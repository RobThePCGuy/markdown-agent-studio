import type { FileKind } from '../types';

export function deriveKind(path: string): FileKind {
  if (path.startsWith('agents/')) return 'agent';
  if (path.startsWith('memory/')) return 'memory';
  if (path.startsWith('artifacts/')) return 'artifact';
  return 'unknown';
}

export function computeHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export function findSimilarPaths(target: string, existingPaths: string[], maxResults = 3): string[] {
  const scored = existingPaths.map(p => ({
    path: p,
    score: levenshtein(target.toLowerCase(), p.toLowerCase()),
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, maxResults).map(s => s.path);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function computeLineDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) return '';
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined && newLine === undefined) {
      result.push(`-${oldLine}`);
    } else if (oldLine === undefined && newLine !== undefined) {
      result.push(`+${newLine}`);
    } else if (oldLine !== newLine) {
      result.push(`-${oldLine}`);
      result.push(`+${newLine}`);
    }
  }
  return result.join('\n');
}
