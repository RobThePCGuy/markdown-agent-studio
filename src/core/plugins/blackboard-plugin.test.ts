import { describe, it, expect } from 'vitest';
import { blackboardReadPlugin, blackboardWritePlugin } from './blackboard-plugin';
import { createBlackboardStore } from '../../stores/blackboard-store';
import { createVFSStore } from '../../stores/vfs-store';
import { createEventLog } from '../../stores/event-log';
import type { ToolContext } from '../tool-plugin';

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  const vfs = createVFSStore();
  const eventLog = createEventLog(vfs);
  return {
    vfs,
    registry: { getState: () => ({}) } as any,
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

describe('blackboardWritePlugin', () => {
  it('has correct name', () => {
    expect(blackboardWritePlugin.name).toBe('blackboard_write');
  });

  it('requires key and value', () => {
    expect(blackboardWritePlugin.parameters.key.required).toBe(true);
    expect(blackboardWritePlugin.parameters.value.required).toBe(true);
  });

  it('returns error when blackboardStore is not available', async () => {
    const ctx = makeContext();
    const result = await blackboardWritePlugin.handler({ key: 'k', value: 'v' }, ctx);
    expect(result).toContain('Error');
    expect(result).toContain('Blackboard not available');
  });

  it('writes to the store and emits event', async () => {
    const blackboardStore = createBlackboardStore();
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardWritePlugin.handler({ key: 'status', value: 'done' }, ctx);
    expect(result).toContain('Wrote "status"');
    expect(blackboardStore.getState().get('status')).toBe('done');

    const events = ctx.eventLog.getState().entries;
    const bbEvent = events.find((e) => e.type === 'blackboard_write');
    expect(bbEvent).toBeDefined();
    expect(bbEvent!.data.key).toBe('status');
  });
});

describe('blackboardReadPlugin', () => {
  it('has correct name', () => {
    expect(blackboardReadPlugin.name).toBe('blackboard_read');
  });

  it('returns error when blackboardStore is not available', async () => {
    const ctx = makeContext();
    const result = await blackboardReadPlugin.handler({}, ctx);
    expect(result).toContain('Error');
    expect(result).toContain('Blackboard not available');
  });

  it('lists all keys when no key given', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('a', '1');
    blackboardStore.getState().set('b', '2');
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardReadPlugin.handler({}, ctx);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  it('reads a specific key', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('color', 'blue');
    const ctx = makeContext({ blackboardStore });
    const result = await blackboardReadPlugin.handler({ key: 'color' }, ctx);
    expect(result).toContain('blue');
  });

  it('emits event on read', async () => {
    const blackboardStore = createBlackboardStore();
    blackboardStore.getState().set('x', 'y');
    const ctx = makeContext({ blackboardStore });
    await blackboardReadPlugin.handler({ key: 'x' }, ctx);

    const events = ctx.eventLog.getState().entries;
    const bbEvent = events.find((e) => e.type === 'blackboard_read');
    expect(bbEvent).toBeDefined();
  });
});
