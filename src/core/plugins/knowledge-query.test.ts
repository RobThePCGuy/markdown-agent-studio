import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../tool-plugin';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';
import { knowledgeQueryPlugin } from './knowledge-query';

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  const vfs = createVFSStore();
  const registry = createAgentRegistry();
  const eventLog = createEventLog(vfs);

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
    ...overrides,
  };
}

describe('knowledge_query plugin', () => {
  it('has the correct name and parameters', () => {
    expect(knowledgeQueryPlugin.name).toBe('knowledge_query');
    expect(knowledgeQueryPlugin.parameters.query).toBeDefined();
    expect(knowledgeQueryPlugin.parameters.query.required).toBe(true);
    expect(knowledgeQueryPlugin.parameters.limit).toBeDefined();
  });

  it('returns error when vectorStore is not available', async () => {
    const ctx = makeContext({ vectorStore: undefined });
    const result = await knowledgeQueryPlugin.handler({ query: 'test' }, ctx);

    expect(result).toContain('Error');
    expect(result).toContain('Vector memory is not available');
  });

  it('returns error when query is empty', async () => {
    const vectorStore = {
      semanticSearch: vi.fn(),
      markShared: vi.fn(),
    };
    const ctx = makeContext({ vectorStore });
    const result = await knowledgeQueryPlugin.handler({ query: '  ' }, ctx);

    expect(result).toBe('Error: query is required.');
    expect(vectorStore.semanticSearch).not.toHaveBeenCalled();
  });

  it('returns no-results message when search returns empty', async () => {
    const vectorStore = {
      semanticSearch: vi.fn().mockResolvedValue([]),
      markShared: vi.fn(),
    };
    const ctx = makeContext({ vectorStore });
    const result = await knowledgeQueryPlugin.handler(
      { query: 'unknown topic' },
      ctx,
    );

    expect(result).toBe('No shared knowledge found.');
    expect(vectorStore.semanticSearch).toHaveBeenCalledWith(
      'unknown topic',
      'agent-1',
      10,
    );
  });

  it('returns formatted results when vectorStore returns data', async () => {
    const mockResults = [
      {
        type: 'fact',
        content: 'The sky is blue',
        tags: ['science', 'nature'],
        agentId: 'agent-2',
      },
      {
        type: 'skill',
        content: 'How to parse JSON',
        tags: ['programming'],
        agentId: 'agent-3',
      },
    ];

    const vectorStore = {
      semanticSearch: vi.fn().mockResolvedValue(mockResults),
      markShared: vi.fn(),
    };
    const ctx = makeContext({ vectorStore });
    const result = await knowledgeQueryPlugin.handler(
      { query: 'sky color', limit: 5 },
      ctx,
    );

    expect(result).toContain('1. [fact] The sky is blue');
    expect(result).toContain('Tags: science, nature');
    expect(result).toContain('From: agent-2');
    expect(result).toContain('2. [skill] How to parse JSON');
    expect(result).toContain('Tags: programming');
    expect(result).toContain('From: agent-3');
    expect(result).toContain('---');

    expect(vectorStore.semanticSearch).toHaveBeenCalledWith(
      'sky color',
      'agent-1',
      5,
    );
  });

  it('defaults limit to 10 when not provided', async () => {
    const vectorStore = {
      semanticSearch: vi.fn().mockResolvedValue([]),
      markShared: vi.fn(),
    };
    const ctx = makeContext({ vectorStore });
    await knowledgeQueryPlugin.handler({ query: 'test' }, ctx);

    expect(vectorStore.semanticSearch).toHaveBeenCalledWith(
      'test',
      'agent-1',
      10,
    );
  });
});
