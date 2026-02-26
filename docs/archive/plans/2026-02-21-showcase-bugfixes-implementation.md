# Showcase & Workspace Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three bugs: wrong CSS path in generated HTML, blank workspace files on first select, and too-fast showcase playback.

**Architecture:** Three independent bug fixes in separate files. The playback fix replaces a flat delay constant with per-chunk-type delay logic in `ScriptedAIProvider.chat()`. The blank editor fix adds a `key` prop to force Monaco remounts. The CSS path is a one-character fix in a template string.

**Tech Stack:** TypeScript, React, Vitest, @monaco-editor/react

---

### Task 1: Fix CSS path in generated HTML

**Files:**
- Modify: `src/core/demo-script.ts:65`

**Step 1: Fix the href**

In `src/core/demo-script.ts` line 65, change:
```html
<link rel="stylesheet" href="site/styles.css" />
```
to:
```html
<link rel="stylesheet" href="styles.css" />
```

The HTML file lives at `site/index.html`, so the relative path to `site/styles.css` should just be `styles.css`.

**Step 2: Commit**

```bash
git add src/core/demo-script.ts
git commit -m "fix: correct CSS path in demo HTML template"
```

---

### Task 2: Fix workspace files blank on first select

**Files:**
- Modify: `src/components/editor/AgentEditor.tsx:134`

**Step 1: Add key prop to Monaco Editor**

In `src/components/editor/AgentEditor.tsx` line 134, add a `key` prop to force remount when the file changes:

```tsx
          <Editor
            key={editingFilePath}
            height="100%"
```

This ensures Monaco always initializes with the correct `value` from VFS content rather than relying on render-time state updates propagating before Monaco's lazy initialization completes.

**Step 2: Verify the app builds**

```bash
npx vite build 2>&1 | tail -5
```

Expected: Build succeeds with no TypeScript errors.

**Step 3: Commit**

```bash
git add src/components/editor/AgentEditor.tsx
git commit -m "fix: blank editor on first file select by forcing Monaco remount"
```

---

### Task 3: Add variable playback delays by chunk type

**Files:**
- Modify: `src/core/scripted-provider.ts:12,88-96`
- Test: `src/core/scripted-provider.test.ts`

**Step 1: Write a test for variable chunk delays**

Add a new test to `src/core/scripted-provider.test.ts` that verifies different chunk types produce different delays. The test should check that `tool_call` and `done` chunks take longer than `text` chunks:

```typescript
  it('applies longer delays for tool_call and done chunks than text chunks', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'fast text' },
          { type: 'tool_call', toolCall: { id: 'tc-1', name: 'test', args: {} } },
          { type: 'done', tokenCount: 1 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const timestamps: number[] = [];
    for await (const _chunk of provider.chat(makeConfig('s1'), [], [])) {
      timestamps.push(Date.now());
    }

    // 3 chunks = 3 timestamps
    expect(timestamps).toHaveLength(3);

    const textToToolGap = timestamps[1] - timestamps[0];
    const toolToDoneGap = timestamps[2] - timestamps[1];

    // tool_call delay should be noticeably longer than text delay
    // text ~120ms, tool_call ~600ms, done ~1200ms
    // Allow generous margins for CI timing variance
    expect(textToToolGap).toBeGreaterThan(200);
    expect(toolToDoneGap).toBeGreaterThan(500);
  });
```

**Step 2: Run the test to verify it fails**

```bash
npx vitest run src/core/scripted-provider.test.ts 2>&1 | tail -20
```

Expected: FAIL - the flat 30ms delay means all gaps are ~30ms, not >200ms or >500ms.

**Step 3: Replace flat delay with per-chunk-type delays**

In `src/core/scripted-provider.ts`:

1. Replace the constant on line 12:

```typescript
const CHUNK_DELAY_MS = 30;
```

with a delay map:

```typescript
const CHUNK_DELAY_MS: Record<string, number> = {
  text: 120,
  tool_call: 600,
  done: 1200,
  error: 0,
};
```

2. Update the delay line inside the `for` loop (line 94):

```typescript
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
```

becomes:

```typescript
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS[chunk.type] ?? 120));
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run src/core/scripted-provider.test.ts 2>&1 | tail -20
```

Expected: All tests PASS including the new timing test.

**Step 5: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: All tests pass. No regressions.

**Step 6: Commit**

```bash
git add src/core/scripted-provider.ts src/core/scripted-provider.test.ts
git commit -m "fix: slow down showcase playback with variable per-chunk-type delays"
```
