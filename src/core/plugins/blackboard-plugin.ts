import type { ToolPlugin } from '../tool-plugin';

export const blackboardWritePlugin: ToolPlugin = {
  name: 'blackboard_write',
  description: 'Write a key-value entry to the shared blackboard visible to all agents in this run.',
  parameters: {
    key: { type: 'string', description: 'Key name', required: true },
    value: { type: 'string', description: 'Value to store', required: true },
  },
  async handler(args, ctx) {
    const key = String(args.key || '').trim();
    const value = String(args.value || '');
    if (!key) return 'Error: key is required.';

    if (!ctx.blackboard) return 'Error: Blackboard not available.';

    ctx.blackboard.set(key, value);
    return `Wrote "${key}" to blackboard.`;
  },
};

export const blackboardReadPlugin: ToolPlugin = {
  name: 'blackboard_read',
  description: 'Read from the shared blackboard. Omit key to list all entries.',
  parameters: {
    key: { type: 'string', description: 'Key to read (omit to list all keys)' },
  },
  async handler(args, ctx) {
    if (!ctx.blackboard) return 'Error: Blackboard not available.';

    const key = args.key ? String(args.key).trim() : '';

    if (!key) {
      const keys = Array.from(ctx.blackboard.keys());
      if (keys.length === 0) return 'Blackboard is empty.';
      return 'Blackboard keys:\n' + keys.map((k) => `- ${k}: ${String(ctx.blackboard!.get(k)).slice(0, 100)}`).join('\n');
    }

    const value = ctx.blackboard.get(key);
    if (value === undefined) return `Key "${key}" not found on blackboard.`;
    return `${key}: ${String(value)}`;
  },
};
