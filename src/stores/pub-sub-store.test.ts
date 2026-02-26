import { describe, it, expect, beforeEach } from 'vitest';
import { createPubSubStore, type PubSubState } from './pub-sub-store';

describe('PubSubStore', () => {
  let store: { getState: () => PubSubState };

  beforeEach(() => {
    store = createPubSubStore();
  });

  it('starts with no messages', () => {
    const messages = store.getState().getMessages('any-channel');
    expect(messages).toEqual([]);
  });

  it('publish adds message to channel', () => {
    store.getState().publish('findings', { text: 'found something' }, 'agent-a');
    const messages = store.getState().getMessages('findings');
    expect(messages).toHaveLength(1);
    expect((messages[0].data as Record<string, unknown>).text).toBe('found something');
    expect(messages[0].authorAgentId).toBe('agent-a');
  });

  it('subscribe returns messages for agent since subscription', () => {
    store.getState().subscribe('findings', 'agent-b');
    store.getState().publish('findings', { text: 'new data' }, 'agent-a');
    const pending = store.getState().getPendingMessages('findings', 'agent-b');
    expect(pending).toHaveLength(1);
  });

  it('ack marks messages as read', () => {
    store.getState().subscribe('findings', 'agent-b');
    store.getState().publish('findings', { text: 'data' }, 'agent-a');
    store.getState().ack('findings', 'agent-b');
    const pending = store.getState().getPendingMessages('findings', 'agent-b');
    expect(pending).toHaveLength(0);
  });

  it('getChannels lists active channels', () => {
    store.getState().publish('ch1', {}, 'a');
    store.getState().publish('ch2', {}, 'a');
    expect(store.getState().getChannels()).toEqual(expect.arrayContaining(['ch1', 'ch2']));
  });

  it('clear resets all state', () => {
    store.getState().publish('ch', {}, 'a');
    store.getState().subscribe('ch', 'b');
    store.getState().clear();
    expect(store.getState().getChannels()).toEqual([]);
  });
});
