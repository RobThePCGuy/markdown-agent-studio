import { describe, it, expect } from 'vitest';
import { createTaskQueueStore, type TaskItem } from './task-queue-store';

function makeTask(id: string, description: string, status: TaskItem['status'] = 'pending'): TaskItem {
  const now = Date.now();
  return {
    id,
    description,
    status,
    notes: '',
    priority: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('task-queue-store', () => {
  it('adds tasks with sequential ids', () => {
    const store = createTaskQueueStore();
    const id1 = store.getState().add('first task');
    const id2 = store.getState().add('second task');

    expect(id1).toMatch(/^tq-\d+$/);
    expect(id2).toMatch(/^tq-\d+$/);
    expect(id1).not.toBe(id2);
    expect(store.getState().getAll()).toHaveLength(2);
  });

  it('hydrates tasks via replaceAll and continues id sequence', () => {
    const store = createTaskQueueStore();
    store.getState().replaceAll([
      makeTask('tq-10', 'hydrate 1'),
      makeTask('tq-42', 'hydrate 2', 'in_progress'),
    ]);

    const addedId = store.getState().add('new task');
    expect(addedId).toBe('tq-43');
    expect(store.getState().getAll()).toHaveLength(3);
  });

  it('replaceAll deduplicates by id using the latest entry', () => {
    const store = createTaskQueueStore();
    store.getState().replaceAll([
      makeTask('tq-7', 'old description'),
      makeTask('tq-7', 'new description', 'done'),
    ]);

    const all = store.getState().getAll();
    expect(all).toHaveLength(1);
    expect(all[0].description).toBe('new description');
    expect(all[0].status).toBe('done');
  });
});

