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

export interface PageResult {
  entries: EventLogEntry[];
  total: number;
  hasMore: boolean;
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
  getPage(offset: number, limit: number): PageResult;
  getPageByAgent(agentId: string, offset: number, limit: number): PageResult;
  archiveAndClear(keepLast: number): EventLogEntry[];
}

const MAX_CHECKPOINTS = 200;
const MAX_ENTRIES = 10_000;

/** Event types that capture VFS snapshots for replay checkpoints. */
const CHECKPOINT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'activation',
  'complete',
  'abort',
  'file_change',
  'workflow_start',
  'workflow_step',
  'workflow_complete',
]);

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
      if (vfs && CHECKPOINT_EVENT_TYPES.has(entry.type)) {
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

      set((state) => {
        const next = [...state.entries, entry];
        // Cap entries to prevent OOM in long autonomous missions
        const trimmedEntries = next.length > MAX_ENTRIES
          ? next.slice(next.length - MAX_ENTRIES)
          : next;
        return {
        entries: trimmedEntries,
        checkpoints: checkpoint
          ? trimCheckpoints([...state.checkpoints, checkpoint])
          : state.checkpoints,
        };
      });
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

    getPage(offset: number, limit: number): PageResult {
      const all = get().entries;
      const entries = all.slice(offset, offset + limit);
      return {
        entries,
        total: all.length,
        hasMore: offset + limit < all.length,
      };
    },

    // O(n) scan is fine: MAX_ENTRIES caps at 10K, <1ms on modern JS
    getPageByAgent(agentId: string, offset: number, limit: number): PageResult {
      const filtered = get().entries.filter((e) => e.agentId === agentId);
      const entries = filtered.slice(offset, offset + limit);
      return {
        entries,
        total: filtered.length,
        hasMore: offset + limit < filtered.length,
      };
    },

    archiveAndClear(keepLast: number): EventLogEntry[] {
      const all = get().entries;
      if (all.length <= keepLast) return [];
      const cutoff = all.length - keepLast;
      const archived = all.slice(0, cutoff);
      set((state) => ({
        entries: state.entries.slice(cutoff),
      }));
      return archived;
    },
  }));
}
