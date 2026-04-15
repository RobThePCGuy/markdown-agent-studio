import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createVFSStore, type VFSState } from './vfs-store';
import { createAgentRegistry, type AgentRegistryState } from './agent-registry';
import { createEventLog, type EventLogState } from './event-log';
import { createSessionStore, type SessionStoreState } from './session-store';
import { createProjectStore, type ProjectState } from './project-store';
import { createMemoryStore, type MemoryStoreState } from './memory-store';
import { createTaskQueueStore, type TaskQueueState } from './task-queue-store';
import { createPubSubStore } from './pub-sub-store';
import { createBlackboardStore, type BlackboardState } from './blackboard-store';
import type { KernelConfig } from '../types';
import { DEFAULT_KERNEL_CONFIG } from '../types';
import { DiskSync } from '../core/disk-sync';
import { MCPClientManager, type MCPServerConfig } from '../core/mcp-client';
import { getOrCreateKey, encryptValue, decryptValue, isEncrypted } from '../utils/crypto-storage';

// Singleton vanilla stores
export const vfsStore = createVFSStore();
export const agentRegistry = createAgentRegistry();
export const eventLogStore = createEventLog(vfsStore);
export const sessionStore = createSessionStore();
export const projectStore = createProjectStore();
export const memoryStore = createMemoryStore();
export const taskQueueStore = createTaskQueueStore();
export const pubSubStore = createPubSubStore();
export const blackboardStore = createBlackboardStore();
export const diskSync = new DiskSync(vfsStore, projectStore, agentRegistry);

// AI provider type
export type ProviderType = 'gemini' | 'anthropic' | 'openai';

