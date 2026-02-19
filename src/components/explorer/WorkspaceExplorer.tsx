import { useCallback, useMemo } from 'react';
import { useVFS, useAgentRegistry, useUI, vfsStore, agentRegistry } from '../../stores/use-stores';
import styles from './WorkspaceExplorer.module.css';

export function WorkspaceExplorer() {
  const filesMap = useVFS((s) => s.files);
  const allPaths = useMemo(() => [...filesMap.keys()].sort(), [filesMap]);
  const agents = useAgentRegistry((s) => s.agents);
  const selectedFile = useUI((s) => s.selectedFilePath);
  const setSelectedFile = useUI((s) => s.setSelectedFile);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);
  const openFileInEditor = useUI((s) => s.openFileInEditor);
  const editingFilePath = useUI((s) => s.editingFilePath);

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
            const agentStatus = isAgent && agents.has(path) ? 'idle' : undefined;

            return (
              <div
                key={path}
                onClick={() => handleClick(path)}
                className={`${styles.fileItem}${isSelected ? ` ${styles.selected}` : ''}`}
              >
                {isAgent && (
                  <span
                    className={styles.agentDot}
                    style={{ background: agentStatus === 'idle' ? '#6c7086' : '#a6e3a1' }}
                  />
                )}
                <span className={styles.fileName}>{filename}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
