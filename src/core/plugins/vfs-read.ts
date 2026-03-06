import type { ToolPlugin } from '../tool-plugin';
import { findSimilarPaths } from '../../utils/vfs-helpers';

/**
 * Try to find a file by its basename when the exact path doesn't match.
 * Returns the first path whose filename matches, or null.
 */
function findByBasename(target: string, allPaths: string[]): string | null {
  const targetName = target.includes('/') ? target.split('/').pop()! : target;
  const matches = allPaths.filter((p) => {
    const name = p.includes('/') ? p.split('/').pop()! : p;
    return name === targetName;
  });
  return matches.length === 1 ? matches[0] : null;
}

export const vfsReadPlugin: ToolPlugin = {
  name: 'vfs_read',
  description:
    'Read the contents of a file from the virtual filesystem. ' +
    'TIP: Use vfs_list first to verify paths before reading.',
  parameters: {
    path: { type: 'string', description: 'File path to read', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const { vfs } = ctx;

    // Direct match
    const content = vfs.getState().read(path);
    if (content !== null) return content;

    const allPaths = vfs.getState().getAllPaths();

    // Auto-resolve: if the basename uniquely matches one file, use that path
    const resolved = findByBasename(path, allPaths);
    if (resolved) {
      const resolvedContent = vfs.getState().read(resolved);
      if (resolvedContent !== null) {
        return `[Auto-resolved '${path}' → '${resolved}']\n\n${resolvedContent}`;
      }
    }

    const similar = findSimilarPaths(path, allPaths);
    const suggestion =
      similar.length > 0
        ? `Did you mean: ${similar.map((p) => `'${p}'`).join(', ')}? `
        : '';
    return `Error: '${path}' not found. ${suggestion}Available files: [${allPaths.join(', ')}]`;
  },
};
