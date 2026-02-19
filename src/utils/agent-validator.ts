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
    diagnostics.push({
      startLine: 1,
      endLine: closingDelimiterLine || 2,
      startCol: 1,
      endCol: 4,
      message: 'Missing required field: name',
      severity: 'warning',
    });
  }

  // Check for unknown model
  if (typeof fm.model === 'string' && !KNOWN_MODELS.includes(fm.model)) {
    const modelLine = lines.findIndex((l) => l.trimStart().startsWith('model:')) + 1;
    diagnostics.push({
      startLine: modelLine || 2,
      endLine: modelLine || 2,
      startCol: 1,
      endCol: (lines[modelLine - 1]?.length ?? 0) + 1,
      message: `Unknown model '${fm.model}'. Known: ${KNOWN_MODELS.join(', ')}`,
      severity: 'info',
    });
  }

  // Validate safety mode
  const rawMode = fm.safety_mode ?? fm.mode;
  if (rawMode != null) {
    if (typeof rawMode !== 'string') {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'safety_mode'/'mode' should be a string.",
        severity: 'warning',
      });
    } else if (!KNOWN_MODES.includes(rawMode.trim().toLowerCase())) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: `Unknown safety mode '${rawMode}'. Known: safe, balanced, gloves_off.`,
        severity: 'warning',
      });
    } else {
      const normalized = rawMode.trim().toLowerCase();
      if (normalized === 'gloves_off' || normalized === 'gloves-off' || normalized === 'glovesoff' || normalized === 'track') {
        diagnostics.push({
          startLine: 1,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: "Mode 'gloves_off' enables unrestricted execution for this agent.",
          severity: 'warning',
        });
      }
    }
  }

  // Validate read/write scopes
  if (fm.reads != null) {
    if (!Array.isArray(fm.reads)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'reads' should be an array of path patterns.",
        severity: 'warning',
      });
    } else if (hasNonStringItems(fm.reads)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'reads' must only contain strings.",
        severity: 'warning',
      });
    }
  }

  if (fm.writes != null) {
    if (!Array.isArray(fm.writes)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'writes' should be an array of path patterns.",
        severity: 'warning',
      });
    } else if (hasNonStringItems(fm.writes)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'writes' must only contain strings.",
        severity: 'warning',
      });
    }
  }

  // Validate tool allow/deny lists
  if (fm.allowed_tools != null) {
    if (!Array.isArray(fm.allowed_tools) || hasNonStringItems(fm.allowed_tools)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'allowed_tools' must be an array of tool names.",
        severity: 'warning',
      });
    }
  }
  if (fm.blocked_tools != null) {
    if (!Array.isArray(fm.blocked_tools) || hasNonStringItems(fm.blocked_tools)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'blocked_tools' must be an array of tool names.",
        severity: 'warning',
      });
    }
  }

  // Validate gloves-off triggers
  const triggers = fm.gloves_off_triggers ?? fm.glovesOffTriggers;
  if (triggers != null) {
    if (!Array.isArray(triggers) || hasNonStringItems(triggers)) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'gloves_off_triggers' should be an array of strings.",
        severity: 'warning',
      });
    } else if (triggers.length === 0) {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'gloves_off_triggers' is empty and will never match.",
        severity: 'info',
      });
    }
  }

  // Validate permissions
  if (fm.permissions != null) {
    if (Array.isArray(fm.permissions)) {
      if (hasNonStringItems(fm.permissions)) {
        diagnostics.push({
          startLine: 1,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: "Frontmatter field 'permissions' array must contain only strings.",
          severity: 'warning',
        });
      } else {
        const lowered = fm.permissions.map((p) => p.toLowerCase());
        if (lowered.includes('*') || lowered.includes('allow_all') || lowered.includes('all')) {
          diagnostics.push({
            startLine: 1,
            endLine: closingDelimiterLine || 2,
            startCol: 1,
            endCol: 4,
            message: "Frontmatter permissions include allow-all behavior.",
            severity: 'warning',
          });
        }
      }
    } else if (typeof fm.permissions === 'object') {
      const perms = fm.permissions as Record<string, unknown>;
      for (const [key, value] of Object.entries(perms)) {
        if (typeof value !== 'boolean') {
          diagnostics.push({
            startLine: 1,
            endLine: closingDelimiterLine || 2,
            startCol: 1,
            endCol: 4,
            message: `Permission '${key}' should be boolean.`,
            severity: 'warning',
          });
        }
      }
      if (perms.allow_all === true) {
        diagnostics.push({
          startLine: 1,
          endLine: closingDelimiterLine || 2,
          startCol: 1,
          endCol: 4,
          message: "permissions.allow_all=true makes this agent effectively unrestricted.",
          severity: 'warning',
        });
      }
    } else {
      diagnostics.push({
        startLine: 1,
        endLine: closingDelimiterLine || 2,
        startCol: 1,
        endCol: 4,
        message: "Frontmatter field 'permissions' should be an object or array.",
        severity: 'warning',
      });
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
