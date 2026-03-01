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

    // Build structured handoff packet
    const handoffParts: string[] = [];
    handoffParts.push(`[Delegated Task from ${ctx.currentAgentId}]`);
    handoffParts.push('');
    handoffParts.push('## Task');
    handoffParts.push(task);
    handoffParts.push('');

    // Include relevant working memory entries
    if (ctx.memoryStore) {
      const memories = ctx.memoryStore.getState().read('', []);
      if (memories.length > 0) {
        handoffParts.push('## Parent Working Memory');
        const relevant = memories.slice(-10);
        for (const m of relevant) {
          handoffParts.push(`- [${m.key}]: ${m.value.slice(0, 500)}`);
        }
        handoffParts.push('');
      }
    }

    // Include explicit context if provided
    if (context) {
      handoffParts.push('## Additional Context');
      handoffParts.push(context);
      handoffParts.push('');
    }

    const input = handoffParts.join('\n');

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
