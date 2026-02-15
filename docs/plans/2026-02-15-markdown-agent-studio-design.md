# Markdown Agent Studio - Design Document

**Date:** 2026-02-15
**Status:** Approved

## Overview

Markdown Agent Studio is a React-based environment where Markdown files are autonomous agents. Each `.md` file serves as an agent's system prompt. Agents can spawn child agents, read and write files, and delegate tasks - creating a recursive, self-assembling system visible through a live graph UI.

The user uploads markdown files, presses Run, and watches a living graph of agents activating, producing outputs, and spawning more agents. Think "prompt-native IDE" where the program is a growing set of markdown files.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Mid (Markdown Agent Studio) | Core magic without over-engineering |
| AI provider | Gemini first, swappable | Abstract behind AIProvider interface |
| Deployment | Local dev only | Vite dev server, .env API key, IndexedDB storage |
| Use case | General purpose / freeform | Build the engine, users bring their own agents |
| Approval mode | Auto with kill switch | Agents auto-run; user can pause/stop globally or per-agent |
| Architecture | Streaming Pipeline (Approach C) | Bounded concurrency with AbortControllers; feels alive without Web Worker complexity |

## Tech Stack

- **React 19 + TypeScript** via Vite
- **Zustand** for state management (file tree, agent registry, run queue, event log)
- **React Flow** for graph visualization
- **Monaco Editor** for viewing/editing .md files in-app
- **IndexedDB** (via `idb`) for workspace persistence across sessions
- **@google/generative-ai** for Gemini, behind an `AIProvider` interface
- **gray-matter** for YAML frontmatter parsing

## Project Structure

```
markdown-agent-studio/
  src/
    core/           # AI abstraction, kernel, scheduler
    stores/         # Zustand state management
    components/     # React UI components
    hooks/          # Custom React hooks
    types/          # TypeScript interfaces
    utils/          # Parsing, validation, helpers
  public/
  .env              # GEMINI_API_KEY
```

---

## 1. AI Abstraction Layer

```typescript
interface AIProvider {
  chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk>;
  abort(sessionId: string): Promise<void>;
}
```

Gemini is the first implementation. Swapping to OpenAI, Anthropic, or Ollama means writing a new class that implements this interface. The `abort` method returns `Promise<void>` so callers can await cleanup when tracking active sessions in the scheduler.

---

## 2. The Kernel & Scheduler

The kernel is the central runtime loop. It owns the activation queue, manages concurrency via a semaphore, and coordinates tool call side effects.

### Core Types

```typescript
interface Activation {
  id: string;
  agentId: string;          // which agent profile to run
  input: string;            // the prompt/task for this activation
  parentId?: string;        // who spawned this (for graph edges)
  spawnDepth: number;       // O(1) depth tracking (parent.depth + 1)
  priority: number;         // lower = sooner
  createdAt: number;
}

interface AgentSession {
  agentId: string;
  activationId: string;
  controller: AbortController;  // per-agent kill
  status: 'running' | 'paused' | 'completed' | 'aborted' | 'error';
  history: Message[];
  toolCalls: ToolCallRecord[];
  tokenCount: number;
}

interface Kernel {
  globalController: AbortController;  // kill-all switch
  maxConcurrency: number;             // semaphore max (default: 3)
  activeSessions: Map<string, AgentSession>;
  queue: Activation[];
  paused: boolean;
}
```

### Scheduling Loop

1. Kernel checks `queue` for the next activation
2. If `activeSessions.size < maxConcurrency` and not `paused`, acquire a semaphore slot
3. Create an `AgentSession` with a new `AbortController`
   - Wire parent-child: `globalController.signal.addEventListener('abort', () => session.controller.abort())`
4. Look up the agent profile from the registry, build the system prompt from the .md body
5. Call `aiProvider.chat()` with the system prompt, input, and tool declarations
6. Stream the response. **Pause granularity is between tool calls** (not between full responses). If `kernel.paused` is true after a tool call completes, the agent waits before processing the next tool call.
7. On each tool call, dispatch to the tool handler (see Section 4)
8. When the stream completes, release the semaphore slot, mark session as `completed`
9. Log the full step to the event log (agent ID, input hashes, tool calls, output diffs, token count)
10. Go back to step 1

### Kill Switch Behavior

- **Kill one agent**: `session.controller.abort()` - streaming fetch cancels, session moves to `aborted`, slot released
- **Kill all**: `globalController.abort()` - all sessions abort, queue paused
- **Pause**: `kernel.paused = true` - no new activations start; running agents pause between tool calls

### Guardrails

