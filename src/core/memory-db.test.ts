import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryDB, VFSMemoryDB, createMemoryDB } from './memory-db';
import { VectorMemoryDB } from './vector-memory-db';
import type { LongTermMemory } from '../types/memory';
import type { VFSState } from '../stores/vfs-store';

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

// ---------------------------------------------------------------------------
// VFSMemoryDB
// ---------------------------------------------------------------------------

/** Minimal VFS mock backed by a plain Map */
function createMockVFS(): { getState(): VFSState; subscribe(): () => void } {
  const files = new Map<string, string>();
  return {
    getState() {
      return {
        read(path: string) { return files.get(path) ?? null; },
        write(path: string, content: string) { files.set(path, content); },
      } as unknown as VFSState;
    },
    subscribe() { return () => {}; },
  };
}

describe('VFSMemoryDB', () => {
  let vfs: ReturnType<typeof createMockVFS>;
  let db: VFSMemoryDB;

  beforeEach(() => {
    vfs = createMockVFS();
    db = new VFSMemoryDB(vfs);
  });

  it('starts empty when no VFS file exists', async () => {
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

  it('upserts on put with same id', async () => {
    await db.put(makeEntry({ content: 'v1' }));
    await db.put(makeEntry({ content: 'v2' }));

    const all = await db.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('v2');
  });

  it('stores multiple entries with different ids', async () => {
    await db.put(makeEntry({ id: 'a', content: 'alpha' }));
    await db.put(makeEntry({ id: 'b', content: 'beta' }));

    const all = await db.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual(['a', 'b']);
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

  it('clear writes empty array', async () => {
    await db.put(makeEntry({ id: 'a' }));
    await db.put(makeEntry({ id: 'b' }));
    await db.clear();

    const all = await db.getAll();
    expect(all).toEqual([]);
  });

  it('persists as JSON at memory/long-term-memory.json', async () => {
    await db.put(makeEntry());

    const raw = vfs.getState().read('memory/long-term-memory.json');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('mem-1');
  });

  it('returns empty array for corrupted JSON', async () => {
    vfs.getState().write('memory/long-term-memory.json', 'not valid json', {});

    const all = await db.getAll();
    expect(all).toEqual([]);
  });

  it('returns empty array for non-array JSON', async () => {
    vfs.getState().write('memory/long-term-memory.json', '{"not": "array"}', {});

    const all = await db.getAll();
    expect(all).toEqual([]);
  });

  it('reads entries written by a previous VFSMemoryDB instance', async () => {
    await db.put(makeEntry({ id: 'persisted', content: 'survives' }));

    // Create a fresh db pointing to the same VFS
    const db2 = new VFSMemoryDB(vfs);
    const all = await db2.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('survives');
  });
});

// ---------------------------------------------------------------------------
// createMemoryDB factory
// ---------------------------------------------------------------------------

describe('createMemoryDB factory', () => {
  it('returns VectorMemoryDB when useVectorStore option is true', () => {
    const db = createMemoryDB(undefined, { useVectorStore: true });
    expect(db).toBeInstanceOf(VectorMemoryDB);
  });
});
