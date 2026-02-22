import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryManager, _resetLtmCounter } from './memory-manager';
import type { MemoryDB } from './memory-db';
import type { LongTermMemory } from '../types/memory';

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

    it('defaults maxEntries to 15', async () => {
      for (let i = 0; i < 20; i++) {
        await mm.store({ agentId: 'a', type: 'fact', content: `item ${i}`, tags: [], runId: 'r' });
      }

      const results = await mm.retrieve('a', 'item');
      expect(results).toHaveLength(15);
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
  });
});
