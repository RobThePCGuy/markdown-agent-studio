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
  checkpointCount(): number;
  exportJSON(): string;
  clear(): void;
}

const MAX_CHECKPOINTS = 200;

function trimCheckpoints(checkpoints: ReplayCheckpoint[]): ReplayCheckpoint[] {
  if (checkpoints.length <= MAX_CHECKPOINTS) return checkpoints;

  const first10 = checkpoints.slice(0, 10);
  const last100 = checkpoints.slice(-100);
  const middle = checkpoints.slice(10, -100);

  const remaining = MAX_CHECKPOINTS - first10.length - last100.length;
  const step = Math.max(1, Math.floor(middle.length / remaining));
  const sampled: ReplayCheckpoint[] = [];
  for (let i = 0; i < middle.length && sampled.length < remaining; i += step) {
    sampled.push(middle[i]);
  }

  return [...first10, ...sampled, ...last100];
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
          ? trimCheckpoints([...state.checkpoints, checkpoint])
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
      const exact = get().checkpoints.find((c) => c.eventId === eventId);
      if (exact) return exact;

      // Fall back to most recent checkpoint before this event
      const entries = get().entries;
      const eventIndex = entries.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) return undefined;

      const eventTimestamp = entries[eventIndex].timestamp;
      const candidates = get().checkpoints.filter((c) => c.timestamp <= eventTimestamp);
      return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
    },

    checkpointCount(): number {
      return get().checkpoints.length;
    },

    exportJSON(): string {
      return JSON.stringify(get().entries, null, 2);
    },

    clear(): void {
      set({ entries: [], checkpoints: [] });
    },
  }));
}
