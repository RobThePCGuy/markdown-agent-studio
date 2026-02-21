# Markdown Agent Studio

A visual IDE for building, orchestrating, and observing autonomous AI agent teams.

Define agents in Markdown. Watch them collaborate in real time.

## Features

- Agent definitions in Markdown + YAML frontmatter
- Real-time multi-agent graph visualization
- Inspector for chat logs, events, and memory
- Built-in demo mode (no API key required)
- Gemini provider integration for live runs

## Run From Source

Requires Node.js `20.19+`.

```bash
git clone https://github.com/RobThePCGuy/markdown-agent-studio.git
cd markdown-agent-studio
npm install
npm run dev
```

Open `http://localhost:5173`.

## Configuration

Create a local env file:

```bash
cp .env.example .env.local
```

Set:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

You can also paste an API key in the app settings UI. Keys are stored in browser `localStorage`.

## NPM Package

Install:

```bash
npm install markdown-agent-studio
```

The package exports the built app directory path:

```ts
import distPath from 'markdown-agent-studio';
```

Example with Express:

```ts
import express from 'express';
import distPath from 'markdown-agent-studio';

const app = express();
app.use(express.static(distPath));
app.listen(3000);
```

## Scripts

- `npm run dev` - start Vite dev server
- `npm run lint` - run ESLint
- `npm test` - run Vitest suite
- `npm run build` - typecheck and build production assets
- `npm run check:all` - run lint, test, and build
- `npm run commit:checked -- --message "feat: your change"` - run checks before commit

Checked commit with automatic version rollback on failure:

```bash
npm run commit:checked -- --message "chore(release): v0.1.1" --bump patch --stage-all
```

If checks or commit fail after a version bump, `package.json` and `package-lock.json` are restored.

## Publishing

- `prepublishOnly` runs lint, tests, and build checks automatically.
- `prepack` builds fresh `dist` assets for the npm tarball.

Manual publish:

```bash
npm version patch
npm publish --access public
```

## License

MIT
