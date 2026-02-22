import { createStore } from 'zustand/vanilla';
import type { WorkingMemoryEntry } from '../types/memory';

let wmCounter = 0;

interface WriteInput {
  key: string;
  value: string;
  tags: string[];
  authorAgentId: string;
}

export interface MemoryStoreState {
  entries: WorkingMemoryEntry[];
  runId: string | null;
  initRun(runId: string): void;
  write(input: WriteInput): void;
  read(query: string, tags?: string[]): WorkingMemoryEntry[];
  endRun(): WorkingMemoryEntry[];
}

export function createMemoryStore() {
  wmCounter = 0;
  return createStore<MemoryStoreState>((set, get) => ({
    entries: [],
    runId: null,

    initRun(runId: string): void {
      wmCounter = 0;
      set({ entries: [], runId });
    },

    write(input: WriteInput): void {
      const { runId } = get();
      if (runId === null) return;
      const normalizedTags = [...new Set(
        input.tags
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      )];

      const entry: WorkingMemoryEntry = {
        id: `wm-${++wmCounter}`,
        key: input.key,
        value: input.value,
        tags: normalizedTags,
        authorAgentId: input.authorAgentId,
        timestamp: Date.now(),
        runId,
      };

      set((state) => ({
        entries: [...state.entries, entry],
      }));
    },

    read(query: string, tags?: string[]): WorkingMemoryEntry[] {
      const q = query.toLowerCase();
      let results = get().entries.filter(
        (e) =>
          e.key.toLowerCase().includes(q) ||
          e.value.toLowerCase().includes(q),
      );

      if (tags && tags.length > 0) {
        const normalizedTags = tags.map((t) => t.toLowerCase());
        results = results.filter((e) => {
          const entryTags = new Set(e.tags.map((tag) => tag.toLowerCase()));
          return normalizedTags.some((t) => entryTags.has(t));
        });
      }

      // Newest first
      return [...results].reverse();
    },

    endRun(): WorkingMemoryEntry[] {
      const snapshot = [...get().entries];
      set({ entries: [], runId: null });
      return snapshot;
    },
  }));
}
