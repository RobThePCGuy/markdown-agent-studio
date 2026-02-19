import matter from 'gray-matter';
import type {
  AgentExecutionMode,
  AgentPermissions,
  AgentPolicy,
  AgentProfile,
  CustomToolDef,
} from '../types';
import { computeHash } from './vfs-helpers';

const MODE_ALIASES: Record<string, AgentExecutionMode> = {
  safe: 'safe',
  street: 'safe',
  balanced: 'balanced',
  gloves_off: 'gloves_off',
  'gloves-off': 'gloves_off',
  glovesoff: 'gloves_off',
  track: 'gloves_off',
};

function parseMode(input: unknown): AgentExecutionMode {
  if (typeof input !== 'string') return 'gloves_off';
  const normalized = input.trim().toLowerCase();
  return MODE_ALIASES[normalized] ?? 'gloves_off';
}

function defaultPermissions(mode: AgentExecutionMode): AgentPermissions {
  if (mode === 'gloves_off') {
    return {
      spawnAgents: true,
      editAgents: true,
      deleteFiles: true,
      webAccess: true,
      signalParent: true,
      customTools: true,
    };
  }

  if (mode === 'safe') {
    return {
      spawnAgents: false,
      editAgents: false,
      deleteFiles: false,
      webAccess: false,
      signalParent: true,
      customTools: false,
    };
  }

  return {
    spawnAgents: true,
    editAgents: false,
    deleteFiles: false,
    webAccess: true,
    signalParent: true,
    customTools: true,
  };
}

function defaultReads(mode: AgentExecutionMode): string[] {
  if (mode === 'safe') {
    return ['agents/**', 'memory/**', 'artifacts/**'];
  }
  return ['**'];
}

function defaultWrites(mode: AgentExecutionMode): string[] {
  if (mode === 'gloves_off') {
    return ['**'];
  }
  return ['memory/**', 'artifacts/**'];
}

function uniqueNonEmptyStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  return [...new Set(cleaned)];
}

function permissionKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]/g, '_');
}

function tokenKey(token: string): string {
  return token.toLowerCase().replace(/[\s-]/g, '_');
}

function setAllPermissions(value: boolean): AgentPermissions {
  return {
    spawnAgents: value,
    editAgents: value,
    deleteFiles: value,
    webAccess: value,
    signalParent: value,
    customTools: value,
  };
}

function applyPermissionToken(
  perms: AgentPermissions,
  token: string,
): { perms: AgentPermissions; readAll: boolean; writeAll: boolean; mode: AgentExecutionMode | null } {
  const t = tokenKey(token);
  let next = { ...perms };
  let readAll = false;
  let writeAll = false;
  let mode: AgentExecutionMode | null = null;

  switch (t) {
    case 'spawn_agent':
    case 'spawn_agents':
      next.spawnAgents = true;
      break;
    case 'edit_agents':
    case 'overwrite_agents':
      next.editAgents = true;
      break;
    case 'delete_files':
    case 'vfs_delete':
      next.deleteFiles = true;
      break;
    case 'web':
    case 'web_access':
    case 'web_fetch':
    case 'web_search':
      next.webAccess = true;
      break;
    case 'signal_parent':
      next.signalParent = true;
      break;
    case 'custom_tools':
      next.customTools = true;
      break;
    case 'read_all':
      readAll = true;
      break;
    case 'write_all':
      writeAll = true;
      break;
    case 'allow_all':
    case 'all':
    case '*':
      next = setAllPermissions(true);
      readAll = true;
      writeAll = true;
      break;
    case 'gloves_off':
      mode = 'gloves_off';
      break;
    case 'safe':
      mode = 'safe';
      break;
    case 'balanced':
      mode = 'balanced';
      break;
  }

  return { perms: next, readAll, writeAll, mode };
}

