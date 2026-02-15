import { useCallback } from 'react';
import { useVFS, useAgentRegistry, useUI, vfsStore, agentRegistry } from '../../stores/use-stores';

export function WorkspaceExplorer() {
  const allPaths = useVFS((s) => [...s.files.keys()].sort());
  const agents = useAgentRegistry((s) => s.agents);
  const selectedFile = useUI((s) => s.selectedFilePath);
  const setSelectedFile = useUI((s) => s.setSelectedFile);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);

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
  };

  return (
    <div
      style={{ height: '100%', background: '#1e1e2e', color: '#cdd6f4', padding: 8, overflow: 'auto' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', opacity: 0.5 }}>
        Workspace
      </div>

      {allPaths.length === 0 && (
        <div style={{
          border: '2px dashed #45475a',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          fontSize: 12,
          opacity: 0.5,
        }}>
          Drop .md files here to get started
        </div>
      )}

      {[...groups.entries()].map(([prefix, paths]) => (
        <div key={prefix} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#89b4fa', marginBottom: 2 }}>{prefix}</div>
          {paths.map((path) => {
            const filename = path.split('/').pop() ?? path;
            const isAgent = path.startsWith('agents/');
            const isSelected = path === selectedFile;
            const agentStatus = isAgent && agents.has(path) ? 'idle' : undefined;

            return (
              <div
                key={path}
                onClick={() => handleClick(path)}
                style={{
                  padding: '2px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: isSelected ? '#313244' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isAgent && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: agentStatus === 'idle' ? '#6c7086' : '#a6e3a1',
                    display: 'inline-block',
                  }} />
                )}
                {filename}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
