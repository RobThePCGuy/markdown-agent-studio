import { useCallback, useRef, useState, useEffect } from 'react';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useUI, uiStore, vfsStore, agentRegistry } from '../../stores/use-stores';
import { EditorToolbar } from './EditorToolbar';
import { validateAgentContent } from '../../utils/agent-validator';
import styles from './AgentEditor.module.css';

let themeRegistered = false;

export function AgentEditor() {
  const editingFilePath = useUI((s) => s.editingFilePath);
  const setEditorDirty = useUI((s) => s.setEditorDirty);
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [content, setContent] = useState('');
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    };
  }, []);

  // Load file content when editingFilePath changes
  useEffect(() => {
    if (!editingFilePath) {
      setContent('');
      return;
    }
    const vfsContent = vfsStore.getState().read(editingFilePath);
    setContent(vfsContent ?? '');
  }, [editingFilePath]);

  const runValidation = useCallback((value: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const isAgent = editingFilePath?.startsWith('agents/') ?? false;
    const diagnostics = validateAgentContent(value, isAgent);

    const markers: monacoEditor.IMarkerData[] = diagnostics.map((d) => ({
      startLineNumber: d.startLine,
      endLineNumber: d.endLine,
      startColumn: d.startCol,
      endColumn: d.endCol,
      message: d.message,
      severity: d.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : d.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
    }));

    monaco.editor.setModelMarkers(model, 'agent-validator', markers);
  }, [editingFilePath]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Define theme once (Monaco themes are global singletons)
    if (!themeRegistered) {
      monaco.editor.defineTheme('catppuccin-mocha', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6c7086' },
          { token: 'keyword', foreground: 'cba6f7' },
          { token: 'string', foreground: 'a6e3a1' },
          { token: 'number', foreground: 'fab387' },
          { token: 'type', foreground: '89b4fa' },
        ],
        colors: {
          'editor.background': '#1e1e2e',
          'editor.foreground': '#cdd6f4',
          'editor.lineHighlightBackground': '#33324a',
          'editor.selectionBackground': '#45475a',
          'editorCursor.foreground': '#e0a650',
          'editorGutter.background': '#181825',
        },
      });
      themeRegistered = true;
    }
    monaco.editor.setTheme('catppuccin-mocha');

    // Ctrl+S / Cmd+S to save
    editor.addAction({
      id: 'agent-editor-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: (ed) => {
        const filePath = uiStore.getState().editingFilePath;
        if (!filePath) return;
        const value = ed.getValue();
        vfsStore.getState().write(filePath, value, {});
        if (filePath.startsWith('agents/')) {
          agentRegistry.getState().registerFromFile(filePath, value);
        }
        uiStore.getState().setEditorDirty(false);
      },
    });

    // Run initial validation
    runValidation(content);
  }, [content, runValidation]);

  const handleContentChange = useCallback((value: string | undefined) => {
    const newContent = value ?? '';
    setContent(newContent);
    setEditorDirty(true);

    // Debounced validation
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    validateTimerRef.current = setTimeout(() => runValidation(newContent), 300);
  }, [setEditorDirty, runValidation]);

  const handleToolbarContentChange = useCallback((newContent: string, _newPath: string) => {
    setContent(newContent);
    // Validation runs after editor mount updates
    setTimeout(() => runValidation(newContent), 50);
  }, [runValidation]);

  return (
    <div className={styles.container}>
      <EditorToolbar content={content} onContentChange={handleToolbarContentChange} />
      <div className={styles.editorArea}>
        {editingFilePath ? (
          <Editor
            height="100%"
            language="markdown"
            value={content}
            onChange={handleContentChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        ) : (
          <div className={styles.emptyState}>
            Select a file from the workspace or create a new agent from a template.
          </div>
        )}
      </div>
    </div>
  );
}
