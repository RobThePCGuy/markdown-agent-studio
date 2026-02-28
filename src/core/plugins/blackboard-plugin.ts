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

    if (!ctx.blackboardStore) return 'Error: Blackboard not available.';

    ctx.blackboardStore.getState().set(key, value);

    ctx.eventLog.getState().append({
      type: 'blackboard_write',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { key, value: String(value).slice(0, 200) },
    });

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
    if (!ctx.blackboardStore) return 'Error: Blackboard not available.';

    const state = ctx.blackboardStore.getState();
    const key = args.key ? String(args.key).trim() : '';

    ctx.eventLog.getState().append({
      type: 'blackboard_read',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { key: key || '*' },
    });

    if (!key) {
      const keys = state.keys();
      if (keys.length === 0) return 'Blackboard is empty.';
      return 'Blackboard keys:\n' + keys.map((k) => `- ${k}: ${String(state.get(k)).slice(0, 100)}`).join('\n');
    }

    const value = state.get(key);
    if (value === undefined) return `Key "${key}" not found on blackboard.`;
    return `${key}: ${String(value)}`;
  },
};
