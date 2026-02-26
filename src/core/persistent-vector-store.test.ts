import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { PersistentVectorStore } from './persistent-vector-store';
import type { MemoryVector } from './vector-store';

function makeVector(id: string, content: string, agentId = 'agent-a'): Omit<MemoryVector, 'embedding'> {
  return {
    id,
    agentId,
    content,
    type: 'fact',
    tags: ['test'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    shared: false,
  };
}

describe('PersistentVectorStore', () => {
  let store: PersistentVectorStore;

  beforeEach(async () => {
    store = new PersistentVectorStore();
    await store.init();
    await store.clear();
  });

  it('init() loads existing vectors from IndexedDB', async () => {
    await store.add(makeVector('v1', 'hello world'));

    // Create a new store instance and init it - should load from IndexedDB
    const store2 = new PersistentVectorStore();
    await store2.init();

    const all = await store2.getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('v1');
    expect(all[0].content).toBe('hello world');
  });

  it('add() persists and survives re-init', async () => {
    const vec = await store.add(makeVector('v2', 'persistent data'));
    expect(vec.embedding.length).toBeGreaterThan(0);

    const store2 = new PersistentVectorStore();
    await store2.init();
    const found = await store2.getById('v2');
    expect(found).not.toBeNull();
    expect(found!.content).toBe('persistent data');
  });

  it('search() returns cosine-ranked results', async () => {
    await store.add(makeVector('v-cat', 'cats are furry animals'));
    await store.add(makeVector('v-dog', 'dogs are loyal companions'));
    await store.add(makeVector('v-code', 'JavaScript is a programming language'));

    const results = await store.search('feline pet', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.length).toBeGreaterThan(0);
  });

  it('searchWithDiagnostics() supports keywordFilter/minScore and returns telemetry', async () => {
    await store.add(makeVector('diag-a', 'TypeScript migration guide'));
    await store.add(makeVector('diag-b', 'Cooking and recipes notebook'));

    const out = await store.searchWithDiagnostics('TypeScript', {
      keywordFilter: 'typescript',
      minScore: -1,
      limit: 5,
    });

    const ids = out.results.map((r) => r.id);
    expect(ids).toContain('diag-a');
    expect(ids).not.toContain('diag-b');
    expect(out.diagnostics.totalVectors).toBeGreaterThan(0);
    expect(out.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('update() regenerates embedding on content change', async () => {
    const original = await store.add(makeVector('v3', 'original content'));
    const origEmbed = [...original.embedding];

    await store.update('v3', { content: 'completely different content' });
    const updated = await store.getById('v3');
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe('completely different content');
    // Embedding should differ
    expect(updated!.embedding).not.toEqual(origEmbed);
  });

  it('delete() removes from cache and DB', async () => {
    await store.add(makeVector('v4', 'to be deleted'));
    await store.delete('v4');

    expect(await store.getById('v4')).toBeNull();

    // Also gone after re-init
    const store2 = new PersistentVectorStore();
    await store2.init();
    expect(await store2.getById('v4')).toBeNull();
  });

  it('clear() empties everything', async () => {
    await store.add(makeVector('v5', 'data'));
    await store.add(makeVector('v6', 'more data'));
    await store.clear();

    expect((await store.getAll()).length).toBe(0);

    const store2 = new PersistentVectorStore();
    await store2.init();
    expect((await store2.getAll()).length).toBe(0);
  });
});
