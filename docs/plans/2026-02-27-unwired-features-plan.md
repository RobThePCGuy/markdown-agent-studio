# Wire Unwired Runtime Features - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the four unwired feature groups (blackboard, pub/sub, knowledge tools, vector memory init) to the kernel runtime so agents can use them at runtime.

**Architecture:** Each feature already has plugin code and/or stores written. The work is threading existing stores through the dependency chain: KernelDeps -> Kernel -> ToolHandlerConfig -> ToolContext. The blackboard gets a new Zustand store. The vector memory init gets called eagerly when vector memory is enabled.

**Tech Stack:** TypeScript, Zustand (vanilla stores), Vitest

---

### Task 1: Create Blackboard Store

**Files:**
- Create: `src/stores/blackboard-store.ts`
- Test: `src/stores/blackboard-store.test.ts`

**Step 1: Write the failing test**

```typescript
// src/stores/blackboard-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createBlackboardStore, type BlackboardState } from './blackboard-store';

describe('BlackboardStore', () => {
  let store: { getState: () => BlackboardState };

  beforeEach(() => {
    store = createBlackboardStore();
  });

  it('starts empty', () => {
    expect(store.getState().keys()).toEqual([]);
  });

  it('set and get a value', () => {
    store.getState().set('status', 'running');
    expect(store.getState().get('status')).toBe('running');
  });

  it('keys lists all entries', () => {
    store.getState().set('a', 1);
    store.getState().set('b', 2);
    expect(store.getState().keys()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('clear resets all state', () => {
    store.getState().set('x', 'y');
    store.getState().clear();
    expect(store.getState().keys()).toEqual([]);
    expect(store.getState().get('x')).toBeUndefined();
  });

  it('overwrites existing key', () => {
    store.getState().set('k', 'v1');
    store.getState().set('k', 'v2');
    expect(store.getState().get('k')).toBe('v2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/blackboard-store.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/stores/blackboard-store.ts
import { createStore } from 'zustand/vanilla';

export interface BlackboardState {
  entries: Record<string, unknown>;
  set(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  keys(): string[];
  clear(): void;
}

export function createBlackboardStore() {
  return createStore<BlackboardState>((set, get) => ({
    entries: {},

    set(key, value) {
      set((s) => ({ entries: { ...s.entries, [key]: value } }));
    },

    get(key) {
      return get().entries[key];
    },

    keys() {
      return Object.keys(get().entries);
    },

    clear() {
      set({ entries: {} });
    },
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/blackboard-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/blackboard-store.ts src/stores/blackboard-store.test.ts
git commit -m "feat: add BlackboardStore (Zustand)"
```

---

### Task 2: Register Blackboard Store Singleton

**Files:**
- Modify: `src/stores/use-stores.ts`

**Step 1: Add blackboard store import, singleton, and React hook**

Add to imports:
```typescript
import { createBlackboardStore, type BlackboardState } from './blackboard-store';
```

Add singleton after `pubSubStore` (line 24):
```typescript
export const blackboardStore = createBlackboardStore();
```

Add React hook after `useTaskQueueStore`:
```typescript
export function useBlackboardStore<T>(selector: (state: BlackboardState) => T): T {
  return useStore(blackboardStore, selector);
}
```

**Step 2: Run existing tests to verify no regressions**

Run: `npx vitest run src/stores/`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: register blackboardStore singleton and React hook"
```

---

### Task 3: Update ToolContext Interface

**Files:**
- Modify: `src/core/tool-plugin.ts`

**Step 1: Replace `blackboard` with `blackboardStore` in ToolContext**

Add import:
```typescript
import type { BlackboardState } from '../stores/blackboard-store';
```

Replace line 42:
```typescript
  blackboard?: Map<string, unknown>;
```
with:
```typescript
  blackboardStore?: Store<BlackboardState>;