// UI state store
export interface UIState {
  selectedAgentId: string | null;
  selectedFilePath: string | null;
  activeTab: 'graph' | 'editor';
  kernelConfig: KernelConfig;
  apiKey: string;
  provider: ProviderType;
  providerApiKeys: Record<string, string>;
  editingFilePath: string | null;
  editorDirty: boolean;
  settingsOpen: boolean;
  soundEnabled: boolean;
  showWelcome: boolean;
  keysReady: boolean;
  keysError: string | null;
  globalMcpServers: MCPServerConfig[];
  workflowVariableModal: {
    workflowPath: string;
    variables: string[];
    onSubmit: (values: Record<string, string>) => void;
  } | null;
  setSelectedAgent: (id: string | null) => void;
  setSelectedFile: (path: string | null) => void;
  setActiveTab: (tab: 'graph' | 'editor') => void;
  setKernelConfig: (config: Partial<KernelConfig>) => void;
  setApiKey: (key: string) => void;
  setProvider: (provider: ProviderType) => void;
  setProviderApiKey: (provider: string, key: string) => void;
  setProviderApiKeys: (keys: Record<string, string>) => void;
  setKeysReady: (ready: boolean) => void;
  setKeysError: (error: string | null) => void;
  setEditingFile: (path: string | null) => void;
  setEditorDirty: (dirty: boolean) => void;
  openFileInEditor: (path: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setShowWelcome: (show: boolean) => void;
  setGlobalMcpServers: (servers: MCPServerConfig[]) => void;
  setWorkflowVariableModal: (modal: UIState['workflowVariableModal']) => void;
  addMcpServer: (server: MCPServerConfig) => void;
  removeMcpServer: (name: string) => void;
  updateMcpServer: (name: string, server: MCPServerConfig) => void;
}

const persistedApiKey = (() => {
  try { return localStorage.getItem('mas-api-key') ?? import.meta.env.VITE_GEMINI_API_KEY ?? ''; }
  catch { return import.meta.env.VITE_GEMINI_API_KEY ?? ''; }
})();

const persistedProvider = (() => {
  try { return (localStorage.getItem('mas-provider') as ProviderType) ?? 'gemini'; }
  catch { return 'gemini' as ProviderType; }
})();

const _rawProviderApiKeys = (() => {
  try { return localStorage.getItem('mas-provider-api-keys') ?? ''; }
  catch { return ''; }
})();

const persistedProviderApiKeys: Record<string, string> = (() => {
  try {
    // If value is encrypted, return empty — async init will populate after decryption
    if (isEncrypted(_rawProviderApiKeys)) return {};
    const keys: Record<string, string> = _rawProviderApiKeys ? JSON.parse(_rawProviderApiKeys) : {};
    // Migrate existing apiKey to gemini slot if not already present
    if (!keys.gemini && persistedApiKey) keys.gemini = persistedApiKey;
    return keys;
  } catch { return persistedApiKey ? { gemini: persistedApiKey } : {}; }
})();

const persistedConfig = (() => {
  try {
    const raw = localStorage.getItem('mas-kernel-config');
    return raw ? { ...DEFAULT_KERNEL_CONFIG, ...JSON.parse(raw) } : DEFAULT_KERNEL_CONFIG;
  } catch { return DEFAULT_KERNEL_CONFIG; }
})();

const persistedSoundEnabled = (() => {
  try { return localStorage.getItem('mas-sound-enabled') === 'true'; }
  catch { return false; }
})();

const persistedMcpServers: MCPServerConfig[] = (() => {
  try {
    const raw = localStorage.getItem('mas-mcp-servers');
    return raw ? MCPClientManager.parseServerConfigs(JSON.parse(raw)) : [];
  } catch { return []; }
})();

// --- Crypto helpers for encrypted API key persistence ---
let _cryptoKey: CryptoKey | null = null;
async function loadCryptoKey(): Promise<CryptoKey> {
  if (!_cryptoKey) _cryptoKey = await getOrCreateKey();
  return _cryptoKey;
}
/** Write keys to localStorage, encrypted if possible, plaintext as fallback. */
async function writeEncryptedKeys(keys: Record<string, string>): Promise<void> {
  try {
    const key = await loadCryptoKey();
    const encrypted = await encryptValue(key, JSON.stringify(keys));
    localStorage.setItem('mas-provider-api-keys', encrypted);
  } catch {
    // SubtleCrypto/IndexedDB unavailable — write plaintext so key changes aren't lost
    try { localStorage.setItem('mas-provider-api-keys', JSON.stringify(keys)); } catch { /* */ }
  }
}

/** Attempt to encrypt existing plaintext keys. Returns true if migration succeeded. */
async function tryMigrateToEncrypted(keys: Record<string, string>): Promise<boolean> {
  try {
    const key = await loadCryptoKey();
    const encrypted = await encryptValue(key, JSON.stringify(keys));
    localStorage.setItem('mas-provider-api-keys', encrypted);
    return true;
  } catch {
    return false;
  }
}

export const uiStore = createStore<UIState>((set) => ({
  selectedAgentId: null,
  selectedFilePath: null,
  activeTab: 'graph',
  kernelConfig: persistedConfig,
  apiKey: persistedApiKey,
  provider: persistedProvider,
  providerApiKeys: persistedProviderApiKeys,
  editingFilePath: null,
  editorDirty: false,
  settingsOpen: false,
  soundEnabled: persistedSoundEnabled,
  showWelcome: false,
  keysReady: !isEncrypted(_rawProviderApiKeys),
  keysError: null,
  globalMcpServers: persistedMcpServers,
  workflowVariableModal: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id, selectedFilePath: null }),
  setSelectedFile: (path) => set({ selectedFilePath: path, selectedAgentId: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setKernelConfig: (partial) => set((s) => {
    const next = { ...s.kernelConfig, ...partial };
    try { localStorage.setItem('mas-kernel-config', JSON.stringify(next)); } catch { /* localStorage may be unavailable */ }
    return { kernelConfig: next };
  }),
  setApiKey: (key) => {
    set({ apiKey: key });
  },
  setProvider: (provider) => {
    try { localStorage.setItem('mas-provider', provider); } catch { /* localStorage may be unavailable */ }
    // Sync apiKey to the selected provider's key for backwards compatibility
    set((s) => {
      const key = s.providerApiKeys[provider] ?? '';
      return { provider, apiKey: key };
    });
  },
  setProviderApiKey: (provider, key) => {
    set((s) => {
      const next = { ...s.providerApiKeys, [provider]: key };
      writeEncryptedKeys(next);
      // If updating the active provider, also sync apiKey
      if (provider === s.provider) {
        return { providerApiKeys: next, apiKey: key };
      }
      return { providerApiKeys: next };
    });
  },
  setProviderApiKeys: (keys) => {
    set((s) => {
      writeEncryptedKeys(keys);
      const activeKey = keys[s.provider] ?? '';
      return { providerApiKeys: keys, apiKey: activeKey };
    });
  },
  setKeysReady: (ready) => set({ keysReady: ready }),
  setKeysError: (error) => set({ keysError: error }),
  setEditingFile: (path) => set({ editingFilePath: path, editorDirty: false }),
  setEditorDirty: (dirty) => set({ editorDirty: dirty }),
  openFileInEditor: (path) => set({ editingFilePath: path, editorDirty: false, activeTab: 'editor' }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSoundEnabled: (enabled) => {
    try { localStorage.setItem('mas-sound-enabled', String(enabled)); } catch { /* localStorage may be unavailable */ }
    set({ soundEnabled: enabled });
  },
  setShowWelcome: (show) => set({ showWelcome: show }),
  setGlobalMcpServers: (servers) => {
    try { localStorage.setItem('mas-mcp-servers', JSON.stringify(servers)); } catch { /* localStorage may be unavailable */ }
    set({ globalMcpServers: servers });
  },
  setWorkflowVariableModal: (modal) => set({ workflowVariableModal: modal }),
  addMcpServer: (server) => set((s) => {
    if (s.globalMcpServers.some((srv) => srv.name === server.name)) return s;
    const next = [...s.globalMcpServers, server];
    try { localStorage.setItem('mas-mcp-servers', JSON.stringify(next)); } catch { /* */ }
    return { globalMcpServers: next };
  }),
  removeMcpServer: (name) => set((s) => {
    const next = s.globalMcpServers.filter((srv) => srv.name !== name);
    try { localStorage.setItem('mas-mcp-servers', JSON.stringify(next)); } catch { /* */ }
    return { globalMcpServers: next };
  }),
  updateMcpServer: (name, server) => set((s) => {
    const next = s.globalMcpServers.map((srv) => (srv.name === name ? server : srv));
    try { localStorage.setItem('mas-mcp-servers', JSON.stringify(next)); } catch { /* */ }
    return { globalMcpServers: next };
  }),
}));

// --- Async crypto initialization: decrypt or migrate API keys ---
(async () => {
  try {
    if (isEncrypted(_rawProviderApiKeys)) {
      // Stored value is encrypted — decrypt and patch store
      const cryptoKey = await loadCryptoKey();
      const json = await decryptValue(cryptoKey, _rawProviderApiKeys);
      if (json) {
        const keys: Record<string, string> = JSON.parse(json);
        const state = uiStore.getState();
        state.setProviderApiKeys(keys);
      }
    } else if (_rawProviderApiKeys) {
      // Stored value is plaintext JSON — try to migrate to encrypted.
      // If crypto is unavailable, leave plaintext as-is (no-op, no loop on next load).
      await tryMigrateToEncrypted(persistedProviderApiKeys);
    }
  } catch (_err) {
    uiStore.getState().setKeysError(
      'API key decryption failed. Please re-enter your API keys in Settings.'
    );
  } finally {
    uiStore.getState().setKeysReady(true);
  }
})();

// Wire up disk-based settings persistence (excludes API keys for security).
diskSync.onSettingsLoaded = (settings) => {
  const state = uiStore.getState();
  if (settings.kernelConfig) {
    state.setKernelConfig(settings.kernelConfig);
  }
  if (settings.provider) {
    state.setProvider(settings.provider as ProviderType);
  }
  if (typeof settings.soundEnabled === 'boolean') {
    state.setSoundEnabled(settings.soundEnabled);
  }
  if (settings.globalMcpServers) {
    state.setGlobalMcpServers(settings.globalMcpServers);
  }
};

diskSync.getSettings = () => {
  const state = uiStore.getState();
  return {
    kernelConfig: state.kernelConfig,
    provider: state.provider,
    soundEnabled: state.soundEnabled,
    globalMcpServers: state.globalMcpServers,
  };
};

// Subscribe to settings changes and mark dirty for disk persistence.
uiStore.subscribe((state, prev) => {
  if (!projectStore.getState().dirHandle) return; // No project connected
  if (
    state.kernelConfig !== prev.kernelConfig ||
    state.provider !== prev.provider ||
    state.soundEnabled !== prev.soundEnabled ||
    state.globalMcpServers !== prev.globalMcpServers
  ) {
    diskSync.markSettingsDirty();
  }
});

// React hooks
export function useVFS<T>(selector: (state: VFSState) => T): T {
  return useStore(vfsStore, selector);
}

export function useAgentRegistry<T>(selector: (state: AgentRegistryState) => T): T {
  return useStore(agentRegistry, selector);
}

export function useEventLog<T>(selector: (state: EventLogState) => T): T {
  return useStore(eventLogStore, selector);
}

export function useUI<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}

export function useSessionStore<T>(selector: (state: SessionStoreState) => T): T {
  return useStore(sessionStore, selector);
}

export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  return useStore(projectStore, selector);
}

export function useMemoryStore<T>(selector: (state: MemoryStoreState) => T): T {
  return useStore(memoryStore, selector);
}

export function useTaskQueueStore<T>(selector: (state: TaskQueueState) => T): T {
  return useStore(taskQueueStore, selector);
}

export function useBlackboardStore<T>(selector: (state: BlackboardState) => T): T {
  return useStore(blackboardStore, selector);
}
