import type { ToolPlugin, ToolParameter } from '../tool-plugin';
import type { CustomToolDef } from '../../types/agent';

const LEGACY_GEMINI_MODEL = /^gemini-1\.5/i;
const DEFAULT_MODEL = 'gemini-3-flash-preview';

function substituteTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return args[key] !== undefined ? String(args[key]) : `{{${key}}}`;
  });
}

function resolveWorkerModel(model: string | undefined, preferredModel: string | undefined): string {
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  if (requestedModel && !LEGACY_GEMINI_MODEL.test(requestedModel)) {
    return requestedModel;
  }

  const preferred = typeof preferredModel === 'string' ? preferredModel.trim() : '';
  if (preferred) {
    return preferred;
  }

  return DEFAULT_MODEL;
}

export function createCustomToolPlugin(def: CustomToolDef): ToolPlugin {
  const parameters: Record<string, ToolParameter> = {};
  for (const [key, param] of Object.entries(def.parameters)) {
    parameters[key] = {
      type: (param.type as ToolParameter['type']) ?? 'string',
      description: param.description,
      required: true,
    };
  }

  return {
    name: def.name,
    description: def.description,
    parameters,
    async handler(args, ctx) {
      if (ctx.spawnDepth >= ctx.maxDepth) {
        return `Error: depth limit reached (${ctx.spawnDepth}/${ctx.maxDepth}). Cannot execute custom tool '${def.name}'.`;
      }

      const totalChildren = ctx.childCount + ctx.spawnCount;
      if (totalChildren >= ctx.maxFanout) {
        return `Error: fanout limit reached (${totalChildren}/${ctx.maxFanout}). Cannot execute custom tool '${def.name}'.`;
      }

      const prompt = substituteTemplate(def.prompt, args);
      const agentName = `${def.name}-worker`;
      const path = `agents/_custom_${def.name}_${Date.now()}.md`;
      const model = resolveWorkerModel(def.model, ctx.preferredModel);

      let frontmatter = `---\nname: "${agentName}"\nmodel: "${model}"`;
      frontmatter +=
        '\nsafety_mode: "gloves_off"' +
        '\nreads:\n  - "**"' +
        '\nwrites:\n  - "memory/**"\n  - "artifacts/**"' +
        '\npermissions:' +
        '\n  spawn_agents: false' +
        '\n  edit_agents: false' +
        '\n  delete_files: false' +
        '\n  web_access: true' +
        '\n  signal_parent: true' +
        '\n  custom_tools: false';
      frontmatter += '\n---\n\n';

      let systemPrompt =
        'You are a tool executor. Complete the following task and return the result.\n\n' +
        'You have access to these tools:\n' +
        '- vfs_read / vfs_write / vfs_list / vfs_delete: Read, write, list, and delete workspace files\n' +
        '- web_fetch: Fetch content from a URL\n' +
        '- web_search: Search the web using Google Search\n' +
        '- signal_parent: Send a message back to the agent that spawned you';
      if (def.resultSchema) {
        systemPrompt += `\n\nReturn your result as JSON matching this schema:\n${JSON.stringify(def.resultSchema, null, 2)}`;
      }

      const content = frontmatter + systemPrompt;
      const meta = {
        authorAgentId: ctx.currentAgentId,
        activationId: ctx.currentActivationId,
      };

      ctx.vfs.getState().write(path, content, meta);
      ctx.registry.getState().registerFromFile(path, content);
      ctx.incrementSpawnCount();

      const newDepth = ctx.spawnDepth + 1;

      if (ctx.onRunSessionAndReturn) {
        const result = await ctx.onRunSessionAndReturn({
          agentId: path,
          input: prompt,
          parentId: ctx.currentAgentId,
          spawnDepth: newDepth,
          priority: newDepth,
        });
        return result;
      }

      // Fallback to fire-and-forget
      ctx.onSpawnActivation({
        agentId: path,
        input: prompt,
        parentId: ctx.currentAgentId,
        spawnDepth: newDepth,
        priority: newDepth,
      });

      return `Custom tool '${def.name}' dispatched as sub-agent at depth ${newDepth}. The sub-agent will execute the task.`;
    },
  };
}
