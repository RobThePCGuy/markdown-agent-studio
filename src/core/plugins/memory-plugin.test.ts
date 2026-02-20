import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolContext } from '../tool-plugin';
import { createMemoryStore } from '../../stores/memory-store';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';
import { memoryWritePlugin, memoryReadPlugin } from './memory-plugin';

function makeContext(
  overrides?: Partial<ToolContext>,
): ToolContext {
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
    ...overrides,
  };
}

describe('memory_write plugin', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it('writes an entry to working memory', async () => {
    const result = await memoryWritePlugin.handler(
      { key: 'test-key', value: 'test-value' },
      ctx,
    );

    expect(result).toContain('Memory written');
    expect(result).toContain('test-key');

    // Verify it was actually written
    const entries = ctx.memoryStore!.getState().read('test-key');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('test-key');
    expect(entries[0].value).toBe('test-value');
    expect(entries[0].authorAgentId).toBe('agent-1');
  });

  it('returns error when no memory store', async () => {
    const noMemCtx = makeContext({ memoryStore: undefined });
    const result = await memoryWritePlugin.handler(
      { key: 'k', value: 'v' },
      noMemCtx,
    );

    expect(result).toContain('Error');
    expect(result).toContain('Memory store is not available');
  });

  it('parses comma-separated tags with trimming', async () => {
    const result = await memoryWritePlugin.handler(
      { key: 'tagged', value: 'data', tags: ' research , api , important ' },
      ctx,
    );

    expect(result).toContain('3 tags');

    const entries = ctx.memoryStore!.getState().read('tagged');
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toEqual(['research', 'api', 'important']);
  });
});

describe('memory_read plugin', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it('reads matching entries', async () => {
    // Write some entries first
    ctx.memoryStore!.getState().write({
      key: 'weather-data',
      value: 'It is sunny today',
      tags: ['weather'],
      authorAgentId: 'agent-1',
    });

    const result = await memoryReadPlugin.handler({ query: 'weather' }, ctx);

    expect(result).toContain('weather-data');
    expect(result).toContain('It is sunny today');
    expect(result).toContain('agent-1');
  });

  it('returns no-results message when nothing matches', async () => {
    const result = await memoryReadPlugin.handler(
      { query: 'nonexistent-query-xyz' },
      ctx,
    );

    expect(result).toBe('No matching memories found.');
  });

  it('filters by tags when provided', async () => {
    ctx.memoryStore!.getState().write({
      key: 'api-result',
      value: 'some api data',
      tags: ['api'],
      authorAgentId: 'agent-1',
    });
    ctx.memoryStore!.getState().write({
      key: 'notes',
      value: 'some notes about api usage',
      tags: ['docs'],
      authorAgentId: 'agent-2',
    });

    // Both match query "api", but only one has the "api" tag
    const result = await memoryReadPlugin.handler(
      { query: 'api', tags: 'api' },
      ctx,
    );

    expect(result).toContain('api-result');
    expect(result).not.toContain('[notes]');
  });

  it('returns error when no memory store', async () => {
    const noMemCtx = makeContext({ memoryStore: undefined });
    const result = await memoryReadPlugin.handler(
      { query: 'test' },
      noMemCtx,
    );

    expect(result).toContain('Error');
    expect(result).toContain('Memory store is not available');
  });
});
