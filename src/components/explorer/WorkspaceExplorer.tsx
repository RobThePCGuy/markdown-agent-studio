import { useCallback, useMemo, useState, useEffect } from 'react';
import { useVFS, useAgentRegistry, useUI, useSessionStore, vfsStore, agentRegistry, eventLogStore } from '../../stores/use-stores';
import { duplicatePath, ensureUniquePath, nextSequentialPath } from '../../utils/path-naming';
import { computeVisiblePaths, formatRelativeAge, type ExplorerSortMode } from '../../utils/workspace-explorer';
import { runController } from '../../core/run-controller';
import styles from './WorkspaceExplorer.module.css';

type ExplorerKindFilter = 'agent' | 'artifact' | 'memory' | 'workflow' | 'unknown';

const KIND_FILTER_TOGGLES: Array<{ key: ExplorerKindFilter; label: string }> = [
  { key: 'agent', label: 'Agent' },
  { key: 'artifact', label: 'Artifact' },
  { key: 'memory', label: 'Memory' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'unknown', label: 'Other' },
];

export function WorkspaceExplorer() {
  const filesMap = useVFS((s) => s.files);
  const allPaths = useMemo(() => [...filesMap.keys()], [filesMap]);
  const agents = useAgentRegistry((s) => s.agents);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const selectedFile = useUI((s) => s.selectedFilePath);
  const setSelectedFile = useUI((s) => s.setSelectedFile);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);
  const openFileInEditor = useUI((s) => s.openFileInEditor);
  const editingFilePath = useUI((s) => s.editingFilePath);
  const editorDirty = useUI((s) => s.editorDirty);
  const setEditingFile = useUI((s) => s.setEditingFile);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortMode, setSortMode] = useState<ExplorerSortMode>('name');
  const [kindFilters, setKindFilters] = useState<Record<ExplorerKindFilter, boolean>>({
    agent: true,
    artifact: true,
    memory: true,
    workflow: true,
    unknown: true,
  });
  const explorerFiles = useMemo(
    () =>
      new Map(
        [...filesMap.entries()].map(([path, file]) => [
          path,
          { path, kind: file.kind, updatedAt: file.updatedAt },
        ]),
      ),
    [filesMap],
  );
  const selectedKindFilters = useMemo(() => {
    const next = new Set<ExplorerKindFilter>();
    for (const key of Object.keys(kindFilters) as ExplorerKindFilter[]) {
      if (kindFilters[key]) next.add(key);
    }
    return next;
  }, [kindFilters]);

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const hasAgent = content.trimStart().startsWith('---');
        const desiredPath = hasAgent ? `agents/${file.name}` : `artifacts/${file.name}`;
        const path = ensureUniquePath(desiredPath, vfsStore.getState().getAllPaths());
        vfsStore.getState().write(path, content, {});
        if (path.startsWith('agents/')) {
          agentRegistry.getState().registerFromFile(path, content);
        }
      };
      reader.readAsText(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const visiblePaths = useMemo(() => {
    return computeVisiblePaths(explorerFiles, filterQuery.trim(), selectedKindFilters, sortMode);
  }, [explorerFiles, filterQuery, selectedKindFilters, sortMode]);

  const groups = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const path of visiblePaths) {
      const slash = path.indexOf('/');
      const prefix = slash !== -1 ? path.slice(0, slash + 1) : '/';
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix)!.push(path);
    }
    return grouped;
  }, [visiblePaths]);

  const toggleKindFilter = useCallback((kind: ExplorerKindFilter) => {
    setKindFilters((current) => ({ ...current, [kind]: !current[kind] }));
  }, []);

  const handleClick = (path: string) => {
    if (path.startsWith('agents/')) {
      setSelectedAgent(path);
    } else {
      setSelectedFile(path);
    }
    openFileInEditor(path);
  };

  const createAgentFile = useCallback(() => {
    const path = nextSequentialPath('agents/untitled', '.md', vfsStore.getState().getAllPaths());
    const content = '---\nname: "Untitled Agent"\n---\n\nDescribe this agent\'s behavior here.';
    vfsStore.getState().write(path, content, {});
    agentRegistry.getState().registerFromFile(path, content);
    setSelectedAgent(path);
    openFileInEditor(path);
  }, [openFileInEditor, setSelectedAgent]);

  const createNoteFile = useCallback(() => {
    const path = nextSequentialPath('artifacts/note', '.md', vfsStore.getState().getAllPaths());
    const content = '# Notes\n\n';
    vfsStore.getState().write(path, content, {});
    setSelectedFile(path);
    openFileInEditor(path);
  }, [openFileInEditor, setSelectedFile]);

  const createWorkflowFile = useCallback(() => {
    const path = nextSequentialPath('workflows/untitled', '.md', vfsStore.getState().getAllPaths());
    const content = [
      '---',
      'name: "Untitled Workflow"',
      'description: ""',
      'trigger: manual',
      'steps:',
      '  - id: step1',
      '    agent: agents/your-agent.md',
      '    prompt: "Your prompt here"',
      '    depends_on: []',
      '    outputs: [result]',
      '---',
    ].join('\n');
    vfsStore.getState().write(path, content, {});
    setSelectedFile(path);
    openFileInEditor(path);
  }, [openFileInEditor, setSelectedFile]);

  return (
    <div
      className={styles.container}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className={styles.heading}>
        Workspace
        <button
          onClick={createAgentFile}
          className={styles.newFileBtn}
          title="New agent file"
        >
          +A
        </button>
        <button
          onClick={createNoteFile}
          className={styles.newFileBtn}
          title="New note file"
        >
          +N
        </button>
        <button
          onClick={createWorkflowFile}
          className={styles.newFileBtn}
          title="New workflow file"
        >
          +W
        </button>
      </div>

      <input
        type="text"
        value={filterQuery}
        onChange={(e) => setFilterQuery(e.target.value)}
        placeholder="Filter files..."
        className={styles.searchInput}
      />

      <div className={styles.controls}>
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Kinds</span>
          <div className={styles.toggleGroup}>
            {KIND_FILTER_TOGGLES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={styles.toggleButton}
                aria-pressed={kindFilters[key]}
                onClick={() => toggleKindFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Sort</span>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={styles.toggleButton}
              aria-pressed={sortMode === 'name'}
              onClick={() => setSortMode('name')}
            >
              Name
            </button>
            <button
              type="button"
              className={styles.toggleButton}
              aria-pressed={sortMode === 'recent'}
              onClick={() => setSortMode('recent')}
            >
              Recent
            </button>
          </div>
        </div>
      </div>

      {allPaths.length === 0 && (
        <div className={styles.emptyDrop}>
          Drop .md files here to get started
        </div>
      )}

      {allPaths.length > 0 && visiblePaths.length === 0 && (
        <div className={styles.emptyDrop}>
          {filterQuery.trim() ? `No files match "${filterQuery.trim()}"` : 'No files match current filters'}
        </div>
      )}

      {[...groups.entries()].map(([prefix, paths]) => (
        <div key={prefix} className={styles.group}>
          <div className={styles.groupHeader}>{prefix}</div>
          {paths.map((path) => {
            const file = filesMap.get(path);
            const filename = path.split('/').pop() ?? path;
            const isAgent = path.startsWith('agents/');
            const isSelected = path === selectedFile || path === selectedAgentId || path === editingFilePath;
            const isUnsaved = path === editingFilePath && editorDirty;
            const updatedAtText = file ? formatRelativeAge(Date.now(), file.updatedAt) : '';

            let agentStatus: 'running' | 'paused' | 'error' | 'idle' | undefined;
            if (isAgent && agents.has(path)) {
              agentStatus = 'idle';
              for (const session of sessions.values()) {
                if (session.agentId === path) {
                  if (session.status === 'running') { agentStatus = 'running'; break; }
                  if (session.status === 'paused') agentStatus = 'paused';
                  else if (session.status === 'error' && agentStatus !== 'paused') agentStatus = 'error';
                }
              }
            }

            return (
              <div
                key={path}
                onClick={() => handleClick(path)}
                onContextMenu={(e) => handleContextMenu(e, path)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(path); } }}
                className={`${styles.fileItem}${isSelected ? ` ${styles.selected}` : ''}`}
              >
                {isAgent && (
                  <span
                    className={`${styles.agentDot}${agentStatus === 'running' ? ` ${styles.running}` : ''}`}
                    style={{
                      background:
                        agentStatus === 'running' ? 'var(--status-green)' :
                        agentStatus === 'paused' ? 'var(--status-orange)' :
                        agentStatus === 'error' ? 'var(--status-red)' :
                        'var(--text-dim)',
                    }}
                  />
                )}
                <span className={styles.fileName}>{filename}</span>
                <span className={styles.fileMeta}>
                  {isUnsaved && <span className={styles.unsavedMarker}>Unsaved</span>}
                  {updatedAtText && <span className={styles.updatedAt}>{updatedAtText}</span>}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              const oldPath = contextMenu.path;
              const oldName = oldPath.split('/').pop() ?? '';
              const enteredName = window.prompt('New name:', oldName);
              const newName = enteredName?.trim();
              if (newName && newName !== oldName) {
                const prefix = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/') + 1) : '';
                const normalizedName = newName.endsWith('.md') ? newName : `${newName}.md`;
                const desiredPath = `${prefix}${normalizedName}`;
                const newPath = ensureUniquePath(
                  desiredPath,
                  vfsStore.getState().getAllPaths().filter((p) => p !== oldPath),
                );
                if (newPath === oldPath) {
                  setContextMenu(null);
                  return;
                }
                const content = vfsStore.getState().read(oldPath);
                if (content !== undefined && content !== null) {
                  vfsStore.getState().write(newPath, content, {});
                  vfsStore.getState().deleteFile(oldPath);

                  if (newPath.startsWith('agents/')) {
                    agentRegistry.getState().registerFromFile(newPath, content);
                  }
                  if (oldPath.startsWith('agents/')) {
                    agentRegistry.getState().unregister(oldPath);
                  }

                  if (selectedFile === oldPath) setSelectedFile(newPath);
                  if (selectedAgentId === oldPath) setSelectedAgent(newPath);
                  if (editingFilePath === oldPath) setEditingFile(newPath);
                }
              }
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              const content = vfsStore.getState().read(contextMenu.path);
              if (content !== undefined && content !== null) {
                const newPath = duplicatePath(contextMenu.path, vfsStore.getState().getAllPaths());
                vfsStore.getState().write(newPath, content, {});
                if (newPath.startsWith('agents/')) agentRegistry.getState().registerFromFile(newPath, content);
              }
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          {contextMenu.path.startsWith('workflows/') && (
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                runController.runWorkflow(contextMenu.path);
                setContextMenu(null);
              }}
            >
              Run Workflow
            </button>
          )}
          {contextMenu.path.startsWith('workflows/') && (() => {
            const entries = eventLogStore.getState().entries;
            let hasFailedRun = false;
            for (let i = entries.length - 1; i >= 0; i--) {
              const e = entries[i];
              if (e.type === 'workflow_complete' && e.data.workflowPath === contextMenu.path && e.data.status === 'failed') {
                hasFailedRun = true;
                break;
              }
            }
            return hasFailedRun ? (
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  runController.resumeWorkflow(contextMenu.path);
                  setContextMenu(null);
                }}
              >
                Resume Workflow
              </button>
            ) : null;
          })()}
          <button
            className={`${styles.contextMenuItem} ${styles.danger}`}
            onClick={() => {
              if (window.confirm(`Delete ${contextMenu.path}?`)) {
                const path = contextMenu.path;
                vfsStore.getState().deleteFile(path);
                if (path.startsWith('agents/')) agentRegistry.getState().unregister(path);
                if (selectedFile === path) setSelectedFile(null);
                if (selectedAgentId === path) setSelectedAgent(null);
                if (editingFilePath === path) setEditingFile(null);
              }
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
