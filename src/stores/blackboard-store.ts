import { createStore } from 'zustand/vanilla';

export interface BlackboardState {
  entries: Record<string, unknown>;
  set(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  keys(): string[];
  clear(): void;
}

export function createBlackboardStore() {
  return createStore<BlackboardState>((set, get) => ({
    entries: {},

    set(key, value) {
      set((s) => ({ entries: { ...s.entries, [key]: value } }));
    },

    get(key) {
      return get().entries[key];
    },

    keys() {
      return Object.keys(get().entries);
    },

    clear() {
      set({ entries: {} });
    },
  }));
}
