import matter from 'gray-matter';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AgentDiagnostic {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: DiagnosticSeverity;
}

const KNOWN_MODELS = ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
const KNOWN_MODES = ['safe', 'balanced', 'gloves_off', 'gloves-off', 'glovesoff', 'street', 'track'];

function hasNonStringItems(value: unknown[]): boolean {
  return value.some((v) => typeof v !== 'string');
}

/** Find the 1-based line number of a YAML field by name. Returns 0 if not found. */
function findFieldLine(lines: string[], ...fieldNames: string[]): number {
  for (const name of fieldNames) {
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${name}:`));
    if (idx !== -1) return idx + 1;
  }
  return 0;
}

/** Build a single-line diagnostic targeting a specific field (or line 1 as fallback). */
function fieldDiag(
  lines: string[],
  fieldLine: number,
  message: string,
  severity: DiagnosticSeverity,
): AgentDiagnostic {
  const ln = fieldLine || 1;
  return {
    startLine: ln,
    endLine: ln,
    startCol: 1,
    endCol: (lines[ln - 1]?.length ?? 0) + 1,
    message,
    severity,
  };
}

export function validateAgentContent(content: string, isAgent = true): AgentDiagnostic[] {
  if (!isAgent) return [];

  const diagnostics: AgentDiagnostic[] = [];
  const lines = content.split('\n');

  // Check for frontmatter delimiters
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    diagnostics.push({
      startLine: 1,
      endLine: 1,
      startCol: 1,
      endCol: (lines[0]?.length ?? 0) + 1,
      message: 'Agent files should have YAML frontmatter (---)',
      severity: 'warning',
    });
    return diagnostics;
  }

  // Try parsing frontmatter
  let parsed;
  try {
    parsed = matter(content);
  } catch (err) {
    diagnostics.push({
      startLine: 1,
      endLine: 3,
      startCol: 1,
      endCol: 4,
      message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'error',
    });
    return diagnostics;
  }

  const fm = parsed.data as Record<string, unknown>;

  // Find the frontmatter line range for positioning markers
  const closingDelimiterLine = lines.indexOf('---', 1) + 1;

  // Check for missing name
  if (typeof fm.name !== 'string' || fm.name.trim() === '') {
    const nameLine = findFieldLine(lines, 'name');
    diagnostics.push(fieldDiag(lines, nameLine, 'Missing required field: name', 'warning'));
  }

  // Check for unknown model
  if (typeof fm.model === 'string' && !KNOWN_MODELS.includes(fm.model)) {
    const modelLine = findFieldLine(lines, 'model');
    diagnostics.push(fieldDiag(lines, modelLine, `Unknown model '${fm.model}'. Known: ${KNOWN_MODELS.join(', ')}`, 'info'));
  }

  // Validate safety mode
  const rawMode = fm.safety_mode ?? fm.mode;
  if (rawMode != null) {
    const modeLine = findFieldLine(lines, 'safety_mode', 'mode');
    if (typeof rawMode !== 'string') {
      diagnostics.push(fieldDiag(lines, modeLine, "Frontmatter field 'safety_mode'/'mode' should be a string.", 'warning'));
    } else if (!KNOWN_MODES.includes(rawMode.trim().toLowerCase())) {
      diagnostics.push(fieldDiag(lines, modeLine, `Unknown safety mode '${rawMode}'. Known: safe, balanced, gloves_off.`, 'warning'));
    } else {
      const normalized = rawMode.trim().toLowerCase();
      if (normalized === 'gloves_off' || normalized === 'gloves-off' || normalized === 'glovesoff' || normalized === 'track') {
        diagnostics.push(fieldDiag(lines, modeLine, "Mode 'gloves_off' enables unrestricted execution for this agent.", 'warning'));
      }
    }
  }

  // Validate read/write scopes
  if (fm.reads != null) {
    const readsLine = findFieldLine(lines, 'reads');
    if (!Array.isArray(fm.reads)) {
      diagnostics.push(fieldDiag(lines, readsLine, "Frontmatter field 'reads' should be an array of path patterns.", 'warning'));
    } else if (hasNonStringItems(fm.reads)) {
      diagnostics.push(fieldDiag(lines, readsLine, "Frontmatter field 'reads' must only contain strings.", 'warning'));
    }
  }

  if (fm.writes != null) {
    const writesLine = findFieldLine(lines, 'writes');
    if (!Array.isArray(fm.writes)) {
      diagnostics.push(fieldDiag(lines, writesLine, "Frontmatter field 'writes' should be an array of path patterns.", 'warning'));
    } else if (hasNonStringItems(fm.writes)) {
      diagnostics.push(fieldDiag(lines, writesLine, "Frontmatter field 'writes' must only contain strings.", 'warning'));
    }
  }

  // Validate tool allow/deny lists
  if (fm.allowed_tools != null) {
    if (!Array.isArray(fm.allowed_tools) || hasNonStringItems(fm.allowed_tools)) {
      const atLine = findFieldLine(lines, 'allowed_tools');
      diagnostics.push(fieldDiag(lines, atLine, "Frontmatter field 'allowed_tools' must be an array of tool names.", 'warning'));
    }
  }
  if (fm.blocked_tools != null) {
    if (!Array.isArray(fm.blocked_tools) || hasNonStringItems(fm.blocked_tools)) {
      const btLine = findFieldLine(lines, 'blocked_tools');
      diagnostics.push(fieldDiag(lines, btLine, "Frontmatter field 'blocked_tools' must be an array of tool names.", 'warning'));
    }
  }

  // Validate gloves-off triggers
  const triggers = fm.gloves_off_triggers ?? fm.glovesOffTriggers;
  if (triggers != null) {
    const trigLine = findFieldLine(lines, 'gloves_off_triggers', 'glovesOffTriggers');
    if (!Array.isArray(triggers) || hasNonStringItems(triggers)) {
      diagnostics.push(fieldDiag(lines, trigLine, "Frontmatter field 'gloves_off_triggers' should be an array of strings.", 'warning'));
    } else if (triggers.length === 0) {
      diagnostics.push(fieldDiag(lines, trigLine, "Frontmatter field 'gloves_off_triggers' is empty and will never match.", 'info'));
    }
  }

  // Validate permissions
  if (fm.permissions != null) {
    const permLine = findFieldLine(lines, 'permissions');
    if (Array.isArray(fm.permissions)) {
      if (hasNonStringItems(fm.permissions)) {
        diagnostics.push(fieldDiag(lines, permLine, "Frontmatter field 'permissions' array must contain only strings.", 'warning'));
      } else {
        const lowered = fm.permissions.map((p) => p.toLowerCase());
        if (lowered.includes('*') || lowered.includes('allow_all') || lowered.includes('all')) {
          diagnostics.push(fieldDiag(lines, permLine, "Frontmatter permissions include allow-all behavior.", 'warning'));
        }
      }
    } else if (typeof fm.permissions === 'object') {
      const perms = fm.permissions as Record<string, unknown>;
      for (const [key, value] of Object.entries(perms)) {
        if (typeof value !== 'boolean') {
          diagnostics.push(fieldDiag(lines, permLine, `Permission '${key}' should be boolean.`, 'warning'));
        }
      }
      if (perms.allow_all === true) {
        diagnostics.push(fieldDiag(lines, permLine, "permissions.allow_all=true makes this agent effectively unrestricted.", 'warning'));
      }
    } else {
      diagnostics.push(fieldDiag(lines, permLine, "Frontmatter field 'permissions' should be an object or array.", 'warning'));
    }
  }

  // Check for empty body
  const body = parsed.content.trim();
  if (body.length === 0) {
    const bodyStartLine = closingDelimiterLine + 1 || lines.length;
    diagnostics.push({
      startLine: bodyStartLine,
      endLine: bodyStartLine,
      startCol: 1,
      endCol: 1,
      message: 'Agent has no system prompt instructions',
      severity: 'warning',
    });
  }

  // Validate custom tool definitions
  if (Array.isArray(fm.tools)) {
    for (const tool of fm.tools) {
      if (typeof tool !== 'object' || tool === null) continue;
      const t = tool as Record<string, unknown>;

      const toolLabel = typeof t.name === 'string' ? `tool '${t.name}'` : 'tool entry';

      if (typeof t.name !== 'string' || t.name.trim() === '') {
        diagnostics.push({
          startLine: closingDelimiterLine || 2,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: `Custom tool is missing required field: name`,
          severity: 'warning',
        });
      }

      if (typeof t.description !== 'string' || t.description.trim() === '') {
        diagnostics.push({
          startLine: closingDelimiterLine || 2,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: `Custom ${toolLabel} is missing required field: description`,
          severity: 'warning',
        });
      }

      if (typeof t.prompt !== 'string' || t.prompt.trim() === '') {
        diagnostics.push({
          startLine: closingDelimiterLine || 2,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: `Custom ${toolLabel} is missing required field: prompt`,
          severity: 'warning',
        });
      }

      // Check template variable mismatches
      if (typeof t.prompt === 'string') {
        const templateVars = [...t.prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        const paramKeys =
          typeof t.parameters === 'object' && t.parameters !== null
            ? Object.keys(t.parameters as Record<string, unknown>)
            : [];

        for (const varName of templateVars) {
          if (!paramKeys.includes(varName)) {
            diagnostics.push({
              startLine: closingDelimiterLine || 2,
              endLine: closingDelimiterLine || 2,
              startCol: 1,
              endCol: 4,
              message: `Custom ${toolLabel} prompt references '{{${varName}}}' but no parameter '${varName}' is defined`,
              severity: 'info',
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
