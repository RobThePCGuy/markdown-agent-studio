import { describe, it, expect } from 'vitest';
import {
  computeVisiblePaths,
  formatRelativeAge,
  type WorkspaceExplorerFile,
} from './workspace-explorer';

const allKinds = new Set<'agent' | 'memory' | 'artifact' | 'unknown'>([
  'agent',
  'memory',
  'artifact',
  'unknown',
]);

function buildFiles(entries: WorkspaceExplorerFile[]): Map<string, WorkspaceExplorerFile> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

describe('computeVisiblePaths', () => {
  const files = buildFiles([
    { path: 'agents/researcher.md', kind: 'agent', updatedAt: 1_000 },
    { path: 'memory/session-notes.md', kind: 'memory', updatedAt: 5_000 },
    { path: 'artifacts/report.md', kind: 'artifact', updatedAt: 8_000 },
    { path: 'unknown/readme.md', kind: 'unknown', updatedAt: 2_000 },
  ]);

  it('applies case-insensitive query substring filtering', () => {
    const result = computeVisiblePaths(files, 'REPORT', allKinds, 'name');
    expect(result).toEqual(['artifacts/report.md']);
  });

  it('filters by selected kinds', () => {
    const filters = new Set<'agent' | 'memory' | 'artifact' | 'unknown'>(['artifact', 'unknown']);
    const result = computeVisiblePaths(files, '', filters, 'name');
    expect(result).toEqual(['artifacts/report.md', 'unknown/readme.md']);
  });

  it('sorts by path ascending when sort mode is name', () => {
    const result = computeVisiblePaths(files, '', allKinds, 'name');
    expect(result).toEqual([
      'agents/researcher.md',
      'artifacts/report.md',
      'memory/session-notes.md',
      'unknown/readme.md',
    ]);
  });

  it('sorts by recent first and path for tie-breaks when sort mode is recent', () => {
    const recentFiles = buildFiles([
      { path: 'c/old.md', kind: 'agent', updatedAt: 10 },
      { path: 'a/newest-a.md', kind: 'memory', updatedAt: 30 },
      { path: 'b/newest-b.md', kind: 'artifact', updatedAt: 30 },
    ]);

    const result = computeVisiblePaths(recentFiles, '', allKinds, 'recent');
    expect(result).toEqual(['a/newest-a.md', 'b/newest-b.md', 'c/old.md']);
  });

  it('returns empty list when kind filters are empty', () => {
    const result = computeVisiblePaths(files, '', new Set(), 'name');
    expect(result).toEqual([]);
  });
});

describe('formatRelativeAge', () => {
  it('formats time across boundaries', () => {
    const now = 1_000_000;

    expect(formatRelativeAge(now, now - 9_999)).toBe('now');
    expect(formatRelativeAge(now, now - 10_000)).toBe('10s');
    expect(formatRelativeAge(now, now - 59_999)).toBe('59s');
    expect(formatRelativeAge(now, now - 60_000)).toBe('1m');
    expect(formatRelativeAge(now, now - 3_599_999)).toBe('59m');
    expect(formatRelativeAge(now, now - 3_600_000)).toBe('1h');
    expect(formatRelativeAge(now, now - 86_399_999)).toBe('23h');
    expect(formatRelativeAge(now, now - 86_400_000)).toBe('1d');
  });
});
