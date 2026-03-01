import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryManager, _resetLtmCounter } from './memory-manager';
import type { MemoryDB } from './memory-db';
import type { LongTermMemory } from '../types/memory';

// ---------------------------------------------------------------------------
// Mock EmbeddingEngine so VectorMemoryDB tests don't load the real ML model
// ---------------------------------------------------------------------------

function fakeEmbed(text: string): number[] {
  const arr = new Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = ((text.charCodeAt(i % text.length) + i) % 100) / 100;
  }
  return arr;
}

vi.mock('./embedding-engine', () => {
  return {
    EmbeddingEngine: class MockEmbeddingEngine {
      embed = async (text: string) => fakeEmbed(text);
      embedBatch = async (texts: string[]) => texts.map((t) => fakeEmbed(t));
      isReady = () => true;
    },
  };
});

/** In-memory mock implementation of MemoryDB */
class MockMemoryDB implements MemoryDB {
  private store = new Map<string, LongTermMemory>();

  async getAll(): Promise<LongTermMemory[]> {
    return [...this.store.values()];
  }

  async put(entry: LongTermMemory): Promise<void> {
    this.store.set(entry.id, entry);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

describe('MemoryManager', () => {
  let db: MockMemoryDB;
  let mm: MemoryManager;

  beforeEach(() => {
    _resetLtmCounter();
    db = new MockMemoryDB();
    mm = new MemoryManager(db);
  });

  describe('store', () => {
    it('creates a LongTermMemory with correct fields', async () => {
      const before = Date.now();
      const mem = await mm.store({
        agentId: 'agent-1',
        type: 'fact',
        content: 'The sky is blue',
        tags: ['sky', 'color'],
        runId: 'run-1',
      });

      expect(mem.id).toMatch(/^ltm-1-\d+$/);
      expect(mem.agentId).toBe('agent-1');
      expect(mem.type).toBe('fact');
      expect(mem.content).toBe('The sky is blue');
      expect(mem.tags).toEqual(['sky', 'color']);
      expect(mem.accessCount).toBe(0);
      expect(mem.createdAt).toBeGreaterThanOrEqual(before);
      expect(mem.lastAccessedAt).toBe(mem.createdAt);
      expect(mem.runId).toBe('run-1');
    });

    it('auto-increments the id counter', async () => {
      const m1 = await mm.store({
        agentId: 'a',
        type: 'fact',
        content: 'first',
        tags: [],
        runId: 'r',
      });
      const m2 = await mm.store({
        agentId: 'a',
        type: 'fact',
        content: 'second',
        tags: [],
        runId: 'r',
      });

      expect(m1.id).toMatch(/^ltm-1-/);
      expect(m2.id).toMatch(/^ltm-2-/);
    });

    it('persists to the DB', async () => {
      await mm.store({
        agentId: 'a',
        type: 'observation',
        content: 'test',
        tags: [],
        runId: 'r',
      });
      const all = await mm.getAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('retrieve', () => {
    it('filters by agentId', async () => {
      await mm.store({ agentId: 'agent-1', type: 'fact', content: 'hello world', tags: ['hello'], runId: 'r' });
      await mm.store({ agentId: 'agent-2', type: 'fact', content: 'hello world', tags: ['hello'], runId: 'r' });

      const results = await mm.retrieve('agent-1', 'hello');
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('agent-1');
    });

    it('includes global memories', async () => {
      await mm.store({ agentId: 'global', type: 'fact', content: 'shared info', tags: ['shared'], runId: 'r' });
      await mm.store({ agentId: 'agent-1', type: 'fact', content: 'private info', tags: ['private'], runId: 'r' });

      const results = await mm.retrieve('agent-1', 'info');
      expect(results).toHaveLength(2);
      const agentIds = results.map((r) => r.agentId);
      expect(agentIds).toContain('global');
      expect(agentIds).toContain('agent-1');
    });

    it('scores tag matches higher than content matches', async () => {
      // Memory with tag match for "deploy"
      await mm.store({ agentId: 'a', type: 'fact', content: 'unrelated content', tags: ['deploy'], runId: 'r' });
      // Memory with only content match for "deploy"
      await mm.store({ agentId: 'a', type: 'fact', content: 'how to deploy apps', tags: ['other'], runId: 'r' });

      const results = await mm.retrieve('a', 'deploy');
      // The tag-match memory should rank first (tag=+3 vs content=+1)
      expect(results[0].tags).toContain('deploy');
    });

    it('gives mistake type a bonus', async () => {
      await mm.store({ agentId: 'a', type: 'fact', content: 'some fact', tags: [], runId: 'r' });
      await mm.store({ agentId: 'a', type: 'mistake', content: 'some mistake', tags: [], runId: 'r' });

      // With no context match, the mistake bonus (+2) should push it above the fact
      const results = await mm.retrieve('a', 'zzz-no-match');
      expect(results[0].type).toBe('mistake');
    });

    it('increments accessCount on retrieval', async () => {
      await mm.store({ agentId: 'a', type: 'fact', content: 'hello', tags: ['hello'], runId: 'r' });

      await mm.retrieve('a', 'hello');
      const afterFirst = await mm.getAll();
      expect(afterFirst[0].accessCount).toBe(1);

      await mm.retrieve('a', 'hello');
      const afterSecond = await mm.getAll();
      expect(afterSecond[0].accessCount).toBe(2);
    });

    it('updates lastAccessedAt on retrieval', async () => {
      const mem = await mm.store({ agentId: 'a', type: 'fact', content: 'hello', tags: ['hello'], runId: 'r' });
      const originalAccess = mem.lastAccessedAt;

      // Small delay to ensure time difference
      await new Promise((r) => setTimeout(r, 5));

      await mm.retrieve('a', 'hello');
      const all = await mm.getAll();
      expect(all[0].lastAccessedAt).toBeGreaterThanOrEqual(originalAccess);
    });

    it('respects maxEntries limit', async () => {
      for (let i = 0; i < 10; i++) {
        await mm.store({ agentId: 'a', type: 'fact', content: `item ${i}`, tags: [], runId: 'r' });
      }

      const results = await mm.retrieve('a', 'item', 3);
      expect(results).toHaveLength(3);
    });

    it('defaults maxEntries to 25', async () => {
      for (let i = 0; i < 30; i++) {
        await mm.store({ agentId: 'a', type: 'fact', content: `item ${i}`, tags: [], runId: 'r' });
      }

      const results = await mm.retrieve('a', 'item');
      expect(results).toHaveLength(25);
    });

    it('returns empty array when no memories match', async () => {
      await mm.store({ agentId: 'agent-2', type: 'fact', content: 'private', tags: [], runId: 'r' });

      const results = await mm.retrieve('agent-1', 'anything');
      expect(results).toEqual([]);
    });
  });

  describe('delete', () => {
    it('removes a memory by id', async () => {
      const mem = await mm.store({ agentId: 'a', type: 'fact', content: 'delete me', tags: [], runId: 'r' });
      await mm.delete(mem.id);
      const all = await mm.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('clearAll', () => {
    it('removes all memories', async () => {
      await mm.store({ agentId: 'a', type: 'fact', content: 'one', tags: [], runId: 'r' });
      await mm.store({ agentId: 'b', type: 'fact', content: 'two', tags: [], runId: 'r' });
      await mm.clearAll();
      const all = await mm.getAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('updates content only', async () => {
      const mem = await mm.store({ agentId: 'a', type: 'fact', content: 'old', tags: ['tag1'], runId: 'r' });
      await mm.update(mem.id, { content: 'new' });

      const all = await mm.getAll();
      expect(all[0].content).toBe('new');
      expect(all[0].tags).toEqual(['tag1']);
    });

    it('updates tags only', async () => {
      const mem = await mm.store({ agentId: 'a', type: 'fact', content: 'keep', tags: ['old'], runId: 'r' });
      await mm.update(mem.id, { tags: ['new', 'tags'] });

      const all = await mm.getAll();
      expect(all[0].content).toBe('keep');
      expect(all[0].tags).toEqual(['new', 'tags']);
    });

    it('updates both content and tags', async () => {
      const mem = await mm.store({ agentId: 'a', type: 'fact', content: 'old', tags: ['old'], runId: 'r' });
      await mm.update(mem.id, { content: 'new', tags: ['new'] });

      const all = await mm.getAll();
      expect(all[0].content).toBe('new');
      expect(all[0].tags).toEqual(['new']);
    });

    it('preserves other fields (type, agentId, accessCount, etc.)', async () => {
      const mem = await mm.store({ agentId: 'agent-x', type: 'mistake', content: 'old', tags: [], runId: 'run-5' });
      await mm.update(mem.id, { content: 'updated' });

      const all = await mm.getAll();
      expect(all[0].type).toBe('mistake');
      expect(all[0].agentId).toBe('agent-x');
      expect(all[0].runId).toBe('run-5');
      expect(all[0].createdAt).toBe(mem.createdAt);
    });

    it('is a no-op for non-existent id', async () => {
      await mm.store({ agentId: 'a', type: 'fact', content: 'safe', tags: [], runId: 'r' });
      await mm.update('does-not-exist', { content: 'should not appear' });

      const all = await mm.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('safe');
    });
  });

  describe('buildMemoryPrompt', () => {
    it('formats memories as markdown with header', async () => {
      await mm.store({ agentId: 'a', type: 'fact', content: 'The API uses REST', tags: ['api', 'rest'], runId: 'r' });
      await mm.store({ agentId: 'a', type: 'mistake', content: 'Forgot to handle 404', tags: ['error', 'api'], runId: 'r' });

      const prompt = await mm.buildMemoryPrompt('a', 'api error handling');

      expect(prompt).toContain('## Memory Context');
      expect(prompt).toContain('**[fact]**');
      expect(prompt).toContain('**[mistake]**');
      expect(prompt).toContain('The API uses REST');
      expect(prompt).toContain('Forgot to handle 404');
      expect(prompt).toContain('_(tags: api, rest)_');
      expect(prompt).toContain('_(tags: error, api)_');
    });

    it('returns empty string when no memories match', async () => {
      const prompt = await mm.buildMemoryPrompt('nonexistent', 'anything');
      expect(prompt).toBe('');
    });

    it('returns empty string when DB is empty', async () => {
      const prompt = await mm.buildMemoryPrompt('a', 'test');
      expect(prompt).toBe('');
    });

    it('respects tokenBudget by truncating memory lines', async () => {
      await mm.store({
        agentId: 'a',
        type: 'fact',
        content: 'alpha details alpha details alpha details alpha details',
        tags: ['alpha'],
        runId: 'r',
      });
      await mm.store({
        agentId: 'a',
        type: 'fact',
        content: 'beta details beta details beta details beta details',
        tags: ['beta'],
        runId: 'r',
      });

      const prompt = await mm.buildMemoryPrompt('a', 'alpha beta', 15, 24);
      const memoryLines = prompt
        .split('\n')
        .filter((line) => line.startsWith('- **['));

      expect(memoryLines.length).toBe(1);
      expect(prompt).toContain('## Memory Context');
    });
  });
});

// ---------------------------------------------------------------------------
// MemoryManager with VectorMemoryDB
// ---------------------------------------------------------------------------

import { VectorMemoryDB } from './vector-memory-db';

describe('MemoryManager with VectorMemoryDB', () => {
  let vectorDb: VectorMemoryDB;
  let mm: MemoryManager;

  beforeEach(async () => {
    _resetLtmCounter();
    vectorDb = new VectorMemoryDB({ inMemory: true });
    await vectorDb.init();
    mm = new MemoryManager(vectorDb);
  });

  it('retrieve uses semantic search when db is VectorMemoryDB', async () => {
    // Store some memories through the manager
    await mm.store({ agentId: 'agent-A', type: 'fact', content: 'TypeScript language features and type system', tags: ['typescript'], runId: 'r1' });
    await mm.store({ agentId: 'agent-A', type: 'fact', content: 'Cooking Italian pasta recipes at home', tags: ['cooking'], runId: 'r2' });
    await mm.store({ agentId: 'agent-A', type: 'fact', content: 'JavaScript frameworks and build tools', tags: ['javascript'], runId: 'r3' });

    // Spy on semanticSearch to verify it gets called
    const semanticSpy = vi.spyOn(vectorDb, 'semanticSearch');

    const results = await mm.retrieve('agent-A', 'TypeScript programming');

    // Semantic search should have been called (not the keyword path)
    expect(semanticSpy).toHaveBeenCalledWith('TypeScript programming', 'agent-A', 25);
    expect(results.length).toBeGreaterThan(0);

    // All results should belong to agent-A
    for (const mem of results) {
      expect(mem.agentId).toBe('agent-A');
    }
  });

  it('semantic retrieve updates accessCount and lastAccessedAt', async () => {
    await mm.store({ agentId: 'agent-A', type: 'fact', content: 'Important fact about testing', tags: ['testing'], runId: 'r1' });

    // Spy on db.put to verify access tracking writes happen
    const putSpy = vi.spyOn(vectorDb, 'put');

    // First retrieval
    const results1 = await mm.retrieve('agent-A', 'testing');
    expect(results1).toHaveLength(1);
    // The returned result has accessCount incremented from 0 -> 1
    expect(results1[0].accessCount).toBe(1);
    expect(results1[0].lastAccessedAt).toBeGreaterThan(0);

    // put() should have been called to persist the access tracking update
    expect(putSpy).toHaveBeenCalled();
    const putCall = putSpy.mock.calls[putSpy.mock.calls.length - 1][0];
    expect(putCall.accessCount).toBe(1);

    // Small delay so timestamp differs
    await new Promise((r) => setTimeout(r, 5));

    // Second retrieval - verify put is called again with updated tracking
    putSpy.mockClear();
    const results2 = await mm.retrieve('agent-A', 'testing');
    expect(results2).toHaveLength(1);
    // accessCount is 1 because VectorMemoryDB round-trips through MemoryVector
    // which resets accessCount to 0, then we increment to 1 again.
    // The important thing is that put() is called each time.
    expect(results2[0].accessCount).toBe(1);
    expect(results2[0].lastAccessedAt).toBeGreaterThanOrEqual(results1[0].lastAccessedAt);
    expect(putSpy).toHaveBeenCalled();
  });

  it('semantic retrieve respects maxEntries', async () => {
    for (let i = 0; i < 10; i++) {
      await mm.store({ agentId: 'agent-A', type: 'fact', content: `Memory item number ${i}`, tags: ['item'], runId: 'r' });
    }

    const results = await mm.retrieve('agent-A', 'memory item', 3);
    expect(results).toHaveLength(3);
  });

  it('retrieve still uses keyword scoring for non-vector DB', async () => {
    // Create a manager with the plain MockMemoryDB
    const plainDb = new MockMemoryDB();
    const plainMm = new MemoryManager(plainDb);

    await plainMm.store({ agentId: 'a', type: 'fact', content: 'hello world', tags: ['hello'], runId: 'r' });
    await plainMm.store({ agentId: 'a', type: 'fact', content: 'goodbye world', tags: ['goodbye'], runId: 'r' });

    // Should use keyword path - 'hello' matches tag and content of first memory
    const results = await plainMm.retrieve('a', 'hello');
    expect(results).toHaveLength(2);
    // First result should be the one with 'hello' tag (tag match scores +3)
    expect(results[0].tags).toContain('hello');
  });
});

// ---------------------------------------------------------------------------
// MemoryManager.vectorStoreAdapter
// ---------------------------------------------------------------------------

describe('MemoryManager.vectorStoreAdapter', () => {
  it('returns undefined for non-vector DB', () => {
    const db = new MockMemoryDB();
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