function applyPermissionObject(perms: AgentPermissions, raw: Record<string, unknown>): AgentPermissions {
  let next = { ...perms };
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'boolean') continue;
    switch (permissionKey(key)) {
      case 'spawn_agent':
      case 'spawn_agents':
        next.spawnAgents = value;
        break;
      case 'edit_agents':
      case 'overwrite_agents':
        next.editAgents = value;
        break;
      case 'delete_files':
      case 'vfs_delete':
        next.deleteFiles = value;
        break;
      case 'web':
      case 'web_access':
      case 'web_fetch':
      case 'web_search':
        next.webAccess = value;
        break;
      case 'signal_parent':
        next.signalParent = value;
        break;
      case 'custom_tools':
        next.customTools = value;
        break;
      case 'allow_all':
        if (value) {
          next = setAllPermissions(true);
        }
        break;
    }
  }
  return next;
}

export function parseAgentPolicy(frontmatter: Record<string, unknown>): AgentPolicy {
  let mode = parseMode(frontmatter.safety_mode ?? frontmatter.mode);
  let reads = defaultReads(mode);
  let writes = defaultWrites(mode);
  let permissions = defaultPermissions(mode);

  const explicitReads = uniqueNonEmptyStrings(frontmatter.reads);
  if (explicitReads.length > 0) {
    reads = explicitReads;
  }

  const explicitWrites = uniqueNonEmptyStrings(frontmatter.writes);
  if (explicitWrites.length > 0) {
    writes = explicitWrites;
  }

  const rawPermissions = frontmatter.permissions;
  if (Array.isArray(rawPermissions)) {
    permissions = setAllPermissions(false);
    for (const rawToken of rawPermissions) {
      if (typeof rawToken !== 'string') continue;
      const applied = applyPermissionToken(permissions, rawToken);
      permissions = applied.perms;
      if (applied.readAll) reads = ['**'];
      if (applied.writeAll) writes = ['**'];
      if (applied.mode) {
        mode = applied.mode;
      }
    }
  } else if (rawPermissions && typeof rawPermissions === 'object' && !Array.isArray(rawPermissions)) {
    const permsObj = rawPermissions as Record<string, unknown>;
    permissions = applyPermissionObject(permissions, permsObj);
    if (permsObj.allow_all === true) {
      mode = 'gloves_off';
    }
  }

  if (mode === 'gloves_off') {
    permissions = setAllPermissions(true);
    reads = ['**'];
    writes = ['**'];
  }

  if (!permissions.editAgents) {
    writes = writes.filter((p) => !p.startsWith('agents/'));
    if (writes.length === 0 && mode === 'gloves_off') {
      writes = ['**'];
    }
  }

  return {
    mode,
    reads: reads.length > 0 ? reads : defaultReads(mode),
    writes: writes.length > 0 ? writes : defaultWrites(mode),
    allowedTools: uniqueNonEmptyStrings(frontmatter.allowed_tools),
    blockedTools: uniqueNonEmptyStrings(frontmatter.blocked_tools),
    glovesOffTriggers: uniqueNonEmptyStrings(
      frontmatter.gloves_off_triggers ?? frontmatter.glovesOffTriggers,
    ),
    permissions,
  };
}

export function resolvePolicyForInput(
  basePolicy: AgentPolicy,
  input: string,
): { policy: AgentPolicy; escalated: boolean; trigger?: string } {
  if (basePolicy.mode === 'gloves_off') {
    return { policy: basePolicy, escalated: false };
  }

  const normalizedInput = input.toLowerCase();
  const matched = basePolicy.glovesOffTriggers.find((trigger) =>
    normalizedInput.includes(trigger.toLowerCase()),
  );
  if (!matched) {
    return { policy: basePolicy, escalated: false };
  }

  return {
    policy: {
      ...basePolicy,
      mode: 'gloves_off',
      reads: ['**'],
      writes: ['**'],
      allowedTools: [],
      blockedTools: [],
      permissions: setAllPermissions(true),
    },
    escalated: true,
    trigger: matched,
  };
}

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
      policy: parseAgentPolicy(fm),
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
      policy: parseAgentPolicy({}),
    };
  }
}
