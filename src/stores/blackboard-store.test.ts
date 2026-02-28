import { describe, it, expect, beforeEach } from 'vitest';
import { createBlackboardStore, type BlackboardState } from './blackboard-store';

describe('BlackboardStore', () => {
  let store: { getState: () => BlackboardState };

  beforeEach(() => {
    store = createBlackboardStore();
  });

  it('starts empty', () => {
    expect(store.getState().keys()).toEqual([]);
  });

  it('set and get a value', () => {
    store.getState().set('status', 'running');
    expect(store.getState().get('status')).toBe('running');
  });

  it('keys lists all entries', () => {
    store.getState().set('a', 1);
    store.getState().set('b', 2);
    expect(store.getState().keys()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('clear resets all state', () => {
    store.getState().set('x', 'y');
    store.getState().clear();
    expect(store.getState().keys()).toEqual([]);
    expect(store.getState().get('x')).toBeUndefined();
  });

  it('overwrites existing key', () => {
    store.getState().set('k', 'v1');
    store.getState().set('k', 'v2');
    expect(store.getState().get('k')).toBe('v2');
  });
});
