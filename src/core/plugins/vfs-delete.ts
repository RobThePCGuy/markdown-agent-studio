import type { ToolPlugin } from '../tool-plugin';

export const vfsDeletePlugin: ToolPlugin = {
  name: 'vfs_delete',
  description: 'Delete a file from the virtual filesystem.',
  parameters: {
    path: { type: 'string', description: 'File path to delete', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const { vfs, registry } = ctx;
    if (!vfs.getState().exists(path)) {
      return `Error: '${path}' not found.`;
    }
    vfs.getState().deleteFile(path);
    if (path.startsWith('agents/')) {
      registry.getState().unregister(path);
    }
    return `Deleted '${path}'`;
  },
};
