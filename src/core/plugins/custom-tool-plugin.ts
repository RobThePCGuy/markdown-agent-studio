import type { ToolPlugin, ToolParameter } from '../tool-plugin';
import type { CustomToolDef } from '../../types/agent';

function substituteTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return args[key] !== undefined ? String(args[key]) : `{{${key}}}`;
  });
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

      let frontmatter = `---\nname: "${agentName}"`;
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
        try {
          const result = await ctx.onRunSessionAndReturn({
            agentId: path,
            input: prompt,
            parentId: ctx.currentAgentId,
            spawnDepth: newDepth,
            priority: newDepth,
          });
          return result;
        } finally {
          // Clean up transient agent — removes the node from the graph view.
          // This is intentional: custom tool agents are ephemeral workers.
          ctx.vfs.getState().deleteFile(path);
          ctx.registry.getState().unregister(path);
        }
      }

      // Fallback: fire-and-forget when onRunSessionAndReturn is not provided.
      // In practice this path is unreachable — the Kernel always provides
      // onRunSessionAndReturn to the ToolHandler. The temp agent file leaks
      // here because onSpawnActivation has no completion callback.
      // TODO: if this path ever becomes reachable, add a session-completion
      // listener (e.g. subscribe to eventLog for 'complete' events matching
      // this agentId) and clean up ctx.vfs.deleteFile(path) + ctx.registry.unregister(path).
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
