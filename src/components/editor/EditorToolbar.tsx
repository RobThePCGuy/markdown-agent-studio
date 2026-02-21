import { useState, useCallback } from 'react';
import { useUI, useVFS, vfsStore, agentRegistry } from '../../stores/use-stores';
import { TemplatePicker } from './TemplatePicker';
import type { AgentTemplate } from '../../utils/agent-templates';
import styles from './EditorToolbar.module.css';

interface EditorToolbarProps {
  content: string;
  onContentChange: (content: string) => void;
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
    onContentChange(template.content);
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
    <div className={styles.toolbar}>
      <TemplatePicker onSelect={handleTemplateSelect} />

      {editingFilePath && (
        <>
          {editingPath ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handlePathSubmit(); }}
              className={styles.formRow}
            >
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                autoFocus
                className={styles.pathInput}
              />
              <button type="submit" className={`${styles.ghostBtn} ${styles.primary}`}>OK</button>
              <button type="button" onClick={() => setEditingPath(false)} className={styles.ghostBtn}>Cancel</button>
            </form>
          ) : (
            <span
              onClick={() => { setPathInput(editingFilePath); setEditingPath(true); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPathInput(editingFilePath); setEditingPath(true); } }}
              className={styles.filePath}
              title="Click to rename/move"
            >
              {editingFilePath}
            </span>
          )}

          <div className={styles.spacer} />

          {editorDirty && <span className={styles.unsaved}>Unsaved</span>}

          <button onClick={handleSave} className={`${styles.ghostBtn} ${styles.primary}`}>
            Save
          </button>
          <button onClick={handleSaveAsTemplate} className={styles.ghostBtn}>
            Save as Template
          </button>
        </>
      )}

      {!editingFilePath && (
        <span className={styles.hint}>
          Select a file or pick a template to start editing
        </span>
      )}

      {externallyModified && (
        <div className={styles.externalModified}>
          File changed externally.
          <button
            onClick={() => {
              if (vfsContent) onContentChange(vfsContent);
            }}
            className={styles.reloadBtn}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
