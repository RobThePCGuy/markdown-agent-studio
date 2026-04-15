import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUI, uiStore, vfsStore, agentRegistry, eventLogStore, sessionStore } from '../../stores/use-stores';
import type { ProviderType } from '../../stores/use-stores';
import { MemoryManager } from '../../core/memory-manager';
import { createMemoryDB } from '../../core/memory-db';
import { loadSampleProject } from '../../core/sample-project';
import { useProviderModels } from '../../hooks/useProviderModels';
import type { MCPServerConfig } from '../../core/mcp-client';
import SettingsTooltip from './SettingsTooltip';
import styles from './SettingsModal.module.css';

// ---------------------------------------------------------------------------
// Tooltip helper — renders the label text with a "?" tooltip inline
// ---------------------------------------------------------------------------
function Label({ text, tip }: { text: string; tip: string }) {
  return (
    <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {text}
      <SettingsTooltip text={tip} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------

export default function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);

  if (!open) return null;

  return <SettingsModalContent />;
}

function SettingsModalContent() {
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
            <Label text="Provider" tip="The LLM provider to use for all agent conversations. Each provider requires its own API key." />
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
            <Label text="API Key" tip="Your secret API key for the selected provider. Stored locally in your browser — never sent anywhere except the provider's API." />
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
            <Label text={`Model${modelsLoading ? ' (loading...)' : ''}`} tip="Which model to use for agent sessions. Larger models are smarter but slower and more expensive. The list updates automatically based on your API key." />
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
                <Label text="Server Name" tip="A unique identifier for this MCP server. Used to reference the server in agent configurations." />
                <input
                  type="text"
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="my-server"
                  className={styles.input}
                />
              </label>

              <label className={styles.label}>
                <Label text="Transport" tip="How the app communicates with the MCP server. HTTP is recommended for most setups. SSE uses server-sent events. stdio launches a local process (not available in browser)." />
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
            <Label text="Max Concurrency" tip="How many agent sessions run in parallel at once. Higher values speed up multi-agent runs but use more API quota. Start with 3 and increase if your rate limits allow." />
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
            <Label text="Max Depth" tip="How deep the agent spawn tree can go. A coordinator spawning a child is depth 1; that child spawning another is depth 2. Keep low to avoid runaway hierarchies that are hard to debug." />
            <input
              type="number"
              min={1}
              max={10}
              defaultValue={kernelConfig.maxDepth}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxDepth: Math.max(1, Math.min(10, v)) }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <Label text="Max Fanout" tip="How many child agents a single parent can spawn in one session. When hit, the spawn_agent and delegate tools are hidden from the LLM. Increase if coordinators need to delegate to many specialists." />
            <input
              type="number"
              min={1}
              max={20}
              defaultValue={kernelConfig.maxFanout}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxFanout: Math.max(1, Math.min(20, v)) }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <Label text="Token Budget" tip="Total token cap across the entire run. The kernel stops scheduling new sessions when this is exhausted. Multi-cycle autonomous runs with several agents can easily consume 500k+ tokens." />
            <input
              type="number"
              min={100000}
              step={100000}
              defaultValue={kernelConfig.tokenBudget}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ tokenBudget: Math.max(100000, v) }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <Label text="Max Agent Turns" tip="Maximum LLM round-trips per agent session. An agent doing more than 15 turns is often stuck in a loop. Lower values catch runaway agents sooner; higher values give complex tasks more room." />
            <input
              type="number"
              min={3}
              max={30}
              defaultValue={kernelConfig.maxAgentTurns ?? 15}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxAgentTurns: Math.max(3, Math.min(30, v)) }); }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <Label text="Workflow Parallel Steps" tip="In workflow mode, how many independent steps can execute concurrently when their dependencies allow. Set to 1 for strictly sequential execution." />
            <input
              type="number"
              min={1}
              max={10}
              defaultValue={kernelConfig.workflowMaxParallelSteps ?? 1}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (!isNaN(v)) {
                  uiStore.getState().setKernelConfig({
                    workflowMaxParallelSteps: Math.max(1, Math.min(10, Math.floor(v))),
                  });
                }
              }}
              className={styles.input}
            />
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section: Agent Persistence */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Agent Persistence</h3>

          <label className={styles.label}>
            <Label text="Min Turns Before Stop" tip="Prevents agents from quitting too early. The agent cannot voluntarily end its session until it has taken at least this many turns. Set to 0 to disable." />
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
            <Label text="Force Reflection" tip="Injects a reflection prompt at the end of each agent session, asking the agent to review its own output quality. Helps catch mistakes and improves memory entries." />
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
            <Label text="Auto-Record Failures" tip="When a tool call fails, automatically writes the error to working memory so the agent (and other agents) can learn from the mistake and avoid repeating it." />
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

          <label className={styles.label}>
            <Label text="Max Nudges Per Session" tip="When an agent tries to stop before min turns, the kernel injects a nudge prompt to keep it going. This limits how many nudges are injected per session to avoid infinite loops." />
            <input
              type="number"
              min={0}
              max={10}
              defaultValue={kernelConfig.maxNudges ?? 3}
              onChange={(e) => { const v = e.target.valueAsNumber; if (!isNaN(v)) uiStore.getState().setKernelConfig({ maxNudges: Math.max(0, Math.min(10, v)) }); }}
              className={styles.input}
            />
          </label>
        </div>

        <hr className={styles.divider} />

        {/* Section 3: Memory System */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Memory System</h3>

          <label className={styles.label}>
            <Label text="Enable Memory" tip="Toggles the long-term memory system. When enabled, agents can store and recall facts, skills, and mistakes across runs. Disabling this makes each run start fresh." />
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
            <Label text="Vector Memory (Semantic Search)" tip="When on, uses browser-local embeddings (Transformers.js) and IndexedDB for semantic similarity search. When off, falls back to simpler JSON tag matching. Vector mode is more accurate but uses more memory on first load." />
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
              <option value="on">On (Vector Embeddings)</option>
            </select>
          </label>

          <label className={styles.label}>
            <Label text="Memory Token Budget" tip="How many tokens of recalled memory context are injected into each agent's system prompt. Higher values give agents more context but leave less room for the actual conversation." />
            <input
              type="number"
              min={500}
              max={8000}
              step={500}
              defaultValue={kernelConfig.memoryTokenBudget ?? 4000}
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
            <Label text="Default Max Cycles" tip="How many kernel cycles the autonomous runner performs. Each cycle runs all queued agents to completion, then evaluates progress. More cycles allow deeper work but consume more tokens and time." />
            <input
              type="number"
              min={1}
              max={100}
              defaultValue={kernelConfig.autonomousMaxCycles ?? 10}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (!isNaN(v)) uiStore.getState().setKernelConfig({ autonomousMaxCycles: Math.max(1, Math.min(100, v)) });
              }}
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            <Label text="Resume Previous Mission" tip="When enabled, autonomous mode picks up where the last run left off — preserving the task queue, mission context, and run ledger. When disabled, each autonomous run starts completely fresh." />
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
            <Label text="Stop When Complete" tip="When enabled, the autonomous runner stops early if it detects all tasks in the queue are done, even if there are cycles remaining. Saves tokens on simple missions." />
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
            <Label text="Seed Continuation Tasks" tip="When the task queue runs dry between cycles, the runner asks the LLM to generate follow-up tasks based on what was accomplished. Keeps autonomous runs productive but can lead to scope creep." />
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
              <span className={styles.labelText}>Type &quot;CLEAR&quot; to confirm</span>
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
