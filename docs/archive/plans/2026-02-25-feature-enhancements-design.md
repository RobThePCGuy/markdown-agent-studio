# Feature Enhancements Design: Memory & Orchestration

**Date:** 2026-02-25
**Version:** 0.3.0 -> 0.4.0
**Approach:** Parallel Tracks (Memory + Orchestration developed independently)

## Overview

Two parallel development tracks to enhance Markdown Agent Studio's core capabilities:

- **Track A (Memory & Persistence):** Replace JSON-based memory with rag-vault's embedded engine (LanceDB + Transformers.js), enabling cross-session persistence, semantic retrieval, and shared knowledge graphs.
- **Track B (Execution & Orchestration):** Add MCP client support, richer inter-agent communication primitives, and markdown-defined workflow pipelines.

## Track A: Memory & Persistence

### A1. Embedded rag-vault Engine

Replace `long-term-memory.json` with rag-vault's core engine embedded directly into Agent Studio.

**New dependencies:**
- LanceDB for vector storage (persists to IndexedDB in browser, filesystem when disk-synced)
- Transformers.js with `all-MiniLM-L6-v2` model (~90MB, runs in browser via WebGPU/WASM)

**New modules:**
- `src/core/vector-store.ts` - LanceDB wrapper with Agent Studio-specific schema
- `src/core/embedding-engine.ts` - Transformers.js model lifecycle management

**Memory vector schema:**
```typescript
interface MemoryVector {
  id: string;
  agentId: string;
  content: string;
  type: "skill" | "fact" | "procedure" | "observation" | "mistake" | "preference";
  tags: string[];
  embedding: number[];    // float[384] from MiniLM-L6
  createdAt: number;
  updatedAt: number;
  cycleId?: string;
  shared: boolean;
}
```

**Two-phase memory system adaptation:**
- Phase 1 (Extract): Unchanged - LLM extracts candidate memories from run context
- Phase 2 (Consolidate): Uses vector similarity to find duplicates/related memories instead of sending entire DB to LLM
- CRUD operations target LanceDB instead of JSON file
- Retrieval becomes hybrid search (semantic + keyword) instead of full-file scan

### A2. Cross-Session Persistence

LanceDB provides native persistence:
- **Browser-only mode:** LanceDB tables persist to IndexedDB (survives page reloads)
- **Disk-sync mode:** LanceDB files sync to connected directory alongside project files
- Mission checkpoints (`memory/autonomous/*.json`) reference vector IDs instead of inline memory content

### A3. Shared Knowledge Graph

Collective knowledge structure built on the vector store:

- Memories marked `shared: true` are visible to all agents
- New `knowledge_query` tool plugin: semantic search across shared memories
- New `knowledge_contribute` tool plugin: add to shared knowledge with automatic dedup via vector similarity
- Graph relationships stored as edges in a separate LanceDB table:
  ```typescript
  interface KnowledgeEdge {
    sourceId: string;
    targetId: string;
    relation: string;
    weight: number;
  }
  ```
- Memory Panel gains a "Shared Knowledge" tab showing the collective graph

### Track A Implementation Order

1. `vector-store.ts` + `embedding-engine.ts` (foundation)
2. Migrate two-phase memory system to use vector store
3. Cross-session persistence via IndexedDB/disk-sync
4. `knowledge_query` + `knowledge_contribute` plugins
5. Shared Knowledge tab in Memory Panel

---

## Track B: Execution & Orchestration

### B1. MCP Client Support

Add an MCP client to the plugin system so agents can connect to any MCP-compatible server.

**New modules:**
- `src/core/mcp-client.ts` - manages connections to external MCP servers
- `src/core/plugins/mcp-bridge-plugin.ts` - exposes discovered MCP tools to agents

**Agent frontmatter config:**
```yaml
mcp_servers:
  - name: rag-vault
    transport: stdio
    command: npx github:RobThePCGuy/rag-vault
    env:
      BASE_DIR: ./docs
  - name: my-database
    transport: http
    url: http://localhost:3001
```

**Flow:**
1. Session starts -> kernel reads agent's `mcp_servers` config
2. MCP client connects and discovers tools via `tools/list`
3. Discovered tools registered in ToolPluginRegistry with `mcp:` prefix (e.g., `mcp:rag-vault:query_documents`)
4. Agent calls MCP tool -> bridge plugin routes to appropriate server
5. Results flow back through normal tool response pipeline

**Settings UI:**
- "MCP Servers" section for global server configs (shared across agents)
- Per-agent overrides in frontmatter

### B2. Inter-Agent Communication

Upgrade from spawn/signal to richer messaging patterns:

