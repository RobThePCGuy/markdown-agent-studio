import { createStore } from 'zustand/vanilla';

export interface TaskItem {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  notes: string;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskQueueState {
  tasks: Map<string, TaskItem>;
  nextId: number;
  add: (description: string, priority?: number) => string;
  update: (id: string, patch: Partial<Pick<TaskItem, 'description' | 'status' | 'notes' | 'priority'>>) => boolean;
  remove: (id: string) => boolean;
  getAll: () => TaskItem[];
  getPending: () => TaskItem[];
  replaceAll: (items: TaskItem[]) => void;
  clear: () => void;
}

let idCounter = 0;

function extractTaskIdNumber(id: string): number {
  const match = /^tq-(\d+)$/.exec(id);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextCounterFromTasks(items: TaskItem[]): number {
  let maxId = 0;
  for (const item of items) {
    maxId = Math.max(maxId, extractTaskIdNumber(item.id));
  }
  return maxId;
}

export function createTaskQueueStore() {
  return createStore<TaskQueueState>((set, get) => ({
    tasks: new Map(),
    nextId: 1,

    add(description: string, priority = 0): string {
      const id = `tq-${++idCounter}`;
      const now = Date.now();
      const item: TaskItem = {
        id,
        description,
        status: 'pending',
        notes: '',
        priority,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => {
        const next = new Map(s.tasks);
        next.set(id, item);
        return { tasks: next };
      });
      return id;
    },

    update(id: string, patch): boolean {
      const existing = get().tasks.get(id);
      if (!existing) return false;
      set((s) => {
        const next = new Map(s.tasks);
        next.set(id, { ...existing, ...patch, updatedAt: Date.now() });
        return { tasks: next };
      });
      return true;
    },

    remove(id: string): boolean {
      if (!get().tasks.has(id)) return false;
      set((s) => {
        const next = new Map(s.tasks);
        next.delete(id);
        return { tasks: next };
      });
      return true;
    },

    getAll(): TaskItem[] {
      return [...get().tasks.values()].sort((a, b) => a.priority - b.priority);
    },

    getPending(): TaskItem[] {
      return [...get().tasks.values()]
        .filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .sort((a, b) => a.priority - b.priority);
    },

    replaceAll(items: TaskItem[]): void {
      const deduped = new Map<string, TaskItem>();
      for (const item of items) {
        deduped.set(item.id, { ...item });
      }
      idCounter = Math.max(idCounter, nextCounterFromTasks([...deduped.values()]));
      set({ tasks: deduped });
    },

    clear(): void {
      set({ tasks: new Map() });
    },
  }));
}
