export interface SearchableCommand {
  id: string;
  label: string;
  category: string;
  hint?: string;
  keywords?: string[];
}

const SCOPE_TO_CATEGORY: Record<string, string> = {
  agent: 'Agents',
  agents: 'Agents',
  a: 'Agents',
  file: 'Files',
  files: 'Files',
  f: 'Files',
  action: 'Actions',
  actions: 'Actions',
  act: 'Actions',
  nav: 'Navigation',
  navigation: 'Navigation',
  n: 'Navigation',
};

interface ParsedCommandQuery {
  scopeCategory?: string;
  tokens: string[];
}

function parseQuery(query: string): ParsedCommandQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { tokens: [] };
  }

  const scopeMatch = trimmed.match(/^([a-z]+):(.*)$/i);
  if (scopeMatch) {
    const alias = scopeMatch[1].toLowerCase();
    const scopeCategory = SCOPE_TO_CATEGORY[alias];
    if (scopeCategory) {
      const tokens = scopeMatch[2].trim().toLowerCase().split(/\s+/).filter(Boolean);
      return { scopeCategory, tokens };
    }
  }

  return {
    tokens: trimmed.toLowerCase().split(/\s+/).filter(Boolean),
  };
}

function scoreCommand(command: SearchableCommand, tokens: string[], scoped: boolean): number {
  const label = command.label.toLowerCase();
  const hint = (command.hint ?? '').toLowerCase();
  const keywords = (command.keywords ?? []).join(' ').toLowerCase();
  const haystack = `${label} ${command.category.toLowerCase()} ${hint} ${keywords}`.trim();
  let score = scoped ? 25 : 0;

  for (const token of tokens) {
    if (label === token) {
      score += 120;
    } else if (label.startsWith(token)) {
      score += 100;
    } else if (label.includes(token)) {
      score += 70;
    } else if (hint.startsWith(token)) {
      score += 50;
    } else {
      score += 30;
    }

    const idx = haystack.indexOf(token);
    if (idx >= 0) {
      score += Math.max(0, 20 - idx);
    }
  }

  return score;
}

export function filterCommands<T extends SearchableCommand>(commands: T[], query: string): T[] {
  const parsed = parseQuery(query);
  if (!parsed.scopeCategory && parsed.tokens.length === 0) {
    return commands;
  }

  const scoped = parsed.scopeCategory !== undefined;
  const ranked: Array<{ command: T; score: number }> = [];

  for (const command of commands) {
    if (parsed.scopeCategory && command.category !== parsed.scopeCategory) {
      continue;
    }

    const haystack = [
      command.label,
      command.category,
      command.hint ?? '',
      ...(command.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();

    if (parsed.tokens.some((token) => !haystack.includes(token))) {
      continue;
    }

    ranked.push({
      command,
      score: scoreCommand(command, parsed.tokens, scoped),
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.command.category.localeCompare(b.command.category) || a.command.label.localeCompare(b.command.label));
  return ranked.map((item) => item.command);
}
