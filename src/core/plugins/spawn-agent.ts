import matter from 'gray-matter';
import type { ToolPlugin } from '../tool-plugin';

function normalizeSpawnedAgentContent(content: string, preferredModel: string | undefined): string {
  try {
    const parsed = matter(content);
    const fm = { ...(parsed.data as Record<string, unknown>) };
    const mode = fm.safety_mode ?? fm.mode;

    // Only inject model when there's an explicit preference (global setting or parent agent model).
    // If no preference, leave whatever model the agent content specifies (or none).
    if (preferredModel) {
      fm.model = preferredModel;
    }

    if (typeof mode !== 'string' || mode.trim() === '') {
      fm.safety_mode = 'gloves_off';
    }

    return matter.stringify(parsed.content.trimStart(), fm);
  } catch {
    return content;
  }
}

export const spawnAgentPlugin: ToolPlugin = {
  name: 'spawn_agent',
  description:
    'Create a new agent by writing a markdown file to agents/. ' +
    'The content should start with YAML frontmatter between --- delimiters ' +
    '(with at least a "name" field), followed by markdown instructions. ' +
    'Example: ---\\nname: "Researcher"\\nmodel: "gemini-2.5-flash"\\n---\\n\\n# MISSION\\n...',
  parameters: {
    filename: { type: 'string', description: 'Filename for the new agent, must end in .md, e.g. "researcher.md"', required: true },
    content: { type: 'string', description: 'Full markdown content with YAML frontmatter', required: true },
    task: { type: 'string', description: 'The initial task/prompt to give the new agent', required: true },
  },
  async handler(args, ctx) {
    const filename = args.filename as string;
    const rawContent = args.content as string;
    const task = args.task as string;
    const { vfs, registry, eventLog } = ctx;
    const preferredModel = ctx.preferredModel;

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

    // Build structured handoff packet with parent working memory
    const handoffParts: string[] = [];
    handoffParts.push(`[Spawned Task from ${ctx.currentAgentId}]`);
    handoffParts.push('');
    handoffParts.push('## Task');
    handoffParts.push(task);
    handoffParts.push('');
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
    const handoffInput = handoffParts.join('\n');

    // If the agent already exists in the registry, activate it instead of overwriting
    const existingProfile = registry.getState().get(path);
    if (existingProfile) {
      const newDepth = ctx.spawnDepth + 1;

      ctx.onSpawnActivation({
        agentId: path,
        input: handoffInput,
        parentId: ctx.currentAgentId,
        spawnDepth: newDepth,
        priority: newDepth,
      });

      ctx.incrementSpawnCount();

      eventLog.getState().append({
        type: 'spawn',
        agentId: ctx.currentAgentId,
        activationId: ctx.currentActivationId,
        data: { spawned: path, depth: newDepth, task },
      });

      return `Activated existing agent "${existingProfile.name}" at '${path}' (depth ${newDepth}/${ctx.maxDepth}).`;
    }

    const meta = {
      authorAgentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
    };
    const content = normalizeSpawnedAgentContent(rawContent, preferredModel);
    vfs.getState().write(path, content, meta);
    const profile = registry.getState().registerFromFile(path, content);

    ctx.incrementSpawnCount();

    const newDepth = ctx.spawnDepth + 1;

    ctx.onSpawnActivation({
      agentId: path,
      input: handoffInput,
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
