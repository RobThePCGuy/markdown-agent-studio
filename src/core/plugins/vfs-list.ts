import type { ToolPlugin } from '../tool-plugin';

export const vfsListPlugin: ToolPlugin = {
  name: 'vfs_list',
  description: 'List files in the virtual filesystem matching a prefix.',
  parameters: {
    prefix: { type: 'string', description: 'Path prefix to filter by', required: true },
  },
  async handler(args, ctx) {
    const prefix = args.prefix as string;
    const { vfs } = ctx;
    const files = vfs.getState().list(prefix);
    if (files.length > 0) {
      return JSON.stringify(files);
    }
    const prefixes = vfs.getState().getExistingPrefixes();
    return `No files match prefix '${prefix}'. Existing prefixes: [${prefixes.join(', ')}]`;
  },
};
