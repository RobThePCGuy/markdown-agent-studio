# Markdown Agent Studio

A browser IDE for defining, running, and observing multi-agent workflows from Markdown files.

## Highlights

- Agent definitions in `agents/*.md` with YAML frontmatter.
- Real-time run visualization in a graph view.
- Inspector panels for Chat, Events, and Memory.
- Event-log restore/replay support.
- Built-in scripted demo mode when no API key is provided.
- Gemini-backed live runs when an API key is set.
- Persistent autonomous mission state in `memory/autonomous/*.json` for resume-on-next-run continuity.
- Context rollover support: unfinished queued activations are converted into carryover tasks between cycles.
- Autonomous continuity controls in Settings: mission resume, stop-on-complete, and idle task seeding.
- Scoped command palette search (`agent:`, `file:`, `action:`, `nav:`).
- Keyboard run controls: `Ctrl/Cmd+Enter` (run once), `Ctrl/Cmd+Shift+Enter` (autonomous), `Ctrl/Cmd+Shift+P` (pause/resume), `Ctrl/Cmd+Shift+K` (kill all).
- Workspace explorer kind filters (`Agent/Artifact/Memory/Other`) and `Name/Recent` sort.
- Per-file freshness metadata and unsaved indicators in the explorer list.
- Built-in `Autonomous Learner` template and `Copy FM` action in template picker to copy frontmatter quickly.

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

```bash
cp .env.example .env.local
```

Set:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

## npm Usage

Install:

```bash
npm install markdown-agent-studio
```

Use exported `dist` path:

```ts
import distPath from 'markdown-agent-studio';
```

Run immediately with npx (starts local static server and opens your browser):

```bash
npx markdown-agent-studio
```

Options:
- `--port 4173`
- `--host 127.0.0.1`
- `--no-open`

Or host `distPath` with your own static server.

## Key Commands

- `npm run check:all`
- `npm run release -- patch` (or `minor` / `major`)
- `npm run commit:publish -- --message "chore(release): vX.Y.Z" --bump patch`
- `npm publish --access public` (use `--provenance` only in supported CI, e.g. GitHub Actions)

## Docs

- Full guide: <https://github.com/RobThePCGuy/markdown-agent-studio/blob/main/docs/README_FULL.md>
- Release script: `scripts/release.sh`

## License

MIT
