import type { ToolPlugin } from '../tool-plugin';

export const taskQueueReadPlugin: ToolPlugin = {
  name: 'task_queue_read',
  description:
    'Read the persistent task queue. Tasks survive across context cycles in autonomous mode. ' +
    'Use this to check what work remains, what is in progress, and what has been completed.',
  parameters: {
    status_filter: {
      type: 'string',
      description: 'Optional filter: "pending", "in_progress", "done", "blocked", or "all" (default: "all")',
    },
  },
  async handler(args, ctx) {
    if (!ctx.taskQueueStore) {
      return 'Error: Task queue is only available in autonomous mode.';
    }

    const filter = (args.status_filter as string) || 'all';
    const allTasks = ctx.taskQueueStore.getState().getAll();

    const tasks = filter === 'all'
      ? allTasks
      : allTasks.filter((t) => t.status === filter);

    if (tasks.length === 0) {
      return filter === 'all'
        ? 'Task queue is empty. Use task_queue_write to add tasks.'
        : `No tasks with status "${filter}".`;
    }

    const lines = tasks.map((t) => {
      const notes = t.notes ? ` | notes: ${t.notes}` : '';
      return `[${t.id}] (${t.status}, priority:${t.priority}) ${t.description}${notes}`;
    });

    return `Task Queue (${tasks.length} tasks):\n${lines.join('\n')}`;
  },
};
