import type { ToolPlugin } from '../tool-plugin';

export const spawnAgentPlugin: ToolPlugin = {
  name: 'spawn_agent',
  description:
    'Create a new agent by writing a markdown file to agents/. ' +
    'The content should start with YAML frontmatter between --- delimiters ' +
    '(with at least a "name" field), followed by markdown instructions. ' +
    'Example: ---\\nname: "Researcher"\\nmodel: "gemini-3-flash-preview"\\n---\\n\\n# MISSION\\n...',
  parameters: {
    filename: { type: 'string', description: 'Filename for the new agent, must end in .md, e.g. "researcher.md"', required: true },
    content: { type: 'string', description: 'Full markdown content with YAML frontmatter', required: true },
    task: { type: 'string', description: 'The initial task/prompt to give the new agent', required: true },
  },
  async handler(args, ctx) {
    const filename = args.filename as string;
    const content = args.content as string;
    const task = args.task as string;
    const { vfs, registry, eventLog } = ctx;

    // Agent files must be markdown
    const basename = filename.includes('/') ? filename.split('/').pop()! : filename;
    if (!basename.endsWith('.md')) {
      return `Error: Agent files must have a .md extension. Got '${basename}'. Try '${basename.replace(/\.[^.]+$/, '.md')}' instead.`;
    }

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