| Guardrail | Default | Behavior |
|-----------|---------|----------|
| Depth limit | 5 | Track via `spawnDepth` on Activation. Block spawn if exceeded. |
| Fanout limit | 5 per agent | Count children per agent. Block spawn if exceeded. |
| Loop detection | By `agentId` + input hash | Block repeated (agentId + inputHash) within a run. Uses path-based agentId (not content hash) so self-modifying agents can't escape detection. |
| Token budget | Configurable per run | Kernel pauses when budget reached. |
| Progress rule | 2 strikes | If an agent step produces no tool calls and no file changes, log a warning. After 2 consecutive no-progress steps, halt the agent. |

**Design note on content hash vs agentId for loop detection:** Loop detection uses the path-based `agentId` (which doesn't change when an agent rewrites itself). Content hash is tracked separately for "did this agent's instructions actually change" checks, useful for the UI and event log.

---

## 3. Virtual File System (VFS)

The VFS is the shared state all agents read from and write to. It lives in Zustand with IndexedDB as the persistence layer.

### Data Model

```typescript
interface VFSFile {
  path: string;              // e.g. "agents/researcher.md"
  content: string;
  kind: 'agent' | 'memory' | 'artifact' | 'unknown';
  versions: FileVersion[];
  createdBy?: string;        // agent ID that created it
  createdAt: number;
  updatedAt: number;
}

interface FileVersion {
  timestamp: number;
  content: string;           // full snapshot
  diff: string;              // line-level diff from previous version
  authorAgentId?: string;
  activationId?: string;
}

interface VFSStore {
  files: Map<string, VFSFile>;

  read(path: string): string | null;
  write(path: string, content: string, meta: WriteMeta): void;
  list(prefix: string): string[];
  exists(path: string): boolean;
  delete(path: string): void;
  getVersions(path: string): FileVersion[];

  hydrate(): Promise<void>;     // lazy: metadata first, content on demand
  persist(path: string): void;
}
```

### Kind Derivation

- `agents/` -> `agent`
- `memory/` -> `memory`
- `artifacts/` -> `artifact`
- Everything else -> `unknown`

### Agent Registry (Derived from VFS)

```typescript
interface AgentProfile {
  id: string;               // from frontmatter or derived from filename
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;     // markdown body after frontmatter
  frontmatter: Record<string, any>;
  contentHash: string;
}
```

When any file under `agents/` is written or modified:
1. Parse YAML frontmatter (using `gray-matter`)
2. If parsing fails, log a warning and register with defaults (filename as ID, entire content as system prompt)
3. Extract the markdown body as the system prompt
4. Compute a content hash
5. Update the registry entry
6. If new agent from `spawn_agent`, add Activation with `spawnDepth = parent.spawnDepth + 1`

### Conflict Detection

Track `lastReadBy: Map<string, Set<string>>` mapping file paths to agent IDs that have read them in the current tick. On `vfs_write`, if another active agent has read that file since the writer last read it, log a conflict warning in the event log (don't block).

### Lazy Loading

1. On startup: load file metadata (paths, timestamps, kinds) from IndexedDB
2. Agent profiles under `agents/` are always fully loaded (small, needed for registry)
3. Other file contents loaded on demand (agent reads them, user clicks in UI)
4. When `vfs_list` is called by an agent, batch-prefetch contents for all matched paths

### Error Handling

`vfs_read` on a nonexistent file returns a helpful error with suggestions:
- Levenshtein / prefix matching against existing files
- List of available files
- This goes back into the agent's conversation so it can self-correct

---

## 4. Gemini Tool Declarations

Six tools every agent receives. Agents can both spawn new agents and modify existing ones.

### Tool Set

| Tool | Purpose |
|------|---------|
| `spawn_agent(filename, content, task)` | Create a new agent file and activate it |
| `vfs_read(path)` | Read a file from the workspace |
| `vfs_write(path, content)` | Write or overwrite any file (including agent files) |
| `vfs_list(prefix)` | List files matching a path prefix |
| `vfs_delete(path)` | Delete a file from the workspace |
| `signal_parent(message)` | Send a message to the parent agent, re-activating it |

### Tool Call Results

Every tool returns a human-readable string back into the agent's conversation:

| Tool | Success | Error |
|------|---------|-------|
| `spawn_agent` | `"Created and activated 'researcher.md' (depth 3/5)"` | `"Created 'researcher.md' but activation deferred: token budget reached."` or `"Error: depth limit 5/5."` |
| `vfs_read` | File content | `"Error: 'notes/plan.md' not found. Similar: 'artifacts/plan.md'. Available: [...]"` |
| `vfs_write` | `"Written to 'artifacts/spec.md' (1247 chars)"` | N/A (writes generally succeed) |
| `vfs_list` | `"['agents/writer.md', 'agents/critic.md']"` | `"No files match prefix 'tests/'. Existing prefixes: ['agents/', 'artifacts/', 'memory/']"` (informational, not error) |
| `vfs_delete` | `"Deleted 'memory/old-notes.md'"` | `"Error: file not found"` |
| `signal_parent` | `"Message sent to parent 'orchestrator.md'. Re-activating."` | Root agents can still receive signals (they get re-activated). Only truly parentless agents (none exist by default) would error. |

### Guardrail Enforcement at Tool Level

- `spawn_agent` checks depth limit, fanout limit, and loop detection before creating
- `spawn_agent` is honest about partial success (file created but activation deferred)
- `spawn_agent` description includes a format example for YAML frontmatter to improve Gemini output quality
- All tool calls logged to event log with timestamp, agent ID, activation ID

---

## 5. UI Layout

Three-pane IDE layout. All panes are resizable.

### Top Bar

- Project name / workspace name
- **Run button**: "Run orchestrator.md" with a dropdown to pick a different entry-point agent
- **Kickoff prompt**: Text field next to Run for the initial task ("What should the orchestrator do?")
- **Status**: "3 agents running, 2 in queue, 147K tokens used"
- **Settings gear**: API key, model selection, budget caps
- **Export**: "Download workspace" (zip) and "Export event log" (JSON)

### Left Pane: Workspace Explorer

File tree showing VFS contents:

```
agents/
  orchestrator.md     [running]
  researcher.md       [running]
  writer.md           [idle]
memory/
  decisions.md
artifacts/
  draft-spec.md
```

- Status indicators: running (green), idle (grey), error (red), aborted (yellow)
- Click to open in editor tab
- Drag-and-drop `.md` from desktop (auto-detect frontmatter to route to `agents/` vs `artifacts/`)
- Right-click: delete, duplicate, rename
- "Import folder" and "New file" buttons

### Center Pane: Two Tabs

**Tab 1: Graph View (React Flow)**

Node types:
- **Agent node**: Name, status, token count, spawn depth. Color-coded by status.
- **File artifact node**: Small node, filename, creator.

Edge types:
- **Spawned-by**: Solid arrows (always visible, primary structure)
- **Read/wrote**: Dashed arrows (toggleable, off by default, shown on hover/select)

Features:
- Click agent node -> opens chat log in right pane
- Click file node -> opens in editor tab
- Zoom, pan, auto-layout (dagre/elk)
- Minimap (React Flow native) for large graphs
- "Collapse completed agents" option
- **Floating toolbar**: Kill All (red), Pause/Resume toggle, concurrency slider (1-5), depth limit. Concurrency/depth changes apply to new activations only; currently running agents finish their step.

**Tab 2: Editor (Monaco)**

- Markdown + YAML syntax highlighting
- When editing a running agent: banner warns "This agent is active. Changes saved as draft - click Apply to update."
- Draft mode: edits don't take effect until "Apply" or next activation
- Diff view toggle for version comparison

### Right Pane: Inspector / Chat (Context-Sensitive)

**Agent selected**: Streaming chat log
- Real-time message streaming
- Tool calls displayed inline with **collapsible results** (e.g., `[vfs_read] artifacts/spec.md (1247 chars) >` expands on click)
- Token counter and cost estimate
- "Abort this agent" button
- "Re-activate with new input" text field

**File selected**: File metadata
- Created by, timestamps, version count
- Diff viewer for version history

**Nothing selected**: Global event log
- Chronological stream of all tool calls, file changes, activations, warnings, errors
- Filterable by agent, tool type, severity

---

## 6. Markdown Agent Protocol (MAP)

The on-disk convention for workspace files.

### Workspace Layout

```
agents/       # Agent profiles (executable prompts)
memory/       # Shared state, notes, decisions
artifacts/    # Output deliverables
```

### Agent File Format

YAML frontmatter + markdown body:

```markdown
---
name: "Researcher"
model: "gemini"
---

# MISSION
You are a research specialist.

# INSTRUCTIONS
Find relevant information and write your findings to artifacts/research.md.
If you need help with a subtopic, use spawn_agent to create a specialist.

# OUTPUT FORMAT
Write structured markdown with headers and bullet points.
```

Frontmatter is optional. If missing or malformed, the entire file content becomes the system prompt with defaults (filename as ID, no model override). This keeps the barrier to entry low - any markdown file works as an agent.

---

## 7. Event Log Schema

Every significant action is logged for replay and debugging.

```typescript
interface EventLogEntry {
  timestamp: number;
  type: 'activation' | 'tool_call' | 'tool_result' | 'file_change'
      | 'spawn' | 'signal' | 'warning' | 'error' | 'abort' | 'complete';
  agentId: string;
  activationId: string;
  data: Record<string, any>;  // type-specific payload
}
```

The event log is append-only and exportable as JSON.
