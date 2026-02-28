# Wire Unwired Runtime Features

**Date:** 2026-02-27
**Status:** Approved

## Problem

Four feature groups have plugin code and/or stores written but are not connected to the runtime kernel:

1. **Knowledge Base tools** - `knowledge_query` and `knowledge_contribute` plugins exist but `ctx.vectorStore` is never populated
2. **Pub/Sub messaging** - `publish` and `subscribe` plugins exist, `PubSubStore` exists and is instantiated, but the store isn't passed to the kernel tool context
3. **Blackboard shared state** - `blackboard_write` and `blackboard_read` plugins exist but `ctx.blackboard` is never populated; no proper store exists
4. **Vector memory init()** - `VectorMemoryDB.init()` (required to pre-warm the embedding engine) is never called outside tests

## Approach

Approach B: Minimal wiring with a proper Zustand BlackboardStore.

## Design

### 1. Blackboard Store

Create `src/stores/blackboard-store.ts` following the pattern of `pub-sub-store.ts`:

- State: `entries: Map<string, unknown>`, with `set()`, `get()`, `keys()`, `clear()` methods
- Instantiate as singleton in `use-stores.ts`: `export const blackboardStore = createBlackboardStore()`
- Add `useBlackboardStore` React hook
- Update `ToolContext` interface: replace `blackboard?: Map<string, unknown>` with `blackboardStore?: Store<BlackboardState>`
- Update blackboard plugins to use `ctx.blackboardStore.getState()` instead of `ctx.blackboard`
- Clear the store at run start in `RunController`

### 2. Pub/Sub Wiring

Pass the existing `pubSubStore` singleton through the dependency chain:

- `KernelDeps` (kernel.ts): add `pubSubStore?: Store<PubSubState>`
- `ToolHandlerConfig` (tool-handler.ts): add `pubSubStore?: Store<PubSubState>`
- `Kernel._executeSession`: pass to both ToolHandler constructor sites (lines ~371 and ~662)
- `ToolHandler.handle`: add to ToolContext object
- `RunController.createKernel`: pass `pubSubStore`
- `AutonomousRunner`: pass `pubSubStore` from deps into `new Kernel()`
- Clear the store at run start

No changes to `pub-sub-plugin.ts` - it already works correctly.

### 3. Knowledge Tools & Vector Store

Expose a `vectorStoreAdapter` getter on `MemoryManager`:

- Returns a `ToolContext['vectorStore']`-shaped object when the underlying DB is `VectorMemoryDB`
- Returns `undefined` otherwise
- Adapts `semanticSearch()` return type from `LongTermMemory[]` to `{ type, content, tags, agentId }[]`
- Delegates `markShared()` directly

Wire through the same dependency chain:

- `KernelDeps` gets `vectorStore?: ToolContext['vectorStore']`
- `ToolHandlerConfig` gets the same
- Kernel stores and passes to ToolHandler
- `RunController` and `AutonomousRunner` call `memoryManager.vectorStoreAdapter` and pass result

No changes to `knowledge-query.ts` or `knowledge-contribute.ts` - they already work correctly.

### 4. Vector Memory init()

- Make `RunController.refreshMemoryManager()` async
- After creating the DB, check `instanceof VectorMemoryDB` and call `await db.init()`
- Update all three callers (`run()`, `runAutonomous()`, `runWorkflow()`) to await it
- Import `VectorMemoryDB` in `run-controller.ts`

### 5. BUILT_IN_TOOLS & Events

- Add the six tools to the `BUILT_IN_TOOLS` set in `tool-handler.ts`: `knowledge_query`, `knowledge_contribute`, `publish`, `subscribe`, `blackboard_write`, `blackboard_read`
- Add blackboard-specific event emissions in the blackboard plugin handlers using the existing `blackboard_write` and `blackboard_read` event types from `events.ts`
- Update README to remove "(not yet wired into the runtime)" annotations and the vector memory init caveat

## Files to Change

| File | Change |
|------|--------|
| `src/stores/blackboard-store.ts` | **New** - Zustand store for blackboard |
| `src/stores/use-stores.ts` | Add blackboard store singleton + React hook |
| `src/core/tool-plugin.ts` | Update ToolContext: replace `blackboard` with `blackboardStore`, add import |
| `src/core/tool-handler.ts` | Add `pubSubStore`, `vectorStore`, `blackboardStore` to config and context; update BUILT_IN_TOOLS |
| `src/core/kernel.ts` | Add `pubSubStore`, `vectorStore`, `blackboardStore` to KernelDeps; pass through to ToolHandler |
| `src/core/run-controller.ts` | Pass stores to Kernel; make refreshMemoryManager async; call init(); clear blackboard/pubsub at run start |
| `src/core/autonomous-runner.ts` | Pass stores to Kernel |
| `src/core/memory-manager.ts` | Add `vectorStoreAdapter` getter |
| `src/core/plugins/blackboard-plugin.ts` | Use `ctx.blackboardStore` instead of `ctx.blackboard`; add event logging |
| `README.md` | Remove "not yet wired" annotations |
| Tests | Update affected test files |
