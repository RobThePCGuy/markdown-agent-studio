import type { ToolPlugin } from '../tool-plugin';

export const signalParentPlugin: ToolPlugin = {
  name: 'signal_parent',
  description: 'Send a message to this agent\'s parent, re-activating it.',
  parameters: {
    message: { type: 'string', description: 'Message to send to parent agent', required: true },
  },
  async handler(args, ctx) {
    const message = args.message as string;
    const { eventLog } = ctx;

    if (!ctx.parentAgentId) {
      return `Error: this agent has no parent. You are a root agent.`;
    }

    ctx.onSpawnActivation({
      agentId: ctx.parentAgentId,
      input: `[Signal from ${ctx.currentAgentId}]: ${message}`,
      parentId: undefined,
      spawnDepth: Math.max(0, ctx.spawnDepth - 1),
      priority: 0,
    });

    eventLog.getState().append({
      type: 'signal',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { parent: ctx.parentAgentId, message },
    });

    return `Message sent to parent '${ctx.parentAgentId}'. Parent will be re-activated.`;
  },
};
