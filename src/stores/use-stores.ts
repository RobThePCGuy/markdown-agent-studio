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
export const diskSync = new DiskSync(vfsStore, projectStore, agentRegistry);

// UI state store
export interface UIState {
  selectedAgentId: string | null;
  selectedFilePath: string | null;
  activeTab: 'graph' | 'editor';
  kernelConfig: KernelConfig;
  apiKey: string;
  editingFilePath: string | null;
  editorDirty: boolean;
  settingsOpen: boolean;
  soundEnabled: boolean;
  showWelcome: boolean;
  globalMcpServers: MCPServerConfig[];
  workflowVariableModal: {
    open: boolean;
    workflowPath: string;
    variables: string[];
    onSubmit: (values: Record<string, string>) => void;
  } | null;
  setSelectedAgent: (id: string | null) => void;
  setSelectedFile: (path: string | null) => void;
  setActiveTab: (tab: 'graph' | 'editor') => void;
  setKernelConfig: (config: Partial<KernelConfig>) => void;
  setApiKey: (key: string) => void;
  setEditingFile: (path: string | null) => void;
  setEditorDirty: (dirty: boolean) => void;
  openFileInEditor: (path: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setShowWelcome: (show: boolean) => void;
  setGlobalMcpServers: (servers: MCPServerConfig[]) => void;
  setWorkflowVariableModal: (modal: UIState['workflowVariableModal']) => void;
}

const persistedApiKey = (() => {
  try { return localStorage.getItem('mas-api-key') ?? import.meta.env.VITE_GEMINI_API_KEY ?? ''; }
  catch { return import.meta.env.VITE_GEMINI_API_KEY ?? ''; }
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
