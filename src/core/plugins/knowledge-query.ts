import type { ToolPlugin } from '../tool-plugin';

export const knowledgeQueryPlugin: ToolPlugin = {
  name: 'knowledge_query',
  description:
    'Search shared knowledge across all agents using semantic similarity.',
  parameters: {
    query: {
      type: 'string',
      description: 'What to search for',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Max results (default 10)',
    },
  },
  async handler(args, ctx) {
    if (!ctx.vectorStore) {
      return 'Error: Vector memory is not available. Enable it in Settings > Memory.';
    }

    const query = String(args.query || '').trim();
    const limit = Number(args.limit) || 10;

    if (!query) return 'Error: query is required.';

    const results = await ctx.vectorStore.semanticSearch(
      query,
      ctx.currentAgentId,
      limit,
    );

    if (results.length === 0) return 'No shared knowledge found.';

    return results
      .map(
        (r: any, i: number) =>
          `${i + 1}. [${r.type}] ${r.content}\n   Tags: ${r.tags.join(', ')} | From: ${r.agentId}`,
      )
      .join('\n---\n');
  },
};
