export type ExplorerSortMode = 'name' | 'recent';

export interface WorkspaceExplorerFile {
  path: string;
  kind: 'agent' | 'memory' | 'artifact' | 'workflow' | 'unknown';
  updatedAt: number;
}

export function computeVisiblePaths(
  files: Map<string, WorkspaceExplorerFile>,
  query: string,
  kindFilters: Set<'agent' | 'memory' | 'artifact' | 'workflow' | 'unknown'>,
  sortMode: ExplorerSortMode,
): string[] {
  if (kindFilters.size === 0) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const visibleFiles: WorkspaceExplorerFile[] = [];

  for (const file of files.values()) {
    if (!kindFilters.has(file.kind)) {
      continue;
    }

    if (!file.path.toLowerCase().includes(normalizedQuery)) {
      continue;
    }

    visibleFiles.push(file);
  }

  if (sortMode === 'recent') {
    visibleFiles.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
  } else {
    visibleFiles.sort((a, b) => a.path.localeCompare(b.path));
  }

  return visibleFiles.map((file) => file.path);
}

export function formatRelativeAge(nowMs: number, updatedAtMs: number): string {
  const elapsedMs = Math.max(0, nowMs - updatedAtMs);

  if (elapsedMs < 10_000) {
    return 'now';
  }

  if (elapsedMs < 60_000) {
    return `${Math.floor(elapsedMs / 1_000)}s`;
  }

  if (elapsedMs < 3_600_000) {
    return `${Math.floor(elapsedMs / 60_000)}m`;
  }

  if (elapsedMs < 86_400_000) {
    return `${Math.floor(elapsedMs / 3_600_000)}h`;
  }

  return `${Math.floor(elapsedMs / 86_400_000)}d`;
}
