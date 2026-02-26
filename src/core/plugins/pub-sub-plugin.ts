import type { ToolPlugin } from '../tool-plugin';

export const publishPlugin: ToolPlugin = {
  name: 'publish',
  description: 'Publish a message to a named channel. Other agents subscribed to this channel will receive it.',
  parameters: {
    channel: { type: 'string', description: 'Channel name to publish to', required: true },
    message: { type: 'string', description: 'Message content to publish', required: true },
  },
  async handler(args, ctx) {
    const channel = String(args.channel || '').trim();
    const message = String(args.message || '').trim();
    if (!channel) return 'Error: channel is required.';
    if (!message) return 'Error: message is required.';

    if (!ctx.pubSubStore) return 'Error: Pub/sub system not available.';

    ctx.pubSubStore.getState().publish(channel, message, ctx.currentAgentId);
    return `Published to channel "${channel}".`;
  },
};

export const subscribePlugin: ToolPlugin = {
  name: 'subscribe',
  description: 'Subscribe to a named channel to receive messages from other agents. Use publish to check for new messages.',
  parameters: {
    channel: { type: 'string', description: 'Channel name to subscribe to', required: true },
    check: { type: 'boolean', description: 'If true, also return pending messages' },
  },
  async handler(args, ctx) {
    const channel = String(args.channel || '').trim();
    if (!channel) return 'Error: channel is required.';
    if (!ctx.pubSubStore) return 'Error: Pub/sub system not available.';

    const state = ctx.pubSubStore.getState();
    state.subscribe(channel, ctx.currentAgentId);

    if (args.check) {
      const pending = state.getPendingMessages(channel, ctx.currentAgentId);
      if (pending.length === 0) return `Subscribed to "${channel}". No pending messages.`;
      state.ack(channel, ctx.currentAgentId);
      return `Subscribed to "${channel}". Pending messages:\n` +
        pending.map((m: { authorAgentId: string; data: unknown }) => `- [${m.authorAgentId}]: ${String(m.data)}`).join('\n');
    }

    return `Subscribed to channel "${channel}".`;
  },
};
