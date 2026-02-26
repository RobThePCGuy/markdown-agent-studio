import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LongTermMemory } from '../types/memory';

// ---------------------------------------------------------------------------
// Deterministic fake embedding generator (same as vector-store.test.ts)
// ---------------------------------------------------------------------------

function fakeEmbed(text: string): number[] {
  const arr = new Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = ((text.charCodeAt(i % text.length) + i) % 100) / 100;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Mock EmbeddingEngine
// ---------------------------------------------------------------------------

const mockEmbed = vi.fn(async (text: string) => fakeEmbed(text));

vi.mock('./embedding-engine', () => {
  return {
    EmbeddingEngine: class MockEmbeddingEngine {
      embed = mockEmbed;
      embedBatch = async (texts: string[]) => texts.map((t) => fakeEmbed(t));
      isReady = () => true;
    },
  };
});

// ---------------------------------------------------------------------------
// Import after mock is set up
// ---------------------------------------------------------------------------

import { VectorMemoryDB } from './vector-memory-db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLTM(overrides: Partial<LongTermMemory> = {}): LongTermMemory {
  return {
    id: overrides.id ?? 'mem-1',
    agentId: overrides.agentId ?? 'agent-A',
    type: overrides.type ?? 'fact',
    content: overrides.content ?? 'TypeScript is a typed superset of JavaScript',
    tags: overrides.tags ?? ['typescript', 'programming'],
    createdAt: overrides.createdAt ?? 1000,
    lastAccessedAt: overrides.lastAccessedAt ?? 2000,
    accessCount: overrides.accessCount ?? 5,
    runId: overrides.runId ?? 'run-123',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VectorMemoryDB', () => {
  let db: VectorMemoryDB;

  beforeEach(async () => {
    mockEmbed.mockClear();
    db = new VectorMemoryDB({ inMemory: true });
    await db.init();
  });

  // ---- 1. put and getAll works (implements MemoryDB contract)
  it('put and getAll works - implements MemoryDB contract', async () => {
    const entry = makeLTM({ id: 'ltm-1', content: 'Hello world' });
    await db.put(entry);

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('ltm-1');
    expect(all[0].agentId).toBe('agent-A');
    expect(all[0].type).toBe('fact');
    expect(all[0].content).toBe('Hello world');
    expect(all[0].tags).toEqual(['typescript', 'programming']);
    expect(all[0].createdAt).toBe(1000);
  });

  // ---- 2. delete removes entry
  it('delete removes entry', async () => {
    await db.put(makeLTM({ id: 'del-1', content: 'First' }));
    await db.put(makeLTM({ id: 'del-2', content: 'Second' }));

    expect(await db.getAll()).toHaveLength(2);

    await db.delete('del-1');

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('del-2');
  });

  // ---- 3. clear removes all
  it('clear removes all', async () => {
    await db.put(makeLTM({ id: 'c1', content: 'One' }));
    await db.put(makeLTM({ id: 'c2', content: 'Two' }));
    await db.put(makeLTM({ id: 'c3', content: 'Three' }));

    expect(await db.getAll()).toHaveLength(3);

    await db.clear();

    const all = await db.getAll();
    expect(all).toHaveLength(0);
  });

  // ---- 4. semanticSearch returns relevant results
  it('semanticSearch returns relevant results', async () => {
    await db.put(makeLTM({ id: 's1', agentId: 'agent-A', content: 'TypeScript language features' }));
    await db.put(makeLTM({ id: 's2', agentId: 'agent-A', content: 'Cooking Italian pasta recipes' }));
    await db.put(makeLTM({ id: 's3', agentId: 'agent-A', content: 'JavaScript frameworks and tools' }));

    const results = await db.semanticSearch('TypeScript programming', 'agent-A');

    // Should return results for agent-A
    expect(results.length).toBeGreaterThan(0);

    // Results should be LongTermMemory objects with all fields
    const first = results[0];
    expect(first.id).toBeDefined();
    expect(first.agentId).toBe('agent-A');
    expect(first.type).toBe('fact');
    expect(first.content).toBeDefined();
    expect(first.tags).toBeDefined();
    expect(first.createdAt).toBeDefined();
    expect(first.lastAccessedAt).toBeDefined();
    expect(typeof first.accessCount).toBe('number');
    expect(typeof first.runId).toBe('string');
  });

  // ---- 5. semanticSearch includes shared memories from other agents
  it('semanticSearch includes shared memories from other agents', async () => {
    // agent-A's private memory
    await db.put(makeLTM({ id: 'own-1', agentId: 'agent-A', content: 'My private note' }));
    // agent-B's private memory - should NOT appear
    await db.put(makeLTM({ id: 'other-1', agentId: 'agent-B', content: 'Someone else private note' }));
    // Global/shared memory - should appear for any agent
    await db.put(makeLTM({ id: 'global-1', agentId: 'global', content: 'A shared global fact' }));

    const results = await db.semanticSearch('note', 'agent-A');

    const ids = results.map((r) => r.id);
    expect(ids).toContain('own-1');
    expect(ids).not.toContain('other-1');
    expect(ids).toContain('global-1');
  });

  // ---- 6. put is upsert - updates existing entry
  it('put is upsert - updates existing entry', async () => {
    const original = makeLTM({ id: 'upsert-1', content: 'Original content' });
    await db.put(original);

    const updated = makeLTM({ id: 'upsert-1', content: 'Updated content', tags: ['updated'] });
    await db.put(updated);

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('upsert-1');
    expect(all[0].content).toBe('Updated content');
    expect(all[0].tags).toEqual(['updated']);
  });

  // ---- 7. markShared changes shared flag
  it('markShared changes shared flag', async () => {
    await db.put(makeLTM({ id: 'share-1', agentId: 'agent-A', content: 'Initially private' }));

    // Before marking shared, agent-B should NOT see it
    let results = await db.semanticSearch('private', 'agent-B');
    let ids = results.map((r) => r.id);
    expect(ids).not.toContain('share-1');

    // Mark as shared
    await db.markShared('share-1', true);

    // Now agent-B should see it
    results = await db.semanticSearch('private', 'agent-B');
    ids = results.map((r) => r.id);
    expect(ids).toContain('share-1');

    // Unmark shared
    await db.markShared('share-1', false);

    // agent-B should no longer see it
    results = await db.semanticSearch('private', 'agent-B');
    ids = results.map((r) => r.id);
    expect(ids).not.toContain('share-1');
  });

  // ---- Additional: semanticSearch respects limit
  it('semanticSearch respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await db.put(makeLTM({ id: `lim-${i}`, agentId: 'agent-A', content: `Memory item ${i}` }));
    }

    const results = await db.semanticSearch('memory', 'agent-A', 3);
    expect(results).toHaveLength(3);
  });

  // ---- Additional: getAll returns proper LongTermMemory structure
  it('getAll returns proper LongTermMemory structure with defaults', async () => {
    await db.put(makeLTM({
      id: 'struct-1',
      agentId: 'agent-X',
      type: 'procedure',
      content: 'How to deploy',
      tags: ['devops'],
      createdAt: 5000,
      lastAccessedAt: 6000,
      accessCount: 3,
      runId: 'run-456',
    }));

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    const mem = all[0];
    expect(mem.id).toBe('struct-1');
    expect(mem.agentId).toBe('agent-X');
    expect(mem.type).toBe('procedure');
    expect(mem.content).toBe('How to deploy');
    expect(mem.tags).toEqual(['devops']);
    expect(mem.createdAt).toBe(5000);
  });

  // ---- Additional: multiple puts and getAll returns all
  it('multiple puts and getAll returns all entries', async () => {
    await db.put(makeLTM({ id: 'm1', content: 'Alpha' }));
    await db.put(makeLTM({ id: 'm2', content: 'Beta' }));
    await db.put(makeLTM({ id: 'm3', content: 'Gamma' }));

    const all = await db.getAll();
    expect(all).toHaveLength(3);
    const ids = all.map((e) => e.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    expect(ids).toContain('m3');
  });

  it('semanticSearchDetailed returns diagnostics and filtered results', async () => {
    await db.put(makeLTM({ id: 'd1', agentId: 'agent-A', content: 'TypeScript coding style guide' }));
    await db.put(makeLTM({ id: 'd2', agentId: 'agent-A', content: 'Gardening seasonal checklist' }));

    const out = await db.semanticSearchDetailed('guide', 'agent-A', {
      keywordFilter: 'typescript',
      minScore: -1,
      limit: 5,
    });

    const ids = out.results.map((r) => r.id);
    expect(ids).toContain('d1');
    expect(ids).not.toContain('d2');
    expect(out.diagnostics.totalVectors).toBeGreaterThan(0);
  });
});
