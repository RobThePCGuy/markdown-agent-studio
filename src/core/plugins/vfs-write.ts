import type { ToolPlugin } from '../tool-plugin';

export const vfsWritePlugin: ToolPlugin = {
  name: 'vfs_write',
  description: 'Create or update a persistent file. Use this for all deliverables, reports, code, and outputs that should be saved. Files persist across runs and are visible in the workspace file explorer.',
  parameters: {
    path: { type: 'string', description: 'File path to write', required: true },
    content: { type: 'string', description: 'Content to write', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const content = args.content as string;
    const { vfs, registry, eventLog } = ctx;
    const meta = {
      authorAgentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
    };

    vfs.getState().write(path, content, meta);

    if (path.startsWith('agents/')) {
      registry.getState().registerFromFile(path, content);
    }

    eventLog.getState().append({
      type: 'file_change',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { path, size: content.length },
    });

    return `Written to '${path}' (${content.length} chars)`;
  },
};
