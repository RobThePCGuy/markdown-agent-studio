import type { ToolPlugin } from '../tool-plugin';

export const memoryWritePlugin: ToolPlugin = {
  name: 'memory_write',
  description:
    'Write a temporary entry to shared working memory. Other agents in the current run can read it via memory_read. ' +
    'Working memory is cleared when the run ends -- use this only for inter-agent coordination during a run. For final outputs use vfs_write instead.',
  parameters: {
    key: {
      type: 'string',
      description: 'A short descriptive key for this memory entry (e.g. "search-results", "user-preferences")',
      required: true,
    },
    value: {
      type: 'string',
      description: 'The content to store',
      required: true,
    },
    tags: {
      type: 'string',
      description: 'Optional comma-separated tags for categorization (e.g. "research,api,important")',
    },
  },
  async handler(args, ctx) {
    if (!ctx.memoryStore) {
      return 'Error: Memory store is not available.';
    }

    const key = args.key as string;
    const value = args.value as string;
    const rawTags = (args.tags as string) || '';
    const tags = rawTags
      ? rawTags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    ctx.memoryStore.getState().write({
      key,
      value,
      tags,
      authorAgentId: ctx.currentAgentId,
    });

    return `Memory written: "${key}" (${tags.length} tag${tags.length === 1 ? '' : 's'})`;
  },
};

export const memoryReadPlugin: ToolPlugin = {
  name: 'memory_read',
  description:
    'Search shared working memory for entries written by any agent in this run. ' +
    'Check here before doing web searches -- another agent may have already found what you need. Note: working memory is temporary and cleared when the run ends.',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query to match against memory keys and values',
      required: true,
    },
    tags: {
      type: 'string',
      description: 'Optional comma-separated tags to filter results (e.g. "research,api")',
    },
  },
  async handler(args, ctx) {
    if (!ctx.memoryStore) {
      return 'Error: Memory store is not available.';
    }

    const query = args.query as string;
    const rawTags = (args.tags as string) || '';
    const tags = rawTags
      ? rawTags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : undefined;

    const results = ctx.memoryStore.getState().read(query, tags);

    if (results.length === 0) {
      return 'No matching memories found.';
    }

    const now = Date.now();
    const formatted = results.map((entry) => {
      const ageSeconds = Math.round((now - entry.timestamp) / 1000);
      return `[${entry.key}] (by ${entry.authorAgentId}, ${ageSeconds}s ago)\n${entry.value}`;
    });

    return formatted.join('\n---\n');
  },
};
