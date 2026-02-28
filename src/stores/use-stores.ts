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

const persistedProviderApiKeys: Record<string, string> = (() => {
  try {
    const raw = localStorage.getItem('mas-provider-api-keys');
    const keys: Record<string, string> = raw ? JSON.parse(raw) : {};
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
    try { localStorage.setItem('mas-api-key', key); } catch { /* localStorage may be unavailable */ }
    set({ apiKey: key });
  },
  setProvider: (provider) => {
    try { localStorage.setItem('mas-provider', provider); } catch { /* localStorage may be unavailable */ }
    // Sync apiKey to the selected provider's key for backwards compatibility
    set((s) => {
      const key = s.providerApiKeys[provider] ?? '';
      try { localStorage.setItem('mas-api-key', key); } catch { /* */ }
      return { provider, apiKey: key };
    });
  },
  setProviderApiKey: (provider, key) => {
    set((s) => {
      const next = { ...s.providerApiKeys, [provider]: key };
      try { localStorage.setItem('mas-provider-api-keys', JSON.stringify(next)); } catch { /* */ }
      // If updating the active provider, also sync apiKey
      if (provider === s.provider) {
        try { localStorage.setItem('mas-api-key', key); } catch { /* */ }
        return { providerApiKeys: next, apiKey: key };
      }
      return { providerApiKeys: next };
    });
  },
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
