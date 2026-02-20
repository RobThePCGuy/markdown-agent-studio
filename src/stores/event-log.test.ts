import { describe, it, expect, beforeEach } from 'vitest';
import { createEventLog } from './event-log';
import { createVFSStore } from './vfs-store';

function createMockVFS() {
  return {
    getState: () => ({
      files: new Map([['test.md', { content: 'hello' }]]),
    }),
  };
}

function appendN(log: ReturnType<typeof createEventLog>, n: number) {
  for (let i = 0; i < n; i++) {
    log.getState().append({
      type: 'activation',
      agentId: 'agent-a',
      activationId: `act-${i}`,
      data: { index: i },
    });
  }
}

describe('Event Log', () => {
  let log: ReturnType<typeof createEventLog>;
  let vfs: ReturnType<typeof createVFSStore>;

  beforeEach(() => {
    vfs = createVFSStore();
    log = createEventLog(vfs);
  });

  it('appends entries', () => {
    log.getState().append({
      type: 'activation',
      agentId: 'agents/writer.md',
      activationId: 'act-1',
      data: { input: 'hello' },
    });
    expect(log.getState().entries).toHaveLength(1);
    expect(log.getState().entries[0].type).toBe('activation');
  });

  it('auto-generates id and timestamp', () => {
    log.getState().append({
      type: 'warning',
      agentId: 'agents/a.md',
      activationId: 'act-1',
      data: { message: 'test' },
    });
    const entry = log.getState().entries[0];
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('filters by agent', () => {
    log.getState().append({ type: 'activation', agentId: 'a', activationId: 'x', data: {} });
    log.getState().append({ type: 'activation', agentId: 'b', activationId: 'y', data: {} });
    expect(log.getState().filterByAgent('a')).toHaveLength(1);
  });

  it('filters by type', () => {
    log.getState().append({ type: 'error', agentId: 'a', activationId: 'x', data: {} });
    log.getState().append({ type: 'warning', agentId: 'a', activationId: 'x', data: {} });
    expect(log.getState().filterByType('error')).toHaveLength(1);
  });

  it('exports as JSON', () => {
    log.getState().append({ type: 'activation', agentId: 'a', activationId: 'x', data: {} });
    const json = log.getState().exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
  });

  it('captures replay checkpoints with file snapshots', () => {
    vfs.getState().write('artifacts/a.md', 'A', {});
    log.getState().append({ type: 'activation', agentId: 'a', activationId: 'x', data: {} });

    vfs.getState().write('artifacts/b.md', 'B', {});
    log.getState().append({ type: 'file_change', agentId: 'a', activationId: 'x', data: {} });

    const cps = log.getState().checkpoints;
    expect(cps).toHaveLength(2);
    expect(cps[0].files['artifacts/a.md']).toBe('A');
    expect(cps[1].files['artifacts/b.md']).toBe('B');
  });
});

describe('Checkpoint Trimming', () => {
  it('does not trim when under 200 checkpoints', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    appendN(log, 150);

    expect(log.getState().checkpoints).toHaveLength(150);
    expect(log.getState().entries).toHaveLength(150);
  });

  it('trims to 200 when exceeded, preserving first 10 and last 100', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    appendN(log, 250);

    const checkpoints = log.getState().checkpoints;
    const entries = log.getState().entries;

    // All 250 entries are preserved (trimming only affects checkpoints)
    expect(entries).toHaveLength(250);

    // Checkpoints are capped at 200
    expect(checkpoints.length).toBeLessThanOrEqual(200);

    // First 10 checkpoints are preserved (these correspond to the first 10 events)
    const first10EventIds = entries.slice(0, 10).map((e) => e.id);
    for (const eventId of first10EventIds) {
      expect(checkpoints.find((c) => c.eventId === eventId)).toBeDefined();
    }

    // Last 100 checkpoints are preserved (these correspond to the last 100 events)
    const last100EventIds = entries.slice(-100).map((e) => e.id);
    for (const eventId of last100EventIds) {
      expect(checkpoints.find((c) => c.eventId === eventId)).toBeDefined();
    }
  });

  it('checkpointCount returns correct count', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    expect(log.getState().checkpointCount()).toBe(0);

    appendN(log, 50);
    expect(log.getState().checkpointCount()).toBe(50);

    appendN(log, 200);
    expect(log.getState().checkpointCount()).toBeLessThanOrEqual(200);
  });
});

describe('getCheckpoint fallback', () => {
  it('returns exact match when available', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    appendN(log, 5);

    const entry = log.getState().entries[2];
    const checkpoint = log.getState().getCheckpoint(entry.id);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.eventId).toBe(entry.id);
  });

  it('falls back to nearest earlier checkpoint when exact is trimmed', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    // Append enough events to trigger trimming (250 > 200)
    appendN(log, 250);

    const entries = log.getState().entries;
    const checkpoints = log.getState().checkpoints;

    // Find an entry in the middle range whose checkpoint was trimmed
    // Events 11-150 are in the middle zone that gets sampled
    let trimmedEntry: (typeof entries)[0] | undefined;
    for (let i = 10; i < 150; i++) {
      const entry = entries[i];
      const hasExact = checkpoints.some((c) => c.eventId === entry.id);
      if (!hasExact) {
        trimmedEntry = entry;
        break;
      }
    }

    // There should be at least one trimmed entry in the middle zone
    expect(trimmedEntry).toBeDefined();

    // getCheckpoint should still return a checkpoint (fallback)
    const fallback = log.getState().getCheckpoint(trimmedEntry!.id);
    expect(fallback).toBeDefined();

    // The fallback checkpoint should have a timestamp <= the event's timestamp
    expect(fallback!.timestamp).toBeLessThanOrEqual(trimmedEntry!.timestamp);
  });

  it('returns undefined when eventId does not exist', () => {
    const mockVFS = createMockVFS();
    const log = createEventLog(mockVFS as any);

    appendN(log, 5);

    const result = log.getState().getCheckpoint('nonexistent-id');
    expect(result).toBeUndefined();
  });
});
