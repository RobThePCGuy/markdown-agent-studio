import type { ToolPlugin } from '../tool-plugin';

export const knowledgeContributePlugin: ToolPlugin = {
  name: 'knowledge_contribute',
  description:
    'Add knowledge to the shared graph for other agents to find.',
  parameters: {
    content: {
      type: 'string',
      description: 'The knowledge to share',
      required: true,
    },
    type: {
      type: 'string',
      description:
        'Memory type: skill, fact, procedure, observation, mistake, or preference',
      required: true,
    },
    tags: {
      type: 'string',
      description: 'Comma-separated tags',
    },
  },
  async handler(args, ctx) {
    if (!ctx.vectorStore) {
      return 'Error: Vector memory is not available.';
    }

    const content = String(args.content || '').trim();
    const type = String(args.type || 'fact');
    const tags = String(args.tags || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    if (!content) return 'Error: content is required.';

    // Write to working memory with shared tag
    if (ctx.memoryStore) {
      ctx.memoryStore.getState().write({
        key: `shared:${type}`,
        value: content,
        tags: [...tags, 'shared'],
        authorAgentId: ctx.currentAgentId,
      });
    }

    return `Contributed to shared knowledge: [${type}] "${content.slice(0, 80)}..."`;
  },
};
