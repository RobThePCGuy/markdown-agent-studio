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
      if (def.model) {
        frontmatter += `\nmodel: "${def.model}"`;
      }
      frontmatter += '\n---\n\n';

      let systemPrompt = 'You are a tool executor. Complete the following task and return the result.';
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
