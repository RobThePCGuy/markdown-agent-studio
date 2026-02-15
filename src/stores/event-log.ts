import { createStore } from 'zustand/vanilla';
import type { EventLogEntry, EventType } from '../types';

let entryCounter = 0;

interface AppendInput {
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}

export interface EventLogState {
  entries: EventLogEntry[];
  append(input: AppendInput): void;
  filterByAgent(agentId: string): EventLogEntry[];
  filterByType(type: EventType): EventLogEntry[];
  exportJSON(): string;
  clear(): void;
}

export function createEventLog() {
  entryCounter = 0;
  return createStore<EventLogState>((set, get) => ({
    entries: [],

    append(input: AppendInput): void {
      const entry: EventLogEntry = {
        id: `evt-${++entryCounter}`,
        timestamp: Date.now(),
        ...input,
      };
      set((state) => ({ entries: [...state.entries, entry] }));
    },

    filterByAgent(agentId: string): EventLogEntry[] {
      return get().entries.filter((e) => e.agentId === agentId);
    },

    filterByType(type: EventType): EventLogEntry[] {
      return get().entries.filter((e) => e.type === type);
    },

    exportJSON(): string {
      return JSON.stringify(get().entries, null, 2);
    },

    clear(): void {
      set({ entries: [] });
    },
  }));
}
