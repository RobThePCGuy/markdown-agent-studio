import matter from 'gray-matter';
import type { AgentProfile, CustomToolDef } from '../types';
import { computeHash } from './vfs-helpers';

function parseCustomTools(
  tools: unknown,
): CustomToolDef[] | undefined {
  if (!Array.isArray(tools)) return undefined;

  const valid: CustomToolDef[] = [];

  for (const entry of tools) {
    if (entry == null || typeof entry !== 'object') continue;

    const e = entry as Record<string, unknown>;

    // name, description, and prompt are required strings
    if (
      typeof e.name !== 'string' ||
      typeof e.description !== 'string' ||
      typeof e.prompt !== 'string'
    ) {
      continue;
    }

    // parameters must be an object (Record<string, {type, description}>)
    if (e.parameters == null || typeof e.parameters !== 'object' || Array.isArray(e.parameters)) {
      continue;
    }

    const rawParams = e.parameters as Record<string, unknown>;
    const parameters: Record<string, { type: string; description: string }> = {};

    let paramsValid = true;
    for (const [key, val] of Object.entries(rawParams)) {
      if (val == null || typeof val !== 'object' || Array.isArray(val)) {
        paramsValid = false;
        break;
      }
      const p = val as Record<string, unknown>;
      if (typeof p.type !== 'string' || typeof p.description !== 'string') {
        paramsValid = false;
        break;
      }
      parameters[key] = { type: p.type, description: p.description };
    }

    if (!paramsValid) continue;

    const tool: CustomToolDef = {
      name: e.name,
      description: e.description,
      parameters,
      prompt: e.prompt,
    };

    if (typeof e.model === 'string') {
      tool.model = e.model;
    }

    if (e.result_schema != null && typeof e.result_schema === 'object' && !Array.isArray(e.result_schema)) {
      tool.resultSchema = e.result_schema as Record<string, unknown>;
    }

    valid.push(tool);
  }

  return valid.length > 0 ? valid : undefined;
}

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
      customTools: parseCustomTools(fm.tools),
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
