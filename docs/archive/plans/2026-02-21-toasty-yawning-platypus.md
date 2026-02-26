# Fix: Number inputs in Settings cannot be cleared with backspace

## Context

When editing a number field in Settings (e.g. Max Concurrency showing "0" or any value), pressing backspace to clear the field doesn't work. The field snaps back to "0" immediately, so typing "1" produces "01" instead of replacing the value.

**Root cause**: All 5 number inputs use `Number(e.target.value)` in their onChange handlers. When the user backspaces to clear the field, `e.target.value` becomes `""`, and `Number("")` evaluates to `0` in JavaScript. This immediately sets the state back to `0`, so the controlled input never shows an empty field.

## File to modify

`src/components/settings/SettingsModal.tsx` (lines 145-229)

## Approach

Use `e.target.valueAsNumber` (native to `<input type="number">`) with an `isNaN` guard. When the user clears the field, `valueAsNumber` is `NaN` - we simply skip the state update in that case, letting the browser's native input handle the empty display state. When the user types a valid number, we update state normally.

For each of the 5 number inputs, change the onChange from:
```tsx
onChange={(e) => uiStore.getState().setKernelConfig({ maxConcurrency: Number(e.target.value) })}
```
to:
```tsx
onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxConcurrency: v }); }}
```

Also change the `value` prop to `defaultValue` on each input so React doesn't fight the browser's native number input behavior during editing. This lets the user freely edit the field while still initializing from state.

**Affected inputs (5 total):**
1. Line 149 / 150 - Max Concurrency
2. Line 161 / 162 - Max Depth
3. Line 173 / 174 - Max Fanout
4. Line 185 / 186 - Token Budget
5. Line 221 / 224 - Memory Token Budget

## Verification

1. Open the app, go to Settings
2. For each number field: click into it, select all / backspace to clear, type a new number - it should replace cleanly
3. Confirm that valid values are still persisted (close and reopen Settings to check)
