# Showcase & Workspace Bugfixes Design

## Date: 2026-02-21

## Issues

### 1. CSS path in generated HTML
- **File**: `src/core/demo-script.ts` line 65
- **Problem**: `<link>` href is `site/styles.css` but the HTML lives at `site/index.html`, making the relative path wrong
- **Fix**: Change href to `styles.css`

### 2. Workspace files blank on first select
- **File**: `src/components/editor/AgentEditor.tsx`
- **Problem**: Monaco editor shows blank content when a file is first selected. Clicking away and back shows the content correctly.
- **Root cause**: Render-time state adjustment sets content via `setContent()`, but Monaco may initialize with the stale empty value before the re-render propagates, especially during its lazy-load phase.
- **Fix**: Add `key={editingFilePath}` to the `<Editor>` component to force a full remount when the file path changes, ensuring Monaco always initializes with the correct VFS content.

### 3. Showcase playback too fast
- **File**: `src/core/scripted-provider.ts`
- **Problem**: Flat `CHUNK_DELAY_MS = 30` makes the entire demo finish in ~3 seconds. Target is ~30 seconds.
- **Fix**: Replace flat delay with variable delays by chunk type:
  - `text` chunks: ~120ms (readable streaming pace)
  - `tool_call` chunks: ~600ms (pause for "tool execution")
  - `done` chunks: ~1200ms (visible pause between agent turns)
- **Math**: (28 text x 120) + (26 tool_call x 600) + (9 done x 1200) = ~30 seconds
