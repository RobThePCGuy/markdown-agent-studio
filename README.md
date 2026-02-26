# Markdown Agent Studio

A visual IDE for building AI agents that learn from experience — not from training data or prompt engineering, but from doing the work.

## The Problem with AI Agents Today

Every AI agent created under the same model starts with the same intelligence. We've tried to differentiate them through prompt engineering (telling them what to be) and fine-tuning (showing them what others have done). But neither of these is actual learning. A prompted agent doesn't get better at writing stories by writing stories. It gets the same result every time, from the same static starting point.

Humans don't work this way. We learn by doing, failing, reflecting, and carrying that experience forward. Our entire lives are spent on this loop. AI agents have no equivalent — until now.

## What This Project Does

Markdown Agent Studio is a workspace where agents develop specialization through their own experience.

Here is how it works: you give an agent a task — say, "learn to write better short stories." The agent runs, produces output, and reflects on what it did. On the next run, its memory from the previous session feeds back in. It sees what it tried, what fell flat, what worked. It spawns sub-agents to research narrative structure or study dialogue patterns. When context fills up, a summarizer compresses working memory into long-term knowledge — deduplicating what it already knows, preserving what's new. Run after run, the agent's accumulated knowledge grows deeper and more refined.

The result is an agent that has genuinely specialized — not because a human engineered the right prompt, but because the agent earned its expertise through iterative practice.

## Why Markdown

Most agent tooling forces a choice: write code (powerful but inaccessible) or use a visual builder (accessible but opaque). Agents defined in Markdown sit in the middle. They're plain text files you can read, edit, version-control, and share. The YAML frontmatter configures behavior; the body is the system prompt. No framework lock-in, no proprietary format.

```md
---
name: Story Writer
model: gemini-2.5-flash
tools: [web_search, vfs_write, memory_write, memory_read, spawn_agent]
autonomous:
  max_cycles: 20
  resume_mission: true
---

You are a story writer developing your craft through practice.
Read your memory for lessons from previous sessions before starting.
Write drafts to files. Reflect on what works and what doesn't.
Spawn a critic agent to review your output. Incorporate feedback.
Record what you learned to memory before finishing.
```

That file *is* the agent. No scaffolding code, no configuration UI, no deployment step.

## How the Learning Loop Works

1. **Run** — The agent executes its task, using tools to research, write, and collaborate with sub-agents.
2. **Reflect** — Before the session ends, the agent records what it accomplished, what failed, and what to try next.
3. **Compress** — When context fills up, a summarizer agent distills working memory into long-term knowledge. Duplicates are discarded; new insights are preserved.
4. **Resume** — On the next run, accumulated memory feeds back in. The agent picks up where it left off, building on everything it has learned.

Each cycle makes the agent more capable at its specific task. Not because the model changed, but because the agent's experiential knowledge grew.

## Feature Highlights

### Agent authoring

- Agent definitions in `agents/*.md` with YAML frontmatter
- Monaco editor with live validation
- Template picker and drag/drop Markdown import
- Built-in sample project with a full multi-agent team

### Experiential memory

- Working memory per run with post-run summarization
- Long-term vector-backed memory with semantic retrieval
- Memory compression and deduplication across runs
- Shared vs private memory visibility between agents
- Persistent autonomous checkpoints for session continuity

### Multi-agent orchestration

- Agents can spawn sub-agents for focused tasks
- Markdown-defined workflows with DAG execution
- Dependency-aware step ordering and parallel execution
- Pub/sub messaging and blackboard shared state
- Delegate, signal, and task queue coordination patterns

### Observability

- Live graph visualization of agents and workflow steps
- Inspector tabs for Chat, Events, and Memory
- Event log with checkpoint, restore, and replay
- Run timeline and global controls (pause, resume, kill)
- Keyboard-first command palette

### Integrations

- Gemini, OpenAI, and Anthropic provider support
- MCP server integration (HTTP/SSE/stdio)
- Built-in scripted demo provider (no API key required)

## Getting Started

### Prerequisites

- **Git**: <https://git-scm.com/downloads>
- **Node.js 20.19+**: <https://nodejs.org/>

### Setup

```bash
git clone https://github.com/RobThePCGuy/markdown-agent-studio.git
cd markdown-agent-studio
npm install
npm run dev
```

Open `http://localhost:5173`. Pick an agent, enter a prompt, click **Run**.

No API key? That's fine — the app uses a scripted demo provider automatically so you can explore the full experience first.

### Configuration

```bash
cp .env.example .env.local
```

Add your provider keys:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

If no key is set, demo mode is used. Settings and state are persisted in browser storage.

## How Agent Files Work

Agent files live in `agents/*.md` and use YAML frontmatter for configuration.

```md
---
name: Researcher
model: gemini-2.5-flash
tools: [web_search, vfs_write, memory_write]
---

You are a focused research agent. Produce structured findings and write them to markdown files.
```

## How Workflow Files Work

Workflow files live in `workflows/*.md` and define multi-step pipelines with dependencies.

```md
---
name: Research Pipeline
steps:
  - id: research
    agent: agents/researcher.md
    prompt: "Research {topic}"
  - id: write
    agent: agents/writer.md
    depends_on: [research]
    prompt: "Write from {research.result}"
---
```

## Keyboard Shortcuts

- `Ctrl/Cmd+K` — command palette
- `Ctrl/Cmd+Enter` — run once
- `Ctrl/Cmd+Shift+Enter` — run autonomous
- `Ctrl/Cmd+Shift+P` — pause/resume
- `Ctrl/Cmd+Shift+K` — kill all
- `Ctrl/Cmd+Shift+L` — focus prompt box

## Advanced

### MCP server configuration

Supported transports: `http`, `sse`, and `stdio` with `gatewayUrl` (browser-safe bridge).

```yaml
mcp_servers:
  - name: docs
    transport: http
    url: http://localhost:3000/mcp
  - name: local-tools
    transport: stdio
    command: npx
    args: [my-mcp-server]
    gatewayUrl: http://localhost:3001/mcp
```

### Memory system tuning

In Settings: Enable Memory, Use Vector Memory, Memory Token Budget, and autonomous continuity options (resume/stop/seed).

### Workflow parallelism

`Workflow Parallel Steps` controls max concurrent steps. Use `1` for strict sequential; increase for wider DAG fan-out.

### Running as an npm package

```bash
npx markdown-agent-studio
```

Or install and import:

```bash
npm install markdown-agent-studio
```

```ts
import distPath from 'markdown-agent-studio';
```

Options: `--port 4173`, `--host 127.0.0.1`, `--no-open`

## Development

```bash
npm run dev          # local dev server
npm run lint         # lint checks
npm test             # test suite (51 test files)
npm run build        # typecheck + production build
npm run check:all    # lint + test + build + bundle guard
```

CI runs lint, tests, build, bundle-size guard, and npm dry-run on every push and PR.

### Release

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

## Tech Stack

- React + TypeScript + Vite
- Zustand state management
- React Flow visualization
- Monaco Editor
- MCP SDK
- Transformers.js + IndexedDB-backed vector memory

## Troubleshooting

- **App does not start:** confirm Node version is `20.19+`
- **No AI responses:** confirm your API key in `.env.local`
- **MCP stdio server unavailable in browser:** use `gatewayUrl`
- **Slow first vector search:** expected model warm-up/download

## License

MIT
