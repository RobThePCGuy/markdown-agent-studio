# Markdown Agent Studio (Full Guide)

Markdown Agent Studio is a browser IDE for defining, running, and observing multi-agent workflows from Markdown files.

## What You Can Do

- Define agents in `agents/*.md` with YAML frontmatter (name, permissions, reads/writes, tools).
- Run from a selected agent + kickoff prompt, then pause/resume/kill active runs.
- Watch agent activity in a live graph view with spawn/signal/web/thinking overlays.
- Inspect per-agent Chat, Events, and Memory panels while runs execute.
- Restore or replay from event-log checkpoints.
- Edit Markdown files in Monaco with validation markers and template workflows.
- Drag and drop `.md` files into the workspace (agent files with frontmatter are auto-registered).
- Connect a local folder via File System Access (`showDirectoryPicker`) for disk-backed projects.
- Use command palette (`Ctrl/Cmd + K`) for navigation and quick actions, including scoped search (`agent:`, `file:`, `action:`, `nav:`).
- Control runs from anywhere with keyboard shortcuts: `Ctrl/Cmd+Enter` (run once), `Ctrl/Cmd+Shift+Enter` (autonomous), `Ctrl/Cmd+Shift+P` (pause/resume), `Ctrl/Cmd+Shift+K` (kill all), `Ctrl/Cmd+Shift+L` (focus prompt).
- Filter workspace files directly in the explorer with kind toggles (`Agent/Artifact/Memory/Other`) and sort by `Name` or `Recent`.
- Track freshness and editing state with per-file relative update metadata and unsaved markers in the explorer list.
- Create quick starter files from explorer actions (`+A` agent, `+N` note).
- Start from a built-in `Autonomous Learner` template and copy any template frontmatter with `Copy FM`.
- Run persistent autonomous missions that resume from `memory/autonomous/*.json` with task queue continuity across launches.
- Rollover incomplete cycle work into carryover tasks when context/token limits interrupt a cycle.
- Tune autonomous continuity behavior from Settings (`Resume Previous Mission`, `Stop When Complete`, `Seed Continuation Tasks`).

## Run Modes

- With an API key, runs use `GeminiProvider`.
- Without an API key (or with placeholder key), runs use `ScriptedAIProvider` with the built-in demo script.
- On first onboarding for a fresh workspace, the app loads a 6-agent sample project and preselects the project lead with prompt `Build me a portfolio website`.

## Quick Start

Requires Node.js `20.19+`.

```bash
git clone https://github.com/RobThePCGuy/markdown-agent-studio.git
cd markdown-agent-studio
npm install
npm run dev
```

Open `http://localhost:5173`.

## Configuration

Create local env file:

```bash
cp .env.example .env.local
```

Set:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

Notes:
- API key, kernel config, onboarding flag, and sound preference are persisted in browser `localStorage`.
- Long-term memory is stored in IndexedDB (`mas-long-term-memory`) when available.

## Autonomous Continuity

- Autonomous runs are chunked into cycles. At the end of each cycle, working memory + session history are summarized into long-term memory (when an API key is set).
- Mission progress is checkpointed to `memory/autonomous/*.json`, including:
  - mission prompt and cycle counters
  - cumulative token usage
  - task queue snapshot
  - short cycle notes for next-cycle context
- If a cycle ends with queued activations (for example after token budget pause), those activations are preserved as carryover tasks so the next cycle can continue where it left off.
- By default, autonomous mode resumes the previous mission for the same agent only when the mission prompt matches.

## NPM Package

Install:

```bash
npm install markdown-agent-studio
```

The package exports the built app directory path:

```ts
import distPath from 'markdown-agent-studio';
```

Quick-run CLI is available:

```bash
npx markdown-agent-studio
```

CLI options:
- `--port 4173`
- `--host 127.0.0.1`
- `--no-open`

You can also serve the exported `distPath` with your own static host.

Example (Express static hosting):

```ts
import express from 'express';
import distPath from 'markdown-agent-studio';

const app = express();
app.use(express.static(distPath));
app.listen(3000);
```

Published package contents are intentionally minimal:
- `dist/`
- `index.js`
- `index.d.ts`
- `README.md`
- `LICENSE`

## Scripts

- `npm run dev` - start Vite dev server
- `npm run lint` - run ESLint
- `npm test` - run Vitest
- `npm run build` - typecheck + production build
- `npm run check:all` - lint + test + build
- `npm run release -- patch` - full release flow (checks, version bump, commit, tag, npm publish, push)
- `npm run commit:checked -- --message "feat: ..."` - checked commit routine
- `npm run commit:publish -- --message "chore(release): vX.Y.Z" --bump patch` - checked release commit with publish-scope staging

If checks fail after a version bump, `package.json` and `package-lock.json` are restored automatically.

## CI and Publish Workflows

- CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`, executing lint/test/build and npm dry-run packaging.
- Publish (`.github/workflows/publish.yml`) runs on release publish (or manual dispatch), verifies lint/test/build, then publishes to npm using `NPM_TOKEN`.

## Release Notes

- Use `scripts/release.sh` for the repeatable release flow.
- Local publish: `npm publish --access public` (skip `--provenance` unless provider support is available).
- `prepublishOnly` runs lint + test.
- `prepack` builds fresh `dist` before packing/publishing.

## Tech Stack

React, TypeScript, Vite, Zustand, React Flow (`@xyflow/react`), Monaco Editor, and Google Generative AI SDK.

## License

MIT
