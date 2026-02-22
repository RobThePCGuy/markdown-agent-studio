import type { ToolPlugin } from '../tool-plugin';

export const taskQueueWritePlugin: ToolPlugin = {
  name: 'task_queue_write',
  description:
    'Manage the persistent task queue. Add, update, or remove tasks that persist across context cycles. ' +
    'Use this to track work items, set priorities, and maintain continuity between autonomous cycles.',
  parameters: {
    action: {
      type: 'string',
      description: 'Action to perform: "add", "update", or "remove"',
      required: true,
    },
    description: {
      type: 'string',
      description: 'Task description (required for "add")',
    },
    task_id: {
      type: 'string',
      description: 'Task ID (required for "update" and "remove")',
    },
    status: {
      type: 'string',
      description: 'New status for "update": "pending", "in_progress", "done", or "blocked"',
    },
    notes: {
      type: 'string',
      description: 'Notes to attach to a task (for "update")',
    },
    priority: {
      type: 'number',
      description: 'Priority (lower = higher priority, default 0)',
    },
  },
  async handler(args, ctx) {
    if (!ctx.taskQueueStore) {
      return 'Error: Task queue is only available in autonomous mode.';
    }

    const action = args.action as string;
    const store = ctx.taskQueueStore.getState();

    switch (action) {
      case 'add': {
        const desc = args.description as string;
        if (!desc) return 'Error: "description" is required for add action.';
        const priority = typeof args.priority === 'number' ? args.priority : 0;
        const id = store.add(desc, priority);
        return `Task added: ${id}`;
      }

      case 'update': {
        const taskId = args.task_id as string;
        if (!taskId) return 'Error: "task_id" is required for update action.';
        const patch: Record<string, unknown> = {};
        if (args.status) patch.status = args.status;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.description) patch.description = args.description;
        if (typeof args.priority === 'number') patch.priority = args.priority;
        const ok = store.update(taskId, patch as Parameters<typeof store.update>[1]);
        return ok ? `Task ${taskId} updated.` : `Error: Task "${taskId}" not found.`;
      }

      case 'remove': {
        const taskId = args.task_id as string;
        if (!taskId) return 'Error: "task_id" is required for remove action.';
        const ok = store.remove(taskId);
        return ok ? `Task ${taskId} removed.` : `Error: Task "${taskId}" not found.`;
      }

      default:
        return `Error: Unknown action "${action}". Use "add", "update", or "remove".`;
    }
  },
};
