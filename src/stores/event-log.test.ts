import { describe, it, expect, beforeEach } from 'vitest';
import { createEventLog } from './event-log';

describe('Event Log', () => {
  let log: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    log = createEventLog();
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
});
