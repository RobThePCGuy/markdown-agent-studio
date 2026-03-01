import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Summarizer } from './summarizer';
import type { SummarizeFn, ExtractedMemory } from './summarizer';
import { MemoryManager, _resetLtmCounter } from './memory-manager';
import { InMemoryMemoryDB } from './memory-db';
import type { WorkingMemoryEntry } from '../types/memory';
import type { LiveSession } from '../types/session';
import { createVFSStore } from '../stores/vfs-store';

// ---------------------------------------------------------------------------
// Deterministic fake embedding generator for VectorMemoryDB tests
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkingMemory(overrides: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry {
  return {
    id: 'wm-1',
    key: 'status',
    value: 'in progress',
    tags: ['status'],
    authorAgentId: 'agent-1',
    timestamp: Date.now(),
    runId: 'run-1',
    ...overrides,
  };
}

function makeSession(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    agentId: 'agent-1',
    activationId: 'act-1',
    status: 'completed',
    messages: [
      { role: 'user', content: 'Hello agent', timestamp: 1000 },
      { role: 'assistant', content: 'Hello! How can I help?', timestamp: 2000 },
    ],
    streamingText: '',
    toolCalls: [],
    tokenCount: 100,
    startedAt: 1000,
    completedAt: 5000,
    ...overrides,
  };
}

