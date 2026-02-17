import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import { useUI, uiStore, vfsStore, agentRegistry, eventLogStore, sessionStore } from '../../stores/use-stores';

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#89b4fa' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: '#a6adc8' }}>{text}</span>
      {children}
    </label>
  );
}

function Divider() {
  return <hr style={{ border: 'none', borderTop: '1px solid #45475a', margin: '20px 0' }} />;
}

// ---------------------------------------------------------------------------
// Shared input styles
// ---------------------------------------------------------------------------

const inputStyle: CSSProperties = {
  background: '#1e1e2e',
  border: '1px solid #45475a',
  borderRadius: 6,
  color: '#cdd6f4',
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------

export default function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const apiKey = useUI((s) => s.apiKey);
  const kernelConfig = useUI((s) => s.kernelConfig);

  const [showKey, setShowKey] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      uiStore.getState().setSettingsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Reset local state when modal opens
  useEffect(() => {
    if (open) {
      setShowKey(false);
      setClearConfirm('');
    }
  }, [open]);

  if (!open) return null;

  const close = () => uiStore.getState().setSettingsOpen(false);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  const handleClearWorkspace = () => {
    try {
      // VFS store - reset files to empty Map
      vfsStore.setState({ files: new Map() });
    } catch {
      // ignore if unavailable
    }
    try {
      // Agent registry - reset agents to empty Map
      agentRegistry.setState({ agents: new Map() });
    } catch {
      // ignore if unavailable
    }
    try {
      // Event log - has a clear() method
      eventLogStore.getState().clear();
    } catch {
      // ignore if unavailable
    }
    try {
      sessionStore.getState().clearAll();
    } catch {
      // ignore if unavailable
    }
    close();
  };

  const model = kernelConfig.model ?? 'gemini-2.0-flash';

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#313244',
          borderRadius: 12,
          width: 480,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px 28px',
          position: 'relative',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#cdd6f4' }}>Settings</h2>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: '#a6adc8',
              fontSize: 20,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
            aria-label="Close settings"
          >
            x
          </button>
        </div>

        {/* Section 1: API Configuration */}
        <Section title="API Configuration">
          <Label text="API Key">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => uiStore.getState().setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                style={{
                  background: '#1e1e2e',
                  border: '1px solid #45475a',
                  borderRadius: 6,
                  color: '#a6adc8',
                  padding: '8px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Label>

          <Label text="Model">
            <select
              value={model}
              onChange={(e) => uiStore.getState().setKernelConfig({ model: e.target.value })}
              style={selectStyle}
            >
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            </select>
          </Label>
        </Section>

        <Divider />

        {/* Section 2: Kernel Limits */}
        <Section title="Kernel Limits">
          <Label text="Max Concurrency">
            <input
              type="number"
              min={1}
              max={10}
              value={kernelConfig.maxConcurrency}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxConcurrency: Number(e.target.value) })}
              style={inputStyle}
            />
          </Label>

          <Label text="Max Depth">
            <input
              type="number"
              min={1}
              max={20}
              value={kernelConfig.maxDepth}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxDepth: Number(e.target.value) })}
              style={inputStyle}
            />
          </Label>

          <Label text="Max Fanout">
            <input
              type="number"
              min={1}
              max={20}
              value={kernelConfig.maxFanout}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxFanout: Number(e.target.value) })}
              style={inputStyle}
            />
          </Label>

          <Label text="Token Budget">
            <input
              type="number"
              min={50000}
              step={50000}
              value={kernelConfig.tokenBudget}
              onChange={(e) => uiStore.getState().setKernelConfig({ tokenBudget: Number(e.target.value) })}
              style={inputStyle}
            />
          </Label>
        </Section>

        <Divider />

        {/* Section 3: Danger Zone */}
        <Section title="Danger Zone">
          <div
            style={{
              border: '1px solid #f38ba8',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#a6adc8' }}>
              This will clear all files, agents, and event logs from the workspace. This action cannot be undone.
            </p>
            <Label text='Type "CLEAR" to confirm'>
              <input
                type="text"
                placeholder='Type "CLEAR" to confirm'
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                style={inputStyle}
              />
            </Label>
            <button
              disabled={clearConfirm !== 'CLEAR'}
              onClick={handleClearWorkspace}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: clearConfirm === 'CLEAR' ? 'pointer' : 'not-allowed',
                background: clearConfirm === 'CLEAR' ? '#f38ba8' : '#45475a',
                color: clearConfirm === 'CLEAR' ? '#1e1e2e' : '#6c7086',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              Clear Workspace
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
