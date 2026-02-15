import { useCallback, useRef, useState, useEffect } from 'react';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useUI, vfsStore } from '../../stores/use-stores';
import { EditorToolbar } from './EditorToolbar';
import { validateAgentContent } from '../../utils/agent-validator';

export function AgentEditor() {
  const editingFilePath = useUI((s) => s.editingFilePath);
  const setEditorDirty = useUI((s) => s.setEditorDirty);
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [content, setContent] = useState('');
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Define Catppuccin-inspired theme
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
        'editor.lineHighlightBackground': '#313244',
        'editor.selectionBackground': '#45475a',
        'editorCursor.foreground': '#f5e0dc',
        'editorGutter.background': '#181825',
      },
    });
    monaco.editor.setTheme('catppuccin-mocha');

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e2e' }}>
      <EditorToolbar content={content} onContentChange={handleToolbarContentChange} />
      <div style={{ flex: 1 }}>
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
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6c7086',
            fontSize: 14,
          }}>
            Select a file from the workspace or create a new agent from a template.
          </div>
        )}
      </div>
    </div>
  );
}
