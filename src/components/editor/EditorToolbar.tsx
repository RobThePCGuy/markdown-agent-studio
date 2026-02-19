import { useState, useCallback } from 'react';
import { useUI, useVFS, vfsStore, agentRegistry } from '../../stores/use-stores';
import { TemplatePicker } from './TemplatePicker';
import type { AgentTemplate } from '../../utils/agent-templates';

interface EditorToolbarProps {
  content: string;
  onContentChange: (content: string, path: string) => void;
}

export function EditorToolbar({ content, onContentChange }: EditorToolbarProps) {
  const editingFilePath = useUI((s) => s.editingFilePath);
  const editorDirty = useUI((s) => s.editorDirty);
  const setEditingFile = useUI((s) => s.setEditingFile);
  const setEditorDirty = useUI((s) => s.setEditorDirty);
  const filesMap = useVFS((s) => s.files);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');

  const handleSave = useCallback(() => {
    if (!editingFilePath) return;
    vfsStore.getState().write(editingFilePath, content, {});
    if (editingFilePath.startsWith('agents/')) {
      agentRegistry.getState().registerFromFile(editingFilePath, content);
    }
    setEditorDirty(false);
  }, [editingFilePath, content, setEditorDirty]);

  const handleSaveAsTemplate = useCallback(() => {
    const name = window.prompt('Template name:');
    if (!name) return;
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const templatePath = `templates/${safeName}.md`;
    vfsStore.getState().write(templatePath, content, {});
  }, [content]);

  const handleTemplateSelect = useCallback((template: AgentTemplate) => {
    if (editorDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    const existing = [...filesMap.keys()].filter((p) => p.match(/^agents\/untitled-\d+\.md$/));
    const nextNum = existing.length + 1;
    const newPath = `agents/untitled-${nextNum}.md`;
    // Write to VFS first so the editor useEffect finds content when editingFilePath changes
    vfsStore.getState().write(newPath, template.content, {});
    agentRegistry.getState().registerFromFile(newPath, template.content);
    onContentChange(template.content, newPath);
    setEditingFile(newPath);
    setEditorDirty(false);
  }, [editorDirty, onContentChange, setEditingFile, setEditorDirty, filesMap]);

  const handlePathSubmit = useCallback(() => {
    if (!pathInput.trim() || !editingFilePath) return;
    const oldPath = editingFilePath;
    const newPath = pathInput.trim();

    // Move content to new path
    vfsStore.getState().write(newPath, content, {});
    if (newPath.startsWith('agents/')) {
      agentRegistry.getState().registerFromFile(newPath, content);
    }
    // Delete old path if it was different and existed
    if (oldPath !== newPath && vfsStore.getState().exists(oldPath)) {
      vfsStore.getState().deleteFile(oldPath);
      if (oldPath.startsWith('agents/')) {
        agentRegistry.getState().unregister(oldPath);
      }
    }
    setEditingFile(newPath);
    setEditingPath(false);
  }, [pathInput, editingFilePath, content, setEditingFile]);

  // Check if file was modified externally
  const vfsContent = editingFilePath ? filesMap.get(editingFilePath)?.content : null;
  const externallyModified = editingFilePath && vfsContent !== null && vfsContent !== undefined && vfsContent !== content && !editorDirty;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 8px',
      borderBottom: '1px solid #313244',
      background: '#181825',
      fontSize: 12,
      color: '#cdd6f4',
      flexWrap: 'wrap',
    }}>
      <TemplatePicker onSelect={handleTemplateSelect} />

      {editingFilePath && (
        <>
          {editingPath ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handlePathSubmit(); }}
              style={{ display: 'flex', gap: 4 }}
            >
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                autoFocus
                style={{
                  background: '#313244',
                  color: '#cdd6f4',
                  border: '1px solid #89b4fa',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 12,
                  width: 200,
                }}
              />
              <button type="submit" style={smallBtnStyle('#a6e3a1', '#1e1e2e')}>OK</button>
              <button type="button" onClick={() => setEditingPath(false)} style={smallBtnStyle('#6c7086', '#cdd6f4')}>Cancel</button>
            </form>
          ) : (
            <span
              onClick={() => { setPathInput(editingFilePath); setEditingPath(true); }}
              style={{ cursor: 'pointer', color: '#89b4fa', fontFamily: 'monospace', fontSize: 11 }}
              title="Click to rename/move"
            >
              {editingFilePath}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {editorDirty && <span style={{ color: '#fab387', fontSize: 11 }}>Unsaved</span>}

          <button onClick={handleSave} style={smallBtnStyle('#a6e3a1', '#1e1e2e')}>
            Save
          </button>
          <button onClick={handleSaveAsTemplate} style={smallBtnStyle('#6c7086', '#cdd6f4')}>
            Save as Template
          </button>
        </>
      )}

      {!editingFilePath && (
        <span style={{ color: '#6c7086', fontStyle: 'italic' }}>
          Select a file or pick a template to start editing
        </span>
      )}

      {externallyModified && (
        <div style={{
          width: '100%',
          background: '#fab387',
          color: '#1e1e2e',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 4,
        }}>
          File changed externally.
          <button
            onClick={() => {
              if (vfsContent) onContentChange(vfsContent, editingFilePath!);
            }}
            style={{ background: '#1e1e2e', color: '#fab387', border: 'none', borderRadius: 3, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

function smallBtnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
