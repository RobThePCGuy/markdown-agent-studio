# Markdown Agent Studio

A visual IDE for building, running, and observing multi-agent AI workflows from Markdown files.

This `README.md` is the **single source of truth** for setup, usage, architecture, and release workflow.

## Why This Project Exists

Most agent tooling is either:

- Prompt-only (hard to track state and outputs)
- Code-only (hard for non-engineers to use)
- Black-box (hard to debug multi-agent behavior)

Markdown Agent Studio gives you a practical middle ground:

- Define agents in plain Markdown
- Run them in a browser workspace
- See exactly what happened (tools, files, memory, events, workflow steps)

## Feature Highlights

### Agent authoring and workspace UX

- Agent definitions in `agents/*.md` with YAML frontmatter
- Monaco editor with live validation for agent files
- Template picker for rapid agent creation
- Built-in sample project and onboarding flow
- Drag/drop Markdown import

### Execution and orchestration

- Single runs and autonomous cycle mode
- Markdown-defined workflows in `workflows/*.md`
- Workflow DAG execution with dependency-aware ordering
- Resume failed workflows with captured step outputs
- Workflow output file generation in `outputs/*.md`

### Memory and knowledge

- Working memory per run with post-run summarization
- Vector-backed long-term memory (optional)
- Semantic retrieval with filters and diagnostics
- Shared vs private memory visibility rules
- Persistent autonomous checkpoints in `memory/autonomous/*.json`

### Observability and control

- Live graph visualization of agents and workflow steps
- Inspector tabs for Chat, Events, and Memory
- Event log checkpoints + restore/replay
- Global run controls: pause, resume, kill
- Keyboard-first command palette and shortcuts

### Integrations

- Gemini, OpenAI, Anthropic provider support
- MCP server integration (HTTP/SSE)
- Browser-safe stdio gateway option for MCP (`gatewayUrl`)
- Built-in scripted demo provider (no API key required)

## Getting Started (Beginner-Friendly)

If you are new to GitHub or local development, follow this exactly.

### 1. Install required tools

- Install **Git**: <https://git-scm.com/downloads>
- Install **Node.js 20.19+**: <https://nodejs.org/>

Check installs:

```bash
git --version
node --version
npm --version
```

### 2. Download this project

```bash
git clone https://github.com/RobThePCGuy/markdown-agent-studio.git
cd markdown-agent-studio
```

### 3. Install dependencies

```bash
npm install
```

### 4. Start the app

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 5. First run experience

- Pick an agent in the left panel
- Enter a kickoff prompt
- Click **Run**
- Watch progress in Graph + Inspector panels

No API key yet? That is fine. The app uses a scripted demo provider automatically.

## Configuration

Create local env file:

```bash
cp .env.example .env.local
```

Then add keys you want to use:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

Notes:

- If no usable key is set, demo mode is used
- Settings and onboarding state are persisted in browser storage

## How Agent Files Work

Agent files live in `agents/*.md` and use YAML frontmatter.

Example:

```md
---
name: Researcher
model: gemini-2.5-flash
tools: [web_search, vfs_write, memory_write]
---

You are a focused research agent. Produce structured findings and write them to markdown files.
```

## How Workflow Files Work

Workflow files live in `workflows/*.md` and define step dependencies.

Example:

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

- `Ctrl/Cmd+K`: command palette
- `Ctrl/Cmd+Enter`: run once
- `Ctrl/Cmd+Shift+Enter`: run autonomous
- `Ctrl/Cmd+Shift+P`: pause/resume
- `Ctrl/Cmd+Shift+K`: kill all
- `Ctrl/Cmd+Shift+L`: focus prompt box

## Advanced

### MCP server configuration

Global MCP servers are configured in Settings and persisted in local storage.

Supported transports:

- `http`
- `sse`
- `stdio` with `gatewayUrl` (browser-safe bridge)

Example config shape:

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

In Settings you can control:

- `Enable Memory`
- `Use Vector Memory`
- `Memory Token Budget`
- Autonomous continuity options (resume/stop/seed)

### Workflow parallelism

`Workflow Parallel Steps` controls max concurrent runnable steps in workflows.  
Use `1` for strict sequential behavior; increase for wider DAG fan-out.

### Running as an npm package

Install:

```bash
npm install markdown-agent-studio
```

Use exported dist path:

```ts
import distPath from 'markdown-agent-studio';
```

Quick-run:

```bash
npx markdown-agent-studio
```

Options:

- `--port 4173`
- `--host 127.0.0.1`
- `--no-open`

## Development and Quality Gates

Common scripts:

- `npm run dev`: local development server
- `npm run lint`: lint checks
- `npm test`: test suite
- `npm run build`: typecheck + production build
- `npm run check:bundle`: bundle-size guard
- `npm run check:all`: lint + test + build + bundle guard

CI runs:

- Lint
- Tests
- Build
- Bundle-size guard
- npm package dry-run

## Release Workflow

Patch/minor/major release scripts:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Checked commit helpers:

```bash
npm run commit:checked -- --message "feat: your change"
npm run commit:publish -- --message "chore(release): vX.Y.Z" --bump patch
```

## Tech Stack

- React + TypeScript + Vite
- Zustand state management
- React Flow visualization
- Monaco Editor
- MCP SDK
- Transformers.js + IndexedDB-backed vector memory

## Troubleshooting

- App does not start: confirm Node version is `20.19+`
- No AI responses: confirm your API key in `.env.local`
- MCP stdio server unavailable in browser: use `gatewayUrl`
- Slow first vector search: expected model warm-up/download

## License

MIT
