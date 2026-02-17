import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createVFSStore, type VFSState } from './vfs-store';
import { createAgentRegistry, type AgentRegistryState } from './agent-registry';
import { createEventLog, type EventLogState } from './event-log';
import type { KernelConfig } from '../types';
import { DEFAULT_KERNEL_CONFIG } from '../types';

// Singleton vanilla stores
export const vfsStore = createVFSStore();
export const agentRegistry = createAgentRegistry();
export const eventLogStore = createEventLog();

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
  setSelectedAgent: (id: string | null) => void;
  setSelectedFile: (path: string | null) => void;
  setActiveTab: (tab: 'graph' | 'editor') => void;
  setKernelConfig: (config: Partial<KernelConfig>) => void;
  setApiKey: (key: string) => void;
  setEditingFile: (path: string | null) => void;
  setEditorDirty: (dirty: boolean) => void;
  openFileInEditor: (path: string) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const uiStore = createStore<UIState>((set) => ({
  selectedAgentId: null,
  selectedFilePath: null,
  activeTab: 'graph',
  kernelConfig: DEFAULT_KERNEL_CONFIG,
  apiKey: import.meta.env.VITE_GEMINI_API_KEY ?? '',
  editingFilePath: null,
  editorDirty: false,
  settingsOpen: false,
  setSelectedAgent: (id) => set({ selectedAgentId: id, selectedFilePath: null }),
  setSelectedFile: (path) => set({ selectedFilePath: path, selectedAgentId: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setKernelConfig: (partial) => set((s) => ({ kernelConfig: { ...s.kernelConfig, ...partial } })),
  setApiKey: (key) => set({ apiKey: key }),
  setEditingFile: (path) => set({ editingFilePath: path, editorDirty: false }),
  setEditorDirty: (dirty) => set({ editorDirty: dirty }),
  openFileInEditor: (path) => set({ editingFilePath: path, editorDirty: false, activeTab: 'editor' }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
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
