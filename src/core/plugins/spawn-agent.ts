import type { ToolPlugin } from '../tool-plugin';

export const spawnAgentPlugin: ToolPlugin = {
  name: 'spawn_agent',
  description: 'Create a new agent file and activate it with a task.',
  parameters: {
    filename: { type: 'string', description: 'Filename for the new agent (under agents/)', required: true },
    content: { type: 'string', description: 'Markdown content defining the agent', required: true },
    task: { type: 'string', description: 'Task to assign to the spawned agent', required: true },
  },
  async handler(args, ctx) {
    const filename = args.filename as string;
    const content = args.content as string;
    const task = args.task as string;
    const { vfs, registry, eventLog } = ctx;
    const path = filename.startsWith('agents/') ? filename : `agents/${filename}`;

    if (ctx.spawnDepth >= ctx.maxDepth) {
      return `Error: depth limit reached (${ctx.spawnDepth}/${ctx.maxDepth}). Cannot spawn more agents.`;
    }

    const totalChildren = ctx.childCount + ctx.spawnCount;
    if (totalChildren >= ctx.maxFanout) {
      return `Error: fanout limit reached (${totalChildren}/${ctx.maxFanout}). This agent cannot spawn more children.`;
    }

    const meta = {
      authorAgentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
    };
    vfs.getState().write(path, content, meta);
    const profile = registry.getState().registerFromFile(path, content);

    ctx.incrementSpawnCount();

    const newDepth = ctx.spawnDepth + 1;

    ctx.onSpawnActivation({
      agentId: path,
      input: task,
      parentId: ctx.currentAgentId,
      spawnDepth: newDepth,
      priority: newDepth,
    });

    eventLog.getState().append({
      type: 'spawn',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { spawned: path, depth: newDepth, task },
    });

    return `Created and activated '${profile.name}' at '${path}' (depth ${newDepth}/${ctx.maxDepth})`;
  },
};
