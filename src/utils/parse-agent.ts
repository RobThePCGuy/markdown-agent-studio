import matter from 'gray-matter';
import type { AgentProfile } from '../types';
import { computeHash } from './vfs-helpers';

export function parseAgentFile(path: string, content: string): AgentProfile {
  const filename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;

  try {
    const parsed = matter(content);
    const fm = parsed.data as Record<string, unknown>;

    return {
      id: typeof fm.id === 'string' ? fm.id : path,
      path,
      name: typeof fm.name === 'string' ? fm.name : filename,
      model: typeof fm.model === 'string' ? fm.model : undefined,
      systemPrompt: parsed.content.trim(),
      frontmatter: fm,
      contentHash: computeHash(content),
    };
  } catch {
    return {
      id: path,
      path,
      name: filename,
      model: undefined,
      systemPrompt: content,
      frontmatter: {},
      contentHash: computeHash(content),
    };
  }
}
