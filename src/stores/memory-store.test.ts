import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryStore } from './memory-store';

describe('Memory Store', () => {
  let store: ReturnType<typeof createMemoryStore>;

  beforeEach(() => {
    store = createMemoryStore();
  });

  it('starts empty', () => {
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().runId).toBeNull();
  });

  it('initRun sets runId and clears entries', () => {
    store.getState().initRun('run-1');
    expect(store.getState().runId).toBe('run-1');
    expect(store.getState().entries).toHaveLength(0);
  });

  it('initRun clears previous entries', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'k', value: 'v', tags: [], authorAgentId: 'a' });
    expect(store.getState().entries).toHaveLength(1);

    store.getState().initRun('run-2');
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().runId).toBe('run-2');
  });

  it('write creates an entry with auto-generated id and timestamp', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'topic', value: 'hello world', tags: ['greet'], authorAgentId: 'agent-1' });

    const entries = store.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('wm-1');
    expect(entries[0].key).toBe('topic');
    expect(entries[0].value).toBe('hello world');
    expect(entries[0].tags).toEqual(['greet']);
    expect(entries[0].authorAgentId).toBe('agent-1');
    expect(entries[0].runId).toBe('run-1');
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it('write increments id counter', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: 'v1', tags: [], authorAgentId: 'x' });
    store.getState().write({ key: 'b', value: 'v2', tags: [], authorAgentId: 'x' });

    const entries = store.getState().entries;
    expect(entries[0].id).toBe('wm-1');
    expect(entries[1].id).toBe('wm-2');
  });

  it('write silently returns when no run is active', () => {
    store.getState().write({ key: 'k', value: 'v', tags: [], authorAgentId: 'a' });
    expect(store.getState().entries).toHaveLength(0);
  });

  it('supports versioning - duplicate keys are both stored', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'config', value: 'v1', tags: ['cfg'], authorAgentId: 'a' });
    store.getState().write({ key: 'config', value: 'v2', tags: ['cfg'], authorAgentId: 'a' });

    const entries = store.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('config');
    expect(entries[0].value).toBe('v1');
    expect(entries[1].key).toBe('config');
    expect(entries[1].value).toBe('v2');
  });

  it('read matches by key substring (case-insensitive)', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'UserPreference', value: 'dark mode', tags: [], authorAgentId: 'a' });
    store.getState().write({ key: 'system', value: 'linux', tags: [], authorAgentId: 'a' });

    const results = store.getState().read('userpref');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('UserPreference');
  });

  it('read matches by value substring (case-insensitive)', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'os', value: 'Linux Mint', tags: [], authorAgentId: 'a' });
    store.getState().write({ key: 'editor', value: 'VSCode', tags: [], authorAgentId: 'a' });

    const results = store.getState().read('linux');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('Linux Mint');
  });

  it('read filters by tags when provided', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: 'val', tags: ['alpha', 'beta'], authorAgentId: 'x' });
    store.getState().write({ key: 'b', value: 'val', tags: ['gamma'], authorAgentId: 'x' });

    // Both match "val" by value, but only first has 'alpha' tag
    const results = store.getState().read('val', ['alpha']);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('a');
  });

  it('read with tags matches any of the provided tags', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: 'x', tags: ['alpha'], authorAgentId: 'x' });
    store.getState().write({ key: 'b', value: 'x', tags: ['beta'], authorAgentId: 'x' });
    store.getState().write({ key: 'c', value: 'x', tags: ['gamma'], authorAgentId: 'x' });

    const results = store.getState().read('x', ['alpha', 'beta']);
    expect(results).toHaveLength(2);
  });

  it('read returns results sorted by recency (newest first)', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'item', value: 'first', tags: [], authorAgentId: 'a' });
    store.getState().write({ key: 'item', value: 'second', tags: [], authorAgentId: 'a' });
    store.getState().write({ key: 'item', value: 'third', tags: [], authorAgentId: 'a' });

    const results = store.getState().read('item');
    expect(results).toHaveLength(3);
    expect(results[0].value).toBe('third');
    expect(results[1].value).toBe('second');
    expect(results[2].value).toBe('first');
  });

  it('endRun returns snapshot of all entries', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: '1', tags: [], authorAgentId: 'x' });
    store.getState().write({ key: 'b', value: '2', tags: [], authorAgentId: 'x' });

    const snapshot = store.getState().endRun();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].key).toBe('a');
    expect(snapshot[1].key).toBe('b');
  });

  it('endRun clears entries and runId', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: '1', tags: [], authorAgentId: 'x' });

    store.getState().endRun();
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().runId).toBeNull();
  });

  it('initRun resets the id counter', () => {
    store.getState().initRun('run-1');
    store.getState().write({ key: 'a', value: 'v', tags: [], authorAgentId: 'x' });
    expect(store.getState().entries[0].id).toBe('wm-1');

    store.getState().initRun('run-2');
    store.getState().write({ key: 'b', value: 'v', tags: [], authorAgentId: 'x' });
    expect(store.getState().entries[0].id).toBe('wm-1');
  });
});
