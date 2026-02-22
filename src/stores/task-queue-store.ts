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
  clear: () => void;
}

let idCounter = 0;

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

    clear(): void {
      set({ tasks: new Map() });
    },
  }));
}
