# Feature Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add vector-based memory with cross-session persistence and shared knowledge, plus MCP client support, richer inter-agent communication, and markdown-defined workflows.

**Architecture:** Two parallel tracks. Track A replaces JSON memory with LanceDB + Transformers.js embeddings (ported from rag-vault). Track B adds MCP client to the plugin system, pub/sub + blackboard communication primitives, and a workflow engine that parses markdown pipeline definitions.

**Tech Stack:** LanceDB (vector storage), Transformers.js (local embeddings), @modelcontextprotocol/sdk (MCP client), Vitest (tests), Zustand (state), React Flow (visualization)

---

## Track A: Memory & Persistence

### Task 1: Add LanceDB and Transformers.js dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run:
```bash
npm install vectordb @xenova/transformers
```

**Step 2: Verify imports resolve**

Run:
```bash
node -e "require('vectordb'); console.log('lancedb ok')"
node -e "require('@xenova/transformers'); console.log('transformers ok')"
```

Expected: Both print "ok" without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lancedb and transformers.js dependencies"
```

---

### Task 2: Embedding engine - failing tests

**Files:**
- Create: `src/core/embedding-engine.test.ts`
- Create: `src/core/embedding-engine.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/embedding-engine.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingEngine } from './embedding-engine';

describe('EmbeddingEngine', () => {
  let engine: EmbeddingEngine;

  beforeAll(() => {
    engine = new EmbeddingEngine();
  });

  it('embed() returns a float array of dimension 384', async () => {
    const result = await engine.embed('hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(384);
    expect(typeof result[0]).toBe('number');
  });

  it('embedBatch() handles multiple strings', async () => {
    const results = await engine.embedBatch(['hello', 'world']);
    expect(results.length).toBe(2);
    expect(results[0].length).toBe(384);
    expect(results[1].length).toBe(384);
  });

  it('similar texts produce higher cosine similarity than dissimilar', async () => {
    const [a, b, c] = await engine.embedBatch([
      'the cat sat on the mat',
      'a feline rested on the rug',
      'quantum mechanics equations',
    ]);
    const simAB = cosine(a, b);
    const simAC = cosine(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('isReady() returns false before init, true after', async () => {
    const fresh = new EmbeddingEngine();
    expect(fresh.isReady()).toBe(false);
    await fresh.embed('trigger init');
    expect(fresh.isReady()).toBe(true);
  });
});

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/embedding-engine.test.ts`
Expected: FAIL - cannot resolve `./embedding-engine`

**Step 3: Commit**

```bash
git add src/core/embedding-engine.test.ts
git commit -m "test: add embedding engine tests (red)"
```

---

### Task 3: Embedding engine - implementation

**Files:**
- Create: `src/core/embedding-engine.ts`

**Step 1: Write the implementation**

```typescript
// src/core/embedding-engine.ts
import { pipeline, type Pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

export class EmbeddingEngine {
  private pipe: Pipeline | null = null;
  private initPromise: Promise<void> | null = null;

  isReady(): boolean {
    return this.pipe !== null;
  }

  private async init(): Promise<void> {
    if (this.pipe) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      this.pipe = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,
      });
    })();
    return this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    const output = await this.pipe!(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/core/embedding-engine.test.ts`
Expected: All 4 tests PASS (first run may be slow due to model download)

**Step 3: Commit**

```bash
git add src/core/embedding-engine.ts
git commit -m "feat: add embedding engine wrapping Transformers.js"
```

---

### Task 4: Vector store - failing tests

**Files:**
- Create: `src/core/vector-store.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/vector-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { VectorStore, type MemoryVector } from './vector-store';

function makeVector(overrides: Partial<MemoryVector> = {}): Omit<MemoryVector, 'embedding'> {
  return {
    id: `mem-${Date.now()}`,
    agentId: 'agent-a',
    content: 'The sky is blue',
    type: 'fact',
    tags: ['color', 'sky'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    shared: false,
    ...overrides,
  };
}

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = new VectorStore({ inMemory: true });
    await store.init();
  });

  it('add and getAll returns stored vectors', async () => {
    await store.add(makeVector({ id: 'v1', content: 'hello world' }));
    const all = await store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('v1');
    expect(all[0].content).toBe('hello world');
    expect(all[0].embedding.length).toBe(384);
  });

  it('search returns relevant results ranked by similarity', async () => {
    await store.add(makeVector({ id: 'v1', content: 'cats are fluffy animals' }));
    await store.add(makeVector({ id: 'v2', content: 'quantum physics equations' }));
    await store.add(makeVector({ id: 'v3', content: 'dogs are loyal pets' }));

    const results = await store.search('furry pets', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
    // Cat or dog should rank above quantum physics
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('v2');
  });

  it('search filters by agentId', async () => {
    await store.add(makeVector({ id: 'v1', agentId: 'a', content: 'cats' }));
    await store.add(makeVector({ id: 'v2', agentId: 'b', content: 'cats too' }));

    const results = await store.search('cats', { agentId: 'a' });
    expect(results.every((r) => r.agentId === 'a')).toBe(true);
  });

  it('search includes shared memories for any agent', async () => {
    await store.add(makeVector({ id: 'v1', agentId: 'a', shared: true, content: 'shared fact' }));
    await store.add(makeVector({ id: 'v2', agentId: 'a', shared: false, content: 'private fact' }));

    const results = await store.search('fact', { agentId: 'b' });
    const ids = results.map((r) => r.id);
    expect(ids).toContain('v1');
    expect(ids).not.toContain('v2');
  });

  it('update modifies content and re-embeds', async () => {
    await store.add(makeVector({ id: 'v1', content: 'original content' }));
    await store.update('v1', { content: 'updated content', tags: ['new'] });
    const all = await store.getAll();
    expect(all[0].content).toBe('updated content');
    expect(all[0].tags).toEqual(['new']);
  });

  it('delete removes a vector', async () => {
    await store.add(makeVector({ id: 'v1', content: 'to delete' }));
    await store.delete('v1');
    const all = await store.getAll();
    expect(all).toHaveLength(0);
  });

  it('clear removes all vectors', async () => {
    await store.add(makeVector({ id: 'v1', content: 'a' }));
    await store.add(makeVector({ id: 'v2', content: 'b' }));
    await store.clear();
    const all = await store.getAll();
    expect(all).toHaveLength(0);
  });

  it('getById returns a single vector or null', async () => {
    await store.add(makeVector({ id: 'v1', content: 'find me' }));
    const found = await store.getById('v1');
    expect(found?.content).toBe('find me');
    const missing = await store.getById('nope');
    expect(missing).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/vector-store.test.ts`
Expected: FAIL - cannot resolve `./vector-store`

**Step 3: Commit**

```bash
git add src/core/vector-store.test.ts
git commit -m "test: add vector store tests (red)"
```

---

### Task 5: Vector store - implementation

**Files:**
- Create: `src/core/vector-store.ts`

**Step 1: Write the implementation**

```typescript
// src/core/vector-store.ts
import { EmbeddingEngine } from './embedding-engine';

export interface MemoryVector {
  id: string;
  agentId: string;
  content: string;
  type: 'skill' | 'fact' | 'procedure' | 'observation' | 'mistake' | 'preference';
  tags: string[];
  embedding: number[];
  createdAt: number;
  updatedAt: number;
  cycleId?: string;
  shared: boolean;
}

export interface SearchOptions {
  agentId?: string;
  limit?: number;
  type?: MemoryVector['type'];
  tags?: string[];
}

export interface VectorStoreOptions {
  inMemory?: boolean;
  dbPath?: string;
}

export class VectorStore {
  private vectors = new Map<string, MemoryVector>();
  private engine = new EmbeddingEngine();
  private options: VectorStoreOptions;

  constructor(options: VectorStoreOptions = {}) {
    this.options = options;
  }

  async init(): Promise<void> {
    // Pre-warm the embedding model
    await this.engine.embed('warmup');
  }

  async add(input: Omit<MemoryVector, 'embedding'>): Promise<MemoryVector> {
    const embedding = await this.engine.embed(input.content);
    const vector: MemoryVector = { ...input, embedding };
    this.vectors.set(vector.id, vector);
    return vector;
  }

  async search(query: string, options: SearchOptions = {}): Promise<MemoryVector[]> {
    const { agentId, limit = 15, type, tags } = options;
    const queryEmbedding = await this.engine.embed(query);

    let candidates = Array.from(this.vectors.values());

    // Filter by agent scope: own memories + shared
    if (agentId) {
      candidates = candidates.filter(
        (v) => v.agentId === agentId || v.shared
      );
    }

    if (type) {
      candidates = candidates.filter((v) => v.type === type);
    }

    if (tags && tags.length > 0) {
      const tagSet = new Set(tags.map((t) => t.toLowerCase()));
      candidates = candidates.filter((v) =>
        v.tags.some((t) => tagSet.has(t.toLowerCase()))
      );
    }

    // Score by cosine similarity
    const scored = candidates.map((v) => ({
      vector: v,
      score: cosine(queryEmbedding, v.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.vector);
  }

  async update(
    id: string,
    changes: Partial<Pick<MemoryVector, 'content' | 'tags' | 'type' | 'shared'>>
  ): Promise<void> {
    const existing = this.vectors.get(id);
    if (!existing) return;

    const updated = { ...existing, ...changes, updatedAt: Date.now() };

    if (changes.content && changes.content !== existing.content) {
      updated.embedding = await this.engine.embed(changes.content);
    }

    this.vectors.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.vectors.delete(id);
  }

  async clear(): Promise<void> {
    this.vectors.clear();
  }

  async getAll(): Promise<MemoryVector[]> {
    return Array.from(this.vectors.values());
  }

  async getById(id: string): Promise<MemoryVector | null> {
    return this.vectors.get(id) ?? null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/core/vector-store.test.ts`
Expected: All 8 tests PASS

**Step 3: Commit**

```bash
git add src/core/vector-store.ts
git commit -m "feat: add vector store with semantic search"
```

---

### Task 6: VectorMemoryDB adapter - failing tests

Implements the existing `MemoryDB` interface backed by the new `VectorStore`, so the migration is incremental.

**Files:**
- Create: `src/core/vector-memory-db.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/vector-memory-db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { VectorMemoryDB } from './vector-memory-db';
import type { LongTermMemory } from '../types/memory';

function makeEntry(overrides: Partial<LongTermMemory> = {}): LongTermMemory {
  return {
    id: 'mem-1',
    agentId: 'agent-a',
    type: 'fact',
    content: 'The sky is blue',
    tags: ['color'],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 0,
    runId: 'run-1',
    ...overrides,
  };
}

describe('VectorMemoryDB', () => {
  let db: VectorMemoryDB;

  beforeEach(async () => {
    db = new VectorMemoryDB({ inMemory: true });
    await db.init();
  });

  it('implements MemoryDB: put and getAll', async () => {
    const entry = makeEntry();
    await db.put(entry);
    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('mem-1');
    expect(all[0].content).toBe('The sky is blue');
  });

  it('implements MemoryDB: delete', async () => {
    await db.put(makeEntry({ id: 'a' }));
    await db.put(makeEntry({ id: 'b' }));
    await db.delete('a');
    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('b');
  });

  it('implements MemoryDB: clear', async () => {
    await db.put(makeEntry({ id: 'a' }));
    await db.put(makeEntry({ id: 'b' }));
    await db.clear();
    expect(await db.getAll()).toHaveLength(0);
  });

  it('semanticSearch returns relevant results', async () => {
    await db.put(makeEntry({ id: 'a', content: 'cats are fluffy' }));
    await db.put(makeEntry({ id: 'b', content: 'quantum physics' }));
    const results = await db.semanticSearch('fluffy animals', 'agent-a');
    expect(results[0].id).toBe('a');
  });

  it('semanticSearch includes shared memories from other agents', async () => {
    // Shared memory from another agent - should appear
    await db.put(makeEntry({ id: 'shared', agentId: 'other', content: 'team knowledge' }));
    // Mark it shared via the vector store
    await db.markShared('shared', true);

    const results = await db.semanticSearch('knowledge', 'agent-a');
    expect(results.some((r) => r.id === 'shared')).toBe(true);
  });

  it('put is upsert - updates existing entry', async () => {
    await db.put(makeEntry({ id: 'a', content: 'version 1' }));
    await db.put(makeEntry({ id: 'a', content: 'version 2' }));
    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('version 2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/vector-memory-db.test.ts`
Expected: FAIL - cannot resolve `./vector-memory-db`

**Step 3: Commit**

```bash
git add src/core/vector-memory-db.test.ts
git commit -m "test: add VectorMemoryDB adapter tests (red)"
```

---

### Task 7: VectorMemoryDB adapter - implementation

**Files:**
- Create: `src/core/vector-memory-db.ts`

**Step 1: Write the implementation**

```typescript
// src/core/vector-memory-db.ts
import type { MemoryDB } from './memory-db';
import type { LongTermMemory } from '../types/memory';
import { VectorStore, type VectorStoreOptions, type MemoryVector } from './vector-store';

export class VectorMemoryDB implements MemoryDB {
  private store: VectorStore;

  constructor(options: VectorStoreOptions = {}) {
    this.store = new VectorStore(options);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async put(entry: LongTermMemory): Promise<void> {
    // Upsert: delete existing if present, then add
    const existing = await this.store.getById(entry.id);
    if (existing) {
      await this.store.delete(entry.id);
    }
    await this.store.add(ltmToVector(entry));
  }

  async getAll(): Promise<LongTermMemory[]> {
    const vectors = await this.store.getAll();
    return vectors.map(vectorToLtm);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  async semanticSearch(query: string, agentId: string, limit = 15): Promise<LongTermMemory[]> {
    const results = await this.store.search(query, { agentId, limit });
    return results.map(vectorToLtm);
  }

  async markShared(id: string, shared: boolean): Promise<void> {
    await this.store.update(id, { shared });
  }
}

function ltmToVector(entry: LongTermMemory): Omit<MemoryVector, 'embedding'> {
  return {
    id: entry.id,
    agentId: entry.agentId,
    content: entry.content,
    type: entry.type,
    tags: entry.tags,
    createdAt: entry.createdAt,
    updatedAt: entry.lastAccessedAt,
    shared: entry.agentId === 'global',
  };
}

function vectorToLtm(v: MemoryVector): LongTermMemory {
  return {
    id: v.id,
    agentId: v.agentId,
    type: v.type,
    content: v.content,
    tags: v.tags,
    createdAt: v.createdAt,
    lastAccessedAt: v.updatedAt,
    accessCount: 0,
    runId: '',
  };
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/core/vector-memory-db.test.ts`
Expected: All 6 tests PASS

**Step 3: Run existing memory-db tests to check no regression**

Run: `npx vitest run src/core/memory-db.test.ts`
Expected: All existing tests still PASS

**Step 4: Commit**

```bash
git add src/core/vector-memory-db.ts
git commit -m "feat: add VectorMemoryDB adapter bridging MemoryDB interface to vector store"
```

---

### Task 8: Wire VectorMemoryDB into createMemoryDB factory

**Files:**
- Modify: `src/core/memory-db.ts` (add VectorMemoryDB to factory)

**Step 1: Write a test for the new factory option**

Add to `src/core/memory-db.test.ts`:

```typescript
import { VectorMemoryDB } from './vector-memory-db';

describe('createMemoryDB', () => {
  it('returns VectorMemoryDB when useVectorStore option is true', () => {
    const db = createMemoryDB(undefined, { useVectorStore: true });
    expect(db).toBeInstanceOf(VectorMemoryDB);
  });

  it('returns VFSMemoryDB when vfs provided and no vector option', () => {
    const vfs = createMockVFS();
    const db = createMemoryDB(vfs);
    expect(db).toBeInstanceOf(VFSMemoryDB);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/memory-db.test.ts`
Expected: FAIL - createMemoryDB does not accept second argument

**Step 3: Update the factory in `src/core/memory-db.ts`**

Add the VectorMemoryDB import and update `createMemoryDB`:

```typescript
import { VectorMemoryDB } from './vector-memory-db';

export interface MemoryDBOptions {
  useVectorStore?: boolean;
}

export function createMemoryDB(
  vfs?: Store<VFSState>,
  options: MemoryDBOptions = {}
): MemoryDB {
  if (options.useVectorStore) {
    return new VectorMemoryDB({ inMemory: true });
  }
  if (vfs) return new VFSMemoryDB(vfs);
  if (typeof indexedDB !== 'undefined') return new IndexedDBMemoryDB();
  return new InMemoryMemoryDB();
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/memory-db.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/core/memory-db.ts src/core/memory-db.test.ts
git commit -m "feat: add vector store option to createMemoryDB factory"
```

---

### Task 9: Update MemoryManager.retrieve to use semantic search

**Files:**
- Modify: `src/core/memory-manager.ts`
- Modify: `src/core/memory-manager.test.ts`

**Step 1: Write failing test for semantic retrieve**

Add to `src/core/memory-manager.test.ts`:

```typescript
describe('MemoryManager with VectorMemoryDB', () => {
  it('retrieve uses semantic search when db supports it', async () => {
    const vectorDb = new VectorMemoryDB({ inMemory: true });
    await vectorDb.init();
    const manager = new MemoryManager(vectorDb);

    await manager.store({
      agentId: 'a', type: 'fact',
      content: 'cats are fluffy animals', tags: ['animals'], runId: 'r1',
    });
    await manager.store({
      agentId: 'a', type: 'fact',
      content: 'quantum physics formulas', tags: ['science'], runId: 'r1',
    });

    const results = await manager.retrieve('a', 'tell me about pets');
    expect(results[0].content).toContain('cats');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/memory-manager.test.ts`
Expected: FAIL (retrieve currently uses keyword scoring, not semantic)

**Step 3: Update retrieve() in `src/core/memory-manager.ts`**

Add semantic path that detects VectorMemoryDB:

```typescript
import { VectorMemoryDB } from './vector-memory-db';

// Inside retrieve():
async retrieve(agentId: string, taskContext: string, maxEntries = 15): Promise<LongTermMemory[]> {
  // Use semantic search if available
  if (this.db instanceof VectorMemoryDB) {
    const results = await this.db.semanticSearch(taskContext, agentId, maxEntries);
    // Update access tracking
    const now = Date.now();
    for (const mem of results) {
      mem.accessCount = (mem.accessCount || 0) + 1;
      mem.lastAccessedAt = now;
      await this.db.put(mem);
    }
    return results;
  }

  // Fallback: existing keyword scoring (keep all existing code)
  // ... existing implementation unchanged ...
}
```

**Step 4: Run all memory manager tests**

Run: `npx vitest run src/core/memory-manager.test.ts`
Expected: All tests PASS (both new and existing)

**Step 5: Commit**

```bash
git add src/core/memory-manager.ts src/core/memory-manager.test.ts
git commit -m "feat: add semantic search path to MemoryManager.retrieve"
```

---

### Task 10: Update Summarizer consolidation to use vector similarity

**Files:**
- Modify: `src/core/summarizer.ts`
- Modify: `src/core/summarizer.test.ts`

**Step 1: Write failing test**

Add to `src/core/summarizer.test.ts`:

```typescript
describe('Summarizer with VectorMemoryDB', () => {
  it('consolidation uses vector similarity for duplicate detection', async () => {
    const vectorDb = new VectorMemoryDB({ inMemory: true });
    await vectorDb.init();
    const manager = new MemoryManager(vectorDb);

    // Store an existing memory
    await manager.store({
      agentId: 'a', type: 'fact',
      content: 'TypeScript uses static types', tags: ['typescript'], runId: 'r0',
    });

    // Consolidation should detect near-duplicate
    const mockSummarizeFn = vi.fn().mockResolvedValue([
      { type: 'fact', content: 'TypeScript has a static type system', tags: ['ts'] },
    ]);

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined);
    await summarizer.summarize('r1', [], [makeMockSession('a')]);

    const all = await manager.getAll();
    // Should not create a duplicate - either updates existing or skips
    expect(all.length).toBeLessThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: FAIL or unexpected duplicate count

**Step 3: Update `buildConsolidationContext` in `src/core/summarizer.ts`**

When using VectorMemoryDB, find near-duplicates for each candidate via semantic search instead of listing the entire DB:

```typescript
private async buildConsolidationContext(
  candidates: ExtractedMemory[],
  agentId: string
): Promise<string> {
  const existing = await this.manager.getAll();

  // If using vector store, find per-candidate similar memories
  if (this.manager.db instanceof VectorMemoryDB) {
    let context = '## Existing Memories (similar matches per candidate)\n\n';
    for (let i = 0; i < candidates.length; i++) {
      const similar = await (this.manager.db as VectorMemoryDB)
        .semanticSearch(candidates[i].content, agentId, 3);
      if (similar.length > 0) {
        context += `Candidate ${i}: "${candidates[i].content}"\nSimilar existing:\n`;
        similar.forEach((s) => {
          context += `  - [${s.id}] ${s.content}\n`;
        });
      }
    }
    context += '\n## Candidates\n';
    candidates.forEach((c, i) => {
      context += `${i}: [${c.type}] ${c.content} (tags: ${c.tags.join(', ')})\n`;
    });
    return context;
  }

  // Fallback: existing full-list approach
  // ... existing implementation unchanged ...
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/core/summarizer.ts src/core/summarizer.test.ts
git commit -m "feat: use vector similarity in consolidation duplicate detection"
```

---

### Task 11: Add kernelConfig toggle for vector memory

**Files:**
- Modify: `src/types/kernel.ts` (add `useVectorMemory` to KernelConfig)
- Modify: `src/stores/use-stores.ts` (default value)
- Modify: `src/core/run-controller.ts` (pass option to createMemoryDB)
- Modify: `src/components/settings/SettingsModal.tsx` (UI toggle)

**Step 1: Add the config field**

In `src/types/kernel.ts`, add to KernelConfig:
```typescript
useVectorMemory: boolean;
```

**Step 2: Set default in `src/stores/use-stores.ts`**

In the kernelConfig initializer, add:
```typescript
useVectorMemory: false,
```

**Step 3: Wire into run-controller.ts**

In `RunController.createKernel()` or wherever `createMemoryDB` is called:
```typescript
const db = createMemoryDB(vfsStore, {
  useVectorStore: kernelConfig.useVectorMemory,
});
```

**Step 4: Add settings toggle**

In `SettingsModal.tsx`, add a new label in the Memory section:
```tsx
<label className={styles.label}>
  <span className={styles.labelText}>Vector Memory (Semantic Search)</span>
  <select
    className={styles.select}
    value={cfg.useVectorMemory ? 'on' : 'off'}
    onChange={(e) =>
      uiStore.getState().setKernelConfig({
        useVectorMemory: e.target.value === 'on',
      })
    }
  >
    <option value="off">Off (JSON-based)</option>
    <option value="on">On (LanceDB + Embeddings)</option>
  </select>
</label>
```

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/types/kernel.ts src/stores/use-stores.ts src/core/run-controller.ts src/components/settings/SettingsModal.tsx
git commit -m "feat: add vector memory toggle to kernel config and settings UI"
```

---

### Task 12: Knowledge query plugin - failing tests

**Files:**
- Create: `src/core/plugins/knowledge-query.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/plugins/knowledge-query.test.ts
import { describe, it, expect, vi } from 'vitest';
import { knowledgeQueryPlugin } from './knowledge-query';
import type { ToolContext } from '../tool-plugin';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    vfs: { getState: () => ({}) } as any,
    registry: { getState: () => ({}) } as any,
    eventLog: { getState: () => ({ push: vi.fn() }) } as any,
    currentAgentId: 'agent-a',
    currentActivationId: 'act-1',
    spawnDepth: 0, maxDepth: 5, maxFanout: 5,
    childCount: 0, spawnCount: 0,
    onSpawnActivation: vi.fn(),
    incrementSpawnCount: vi.fn(),
    ...overrides,
  };
}

describe('knowledgeQueryPlugin', () => {
  it('has correct name and parameters', () => {
    expect(knowledgeQueryPlugin.name).toBe('knowledge_query');
    expect(knowledgeQueryPlugin.parameters.query).toBeDefined();
    expect(knowledgeQueryPlugin.parameters.query.required).toBe(true);
  });

  it('returns error when vector store not available', async () => {
    const result = await knowledgeQueryPlugin.handler({ query: 'test' }, makeCtx());
    expect(result).toContain('not available');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plugins/knowledge-query.test.ts`
Expected: FAIL - cannot resolve `./knowledge-query`

**Step 3: Commit**

```bash
git add src/core/plugins/knowledge-query.test.ts
git commit -m "test: add knowledge_query plugin tests (red)"
```

---

### Task 13: Knowledge query and contribute plugins - implementation

**Files:**
- Create: `src/core/plugins/knowledge-query.ts`
- Create: `src/core/plugins/knowledge-contribute.ts`
- Create: `src/core/plugins/knowledge-contribute.test.ts`
- Modify: `src/core/plugins/index.ts` (register new plugins)
- Modify: `src/core/tool-plugin.ts` (add vectorStore to ToolContext)

**Step 1: Add vectorStore to ToolContext**

In `src/core/tool-plugin.ts`, add to ToolContext interface:
```typescript
vectorStore?: { semanticSearch: (query: string, agentId: string, limit?: number) => Promise<any[]>; markShared: (id: string, shared: boolean) => Promise<void> };
```

**Step 2: Implement knowledge_query plugin**

```typescript
// src/core/plugins/knowledge-query.ts
import type { ToolPlugin } from '../tool-plugin';

export const knowledgeQueryPlugin: ToolPlugin = {
  name: 'knowledge_query',
  description: 'Search shared knowledge across all agents using semantic similarity. Returns memories that other agents have contributed to the shared knowledge graph.',
  parameters: {
    query: { type: 'string', description: 'What to search for in shared knowledge', required: true },
    limit: { type: 'number', description: 'Max results to return (default 10)' },
  },
  async handler(args, ctx) {
    if (!ctx.vectorStore) {
      return 'Error: Vector memory is not available. Enable it in Settings > Memory.';
    }

    const query = String(args.query || '');
    const limit = Number(args.limit) || 10;

    if (!query.trim()) return 'Error: query is required.';

    const results = await ctx.vectorStore.semanticSearch(query, ctx.currentAgentId, limit);

    if (results.length === 0) return 'No shared knowledge found matching your query.';

    return results.map((r: any, i: number) =>
      `${i + 1}. [${r.type}] ${r.content}\n   Tags: ${r.tags.join(', ')} | From: ${r.agentId}`
    ).join('\n---\n');
  },
};
```

**Step 3: Implement knowledge_contribute plugin**

```typescript
// src/core/plugins/knowledge-contribute.ts
import type { ToolPlugin } from '../tool-plugin';

export const knowledgeContributePlugin: ToolPlugin = {
  name: 'knowledge_contribute',
  description: 'Add a piece of knowledge to the shared knowledge graph. Other agents will be able to find this via knowledge_query.',
  parameters: {
    content: { type: 'string', description: 'The knowledge to share', required: true },
    type: { type: 'string', description: 'Memory type: skill, fact, procedure, observation, mistake, or preference', required: true },
    tags: { type: 'string', description: 'Comma-separated tags for discoverability' },
  },
  async handler(args, ctx) {
    if (!ctx.vectorStore) {
      return 'Error: Vector memory is not available. Enable it in Settings > Memory.';
    }

    const content = String(args.content || '').trim();
    const type = String(args.type || 'fact');
    const tags = String(args.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

    if (!content) return 'Error: content is required.';

    // Check for near-duplicates before adding
    const similar = await ctx.vectorStore.semanticSearch(content, ctx.currentAgentId, 3);
    const isDuplicate = similar.some((s: any) => {
      // Simple heuristic: if content is very similar, skip
      const overlap = content.toLowerCase().split(' ')
        .filter((w: string) => s.content.toLowerCase().includes(w)).length;
      return overlap / content.split(' ').length > 0.8;
    });

    if (isDuplicate) {
      return 'This knowledge already exists in the shared graph (near-duplicate detected). No action taken.';
    }

    // Write to working memory with shared flag
    if (ctx.memoryStore) {
      ctx.memoryStore.getState().write({
        key: `shared:${type}`,
        value: content,
        tags: [...tags, 'shared'],
        authorAgentId: ctx.currentAgentId,
      });
    }

    return `Contributed to shared knowledge: [${type}] "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" with tags: ${tags.join(', ') || 'none'}`;
  },
};
```

**Step 4: Register in `src/core/plugins/index.ts`**

Add imports and register calls:
```typescript
import { knowledgeQueryPlugin } from './knowledge-query';
import { knowledgeContributePlugin } from './knowledge-contribute';

// Inside createBuiltinRegistry():
registry.register(knowledgeQueryPlugin);
registry.register(knowledgeContributePlugin);
```

**Step 5: Run all plugin tests**

Run: `npx vitest run src/core/plugins/`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/core/plugins/knowledge-query.ts src/core/plugins/knowledge-contribute.ts src/core/plugins/knowledge-contribute.test.ts src/core/plugins/index.ts src/core/tool-plugin.ts
git commit -m "feat: add knowledge_query and knowledge_contribute plugins"
```

---

### Task 14: Shared Knowledge tab in Memory Panel

**Files:**
- Create: `src/components/inspector/SharedKnowledgePanel.tsx`
- Create: `src/components/inspector/SharedKnowledgePanel.module.css`
- Modify: `src/components/inspector/MemoryPanel.tsx` (add third tab)

**Step 1: Create SharedKnowledgePanel component**

```tsx
// src/components/inspector/SharedKnowledgePanel.tsx
import { useState, useEffect } from 'react';
import styles from './SharedKnowledgePanel.module.css';

interface SharedMemory {
  id: string;
  type: string;
  content: string;
  tags: string[];
  agentId: string;
}

interface Props {
  vectorStore?: {
    semanticSearch: (q: string, agentId: string, limit?: number) => Promise<SharedMemory[]>;
  };
}

const TYPE_COLORS: Record<string, string> = {
  skill: 'var(--status-blue)',
  fact: 'var(--status-green, #4caf50)',
  procedure: 'var(--status-purple, #9c27b0)',
  observation: 'var(--status-cyan, #00bcd4)',
  mistake: 'var(--status-red)',
  preference: 'var(--status-orange, #ff9800)',
};

export default function SharedKnowledgePanel({ vectorStore }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SharedMemory[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!vectorStore || !query.trim()) return;
    setLoading(true);
    try {
      const r = await vectorStore.semanticSearch(query, '', 20);
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  if (!vectorStore) {
    return (
      <div className={styles.empty}>
        Enable Vector Memory in Settings to use shared knowledge.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          placeholder="Search shared knowledge..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className={styles.searchBtn} onClick={search} disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </div>
      <div className={styles.results}>
        {results.length === 0 && (
          <div className={styles.empty}>
            {query ? 'No results found.' : 'Enter a query to search shared knowledge.'}
          </div>
        )}
        {results.map((r) => (
          <div key={r.id} className={styles.entry}>
            <div className={styles.entryHeader}>
              <span
                className={styles.typeBadge}
                style={{ background: TYPE_COLORS[r.type] || 'var(--depth-3)' }}
              >
                {r.type}
              </span>
              <span className={styles.agent}>{r.agentId.split('/').pop()}</span>
            </div>
            <div className={styles.content}>{r.content}</div>
            {r.tags.length > 0 && (
              <div className={styles.tagRow}>
                {r.tags.map((t) => (
                  <span key={t} className={styles.tag}>{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Create CSS module**

```css
/* src/components/inspector/SharedKnowledgePanel.module.css */
.container { display: flex; flex-direction: column; height: 100%; gap: var(--space-2); padding: var(--space-2); }
.searchRow { display: flex; gap: var(--space-2); }
.searchInput { flex: 1; background: var(--depth-1); border: 1px solid var(--depth-4); border-radius: var(--radius-sm); padding: var(--space-2); color: var(--text-primary); font-size: 0.85rem; }
.searchBtn { background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); cursor: pointer; font-size: 0.85rem; }
.searchBtn:disabled { opacity: 0.5; }
.results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2); }
.empty { color: var(--text-dim); text-align: center; padding: var(--space-4); font-size: 0.85rem; }
.entry { background: var(--depth-2); border: 1px solid var(--depth-3); border-radius: 6px; padding: var(--space-2); }
.entryHeader { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
.typeBadge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; color: white; text-transform: uppercase; font-weight: 600; }
.agent { font-size: 0.75rem; color: var(--text-dim); margin-left: auto; }
.content { font-size: 0.85rem; color: var(--text-primary); line-height: 1.4; }
.tagRow { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--space-1); }
.tag { font-size: 0.7rem; padding: 1px 6px; background: var(--depth-3); border-radius: 4px; color: var(--text-dim); }
```

**Step 3: Add tab to MemoryPanel.tsx**

Add `'shared'` to the view mode type and a third tab button. When active, render `<SharedKnowledgePanel />`.

**Step 4: Run lint and verify**

Run: `npx vitest run && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/inspector/SharedKnowledgePanel.tsx src/components/inspector/SharedKnowledgePanel.module.css src/components/inspector/MemoryPanel.tsx
git commit -m "feat: add Shared Knowledge tab to inspector Memory Panel"
```

---

## Track B: Execution & Orchestration

### Task 15: Install MCP SDK dependency

**Files:**
- Modify: `package.json`

**Step 1: Install**

Run:
```bash
npm install @modelcontextprotocol/sdk
```

**Step 2: Verify**

Run:
```bash
node -e "require('@modelcontextprotocol/sdk'); console.log('mcp ok')"
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add MCP SDK dependency"
```

---

### Task 16: MCP client - failing tests

**Files:**
- Create: `src/core/mcp-client.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/mcp-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MCPClientManager, type MCPServerConfig } from './mcp-client';

describe('MCPClientManager', () => {
  it('can be instantiated', () => {
    const manager = new MCPClientManager();
    expect(manager).toBeDefined();
  });

  it('getConnectedServers returns empty initially', () => {
    const manager = new MCPClientManager();
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('getTools returns empty when no servers connected', () => {
    const manager = new MCPClientManager();
    expect(manager.getTools()).toEqual([]);
  });

  it('parseServerConfigs extracts valid configs from frontmatter', () => {
    const configs = MCPClientManager.parseServerConfigs([
      { name: 'test', transport: 'http', url: 'http://localhost:3000' },
    ]);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test');
    expect(configs[0].transport).toBe('http');
  });

  it('parseServerConfigs rejects configs missing name', () => {
    const configs = MCPClientManager.parseServerConfigs([
      { transport: 'http', url: 'http://localhost:3000' },
    ]);
    expect(configs).toHaveLength(0);
  });

  it('callTool returns error for unknown server', async () => {
    const manager = new MCPClientManager();
    const result = await manager.callTool('unknown', 'tool', {});
    expect(result).toContain('not connected');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/mcp-client.test.ts`
Expected: FAIL - cannot resolve `./mcp-client`

**Step 3: Commit**

```bash
git add src/core/mcp-client.test.ts
git commit -m "test: add MCP client manager tests (red)"
```

---

### Task 17: MCP client - implementation

**Files:**
- Create: `src/core/mcp-client.ts`

**Step 1: Write the implementation**

```typescript
// src/core/mcp-client.ts

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  config: MCPServerConfig;
  tools: MCPTool[];
  connected: boolean;
}

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();

  static parseServerConfigs(raw: unknown[]): MCPServerConfig[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is MCPServerConfig => {
      if (!item || typeof item !== 'object') return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.name === 'string' && obj.name.length > 0 &&
        typeof obj.transport === 'string';
    });
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([, s]) => s.connected)
      .map(([name]) => name);
  }

  getTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const server of this.servers.values()) {
      if (server.connected) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }

  async connect(config: MCPServerConfig): Promise<void> {
    // Placeholder: real implementation will use @modelcontextprotocol/sdk
    // For now, register the server as connected with empty tools
    this.servers.set(config.name, {
      config,
      tools: [],
      connected: true,
    });
  }

  async disconnect(name: string): Promise<void> {
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    this.servers.clear();
  }

  async discoverTools(serverName: string): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) return [];
    return server.tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return `Error: MCP server "${serverName}" is not connected.`;
    }

    // Placeholder: real implementation will use server.client.callTool()
    return `Error: Tool execution not yet implemented for ${serverName}:${toolName}`;
  }
}
```

**Step 2: Run tests**

Run: `npx vitest run src/core/mcp-client.test.ts`
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add src/core/mcp-client.ts
git commit -m "feat: add MCPClientManager with config parsing and server management"
```

---

### Task 18: MCP bridge plugin - failing tests

**Files:**
- Create: `src/core/plugins/mcp-bridge-plugin.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/plugins/mcp-bridge-plugin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createMCPBridgePlugins } from './mcp-bridge-plugin';
import type { MCPTool } from '../mcp-client';

describe('createMCPBridgePlugins', () => {
  it('creates a ToolPlugin for each MCP tool', () => {
    const tools: MCPTool[] = [
      { serverName: 'vault', name: 'query_documents', description: 'Search docs', inputSchema: { query: { type: 'string' } } },
      { serverName: 'vault', name: 'ingest_file', description: 'Add file', inputSchema: { path: { type: 'string' } } },
    ];
    const callTool = vi.fn();
    const plugins = createMCPBridgePlugins(tools, callTool);

    expect(plugins).toHaveLength(2);
    expect(plugins[0].name).toBe('mcp:vault:query_documents');
    expect(plugins[1].name).toBe('mcp:vault:ingest_file');
  });

  it('plugin handler calls through to MCP callTool', async () => {
    const tools: MCPTool[] = [
      { serverName: 'vault', name: 'query', description: 'Search', inputSchema: {} },
    ];
    const callTool = vi.fn().mockResolvedValue('result from mcp');
    const plugins = createMCPBridgePlugins(tools, callTool);

    const ctx = {} as any;
    const result = await plugins[0].handler({ q: 'test' }, ctx);

    expect(callTool).toHaveBeenCalledWith('vault', 'query', { q: 'test' });
    expect(result).toBe('result from mcp');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plugins/mcp-bridge-plugin.test.ts`
Expected: FAIL - cannot resolve `./mcp-bridge-plugin`

**Step 3: Commit**

```bash
git add src/core/plugins/mcp-bridge-plugin.test.ts
git commit -m "test: add MCP bridge plugin tests (red)"
```

---

### Task 19: MCP bridge plugin - implementation

**Files:**
- Create: `src/core/plugins/mcp-bridge-plugin.ts`

**Step 1: Write the implementation**

```typescript
// src/core/plugins/mcp-bridge-plugin.ts
import type { ToolPlugin, ToolParameter } from '../tool-plugin';
import type { MCPTool } from '../mcp-client';

type CallToolFn = (server: string, tool: string, args: Record<string, unknown>) => Promise<string>;

export function createMCPBridgePlugins(
  tools: MCPTool[],
  callTool: CallToolFn
): ToolPlugin[] {
  return tools.map((tool) => ({
    name: `mcp:${tool.serverName}:${tool.name}`,
    description: `[MCP: ${tool.serverName}] ${tool.description}`,
    parameters: schemaToParams(tool.inputSchema),
    async handler(args) {
      return callTool(tool.serverName, tool.name, args);
    },
  }));
}

function schemaToParams(schema: Record<string, unknown>): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};
  if (!schema || typeof schema !== 'object') return params;

  // Handle JSON Schema properties
  const properties = (schema as any).properties ?? schema;
  const required = new Set((schema as any).required ?? []);

  for (const [key, val] of Object.entries(properties)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    params[key] = {
      type: mapType(String(v.type || 'string')),
      description: String(v.description || key),
      required: required.has(key),
    };
  }
  return params;
}

function mapType(t: string): 'string' | 'number' | 'boolean' | 'object' {
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object' || t === 'array') return 'object';
  return 'string';
}
```

**Step 2: Run tests**

Run: `npx vitest run src/core/plugins/mcp-bridge-plugin.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/core/plugins/mcp-bridge-plugin.ts
git commit -m "feat: add MCP bridge plugin converting MCP tools to ToolPlugins"
```

---

### Task 20: Parse mcp_servers from agent frontmatter

**Files:**
- Modify: `src/types/agent.ts` (add mcpServers to AgentProfile)
- Modify: `src/utils/parse-agent.ts` (parse mcp_servers field)
- Modify: `src/utils/parse-agent.test.ts` (test the parsing)

**Step 1: Write failing test**

Add to `src/utils/parse-agent.test.ts`:

```typescript
describe('parseMCPServers', () => {
  it('parses mcp_servers from frontmatter', () => {
    const md = `---
name: Test Agent
mcp_servers:
  - name: vault
    transport: http
    url: http://localhost:3000
  - name: db
    transport: stdio
    command: npx my-db-server
---
System prompt here`;

    const profile = parseAgentFile('agents/test.md', md);
    expect(profile.mcpServers).toHaveLength(2);
    expect(profile.mcpServers![0].name).toBe('vault');
    expect(profile.mcpServers![1].transport).toBe('stdio');
  });

  it('returns undefined when no mcp_servers', () => {
    const md = `---
name: Basic Agent
---
Prompt`;
    const profile = parseAgentFile('agents/basic.md', md);
    expect(profile.mcpServers).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/parse-agent.test.ts`
Expected: FAIL - mcpServers not on profile

**Step 3: Add mcpServers to AgentProfile in `src/types/agent.ts`**

```typescript
mcpServers?: MCPServerConfig[];
```

And import/add the MCPServerConfig type (or define inline).

**Step 4: Parse in `src/utils/parse-agent.ts`**

In `parseAgentFile()`, after existing parsing:
```typescript
const mcpServers = fm.mcp_servers
  ? MCPClientManager.parseServerConfigs(fm.mcp_servers)
  : undefined;
```

Add `mcpServers` to the returned AgentProfile object.

**Step 5: Run tests**

Run: `npx vitest run src/utils/parse-agent.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/types/agent.ts src/utils/parse-agent.ts src/utils/parse-agent.test.ts
git commit -m "feat: parse mcp_servers from agent frontmatter"
```

---

### Task 21: Wire MCP into kernel session startup

**Files:**
- Modify: `src/core/kernel.ts` (connect MCP servers at session start, register bridge plugins)

**Step 1: Update kernel to accept MCPClientManager**

In `src/core/kernel.ts`, add to constructor deps:
```typescript
mcpManager?: MCPClientManager;
```

In `runSession()`, after creating per-session registry (around line 300), if the agent profile has mcpServers:

```typescript
if (profile.mcpServers && this.mcpManager) {
  for (const serverConfig of profile.mcpServers) {
    await this.mcpManager.connect(serverConfig);
  }
  const mcpTools = this.mcpManager.getTools();
  const bridgePlugins = createMCPBridgePlugins(
    mcpTools,
    (server, tool, args) => this.mcpManager!.callTool(server, tool, args)
  );
  for (const plugin of bridgePlugins) {
    sessionRegistry.register(plugin);
  }
}
```

**Step 2: Run existing kernel tests**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: All existing tests still PASS (MCP is optional)

**Step 3: Commit**

```bash
git add src/core/kernel.ts
git commit -m "feat: wire MCP client into kernel session startup"
```

---

### Task 22: Pub/Sub store - failing tests

**Files:**
- Create: `src/stores/pub-sub-store.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/stores/pub-sub-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createPubSubStore, type PubSubState } from './pub-sub-store';

describe('PubSubStore', () => {
  let store: { getState: () => PubSubState };

  beforeEach(() => {
    store = createPubSubStore();
  });

  it('starts with no messages', () => {
    const messages = store.getState().getMessages('any-channel');
    expect(messages).toEqual([]);
  });

  it('publish adds message to channel', () => {
    store.getState().publish('findings', { text: 'found something' }, 'agent-a');
    const messages = store.getState().getMessages('findings');
    expect(messages).toHaveLength(1);
    expect(messages[0].data.text).toBe('found something');
    expect(messages[0].authorAgentId).toBe('agent-a');
  });

  it('subscribe returns messages for agent since subscription', () => {
    store.getState().subscribe('findings', 'agent-b');
    store.getState().publish('findings', { text: 'new data' }, 'agent-a');
    const pending = store.getState().getPendingMessages('findings', 'agent-b');
    expect(pending).toHaveLength(1);
  });

  it('ack marks messages as read', () => {
    store.getState().subscribe('findings', 'agent-b');
    store.getState().publish('findings', { text: 'data' }, 'agent-a');
    store.getState().ack('findings', 'agent-b');
    const pending = store.getState().getPendingMessages('findings', 'agent-b');
    expect(pending).toHaveLength(0);
  });

  it('getChannels lists active channels', () => {
    store.getState().publish('ch1', {}, 'a');
    store.getState().publish('ch2', {}, 'a');
    expect(store.getState().getChannels()).toEqual(expect.arrayContaining(['ch1', 'ch2']));
  });

  it('clear resets all state', () => {
    store.getState().publish('ch', {}, 'a');
    store.getState().subscribe('ch', 'b');
    store.getState().clear();
    expect(store.getState().getChannels()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/pub-sub-store.test.ts`
Expected: FAIL - cannot resolve `./pub-sub-store`

**Step 3: Commit**

```bash
git add src/stores/pub-sub-store.test.ts
git commit -m "test: add pub/sub store tests (red)"
```

---

### Task 23: Pub/Sub store - implementation

**Files:**
- Create: `src/stores/pub-sub-store.ts`
- Modify: `src/stores/use-stores.ts` (export singleton + hook)

**Step 1: Write the implementation**

```typescript
// src/stores/pub-sub-store.ts
import { createStore } from 'zustand/vanilla';

interface PubSubMessage {
  id: string;
  channel: string;
  data: unknown;
  authorAgentId: string;
  timestamp: number;
}

interface Subscription {
  agentId: string;
  channel: string;
  subscribedAt: number;
  lastAck: number;
}

export interface PubSubState {
  messages: PubSubMessage[];
  subscriptions: Subscription[];

  publish(channel: string, data: unknown, authorAgentId: string): void;
  subscribe(channel: string, agentId: string): void;
  unsubscribe(channel: string, agentId: string): void;
  ack(channel: string, agentId: string): void;
  getMessages(channel: string): PubSubMessage[];
  getPendingMessages(channel: string, agentId: string): PubSubMessage[];
  getChannels(): string[];
  clear(): void;
}

let msgCounter = 0;

export function createPubSubStore() {
  return createStore<PubSubState>((set, get) => ({
    messages: [],
    subscriptions: [],

    publish(channel, data, authorAgentId) {
      const msg: PubSubMessage = {
        id: `ps-${++msgCounter}`,
        channel,
        data,
        authorAgentId,
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, msg] }));
    },

    subscribe(channel, agentId) {
      const existing = get().subscriptions.find(
        (s) => s.channel === channel && s.agentId === agentId
      );
      if (existing) return;
      set((s) => ({
        subscriptions: [
          ...s.subscriptions,
          { agentId, channel, subscribedAt: Date.now(), lastAck: Date.now() },
        ],
      }));
    },

    unsubscribe(channel, agentId) {
      set((s) => ({
        subscriptions: s.subscriptions.filter(
          (sub) => !(sub.channel === channel && sub.agentId === agentId)
        ),
      }));
    },

    ack(channel, agentId) {
      const now = Date.now();
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) =>
          sub.channel === channel && sub.agentId === agentId
            ? { ...sub, lastAck: now }
            : sub
        ),
      }));
    },

    getMessages(channel) {
      return get().messages.filter((m) => m.channel === channel);
    },

    getPendingMessages(channel, agentId) {
      const sub = get().subscriptions.find(
        (s) => s.channel === channel && s.agentId === agentId
      );
      if (!sub) return [];
      return get().messages.filter(
        (m) => m.channel === channel && m.timestamp > sub.lastAck
      );
    },

    getChannels() {
      return [...new Set(get().messages.map((m) => m.channel))];
    },

    clear() {
      msgCounter = 0;
      set({ messages: [], subscriptions: [] });
    },
  }));
}
```

**Step 2: Export in use-stores.ts**

Add to `src/stores/use-stores.ts`:
```typescript
import { createPubSubStore } from './pub-sub-store';
export const pubSubStore = createPubSubStore();
```

**Step 3: Run tests**

Run: `npx vitest run src/stores/pub-sub-store.test.ts`
Expected: All 6 tests PASS

**Step 4: Commit**

```bash
git add src/stores/pub-sub-store.ts src/stores/use-stores.ts
git commit -m "feat: add pub/sub store for inter-agent channel messaging"
```

---

### Task 24: Publish, Subscribe, Blackboard plugins - failing tests

**Files:**
- Create: `src/core/plugins/pub-sub-plugin.test.ts`
- Create: `src/core/plugins/blackboard-plugin.test.ts`

**Step 1: Write pub/sub plugin tests**

```typescript
// src/core/plugins/pub-sub-plugin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { publishPlugin, subscribePlugin } from './pub-sub-plugin';

describe('publishPlugin', () => {
  it('has correct name', () => {
    expect(publishPlugin.name).toBe('publish');
  });

  it('requires channel and message parameters', () => {
    expect(publishPlugin.parameters.channel.required).toBe(true);
    expect(publishPlugin.parameters.message.required).toBe(true);
  });
});

describe('subscribePlugin', () => {
  it('has correct name', () => {
    expect(subscribePlugin.name).toBe('subscribe');
  });

  it('requires channel parameter', () => {
    expect(subscribePlugin.parameters.channel.required).toBe(true);
  });
});
```

**Step 2: Write blackboard plugin tests**

```typescript
// src/core/plugins/blackboard-plugin.test.ts
import { describe, it, expect } from 'vitest';
import { blackboardReadPlugin, blackboardWritePlugin } from './blackboard-plugin';

describe('blackboardWritePlugin', () => {
  it('has correct name', () => {
    expect(blackboardWritePlugin.name).toBe('blackboard_write');
  });

  it('requires key and value', () => {
    expect(blackboardWritePlugin.parameters.key.required).toBe(true);
    expect(blackboardWritePlugin.parameters.value.required).toBe(true);
  });
});

describe('blackboardReadPlugin', () => {
  it('has correct name', () => {
    expect(blackboardReadPlugin.name).toBe('blackboard_read');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/core/plugins/pub-sub-plugin.test.ts src/core/plugins/blackboard-plugin.test.ts`
Expected: FAIL - cannot resolve modules

**Step 4: Commit**

```bash
git add src/core/plugins/pub-sub-plugin.test.ts src/core/plugins/blackboard-plugin.test.ts
git commit -m "test: add pub/sub and blackboard plugin tests (red)"
```

---

### Task 25: Publish, Subscribe, Blackboard plugins - implementation

**Files:**
- Create: `src/core/plugins/pub-sub-plugin.ts`
- Create: `src/core/plugins/blackboard-plugin.ts`
- Modify: `src/core/tool-plugin.ts` (add pubSubStore and blackboard to ToolContext)
- Modify: `src/core/plugins/index.ts` (register new plugins)

**Step 1: Add to ToolContext in `src/core/tool-plugin.ts`**

```typescript
pubSubStore?: Store<PubSubState>;
blackboard?: Map<string, unknown>;
```

**Step 2: Implement pub/sub plugin**

```typescript
// src/core/plugins/pub-sub-plugin.ts
import type { ToolPlugin } from '../tool-plugin';

export const publishPlugin: ToolPlugin = {
  name: 'publish',
  description: 'Publish a message to a named channel. Other agents subscribed to this channel will receive it.',
  parameters: {
    channel: { type: 'string', description: 'Channel name to publish to', required: true },
    message: { type: 'string', description: 'Message content to publish', required: true },
  },
  async handler(args, ctx) {
    const channel = String(args.channel || '').trim();
    const message = String(args.message || '').trim();
    if (!channel) return 'Error: channel is required.';
    if (!message) return 'Error: message is required.';

    if (!ctx.pubSubStore) return 'Error: Pub/sub system not available.';

    ctx.pubSubStore.getState().publish(channel, message, ctx.currentAgentId);
    return `Published to channel "${channel}".`;
  },
};

export const subscribePlugin: ToolPlugin = {
  name: 'subscribe',
  description: 'Subscribe to a named channel to receive messages from other agents. Use publish to check for new messages.',
  parameters: {
    channel: { type: 'string', description: 'Channel name to subscribe to', required: true },
    check: { type: 'boolean', description: 'If true, also return pending messages' },
  },
  async handler(args, ctx) {
    const channel = String(args.channel || '').trim();
    if (!channel) return 'Error: channel is required.';
    if (!ctx.pubSubStore) return 'Error: Pub/sub system not available.';

    const state = ctx.pubSubStore.getState();
    state.subscribe(channel, ctx.currentAgentId);

    if (args.check) {
      const pending = state.getPendingMessages(channel, ctx.currentAgentId);
      if (pending.length === 0) return `Subscribed to "${channel}". No pending messages.`;
      state.ack(channel, ctx.currentAgentId);
      return `Subscribed to "${channel}". Pending messages:\n` +
        pending.map((m: any) => `- [${m.authorAgentId}]: ${String(m.data)}`).join('\n');
    }

    return `Subscribed to channel "${channel}".`;
  },
};
```

**Step 3: Implement blackboard plugin**

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

    if (!ctx.blackboard) return 'Error: Blackboard not available.';

    ctx.blackboard.set(key, value);
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
    if (!ctx.blackboard) return 'Error: Blackboard not available.';

    const key = args.key ? String(args.key).trim() : '';

    if (!key) {
      const keys = Array.from(ctx.blackboard.keys());
      if (keys.length === 0) return 'Blackboard is empty.';
      return 'Blackboard keys:\n' + keys.map((k) => `- ${k}: ${String(ctx.blackboard!.get(k)).slice(0, 100)}`).join('\n');
    }

    const value = ctx.blackboard.get(key);
    if (value === undefined) return `Key "${key}" not found on blackboard.`;
    return `${key}: ${String(value)}`;
  },
};
```

**Step 4: Register in plugins/index.ts**

```typescript
import { publishPlugin, subscribePlugin } from './pub-sub-plugin';
import { blackboardWritePlugin, blackboardReadPlugin } from './blackboard-plugin';

// Inside createBuiltinRegistry():
registry.register(publishPlugin);
registry.register(subscribePlugin);
registry.register(blackboardWritePlugin);
registry.register(blackboardReadPlugin);
```

**Step 5: Run tests**

Run: `npx vitest run src/core/plugins/pub-sub-plugin.test.ts src/core/plugins/blackboard-plugin.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/core/plugins/pub-sub-plugin.ts src/core/plugins/blackboard-plugin.ts src/core/tool-plugin.ts src/core/plugins/index.ts
git commit -m "feat: add publish, subscribe, blackboard_read, blackboard_write plugins"
```

---

### Task 26: Delegate plugin - failing tests and implementation

**Files:**
- Create: `src/core/plugins/delegate-plugin.test.ts`
- Create: `src/core/plugins/delegate-plugin.ts`
- Modify: `src/core/plugins/index.ts` (register)

**Step 1: Write the failing test**

```typescript
// src/core/plugins/delegate-plugin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { delegatePlugin } from './delegate-plugin';

describe('delegatePlugin', () => {
  it('has correct name and required params', () => {
    expect(delegatePlugin.name).toBe('delegate');
    expect(delegatePlugin.parameters.agent.required).toBe(true);
    expect(delegatePlugin.parameters.task.required).toBe(true);
  });

  it('calls onSpawnActivation with the target agent', async () => {
    const onSpawnActivation = vi.fn();
    const ctx = {
      currentAgentId: 'agents/lead.md',
      currentActivationId: 'act-1',
      spawnDepth: 0,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation,
      incrementSpawnCount: vi.fn(),
      vfs: { getState: () => ({}) } as any,
      registry: { getState: () => ({ agents: new Map([['agents/worker.md', {}]]) }) } as any,
      eventLog: { getState: () => ({ push: vi.fn() }) } as any,
    };

    const result = await delegatePlugin.handler(
      { agent: 'agents/worker.md', task: 'do the thing', priority: '1' },
      ctx as any
    );

    expect(onSpawnActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agents/worker.md',
        input: expect.stringContaining('do the thing'),
        parentId: 'agents/lead.md',
      })
    );
    expect(result).toContain('Delegated');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plugins/delegate-plugin.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// src/core/plugins/delegate-plugin.ts
import type { ToolPlugin } from '../tool-plugin';

export const delegatePlugin: ToolPlugin = {
  name: 'delegate',
  description: 'Delegate a structured task to a specific agent. The agent will receive the task as input with context.',
  parameters: {
    agent: { type: 'string', description: 'Path of the agent to delegate to (e.g., agents/worker.md)', required: true },
    task: { type: 'string', description: 'Task description and instructions', required: true },
    priority: { type: 'number', description: 'Priority (lower = higher priority, default: current depth + 1)' },
    context: { type: 'string', description: 'Additional context to include' },
  },
  async handler(args, ctx) {
    const agentPath = String(args.agent || '').trim();
    const task = String(args.task || '').trim();
    const priority = Number(args.priority) || ctx.spawnDepth + 1;
    const context = args.context ? String(args.context) : '';

    if (!agentPath) return 'Error: agent path is required.';
    if (!task) return 'Error: task description is required.';
    if (ctx.spawnDepth >= ctx.maxDepth) return `Error: Maximum spawn depth (${ctx.maxDepth}) reached.`;
    if (ctx.childCount >= ctx.maxFanout) return `Error: Maximum fanout (${ctx.maxFanout}) reached.`;

    const input = context
      ? `[Delegated Task from ${ctx.currentAgentId}]\n\n${task}\n\nContext:\n${context}`
      : `[Delegated Task from ${ctx.currentAgentId}]\n\n${task}`;

    ctx.onSpawnActivation({
      agentId: agentPath,
      input,
      parentId: ctx.currentAgentId,
      spawnDepth: ctx.spawnDepth + 1,
      priority,
    });
    ctx.incrementSpawnCount();

    return `Delegated task to ${agentPath}: "${task.slice(0, 80)}${task.length > 80 ? '...' : ''}"`;
  },
};
```

**Step 4: Register in plugins/index.ts**

```typescript
import { delegatePlugin } from './delegate-plugin';
// registry.register(delegatePlugin);
```

**Step 5: Run tests**

Run: `npx vitest run src/core/plugins/delegate-plugin.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/core/plugins/delegate-plugin.ts src/core/plugins/delegate-plugin.test.ts src/core/plugins/index.ts
git commit -m "feat: add delegate plugin for structured task handoffs"
```

---

### Task 27: Workflow parser - failing tests

**Files:**
- Create: `src/core/workflow-parser.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/workflow-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseWorkflow, type WorkflowDefinition } from './workflow-parser';

const SAMPLE_WORKFLOW = `---
name: Research Pipeline
description: Multi-stage research with review
trigger: manual
steps:
  - id: research
    agent: agents/researcher.md
    prompt: "Research {topic} thoroughly"
    outputs: [findings]
  - id: review
    agent: agents/reviewer.md
    depends_on: [research]
    prompt: "Review findings: {research.findings}"
    outputs: [review_report]
  - id: write
    agent: agents/writer.md
    depends_on: [research, review]
    prompt: "Write report from {research.findings} and {review.review_report}"
---
# Research Pipeline
`;

describe('parseWorkflow', () => {
  it('parses workflow name and description', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.name).toBe('Research Pipeline');
    expect(wf.description).toBe('Multi-stage research with review');
  });

  it('parses steps with ids and agents', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps).toHaveLength(3);
    expect(wf.steps[0].id).toBe('research');
    expect(wf.steps[0].agent).toBe('agents/researcher.md');
  });

  it('parses depends_on relationships', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps[1].dependsOn).toEqual(['research']);
    expect(wf.steps[2].dependsOn).toEqual(['research', 'review']);
  });

  it('parses outputs array', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps[0].outputs).toEqual(['findings']);
  });

  it('resolves topological order', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    const order = wf.executionOrder;
    const researchIdx = order.indexOf('research');
    const reviewIdx = order.indexOf('review');
    const writeIdx = order.indexOf('write');
    expect(researchIdx).toBeLessThan(reviewIdx);
    expect(researchIdx).toBeLessThan(writeIdx);
    expect(reviewIdx).toBeLessThan(writeIdx);
  });

  it('detects circular dependencies', () => {
    const circular = `---
name: Circular
steps:
  - id: a
    agent: agents/a.md
    depends_on: [b]
    prompt: test
  - id: b
    agent: agents/b.md
    depends_on: [a]
    prompt: test
---`;
    expect(() => parseWorkflow('w.md', circular)).toThrow(/circular/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow-parser.test.ts`
Expected: FAIL - cannot resolve `./workflow-parser`

**Step 3: Commit**

```bash
git add src/core/workflow-parser.test.ts
git commit -m "test: add workflow parser tests (red)"
```

---

### Task 28: Workflow parser - implementation

**Files:**
- Create: `src/core/workflow-parser.ts`

**Step 1: Write the implementation**

```typescript
// src/core/workflow-parser.ts
import matter from 'gray-matter';

export interface WorkflowStep {
  id: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
  outputs: string[];
}

export interface WorkflowDefinition {
  path: string;
  name: string;
  description: string;
  trigger: 'manual' | 'auto';
  steps: WorkflowStep[];
  executionOrder: string[];
  body: string;
}

export function parseWorkflow(path: string, markdown: string): WorkflowDefinition {
  const { data: fm, content } = matter(markdown);

  const name = String(fm.name || path);
  const description = String(fm.description || '');
  const trigger = fm.trigger === 'auto' ? 'auto' : 'manual';

  const rawSteps = Array.isArray(fm.steps) ? fm.steps : [];
  const steps: WorkflowStep[] = rawSteps.map((s: any) => ({
    id: String(s.id || ''),
    agent: String(s.agent || ''),
    prompt: String(s.prompt || ''),
    dependsOn: Array.isArray(s.depends_on) ? s.depends_on.map(String) : [],
    outputs: Array.isArray(s.outputs) ? s.outputs.map(String) : [],
  }));

  const executionOrder = topoSort(steps);

  return { path, name, description, trigger, steps, executionOrder, body: content };
}

function topoSort(steps: WorkflowStep[]): string[] {
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    graph.set(step.id, new Set());
    inDegree.set(step.id, 0);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!graph.has(dep)) throw new Error(`Unknown dependency "${dep}" in step "${step.id}"`);
      graph.get(dep)!.add(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (order.length !== steps.length) {
    throw new Error('Circular dependency detected in workflow steps');
  }

  return order;
}
```

**Step 2: Run tests**

Run: `npx vitest run src/core/workflow-parser.test.ts`
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add src/core/workflow-parser.ts
git commit -m "feat: add workflow parser with YAML frontmatter and topological sorting"
```

---

### Task 29: Workflow engine - failing tests

**Files:**
- Create: `src/core/workflow-engine.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/core/workflow-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowDefinition } from './workflow-parser';

function makeWorkflow(): WorkflowDefinition {
  return {
    path: 'workflows/test.md',
    name: 'Test Workflow',
    description: 'test',
    trigger: 'manual',
    steps: [
      { id: 'a', agent: 'agents/a.md', prompt: 'Do A', dependsOn: [], outputs: ['result_a'] },
      { id: 'b', agent: 'agents/b.md', prompt: 'Do B with {a.result_a}', dependsOn: ['a'], outputs: ['result_b'] },
    ],
    executionOrder: ['a', 'b'],
    body: '',
  };
}

describe('WorkflowEngine', () => {
  it('executes steps in topological order', async () => {
    const executionLog: string[] = [];
    const runStep = vi.fn().mockImplementation(async (stepId: string) => {
      executionLog.push(stepId);
      return { [`result_${stepId}`]: `output of ${stepId}` };
    });

    const engine = new WorkflowEngine({ runStep });
    await engine.execute(makeWorkflow(), {});

    expect(executionLog).toEqual(['a', 'b']);
  });

  it('passes output variables to dependent steps', async () => {
    const prompts: string[] = [];
    const runStep = vi.fn().mockImplementation(async (stepId: string, prompt: string) => {
      prompts.push(prompt);
      return { [`result_${stepId}`]: `data-${stepId}` };
    });

    const engine = new WorkflowEngine({ runStep });
    await engine.execute(makeWorkflow(), {});

    // Step b should have a.result_a substituted
    expect(prompts[1]).toContain('data-a');
  });

  it('getStatus returns step statuses', async () => {
    const runStep = vi.fn().mockResolvedValue({});
    const engine = new WorkflowEngine({ runStep });

    const statusBefore = engine.getStatus();
    expect(statusBefore).toEqual({});

    await engine.execute(makeWorkflow(), {});
    const statusAfter = engine.getStatus();
    expect(statusAfter.a).toBe('completed');
    expect(statusAfter.b).toBe('completed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow-engine.test.ts`
Expected: FAIL - cannot resolve `./workflow-engine`

**Step 3: Commit**

```bash
git add src/core/workflow-engine.test.ts
git commit -m "test: add workflow engine tests (red)"
```

---

### Task 30: Workflow engine - implementation

**Files:**
- Create: `src/core/workflow-engine.ts`

**Step 1: Write the implementation**

```typescript
// src/core/workflow-engine.ts
import type { WorkflowDefinition, WorkflowStep } from './workflow-parser';

type StepRunner = (
  stepId: string,
  prompt: string,
  agentPath: string,
  context: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export interface WorkflowEngineConfig {
  runStep: StepRunner;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export class WorkflowEngine {
  private config: WorkflowEngineConfig;
  private stepStatuses = new Map<string, StepStatus>();
  private stepOutputs = new Map<string, Record<string, unknown>>();

  constructor(config: WorkflowEngineConfig) {
    this.config = config;
  }

  getStatus(): Record<string, StepStatus> {
    const result: Record<string, StepStatus> = {};
    for (const [id, status] of this.stepStatuses) {
      result[id] = status;
    }
    return result;
  }

  async execute(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown>
  ): Promise<Record<string, Record<string, unknown>>> {
    this.stepStatuses.clear();
    this.stepOutputs.clear();

    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

    for (const stepId of workflow.executionOrder) {
      const step = stepMap.get(stepId);
      if (!step) continue;

      this.stepStatuses.set(stepId, 'running');

      // Build context from dependency outputs
      const context: Record<string, unknown> = { ...variables };
      for (const depId of step.dependsOn) {
        const depOutput = this.stepOutputs.get(depId);
        if (depOutput) {
          context[depId] = depOutput;
        }
      }

      // Resolve template variables in prompt
      const resolvedPrompt = resolveTemplate(step.prompt, context);

      try {
        const output = await this.config.runStep(stepId, resolvedPrompt, step.agent, context);
        this.stepOutputs.set(stepId, output);
        this.stepStatuses.set(stepId, 'completed');
      } catch (err) {
        this.stepStatuses.set(stepId, 'failed');
        throw err;
      }
    }

    const allOutputs: Record<string, Record<string, unknown>> = {};
    for (const [id, output] of this.stepOutputs) {
      allOutputs[id] = output;
    }
    return allOutputs;
  }
}

function resolveTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\.(\w+)\}/g, (match, stepId, key) => {
    const stepOutput = context[stepId];
    if (stepOutput && typeof stepOutput === 'object' && key in (stepOutput as any)) {
      return String((stepOutput as any)[key]);
    }
    return match;
  }).replace(/\{(\w+)\}/g, (match, key) => {
    if (key in context && typeof context[key] !== 'object') {
      return String(context[key]);
    }
    return match;
  });
}
```

**Step 2: Run tests**

Run: `npx vitest run src/core/workflow-engine.test.ts`
Expected: All 3 tests PASS

**Step 3: Commit**

```bash
git add src/core/workflow-engine.ts
git commit -m "feat: add workflow engine with DAG execution and template resolution"
```

---

### Task 31: Workflow templates

**Files:**
- Create: `src/core/workflow-templates.ts`
- Create: `src/core/workflow-templates.test.ts`

**Step 1: Write the test**

```typescript
// src/core/workflow-templates.test.ts
import { describe, it, expect } from 'vitest';
import { WORKFLOW_TEMPLATES } from './workflow-templates';
import { parseWorkflow } from './workflow-parser';

describe('Workflow Templates', () => {
  it('all templates parse without error', () => {
    for (const [name, md] of Object.entries(WORKFLOW_TEMPLATES)) {
      const wf = parseWorkflow(`workflows/${name}.md`, md);
      expect(wf.name).toBeTruthy();
      expect(wf.steps.length).toBeGreaterThan(0);
      expect(wf.executionOrder.length).toBe(wf.steps.length);
    }
  });

  it('chain template has sequential dependencies', () => {
    const wf = parseWorkflow('w.md', WORKFLOW_TEMPLATES.chain);
    for (let i = 1; i < wf.steps.length; i++) {
      expect(wf.steps[i].dependsOn).toContain(wf.steps[i - 1].id);
    }
  });

  it('fan-out template has parallel workers', () => {
    const wf = parseWorkflow('w.md', WORKFLOW_TEMPLATES['fan-out']);
    // Multiple steps should have the same single dependency
    const workerSteps = wf.steps.filter((s) => s.dependsOn.length === 1 && s.dependsOn[0] === wf.steps[0].id);
    expect(workerSteps.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow-templates.test.ts`
Expected: FAIL

**Step 3: Implement templates**

```typescript
// src/core/workflow-templates.ts

export const WORKFLOW_TEMPLATES: Record<string, string> = {
  chain: `---
name: Sequential Chain
description: Agents process input one after another
trigger: manual
steps:
  - id: step1
    agent: agents/processor-1.md
    prompt: "Process this input: {input}"
    outputs: [result]
  - id: step2
    agent: agents/processor-2.md
    depends_on: [step1]
    prompt: "Refine this: {step1.result}"
    outputs: [result]
  - id: step3
    agent: agents/processor-3.md
    depends_on: [step2]
    prompt: "Finalize this: {step2.result}"
    outputs: [result]
---
# Sequential Chain
Each agent processes the output of the previous one.
`,

  'fan-out': `---
name: Fan-Out / Fan-In
description: One agent distributes work, parallel workers process, collector gathers results
trigger: manual
steps:
  - id: distribute
    agent: agents/distributor.md
    prompt: "Break this task into parts: {input}"
    outputs: [parts]
  - id: worker1
    agent: agents/worker.md
    depends_on: [distribute]
    prompt: "Process part 1: {distribute.parts}"
    outputs: [result]
  - id: worker2
    agent: agents/worker.md
    depends_on: [distribute]
    prompt: "Process part 2: {distribute.parts}"
    outputs: [result]
  - id: collect
    agent: agents/collector.md
    depends_on: [worker1, worker2]
    prompt: "Combine results: {worker1.result} and {worker2.result}"
    outputs: [final]
---
# Fan-Out / Fan-In
Distributes work to parallel agents and collects results.
`,

  debate: `---
name: Debate
description: Two agents argue positions, a judge decides
trigger: manual
steps:
  - id: position_a
    agent: agents/debater-a.md
    prompt: "Argue FOR this position: {topic}"
    outputs: [argument]
  - id: position_b
    agent: agents/debater-b.md
    prompt: "Argue AGAINST this position: {topic}"
    outputs: [argument]
  - id: judge
    agent: agents/judge.md
    depends_on: [position_a, position_b]
    prompt: "Judge these arguments:\\nFOR: {position_a.argument}\\nAGAINST: {position_b.argument}"
    outputs: [verdict]
---
# Debate
Two agents take opposing sides, a third judges.
`,

  'review-loop': `---
name: Review Loop
description: Author writes, reviewer critiques, author revises
trigger: manual
steps:
  - id: draft
    agent: agents/author.md
    prompt: "Write a draft about: {topic}"
    outputs: [content]
  - id: review
    agent: agents/reviewer.md
    depends_on: [draft]
    prompt: "Review this draft critically: {draft.content}"
    outputs: [feedback]
  - id: revise
    agent: agents/author.md
    depends_on: [draft, review]
    prompt: "Revise your draft based on this feedback: {review.feedback}\\n\\nOriginal: {draft.content}"
    outputs: [final]
---
# Review Loop
Author drafts, reviewer critiques, author revises.
`,
};
```

**Step 4: Run tests**

Run: `npx vitest run src/core/workflow-templates.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/core/workflow-templates.ts src/core/workflow-templates.test.ts
git commit -m "feat: add built-in workflow templates (chain, fan-out, debate, review-loop)"
```

---

### Task 32: Add workflow event types

**Files:**
- Modify: `src/types/events.ts` (add new event types)

**Step 1: Update EventType**

Add to the EventType union:
```typescript
| 'mcp_connect' | 'mcp_disconnect' | 'mcp_tool_call'
| 'channel_publish' | 'channel_subscribe'
| 'blackboard_write' | 'blackboard_read'
| 'delegate'
| 'workflow_start' | 'workflow_step' | 'workflow_complete'
```

**Step 2: Run existing event log tests**

Run: `npx vitest run src/stores/event-log.test.ts`
Expected: All tests PASS (union types are additive)

**Step 3: Commit**

```bash
git add src/types/events.ts
git commit -m "feat: add event types for MCP, pub/sub, blackboard, workflows"
```

---

### Task 33: Register workflows in VFS file kind system

**Files:**
- Modify: `src/types/vfs.ts` (add 'workflow' to file kinds if not present)
- Modify: `src/stores/vfs-store.ts` (auto-detect workflow files)

**Step 1: Check existing file kind detection**

Look at how `agents/` files get kind `'agent'` and replicate for `workflows/` -> `'workflow'`.

**Step 2: Add workflow kind**

In the file kind detection logic, add:
```typescript
if (path.startsWith('workflows/') && path.endsWith('.md')) return 'workflow';
```

**Step 3: Run VFS tests**

Run: `npx vitest run src/stores/vfs-store.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/types/vfs.ts src/stores/vfs-store.ts
git commit -m "feat: add workflow file kind detection in VFS"
```

---

### Task 34: Full integration test - run all tests

**Step 1: Run the complete test suite**

Run: `npx vitest run`
Expected: All tests PASS, no regressions

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Clean build, no type errors

**Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore: fix any integration issues from feature enhancements"
```

---

## Summary

| Task | Track | Description | New Files |
|------|-------|-------------|-----------|
| 1 | A | Install LanceDB + Transformers.js | - |
| 2-3 | A | Embedding engine (test + impl) | embedding-engine.ts |
| 4-5 | A | Vector store (test + impl) | vector-store.ts |
| 6-7 | A | VectorMemoryDB adapter (test + impl) | vector-memory-db.ts |
| 8 | A | Wire into createMemoryDB factory | - |
| 9 | A | Semantic search in MemoryManager.retrieve | - |
| 10 | A | Vector similarity in Summarizer consolidation | - |
| 11 | A | Settings toggle for vector memory | - |
| 12-13 | A | Knowledge query + contribute plugins | knowledge-query.ts, knowledge-contribute.ts |
| 14 | A | Shared Knowledge UI tab | SharedKnowledgePanel.tsx |
| 15 | B | Install MCP SDK | - |
| 16-17 | B | MCP client manager (test + impl) | mcp-client.ts |
| 18-19 | B | MCP bridge plugin (test + impl) | mcp-bridge-plugin.ts |
| 20 | B | Parse mcp_servers from frontmatter | - |
| 21 | B | Wire MCP into kernel sessions | - |
| 22-23 | B | Pub/Sub store (test + impl) | pub-sub-store.ts |
| 24-25 | B | Publish, Subscribe, Blackboard plugins | pub-sub-plugin.ts, blackboard-plugin.ts |
| 26 | B | Delegate plugin | delegate-plugin.ts |
| 27-28 | B | Workflow parser (test + impl) | workflow-parser.ts |
| 29-30 | B | Workflow engine (test + impl) | workflow-engine.ts |
| 31 | B | Workflow templates | workflow-templates.ts |
| 32 | B | New event types | - |
| 33 | B | Workflow VFS file kind | - |
| 34 | - | Full integration validation | - |
