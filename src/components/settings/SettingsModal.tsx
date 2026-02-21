import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUI, uiStore, vfsStore, agentRegistry, eventLogStore, sessionStore } from '../../stores/use-stores';
import { MemoryManager } from '../../core/memory-manager';
import { createMemoryDB } from '../../core/memory-db';
import { loadSampleProject } from '../../core/sample-project';
import styles from './SettingsModal.module.css';

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------

export default function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const apiKey = useUI((s) => s.apiKey);
  const kernelConfig = useUI(useShallow((s) => s.kernelConfig));

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

  // Reset local state when modal opens (render-time state adjustment)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setShowKey(false);
      setClearConfirm('');
    }
  }

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

  const model = kernelConfig.model ?? 'gemini-3-flash-preview';

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Settings</h2>
          <button
            onClick={close}
            className={styles.closeBtn}
            aria-label="Close settings"
          >
            x
          </button>
        </div>

        {/* Section 1: API Configuration */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>API Configuration</h3>

          <label className={styles.label}>
            <span className={styles.labelText}>API Key</span>
            <div className={styles.inputRow}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => uiStore.getState().setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className={`${styles.input} ${styles.flexGrow}`}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className={styles.showKeyBtn}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Model</span>
            <select
              value={model}
              onChange={(e) => uiStore.getState().setKernelConfig({ model: e.target.value })}
              className={styles.select}
            >
              <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
              <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            </select>
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section 2: Kernel Limits */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Kernel Limits</h3>

          <label className={styles.label}>
            <span className={styles.labelText}>Max Concurrency</span>
            <input
              type="number"
              min={1}
              max={10}
              value={kernelConfig.maxConcurrency}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxConcurrency: Number(e.target.value) })}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Max Depth</span>
            <input
              type="number"
              min={1}
              max={20}
              value={kernelConfig.maxDepth}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxDepth: Number(e.target.value) })}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Max Fanout</span>
            <input
              type="number"
              min={1}
              max={20}
              value={kernelConfig.maxFanout}
              onChange={(e) => uiStore.getState().setKernelConfig({ maxFanout: Number(e.target.value) })}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Token Budget</span>
            <input
              type="number"
              min={50000}
              step={50000}
              value={kernelConfig.tokenBudget}
              onChange={(e) => uiStore.getState().setKernelConfig({ tokenBudget: Number(e.target.value) })}
              className={styles.input}
            />
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section 3: Memory System */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Memory System</h3>

          <label className={styles.label}>
            <span className={styles.labelText}>Enable Memory</span>
            <select
              value={kernelConfig.memoryEnabled !== false ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  memoryEnabled: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Memory Token Budget</span>
            <input
              type="number"
              min={500}
              max={8000}
              step={500}
              value={kernelConfig.memoryTokenBudget ?? 2000}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  memoryTokenBudget: Number(e.target.value),
                })
              }
              className={styles.input}
            />
          </label>

          <button
            onClick={async () => {
              const db = createMemoryDB();
              const mgr = new MemoryManager(db);
              await mgr.clearAll();
            }}
            className={styles.dangerBtn}
            style={{ marginTop: 8 }}
          >
            Clear All Memories
          </button>
        </div>

        <hr className={styles.divider} />

        {/* Section 4: Danger Zone */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Danger Zone</h3>

          <button
            onClick={() => {
              handleClearWorkspace();
              loadSampleProject(vfsStore, agentRegistry);
            }}
            className={styles.outlineBtn}
            style={{ marginBottom: 8 }}
          >
            Reset to Sample Project
          </button>

          <div className={styles.dangerZone}>
            <p className={styles.dangerText}>
              This will clear all files, agents, and event logs from the workspace. This action cannot be undone.
            </p>

            <label className={styles.label}>
              <span className={styles.labelText}>Type "CLEAR" to confirm</span>
              <input
                type="text"
                placeholder='Type "CLEAR" to confirm'
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                className={styles.input}
              />
            </label>

            <button
              disabled={clearConfirm !== 'CLEAR'}
              onClick={handleClearWorkspace}
              className={styles.dangerBtn}
            >
              Clear Workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
