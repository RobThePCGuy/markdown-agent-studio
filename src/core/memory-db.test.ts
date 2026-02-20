import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryDB } from './memory-db';
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

describe('InMemoryMemoryDB', () => {
  let db: InMemoryMemoryDB;

  beforeEach(() => {
    db = new InMemoryMemoryDB();
  });

  it('starts empty', async () => {
    const all = await db.getAll();
    expect(all).toEqual([]);
  });

  it('put and retrieve', async () => {
    const entry = makeEntry();
    await db.put(entry);

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(entry);
  });

  it('stores a copy so mutations do not leak', async () => {
    const entry = makeEntry();
    await db.put(entry);
    entry.content = 'mutated';

    const all = await db.getAll();
    expect(all[0].content).toBe('The sky is blue');
  });

  it('update on put with same id', async () => {
    await db.put(makeEntry({ content: 'v1' }));
    await db.put(makeEntry({ content: 'v2' }));

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('v2');
  });

  it('delete by id', async () => {
    await db.put(makeEntry({ id: 'a' }));
    await db.put(makeEntry({ id: 'b' }));
    await db.delete('a');

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('b');
  });

  it('delete non-existent id is a no-op', async () => {
    await db.put(makeEntry());
    await db.delete('does-not-exist');

    const all = await db.getAll();
    expect(all).toHaveLength(1);
  });

  it('clear all', async () => {
    await db.put(makeEntry({ id: 'a' }));
    await db.put(makeEntry({ id: 'b' }));
    await db.put(makeEntry({ id: 'c' }));
    await db.clear();

    const all = await db.getAll();
    expect(all).toEqual([]);
  });
});