const sampleExtracted: ExtractedMemory[] = [
  { type: 'fact', content: 'The project uses TypeScript', tags: ['typescript', 'config'] },
  { type: 'mistake', content: 'Forgot to handle null case', tags: ['error', 'null'] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Summarizer', () => {
  let db: InMemoryMemoryDB;
  let manager: MemoryManager;
  let mockSummarizeFn: ReturnType<typeof vi.fn<SummarizeFn>>;
  let summarizer: Summarizer;

  beforeEach(() => {
    _resetLtmCounter();
    db = new InMemoryMemoryDB();
    manager = new MemoryManager(db);
    mockSummarizeFn = vi.fn<SummarizeFn>();
    summarizer = new Summarizer(manager, mockSummarizeFn);
  });

  it('calls summarize function with working memory and session data in the context string', async () => {
    const wm = makeWorkingMemory({ key: 'task', value: 'build the widget' });
    const session = makeSession({
      messages: [
        { role: 'user', content: 'Build a widget', timestamp: 1000 },
        { role: 'assistant', content: 'Sure, building the widget now.', timestamp: 2000 },
      ],
    });

    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [wm], [session]);

    expect(mockSummarizeFn).toHaveBeenCalledOnce();

    const contextArg = mockSummarizeFn.mock.calls[0][0];

    // Working memory content should appear in the context
    expect(contextArg).toContain('task');
    expect(contextArg).toContain('build the widget');

    // Session message content should appear in the context
    expect(contextArg).toContain('Build a widget');
    expect(contextArg).toContain('building the widget now');
  });

  it('stores extracted memories in long-term memory', async () => {
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(2);

    const contents = all.map((m) => m.content);
    expect(contents).toContain('The project uses TypeScript');
    expect(contents).toContain('Forgot to handle null case');

    // Check types are preserved
    const types = all.map((m) => m.type);
    expect(types).toContain('fact');
    expect(types).toContain('mistake');

    // Check tags are preserved
    const factMem = all.find((m) => m.type === 'fact')!;
    expect(factMem.tags).toEqual(['typescript', 'config']);
  });

  it('associates memories with the correct run', async () => {
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    await summarizer.summarize('run-42', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    for (const mem of all) {
      expect(mem.runId).toBe('run-42');
    }
  });

  it('uses single agent ID when only one agent in sessions', async () => {
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    await summarizer.summarize(
      'run-1',
      [makeWorkingMemory()],
      [makeSession({ agentId: 'specialist-agent' })],
    );

    const all = await manager.getAll();
    for (const mem of all) {
      expect(mem.agentId).toBe('specialist-agent');
    }
  });

  it('uses "global" agent ID when multiple agents in sessions', async () => {
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    await summarizer.summarize(
      'run-1',
      [makeWorkingMemory()],
      [
        makeSession({ agentId: 'agent-a' }),
        makeSession({ agentId: 'agent-b' }),
      ],
    );

    const all = await manager.getAll();
    for (const mem of all) {
      expect(mem.agentId).toBe('global');
    }
  });

  it('skips summarization when summarize returns empty array', async () => {
    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(0);
  });

  it('handles summarize function errors gracefully (does not throw)', async () => {
    mockSummarizeFn.mockRejectedValue(new Error('LLM API failed'));

    // Should not throw
    await expect(
      summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]),
    ).resolves.toBeUndefined();

    // No memories should be stored
    const all = await manager.getAll();
    expect(all).toHaveLength(0);
  });

  it('truncates long messages to 1200 characters', async () => {
    const longContent = 'x'.repeat(2000);
    const session = makeSession({
      messages: [
        { role: 'user', content: longContent, timestamp: 1000 },
      ],
    });

    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [], [session]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    // The full 2000-char content should NOT appear
    expect(contextArg).not.toContain(longContent);
    // But a truncated version (1200 chars + '...') should
    expect(contextArg).toContain('x'.repeat(1200) + '...');
  });

  it('only includes last 40 messages per session', async () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `msg_${String(i).padStart(3, '0')}_end`,
      timestamp: i * 1000,
    }));
    const session = makeSession({ messages });

    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [], [session]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    // First 10 messages (000-009) should be excluded (only last 40 kept)
    for (let i = 0; i < 10; i++) {
      expect(contextArg).not.toContain(`msg_${String(i).padStart(3, '0')}_end`);
    }
    // Last 40 messages (010-049) should be present
    for (let i = 10; i < 50; i++) {
      expect(contextArg).toContain(`msg_${String(i).padStart(3, '0')}_end`);
    }
  });

  it('includes VFS file contents in context when files are provided', async () => {
    const vfs = createVFSStore();
    vfs.getState().write('research/findings.md', '# Research\nKey finding: X works best', {
      authorAgentId: 'agent-1',
      activationId: 'act-1',
    });
    const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    expect(contextArg).toContain('## Files Touched This Run');
    expect(contextArg).toContain('research/findings.md');
    expect(contextArg).toContain('Key finding: X works best');
  });

  it('excludes agent definition files from file context', async () => {
    const vfs = createVFSStore();
    vfs.getState().write('agents/researcher.md', '---\nname: researcher\n---', {});
    vfs.getState().write('output.md', 'Some output', { authorAgentId: 'agent-1', activationId: 'act-1' });
    const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [], [makeSession()]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    expect(contextArg).not.toContain('agents/researcher.md');
    expect(contextArg).toContain('output.md');
  });

  it('excludes memory/long-term-memory.json from file context', async () => {
    const vfs = createVFSStore();
    vfs.getState().write('memory/long-term-memory.json', '[{"id":"ltm-1"}]', {});
    vfs.getState().write('report.md', 'Report content', { authorAgentId: 'agent-1', activationId: 'act-1' });
    const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [], [makeSession()]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    expect(contextArg).not.toContain('long-term-memory.json');
    expect(contextArg).toContain('report.md');
  });

  it('excludes files not touched by this run activation ids', async () => {
    const vfs = createVFSStore();
    vfs.getState().write('artifacts/old.md', 'old data', { activationId: 'act-old' });
    vfs.getState().write('artifacts/new.md', 'new data', { activationId: 'act-current' });
    const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
    mockSummarizeFn.mockResolvedValue([]);

    await summarizer.summarize('run-1', [], [makeSession({ activationId: 'act-current' })]);

    const contextArg = mockSummarizeFn.mock.calls[0][0];
    expect(contextArg).not.toContain('artifacts/old.md');
    expect(contextArg).toContain('artifacts/new.md');
  });

  it('works without VFS (backwards compatible)', async () => {
    const summarizer = new Summarizer(manager, mockSummarizeFn);
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(2);
  });

  describe('consolidation', () => {
    it('calls consolidateFn with candidates and existing memories', async () => {
      const existing = await manager.store({
        agentId: 'agent-1',
        type: 'fact',
        content: 'Old fact',
        tags: ['old'],
        runId: 'run-0',
      });

      const candidates: ExtractedMemory[] = [
        { type: 'skill', content: 'New skill', tags: ['new'] },
      ];
      mockSummarizeFn.mockResolvedValue(candidates);

      const mockConsolidateFn = vi.fn().mockResolvedValue({
        operations: [
          { action: 'KEEP', id: existing.id },
          { action: 'ADD', type: 'skill', content: 'New skill', tags: ['new'] },
        ],
      });

      const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

      expect(mockConsolidateFn).toHaveBeenCalledOnce();
      const consolidateArg = mockConsolidateFn.mock.calls[0][0];
      expect(consolidateArg).toContain('Old fact');
      expect(consolidateArg).toContain('New skill');
      expect(consolidateArg).toContain('GENEROUS');
    });

    it('applies ADD operations from consolidation', async () => {
      mockSummarizeFn.mockResolvedValue([
        { type: 'skill', content: 'Learned skill', tags: ['skill'] },
      ]);

      const mockConsolidateFn = vi.fn().mockResolvedValue({
        operations: [
          { action: 'ADD', type: 'skill', content: 'Learned skill', tags: ['skill'] },
        ],
      });

      const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

      const all = await manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('Learned skill');
      expect(all[0].type).toBe('skill');
    });

    it('applies UPDATE operations from consolidation', async () => {
      const existing = await manager.store({
        agentId: 'agent-1',
        type: 'fact',
        content: 'Old content',
        tags: ['old'],
        runId: 'run-0',
      });

      mockSummarizeFn.mockResolvedValue([]);

      const mockConsolidateFn = vi.fn().mockResolvedValue({
        operations: [
          { action: 'UPDATE', id: existing.id, content: 'Updated content', tags: ['updated'] },
        ],
      });

      const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [], [makeSession()]);

      const all = await manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('Updated content');
      expect(all[0].tags).toEqual(['updated']);
    });

    it('applies DELETE operations from consolidation', async () => {
      const existing = await manager.store({
        agentId: 'agent-1',
        type: 'fact',
        content: 'To be deleted',
        tags: ['old'],
        runId: 'run-0',
      });

      mockSummarizeFn.mockResolvedValue([]);

      const mockConsolidateFn = vi.fn().mockResolvedValue({
        operations: [
          { action: 'DELETE', id: existing.id },
        ],
      });

      const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [], [makeSession()]);

      const all = await manager.getAll();
      expect(all).toHaveLength(0);
    });

    it('falls back to adding all candidates when consolidation fails', async () => {
      mockSummarizeFn.mockResolvedValue([
        { type: 'fact', content: 'Fallback fact', tags: ['fallback'] },
      ]);

      const mockConsolidateFn = vi.fn().mockRejectedValue(new Error('LLM failed'));

      const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

      const all = await manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('Fallback fact');
    });

    it('falls back when no consolidateFn is provided', async () => {
      mockSummarizeFn.mockResolvedValue(sampleExtracted);

      const summarizer = new Summarizer(manager, mockSummarizeFn);
      await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

      const all = await manager.getAll();
      expect(all).toHaveLength(2);
    });

    it('uses vector similarity per candidate when VectorMemoryDB is used', async () => {
      const { VectorMemoryDB } = await import('./vector-memory-db');
      const vectorDb = new VectorMemoryDB({ inMemory: true });
      await vectorDb.init();

      // Seed the vector DB with an existing memory
      await vectorDb.put({
        id: 'ltm-existing-1',
        agentId: 'agent-1',
        type: 'fact',
        content: 'TypeScript uses structural typing',
        tags: ['typescript'],
        createdAt: 1000,
        lastAccessedAt: 2000,
        accessCount: 3,
        runId: 'run-0',
      });

      const vectorManager = new MemoryManager(vectorDb);

      const candidates: ExtractedMemory[] = [
        { type: 'fact', content: 'TypeScript supports generics', tags: ['typescript', 'generics'] },
      ];
      mockSummarizeFn.mockResolvedValue(candidates);

      const mockConsolidateFn = vi.fn().mockResolvedValue({
        operations: [
          { action: 'ADD', type: 'fact', content: 'TypeScript supports generics', tags: ['typescript', 'generics'] },
        ],
      });

      const summarizer = new Summarizer(vectorManager, mockSummarizeFn, undefined, mockConsolidateFn);
      await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

      expect(mockConsolidateFn).toHaveBeenCalledOnce();
      const consolidateArg = mockConsolidateFn.mock.calls[0][0];

      // Should use the vector-based format with per-candidate similarity
      expect(consolidateArg).toContain('similar matches per candidate');
      // Should NOT contain the fallback "Existing Long-Term Memories" header
      expect(consolidateArg).not.toContain('Existing Long-Term Memories');
      // Should contain the candidate listing
      expect(consolidateArg).toContain('TypeScript supports generics');
      // Should contain similar existing memories found via semantic search
      expect(consolidateArg).toContain('Similar existing:');
      expect(consolidateArg).toContain('ltm-existing-1');
    });
  });
});