```

**Step 2: Run type check to verify**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in blackboard-plugin.ts and blackboard-plugin.test.ts (expected - we fix those next)

**Step 3: Commit**

```bash
git add src/core/tool-plugin.ts
git commit -m "refactor: replace blackboard Map with blackboardStore in ToolContext"
```

---

### Task 4: Update Blackboard Plugin

**Files:**
- Modify: `src/core/plugins/blackboard-plugin.ts`
- Modify: `src/core/plugins/blackboard-plugin.test.ts`

**Step 1: Update the test file to test with blackboardStore and event logging**

```typescript
// src/core/plugins/blackboard-plugin.test.ts
import { describe, it, expect } from 'vitest';
import { blackboardReadPlugin, blackboardWritePlugin } from './blackboard-plugin';
import { createBlackboardStore } from '../../stores/blackboard-store';
import { createVFSStore } from '../../stores/vfs-store';
import { createEventLog } from '../../stores/event-log';
import type { ToolContext } from '../tool-plugin';

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  const vfs = createVFSStore();
  const eventLog = createEventLog(vfs);
  return {
    vfs,
    registry: { getState: () => ({}) } as any,
    eventLog,
    currentAgentId: 'agent-1',
    currentActivationId: 'act-1',
    spawnDepth: 0,
    maxDepth: 3,
    maxFanout: 5,
    childCount: 0,
    spawnCount: 0,
    onSpawnActivation: () => {},
    incrementSpawnCount: () => {},
    ...overrides,
  };
}

describe('blackboardWritePlugin', () => {
  it('has correct name', () => {
    expect(blackboardWritePlugin.name).toBe('blackboard_write');
  });

  it('requires key and value', () => {
    expect(blackboardWritePlugin.parameters.key.required).toBe(true);
    expect(blackboardWritePlugin.parameters.value.required).toBe(true);
  });

  it('returns error when blackboardStore is not available', async () => {
    const ctx = makeContext();
    const result = await blackboardWritePlugin.handler({ key: 'k', value: 'v' }, ctx);
    expect(result).toContain('Error');
    expect(result).toContain('Blackboard not available');
  });

  it('writes to the store and emits event', async () => {
    const blackboardStore = createBlackboardStore();
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardWritePlugin.handler({ key: 'status', value: 'done' }, ctx);
    expect(result).toContain('Wrote "status"');
    expect(blackboardStore.getState().get('status')).toBe('done');

    const events = ctx.eventLog.getState().entries;
    const bbEvent = events.find((e) => e.type === 'blackboard_write');
    expect(bbEvent).toBeDefined();
    expect(bbEvent!.data.key).toBe('status');
  });
});