**Pub/Sub Channels:**
- `publish` tool: agents publish messages to named channels
- `subscribe` tool: agents register interest in channels (kernel delivers on next turn)
- Lightweight - string names, no pre-declaration
- Example: researcher publishes to `findings`, writer subscribes to `findings`

**Shared Blackboard:**
- Named key-value store visible to all agents in a run
- `blackboard_write` tool: set a key with structured data
- `blackboard_read` tool: read a key or list all keys
- Optionally backed by vector store when `shared: true`
- Useful for coordination without direct messaging

**Structured Handoffs:**
- Enhanced `signal_parent` and new `delegate` tool
- `delegate` sends task description + context to a specific agent
- Receiving agent gets it as system message at start of next turn
- Includes metadata: priority, deadline (cycle count), expected output format

### B3. Markdown-Defined Workflows

New file type: `workflows/*.md` with YAML frontmatter defining multi-agent pipelines.

**Workflow definition format:**
```yaml
---
name: Research Pipeline
description: Multi-stage research with review
trigger: manual
steps:
  - id: research
    agent: researcher
    prompt: "Research {topic} thoroughly"
    outputs: [findings]

  - id: review
    agent: reviewer
    depends_on: [research]
    prompt: "Review these findings for accuracy: {research.findings}"
    outputs: [review_report]

  - id: synthesize
    agent: writer
    depends_on: [research, review]
    prompt: "Write a final report incorporating: {research.findings} and addressing: {review.review_report}"
---

# Research Pipeline

This workflow coordinates a three-stage research process...
```

**Built-in workflow templates:**
- **Chain:** Sequential agent handoff (A -> B -> C)
- **Fan-out/Fan-in:** One agent spawns parallel workers, another collects results
- **Debate:** Two agents argue positions, a third judges
- **Review Loop:** Author + reviewer iterate until approval

**Execution:**
- New `src/core/workflow-engine.ts` interprets workflow definitions
- Resolves `depends_on` to build a DAG of steps
- Executes steps in topological order, passing outputs as template variables
- Graph view renders workflow steps as a distinct visual layer

**Visual editing (future phase):**
- Graph view becomes editable - drag agents into workflow canvas
- Connect with edges to define dependencies
- Export visual layout back to markdown

### Track B Implementation Order

1. `mcp-client.ts` + `mcp-bridge-plugin.ts` (foundation)
2. MCP server config in settings + agent frontmatter
3. `publish`/`subscribe`/`blackboard` plugins
4. `delegate` plugin + structured handoffs
5. `workflow-engine.ts` + markdown workflow parser
6. Workflow templates (chain, fan-out, debate, review)

---

## Cross-Track Integration Points

### 1. Shared Blackboard + Vector Store
The blackboard (B2) optionally persists entries to the vector store (A1) when agents mark data as `shared: true`. Coordination data from workflow runs becomes part of the shared knowledge graph - agents in future runs can recall how previous teams solved similar problems.

### 2. MCP + rag-vault
Even with rag-vault's engine embedded (A1), agents can connect to additional rag-vault instances via MCP (B1). Enables "local knowledge + external knowledge" patterns - search project memory AND a separate rag-vault server indexing documentation.

### 3. Workflow Memory
When a workflow completes (B3), the workflow engine triggers memory extraction (A1) scoped to the entire workflow context, not just individual agent sessions. Produces higher-quality memories from full pipeline visibility.

---

## New File Structure

```
project/
  agents/          # Agent definitions (existing)
  workflows/       # NEW - workflow pipeline definitions
  artifacts/       # Run outputs (existing)
  memory/
    autonomous/    # Mission checkpoints (existing)
    vectors/       # NEW - LanceDB storage directory
    knowledge/     # NEW - exported knowledge graph snapshots
```

## New Plugin Summary

| Plugin | Track | Tool Name | Purpose |
|--------|-------|-----------|---------|
| MCP Bridge | B1 | `mcp:*` | Route calls to external MCP servers |
| Knowledge Query | A3 | `knowledge_query` | Semantic search across shared memories |
| Knowledge Contribute | A3 | `knowledge_contribute` | Add to shared knowledge with dedup |
| Publish | B2 | `publish` | Send to named channels |
| Subscribe | B2 | `subscribe` | Register for channel messages |
| Blackboard Read | B2 | `blackboard_read` | Read shared key-value store |
| Blackboard Write | B2 | `blackboard_write` | Write to shared key-value store |
| Delegate | B2 | `delegate` | Structured task handoff to specific agent |

## Testing Strategy

- Unit tests for each new core module (vector-store, embedding-engine, mcp-client, workflow-engine)
- Integration tests for plugin interactions (MCP bridge routing, knowledge graph queries)
- Existing store tests extended for new persistence layer
- Demo workflow templates tested with ScriptedAIProvider (no API key needed)
