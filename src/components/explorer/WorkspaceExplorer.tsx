import { useCallback, useMemo, useState, useEffect } from 'react';
import { useVFS, useAgentRegistry, useUI, useSessionStore, vfsStore, agentRegistry } from '../../stores/use-stores';
import styles from './WorkspaceExplorer.module.css';

export function WorkspaceExplorer() {
  const filesMap = useVFS((s) => s.files);
  const allPaths = useMemo(() => [...filesMap.keys()].sort(), [filesMap]);
  const agents = useAgentRegistry((s) => s.agents);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedFile = useUI((s) => s.selectedFilePath);
  const setSelectedFile = useUI((s) => s.setSelectedFile);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);
  const openFileInEditor = useUI((s) => s.openFileInEditor);
  const editingFilePath = useUI((s) => s.editingFilePath);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

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
        const path = hasAgent ? `agents/${file.name}` : `artifacts/${file.name}`;
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

  const groups = new Map<string, string[]>();
  for (const path of allPaths) {
    const slash = path.indexOf('/');
    const prefix = slash !== -1 ? path.slice(0, slash + 1) : '/';
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(path);
  }

  const handleClick = (path: string) => {
    if (path.startsWith('agents/')) {
      setSelectedAgent(path);
    } else {
      setSelectedFile(path);
    }
    openFileInEditor(path);
  };

  return (
    <div
      className={styles.container}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className={styles.heading}>
        Workspace
        <button
          onClick={() => {
            const existing = allPaths.filter(p => p.startsWith('agents/untitled'));
            const n = existing.length + 1;
            const path = `agents/untitled-${n}.md`;
            const content = '---\nname: "Untitled Agent"\n---\n\nDescribe this agent\'s behavior here.';
            vfsStore.getState().write(path, content, {});
            agentRegistry.getState().registerFromFile(path, content);
            openFileInEditor(path);
          }}
          className={styles.newFileBtn}
          title="New agent file"
        >
          +
        </button>
      </div>

      {allPaths.length === 0 && (
        <div className={styles.emptyDrop}>
          Drop .md files here to get started
        </div>
      )}

      {[...groups.entries()].map(([prefix, paths]) => (
        <div key={prefix} className={styles.group}>
          <div className={styles.groupHeader}>{prefix}</div>
          {paths.map((path) => {
            const filename = path.split('/').pop() ?? path;
            const isAgent = path.startsWith('agents/');
            const isSelected = path === selectedFile || path === editingFilePath;

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
              const oldName = contextMenu.path.split('/').pop() ?? '';
              const newName = window.prompt('New name:', oldName);
              if (newName && newName !== oldName) {
                const prefix = contextMenu.path.includes('/') ? contextMenu.path.slice(0, contextMenu.path.lastIndexOf('/') + 1) : '';
                const newPath = prefix + newName;
                const content = vfsStore.getState().read(contextMenu.path);
                if (content !== undefined && content !== null) {
                  vfsStore.getState().write(newPath, content, {});
                  vfsStore.getState().deleteFile(contextMenu.path);
                  if (newPath.startsWith('agents/')) agentRegistry.getState().registerFromFile(newPath, content);
                  if (contextMenu.path.startsWith('agents/')) agentRegistry.getState().unregister(contextMenu.path);
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
                const newPath = contextMenu.path.replace(/\.md$/, '-copy.md');
                vfsStore.getState().write(newPath, content, {});
                if (newPath.startsWith('agents/')) agentRegistry.getState().registerFromFile(newPath, content);
              }
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          <button
            className={`${styles.contextMenuItem} ${styles.danger}`}
            onClick={() => {
              if (window.confirm(`Delete ${contextMenu.path}?`)) {
                vfsStore.getState().deleteFile(contextMenu.path);
                if (contextMenu.path.startsWith('agents/')) agentRegistry.getState().unregister(contextMenu.path);
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
