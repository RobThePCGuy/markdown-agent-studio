import type { ToolPlugin } from '../tool-plugin';

export const delegatePlugin: ToolPlugin = {
  name: 'delegate',
  description: 'Delegate a structured task to a specific agent. The agent will receive the task as input with context.',
  parameters: {
    agent: { type: 'string', description: 'Path of the agent to delegate to (e.g., agents/worker.md)', required: true },
    task: { type: 'string', description: 'Task description and instructions', required: true },
    priority: { type: 'number', description: 'Priority (lower = higher priority, default: current depth + 1)' },
    context: { type: 'string', description: 'Additional context to include' },
  },
  async handler(args, ctx) {
    const agentPath = String(args.agent || '').trim();
    const task = String(args.task || '').trim();
    const priority = Number(args.priority) || ctx.spawnDepth + 1;
    const context = args.context ? String(args.context) : '';

    if (!agentPath) return 'Error: agent path is required.';
    if (!task) return 'Error: task description is required.';
    if (ctx.spawnDepth >= ctx.maxDepth) return `Error: Maximum spawn depth (${ctx.maxDepth}) reached.`;
    if (ctx.childCount >= ctx.maxFanout) return `Error: Maximum fanout (${ctx.maxFanout}) reached.`;

    const input = context
      ? `[Delegated Task from ${ctx.currentAgentId}]\n\n${task}\n\nContext:\n${context}`
      : `[Delegated Task from ${ctx.currentAgentId}]\n\n${task}`;

    ctx.onSpawnActivation({
      agentId: agentPath,
      input,
      parentId: ctx.currentAgentId,
      spawnDepth: ctx.spawnDepth + 1,
      priority,
    });
    ctx.incrementSpawnCount();

    return `Delegated task to ${agentPath}: "${task.slice(0, 80)}${task.length > 80 ? '...' : ''}"`;
  },
};
