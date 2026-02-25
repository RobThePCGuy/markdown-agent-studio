import { createStore } from 'zustand/vanilla';

interface PubSubMessage {
  id: string;
  channel: string;
  data: unknown;
  authorAgentId: string;
  timestamp: number;
}

interface Subscription {
  agentId: string;
  channel: string;
  subscribedAt: number;
  lastAck: number;
}

export interface PubSubState {
  messages: PubSubMessage[];
  subscriptions: Subscription[];

  publish(channel: string, data: unknown, authorAgentId: string): void;
  subscribe(channel: string, agentId: string): void;
  unsubscribe(channel: string, agentId: string): void;
  ack(channel: string, agentId: string): void;
  getMessages(channel: string): PubSubMessage[];
  getPendingMessages(channel: string, agentId: string): PubSubMessage[];
  getChannels(): string[];
  clear(): void;
}

let msgCounter = 0;

export function createPubSubStore() {
  return createStore<PubSubState>((set, get) => ({
    messages: [],
    subscriptions: [],

    publish(channel, data, authorAgentId) {
      const msg: PubSubMessage = {
        id: `ps-${++msgCounter}`,
        channel,
        data,
        authorAgentId,
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, msg] }));
    },

    subscribe(channel, agentId) {
      const existing = get().subscriptions.find(
        (s) => s.channel === channel && s.agentId === agentId
      );
      if (existing) return;
      const now = Date.now();
      set((s) => ({
        subscriptions: [
          ...s.subscriptions,
          { agentId, channel, subscribedAt: now, lastAck: now - 1 },
        ],
      }));
    },

    unsubscribe(channel, agentId) {
      set((s) => ({
        subscriptions: s.subscriptions.filter(
          (sub) => !(sub.channel === channel && sub.agentId === agentId)
        ),
      }));
    },

    ack(channel, agentId) {
      const now = Date.now();
      set((s) => ({
        subscriptions: s.subscriptions.map((sub) =>
          sub.channel === channel && sub.agentId === agentId
            ? { ...sub, lastAck: now }
            : sub
        ),
      }));
    },

    getMessages(channel) {
      return get().messages.filter((m) => m.channel === channel);
    },

    getPendingMessages(channel, agentId) {
      const sub = get().subscriptions.find(
        (s) => s.channel === channel && s.agentId === agentId
      );
      if (!sub) return [];
      return get().messages.filter(
        (m) => m.channel === channel && m.timestamp > sub.lastAck
      );
    },

    getChannels() {
      return [...new Set(get().messages.map((m) => m.channel))];
    },

    clear() {
      msgCounter = 0;
      set({ messages: [], subscriptions: [] });
    },
  }));
}