describe('blackboardReadPlugin', () => {
  it('has correct name', () => {
    expect(blackboardReadPlugin.name).toBe('blackboard_read');
  });

  it('returns error when blackboardStore is not available', async () => {
    const ctx = makeContext();
    const result = await blackboardReadPlugin.handler({}, ctx);
    expect(result).toContain('Error');
    expect(result).toContain('Blackboard not available');
  });

  it('lists all keys when no key given', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('a', '1');
    blackboardStore.getState().set('b', '2');
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardReadPlugin.handler({}, ctx);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('reads a specific key', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('color', 'blue');
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardReadPlugin.handler({ key: 'color' }, ctx);
    expect(result).toContain('blue');
  });

  it('emits event on read', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('x', 'y');
    const ctx = makeContext({ blackboardStore });
    await blackboardReadPlugin.handler({ key: 'x' }, ctx);

    const events = ctx.eventLog.getState().entries;
    const bbEvent = events.find((e) => e.type === 'blackboard_read');
    expect(bbEvent).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plugins/blackboard-plugin.test.ts`
Expected: FAIL - plugin still references ctx.blackboard

**Step 3: Update blackboard-plugin.ts**

```typescript
// src/core/plugins/blackboard-plugin.ts
import type { ToolPlugin } from '../tool-plugin';

export const blackboardWritePlugin: ToolPlugin = {
  name: 'blackboard_write',
  description: 'Write a key-value entry to the shared blackboard visible to all agents in this run.',
  parameters: {
    key: { type: 'string', description: 'Key name', required: true },
    value: { type: 'string', description: 'Value to store', required: true },
  },
  async handler(args, ctx) {
    const key = String(args.key || '').trim();
    const value = String(args.value || '');
    if (!key) return 'Error: key is required.';

    if (!ctx.blackboardStore) return 'Error: Blackboard not available.';

    ctx.blackboardStore.getState().set(key, value);

    ctx.eventLog.getState().append({
      type: 'blackboard_write',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { key, value: String(value).slice(0, 200) },
    });

    return `Wrote "${key}" to blackboard.`;
  },
};

export const blackboardReadPlugin: ToolPlugin = {
  name: 'blackboard_read',
  description: 'Read from the shared blackboard. Omit key to list all entries.',
  parameters: {
    key: { type: 'string', description: 'Key to read (omit to list all keys)' },
  },
  async handler(args, ctx) {
    if (!ctx.blackboardStore) return 'Error: Blackboard not available.';

    const state = ctx.blackboardStore.getState();
    const key = args.key ? String(args.key).trim() : '';

    ctx.eventLog.getState().append({
      type: 'blackboard_read',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { key: key || '*' },
    });

    if (!key) {
      const keys = state.keys();
      if (keys.length === 0) return 'Blackboard is empty.';
      return 'Blackboard keys:\n' + keys.map((k) => `- ${k}: ${String(state.get(k)).slice(0, 100)}`).join('\n');
    }

    const value = state.get(key);
    if (value === undefined) return `Key "${key}" not found on blackboard.`;
    return `${key}: ${String(value)}`;
  },
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/plugins/blackboard-plugin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/plugins/blackboard-plugin.ts src/core/plugins/blackboard-plugin.test.ts
git commit -m "feat: update blackboard plugin to use BlackboardStore with event logging"
```

---

### Task 5: Update ToolHandlerConfig and BUILT_IN_TOOLS

**Files:**
- Modify: `src/core/tool-handler.ts`

**Step 1: Add imports**

Add to existing imports:
```typescript
import type { PubSubState } from '../stores/pub-sub-store';
import type { BlackboardState } from '../stores/blackboard-store';
import type { ToolContext } from './tool-plugin';
```

**Step 2: Add six tools to BUILT_IN_TOOLS**

Add to the `BUILT_IN_TOOLS` Set:
```
'knowledge_query',
'knowledge_contribute',
'publish',
'subscribe',
'blackboard_write',
'blackboard_read',
```

**Step 3: Add fields to ToolHandlerConfig**

Add after the `taskQueueStore` field:
```typescript
  pubSubStore?: Store<PubSubState>;
  blackboardStore?: Store<BlackboardState>;
  vectorStore?: ToolContext['vectorStore'];
```

**Step 4: Pass new fields into ToolContext**

In the `handle` method, add to the `ctx` object (after `taskQueueStore` at ~line 105):
```typescript
        pubSubStore: this.config.pubSubStore,
        blackboardStore: this.config.blackboardStore,
        vectorStore: this.config.vectorStore,
```

**Step 5: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in kernel.ts (expected - it doesn't pass these yet)

**Step 6: Commit**

```bash
git add src/core/tool-handler.ts
git commit -m "feat: add pubSub, blackboard, vectorStore to ToolHandlerConfig and BUILT_IN_TOOLS"
```

---

### Task 6: Add vectorStoreAdapter to MemoryManager

**Files:**
- Modify: `src/core/memory-manager.ts`
- Modify: `src/core/memory-manager.test.ts`

**Step 1: Write the failing test**

Add to the end of `src/core/memory-manager.test.ts` (inside or after the existing `MemoryManager with VectorMemoryDB` describe block):

```typescript
describe('MemoryManager.vectorStoreAdapter', () => {
  it('returns undefined for non-vector DB', () => {
    const db = createMemoryDB(createVFSStore());
    const mm = new MemoryManager(db);
    expect(mm.vectorStoreAdapter).toBeUndefined();
  });

  it('returns adapter for VectorMemoryDB', async () => {
    const vectorDb = new VectorMemoryDB({ inMemory: true });
    await vectorDb.init();
    const mm = new MemoryManager(vectorDb);
    const adapter = mm.vectorStoreAdapter;
    expect(adapter).toBeDefined();
    expect(typeof adapter!.semanticSearch).toBe('function');
    expect(typeof adapter!.markShared).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/memory-manager.test.ts`
Expected: FAIL - vectorStoreAdapter does not exist

**Step 3: Write minimal implementation**

Add to `MemoryManager` class (after `getDB()`):

```typescript
  /** Expose a ToolContext-compatible vectorStore when the DB supports it. */
  get vectorStoreAdapter(): {
    semanticSearch: (query: string, agentId: string, limit?: number) => Promise<{ type: string; content: string; tags: string[]; agentId: string }[]>;
    markShared: (id: string, shared: boolean) => Promise<void>;
  } | undefined {
    if (!(this.db instanceof VectorMemoryDB)) return undefined;
    const vectorDb = this.db;
    return {
      async semanticSearch(query, agentId, limit) {
        const results = await vectorDb.semanticSearch(query, agentId, limit);
        return results.map((r) => ({ type: r.type, content: r.content, tags: [...r.tags], agentId: r.agentId }));
      },
      async markShared(id, shared) {
        await vectorDb.markShared(id, shared);
      },
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/memory-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/memory-manager.ts src/core/memory-manager.test.ts
git commit -m "feat: add vectorStoreAdapter getter to MemoryManager"
```

---

### Task 7: Wire Stores Through KernelDeps and Kernel

**Files:**
- Modify: `src/core/kernel.ts`

**Step 1: Add imports**

Add to existing imports:
```typescript
import type { PubSubState } from '../stores/pub-sub-store';
import type { BlackboardState } from '../stores/blackboard-store';
import type { ToolContext } from './tool-plugin';
```

**Step 2: Add fields to KernelDeps**

Add after `taskQueueStore` (line 88):
```typescript
  pubSubStore?: Store<PubSubState>;
  blackboardStore?: Store<BlackboardState>;
  vectorStore?: ToolContext['vectorStore'];
```

**Step 3: Pass to both ToolHandler constructor sites**

In `_executeSession` (~line 371), add to the first ToolHandler constructor:
```typescript
        pubSubStore: this.deps.pubSubStore,
        blackboardStore: this.deps.blackboardStore,
        vectorStore: this.deps.vectorStore,
```

In the second ToolHandler constructor (~line 662), add the same three lines.

**Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in run-controller.ts and autonomous-runner.ts (expected - they don't pass these yet)

**Step 5: Commit**

```bash
git add src/core/kernel.ts
git commit -m "feat: add pubSub, blackboard, vectorStore to KernelDeps"
```

---

### Task 8: Wire RunController

**Files:**
- Modify: `src/core/run-controller.ts`

**Step 1: Add imports**

Add to existing imports:
```typescript
import { pubSubStore, blackboardStore } from '../stores/use-stores';
import { VectorMemoryDB } from './vector-memory-db';
```

**Step 2: Make refreshMemoryManager async and add vector init**

Replace the existing `refreshMemoryManager` method:
```typescript
  private async refreshMemoryManager(config: KernelConfig): Promise<void> {
    const db = createMemoryDB(vfsStore, {
      useVectorStore: config.useVectorMemory ?? false,
    });
    if (db instanceof VectorMemoryDB) {
      await db.init();
    }
    this.memoryManager = new MemoryManager(db);
  }
```

**Step 3: Await refreshMemoryManager in all three run methods**

In `run()` (~line 138): change `this.refreshMemoryManager(config);` to `await this.refreshMemoryManager(config);`

In `runAutonomous()` (~line 190): same change.

In `runWorkflow()` (~line 295): same change (also in `resumeWorkflow` ~line 316).

**Step 4: Add store clearing and passing in run()**

After `sessionStore.getState().clearAll();` in `run()`, add:
```typescript
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();
```

In `createKernel()`, add to the `new Kernel({...})` call:
```typescript
      pubSubStore,
      blackboardStore,
      vectorStore: config.memoryEnabled !== false ? this.memoryManager.vectorStoreAdapter : undefined,
```

**Step 5: Add store clearing in runAutonomous()**

After `sessionStore.getState().clearAll();` in `runAutonomous()`, add:
```typescript
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();
```

In the `new AutonomousRunner()` deps object, add:
```typescript
        pubSubStore,
        blackboardStore,
```

**Step 6: Add store clearing in executeWorkflow()**

After the `sessionStore.getState().clearAll();` call in the `runWorkflow` method body (~line 296), add:
```typescript
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();
```

**Step 7: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors in autonomous-runner.ts (expected - it doesn't accept these deps yet)

**Step 8: Commit**

```bash
git add src/core/run-controller.ts
git commit -m "feat: wire stores through RunController, add vector init"
```

---

### Task 9: Wire AutonomousRunner

**Files:**
- Modify: `src/core/autonomous-runner.ts`

**Step 1: Add imports**

Add to existing imports:
```typescript
import type { PubSubState } from '../stores/pub-sub-store';
import type { BlackboardState } from '../stores/blackboard-store';
import type { ToolContext } from './tool-plugin';
```

**Step 2: Add fields to AutonomousRunnerDeps**

Add after `memoryStore` (line 48):
```typescript
  pubSubStore?: Store<PubSubState>;
  blackboardStore?: Store<BlackboardState>;
```

**Step 3: Pass stores to Kernel constructor**

In the `new Kernel({...})` call (~line 384), add:
```typescript
      pubSubStore: this.deps.pubSubStore,
      blackboardStore: this.deps.blackboardStore,
      vectorStore: this.deps.memoryManager.vectorStoreAdapter,
```

**Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean (no errors)

**Step 5: Commit**

```bash
git add src/core/autonomous-runner.ts
git commit -m "feat: wire stores through AutonomousRunner"
```

---

### Task 10: Update Tool Handler Tests

**Files:**
- Modify: `src/core/tool-handler.test.ts`

**Step 1: Add integration tests for the new tools**

Add the following describe blocks to the existing test file:

```typescript
  describe('blackboard tools (integration)', () => {
    it('blackboard_write stores value and blackboard_read retrieves it', async () => {
      const { createBlackboardStore } = await import('../stores/blackboard-store');
      const bbStore = createBlackboardStore();
      const bbHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/test.md',
        currentActivationId: 'act-bb',
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        blackboardStore: bbStore,
      });

      const writeResult = await bbHandler.handle('blackboard_write', { key: 'goal', value: 'finish task' });
      expect(writeResult).toContain('Wrote "goal"');

      const readResult = await bbHandler.handle('blackboard_read', { key: 'goal' });
      expect(readResult).toContain('finish task');
    });
  });

  describe('pub/sub tools (integration)', () => {
    it('publish and subscribe round-trip', async () => {
      const { createPubSubStore } = await import('../stores/pub-sub-store');
      const psStore = createPubSubStore();
      const psHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/sender.md',
        currentActivationId: 'act-ps',
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        pubSubStore: psStore,
      });

      // Subscribe first
      const subResult = await psHandler.handle('subscribe', { channel: 'updates' });
      expect(subResult).toContain('Subscribed');

      // Publish a message
      const pubResult = await psHandler.handle('publish', { channel: 'updates', message: 'hello world' });
      expect(pubResult).toContain('Published');

      // Check pending messages
      const checkResult = await psHandler.handle('subscribe', { channel: 'updates', check: true });
      expect(checkResult).toContain('hello world');
    });
  });
```

**Step 2: Run tests**

Run: `npx vitest run src/core/tool-handler.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/tool-handler.test.ts
git commit -m "test: add integration tests for blackboard and pub/sub tools"
```

---

### Task 11: Update README

**Files:**
- Modify: `README.md`

**Step 1: Remove "not yet wired" annotations**

Remove `*(not yet wired into the runtime)*` from these sections:
- Knowledge Base tools heading (~line 243)
- Messaging tools heading (~line 250)
- Shared State tools heading (~line 257)

Remove the sentences about stores not being passed to kernel from:
- Inter-Agent Communication > Pub/sub messaging (~line 383): remove "The pub/sub store is not currently passed to the kernel tool context, so these tools will return an error at runtime."
- Inter-Agent Communication > Blackboard (~line 385): remove "The blackboard store is not currently passed to the kernel tool context, so these tools will return an error at runtime."

Remove the vector memory init caveat from Memory System (~line 371): remove "Note: the required `init()` call that loads persisted vectors on startup is not currently invoked in the runtime path, so vectors from previous sessions may not be available until this is addressed."

Also remove from Inter-Agent Communication > Knowledge tools (~line 373): "The `knowledge_contribute` and `knowledge_query` tools are intended for cross-agent knowledge sharing but are not yet connected to the runtime (see [Built-in Tools](#built-in-tools))."

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: remove 'not yet wired' annotations from README"
```

---

### Task 12: Full Verification

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Run lint**

Run: `npm run lint`
Expected: Clean

**Step 4: Run build**

Run: `npm run build`
Expected: Clean build

**Step 5: Commit any fixups if needed, then final verification**

Run: `npm run check:all`
Expected: All checks pass
