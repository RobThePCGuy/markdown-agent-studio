import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUI, uiStore, vfsStore, agentRegistry, eventLogStore, sessionStore } from '../../stores/use-stores';
import type { ProviderType } from '../../stores/use-stores';
import { MemoryManager } from '../../core/memory-manager';
import { createMemoryDB } from '../../core/memory-db';
import { loadSampleProject } from '../../core/sample-project';
import { useProviderModels } from '../../hooks/useProviderModels';
import type { MCPServerConfig } from '../../core/mcp-client';
import styles from './SettingsModal.module.css';

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------

export default function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const provider = useUI((s) => s.provider);
  const providerApiKeys = useUI(useShallow((s) => s.providerApiKeys));
  const currentApiKey = providerApiKeys[provider] ?? '';
  const kernelConfig = useUI(useShallow((s) => s.kernelConfig));
  const { models: availableModels, loading: modelsLoading } = useProviderModels(provider, currentApiKey);

  const globalMcpServers = useUI(useShallow((s) => s.globalMcpServers));

  const [showKey, setShowKey] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');
  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpTransport, setMcpTransport] = useState<'http' | 'sse' | 'stdio'>('http');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');


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
      setMcpFormOpen(false);
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

  const model = kernelConfig.model ?? '';

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
            <span className={styles.labelText}>Provider</span>
            <select
              value={provider}
              onChange={(e) => uiStore.getState().setProvider(e.target.value as ProviderType)}
              className={styles.select}
            >
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>API Key</span>
            <div className={styles.inputRow}>
              <input
                type={showKey ? 'text' : 'password'}
                value={currentApiKey}
                onChange={(e) => uiStore.getState().setProviderApiKey(provider, e.target.value)}
                placeholder={`Enter your ${provider === 'gemini' ? 'Gemini' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}
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
            <span className={styles.labelText}>Model{modelsLoading ? ' (loading...)' : ''}</span>
            <select
              value={model}
              onChange={(e) => uiStore.getState().setKernelConfig({ model: e.target.value })}
              className={styles.select}
            >
              <option value="" disabled>Select a model</option>
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section: MCP Servers */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>MCP Servers</h3>

          {globalMcpServers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {globalMcpServers.map((srv) => (
                <div key={srv.name} className={styles.mcpServerRow}>
                  <div className={styles.mcpServerInfo}>
                    <span className={styles.mcpServerName}>{srv.name}</span>
                    <span className={styles.mcpServerBadge}>{srv.transport}</span>
                    <span className={styles.mcpServerUrl}>
                      {srv.transport === 'stdio' ? srv.command : srv.url}
                    </span>
                  </div>
                  <button
                    onClick={() => uiStore.getState().removeMcpServer(srv.name)}
                    className={styles.mcpRemoveBtn}
                    aria-label={`Remove ${srv.name}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {mcpFormOpen ? (
            <div className={styles.mcpForm}>
              <label className={styles.label}>
                <span className={styles.labelText}>Server Name</span>
                <input
                  type="text"
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="my-server"
                  className={styles.input}
                />
              </label>

              <label className={styles.label}>
                <span className={styles.labelText}>Transport</span>
                <select
                  value={mcpTransport}
                  onChange={(e) => setMcpTransport(e.target.value as 'http' | 'sse' | 'stdio')}
                  className={styles.select}
                >
                  <option value="http">HTTP (Streamable)</option>
                  <option value="sse">SSE</option>
                  <option value="stdio">stdio</option>
                </select>
              </label>

              {mcpTransport === 'stdio' ? (
                <>
                  <label className={styles.label}>
                    <span className={styles.labelText}>Command</span>
                    <input
                      type="text"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      placeholder="node"
                      className={styles.input}
                    />
                  </label>
                  <label className={styles.label}>
                    <span className={styles.labelText}>Arguments (space-separated)</span>
                    <input
                      type="text"
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      placeholder="server.js --port 3000"
                      className={styles.input}
                    />
                  </label>
                  <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--status-yellow)' }}>
                    stdio transport is not available in the browser.
                  </p>
                </>
              ) : (
                <label className={styles.label}>
                  <span className={styles.labelText}>URL</span>
                  <input
                    type="text"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    placeholder="http://localhost:3000/mcp"
                    className={styles.input}
                  />
                </label>
              )}

              <div className={styles.inputRow}>
                <button
                  onClick={() => {
                    if (!mcpName.trim()) return;
                    if (globalMcpServers.some((s) => s.name === mcpName.trim())) return;
                    const server: MCPServerConfig = {
                      name: mcpName.trim(),
                      transport: mcpTransport,
                      ...(mcpTransport === 'stdio'
                        ? {
                            command: mcpCommand.trim(),
                            args: mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : [],
                          }
                        : { url: mcpUrl.trim() }),
                    };
                    uiStore.getState().addMcpServer(server);
                    setMcpName('');
                    setMcpUrl('');
                    setMcpCommand('');
                    setMcpArgs('');
                    setMcpFormOpen(false);
                  }}
                  disabled={!mcpName.trim() || globalMcpServers.some((s) => s.name === mcpName.trim())}
                  className={styles.outlineBtn}
                >
                  Save
                </button>
                <button
                  onClick={() => setMcpFormOpen(false)}
                  className={styles.outlineBtn}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setMcpFormOpen(true)}
              className={styles.outlineBtn}
            >
              Add Server
            </button>
          )}
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
              defaultValue={kernelConfig.maxConcurrency}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxConcurrency: v }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Max Depth</span>
            <input
              type="number"
              min={1}
              max={20}
              defaultValue={kernelConfig.maxDepth}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxDepth: v }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Max Fanout</span>
            <input
              type="number"
              min={1}
              max={20}
              defaultValue={kernelConfig.maxFanout}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxFanout: v }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Token Budget</span>
            <input
              type="number"
              min={50000}
              step={50000}
              defaultValue={kernelConfig.tokenBudget}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ tokenBudget: v }); }}
              className={styles.input}
            />
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section: Agent Persistence */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Agent Persistence</h3>

          <label className={styles.label}>
            <span className={styles.labelText}>Min Turns Before Stop</span>
            <input
              type="number"
              min={0}
              max={25}
              defaultValue={kernelConfig.minTurnsBeforeStop ?? 5}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ minTurnsBeforeStop: Math.max(0, Math.min(25, v)) }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Force Reflection</span>
            <select
              value={kernelConfig.forceReflection !== false ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  forceReflection: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Auto-Record Failures</span>
            <select
              value={kernelConfig.autoRecordFailures !== false ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  autoRecordFailures: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
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
            <span className={styles.labelText}>Vector Memory (Semantic Search)</span>
            <select
              className={styles.select}
              value={kernelConfig.useVectorMemory ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  useVectorMemory: e.target.value === 'on',
                })
              }
            >
              <option value="off">Off (JSON-based)</option>
              <option value="on">On (LanceDB + Embeddings)</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Memory Token Budget</span>
            <input
              type="number"
              min={500}
              max={8000}
              step={500}
              defaultValue={kernelConfig.memoryTokenBudget ?? 2000}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ memoryTokenBudget: v }); }}
              className={styles.input}
            />
          </label>

          <button
            onClick={async () => {
              const db = createMemoryDB(vfsStore);
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

        {/* Section 4: Autonomous Mode */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Autonomous Mode</h3>

          <label className={styles.label}>
            <span className={styles.labelText}>Default Max Cycles</span>
            <input
              type="number"
              min={1}
              max={1000}
              defaultValue={kernelConfig.autonomousMaxCycles ?? 10}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (!isNaN(v)) uiStore.getState().setKernelConfig({ autonomousMaxCycles: Math.max(1, Math.min(1000, v)) });
              }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Resume Previous Mission</span>
            <select
              value={kernelConfig.autonomousResumeMission !== false ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  autonomousResumeMission: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Stop When Complete</span>
            <select
              value={kernelConfig.autonomousStopWhenComplete === true ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  autonomousStopWhenComplete: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="off">Disabled</option>
              <option value="on">Enabled</option>
            </select>
          </label>

          <label className={styles.label}>
            <span className={styles.labelText}>Seed Continuation Tasks</span>
            <select
              value={kernelConfig.autonomousSeedTaskWhenIdle !== false ? 'on' : 'off'}
              onChange={(e) =>
                uiStore.getState().setKernelConfig({
                  autonomousSeedTaskWhenIdle: e.target.value === 'on',
                })
              }
              className={styles.select}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section 5: Danger Zone */}
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
