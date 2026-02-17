import type { ToolPlugin } from '../tool-plugin';
import { findSimilarPaths } from '../../utils/vfs-helpers';

export const vfsReadPlugin: ToolPlugin = {
  name: 'vfs_read',
  description: 'Read the contents of a file from the virtual filesystem.',
  parameters: {
    path: { type: 'string', description: 'File path to read', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const { vfs } = ctx;
    const content = vfs.getState().read(path);
    if (content !== null) return content;

    const allPaths = vfs.getState().getAllPaths();
    const similar = findSimilarPaths(path, allPaths);
    const suggestion =
      similar.length > 0
        ? `Similar: ${similar.map((p) => `'${p}'`).join(', ')}. `
        : '';
    return `Error: '${path}' not found. ${suggestion}Available files: [${allPaths.join(', ')}]`;
  },
};
