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

const KNOWN_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

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
