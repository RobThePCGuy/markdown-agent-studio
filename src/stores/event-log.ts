import { createStore } from 'zustand/vanilla';
import type { EventLogEntry, EventType, ReplayCheckpoint } from '../types';
import type { VFSState } from './vfs-store';

let entryCounter = 0;
let checkpointCounter = 0;

type Store<T> = { getState(): T };

interface AppendInput {
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}

export interface EventLogState {
  entries: EventLogEntry[];
  checkpoints: ReplayCheckpoint[];
  append(input: AppendInput): void;
  filterByAgent(agentId: string): EventLogEntry[];
  filterByType(type: EventType): EventLogEntry[];
  getCheckpoint(eventId: string): ReplayCheckpoint | undefined;
  exportJSON(): string;
  clear(): void;
}

function snapshotFiles(vfs: Store<VFSState>): Record<string, string> {
  return Object.fromEntries(
    [...vfs.getState().files.entries()].map(([path, file]) => [path, file.content]),
  );
}

export function createEventLog(vfs?: Store<VFSState>) {
  entryCounter = 0;
  checkpointCounter = 0;
  return createStore<EventLogState>((set, get) => ({
    entries: [],
    checkpoints: [],

    append(input: AppendInput): void {
      const entry: EventLogEntry = {
        id: `evt-${++entryCounter}`,
        timestamp: Date.now(),
        ...input,
      };

      let checkpoint: ReplayCheckpoint | undefined;
      if (vfs) {
        checkpoint = {
          id: `cp-${++checkpointCounter}`,
          eventId: entry.id,
          timestamp: entry.timestamp,
          eventType: entry.type,
          agentId: entry.agentId,
          activationId: entry.activationId,
          files: snapshotFiles(vfs),
        };
      }

      set((state) => ({
        entries: [...state.entries, entry],
        checkpoints: checkpoint
          ? [...state.checkpoints, checkpoint]
          : state.checkpoints,
      }));
    },

    filterByAgent(agentId: string): EventLogEntry[] {
      return get().entries.filter((e) => e.agentId === agentId);
    },

    filterByType(type: EventType): EventLogEntry[] {
      return get().entries.filter((e) => e.type === type);
    },

    getCheckpoint(eventId: string): ReplayCheckpoint | undefined {
      return get().checkpoints.find((c) => c.eventId === eventId);
    },

    exportJSON(): string {
      return JSON.stringify(get().entries, null, 2);
    },

    clear(): void {
      set({ entries: [], checkpoints: [] });
    },
  }));
}
