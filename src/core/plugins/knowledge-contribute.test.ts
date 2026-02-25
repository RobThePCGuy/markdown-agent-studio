import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../tool-plugin';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';
import { createMemoryStore } from '../../stores/memory-store';
import { knowledgeContributePlugin } from './knowledge-contribute';

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  const vfs = createVFSStore();
  const registry = createAgentRegistry();
  const eventLog = createEventLog(vfs);
  const memoryStore = createMemoryStore();

  // Initialize the run so writes are accepted
  memoryStore.getState().initRun('test-run-1');

  return {
    vfs,
    registry,
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
    memoryStore,
    vectorStore: {
      semanticSearch: vi.fn().mockResolvedValue([]),
      markShared: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('knowledge_contribute plugin', () => {
  it('has the correct name and parameters', () => {
    expect(knowledgeContributePlugin.name).toBe('knowledge_contribute');
    expect(knowledgeContributePlugin.parameters.content).toBeDefined();
    expect(knowledgeContributePlugin.parameters.content.required).toBe(true);
    expect(knowledgeContributePlugin.parameters.type).toBeDefined();
    expect(knowledgeContributePlugin.parameters.type.required).toBe(true);
    expect(knowledgeContributePlugin.parameters.tags).toBeDefined();
  });

  it('returns error when vectorStore is not available', async () => {
    const ctx = makeContext({ vectorStore: undefined });
    const result = await knowledgeContributePlugin.handler(
      { content: 'test content', type: 'fact' },
      ctx,
    );

    expect(result).toContain('Error');
    expect(result).toContain('Vector memory is not available');
  });

  it('returns error when content is empty', async () => {
    const ctx = makeContext();
    const result = await knowledgeContributePlugin.handler(
      { content: '  ', type: 'fact' },
      ctx,
    );

    expect(result).toBe('Error: content is required.');
  });

  it('writes to memoryStore when available', async () => {
    const ctx = makeContext();
    const result = await knowledgeContributePlugin.handler(
      { content: 'Python uses indentation for blocks', type: 'fact', tags: 'python,syntax' },
      ctx,
    );

    expect(result).toContain('Contributed to shared knowledge');
    expect(result).toContain('[fact]');
    expect(result).toContain('Python uses indentation for blocks');

    // Verify the entry was written to memory
    const entries = ctx.memoryStore!.getState().read('shared:fact');
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('Python uses indentation for blocks');
    expect(entries[0].tags).toContain('python');
    expect(entries[0].tags).toContain('syntax');
    expect(entries[0].tags).toContain('shared');
    expect(entries[0].authorAgentId).toBe('agent-1');
  });

  it('works without memoryStore', async () => {
    const ctx = makeContext({ memoryStore: undefined });
    const result = await knowledgeContributePlugin.handler(
      { content: 'Some knowledge', type: 'observation' },
      ctx,
    );

    expect(result).toContain('Contributed to shared knowledge');
    expect(result).toContain('[observation]');
  });

  it('defaults type to fact when not provided', async () => {
    const ctx = makeContext();
    const result = await knowledgeContributePlugin.handler(
      { content: 'A useful fact', type: '' },
      ctx,
    );

    expect(result).toContain('[fact]');
  });

  it('parses and normalizes tags', async () => {
    const ctx = makeContext();
    await knowledgeContributePlugin.handler(
      { content: 'Tag test', type: 'skill', tags: ' JavaScript , React , UI ' },
      ctx,
    );

    const entries = ctx.memoryStore!.getState().read('shared:skill');
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toEqual(['javascript', 'react', 'ui', 'shared']);
  });

  it('truncates content in response to 80 chars', async () => {
    const longContent = 'A'.repeat(120);
    const ctx = makeContext();
    const result = await knowledgeContributePlugin.handler(
      { content: longContent, type: 'fact' },
      ctx,
    );

    // The response should contain at most 80 chars of content
    expect(result).toContain('"' + 'A'.repeat(80) + '...');
  });
});
