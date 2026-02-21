import { createStore } from 'zustand/vanilla';

export type SyncStatus = 'disconnected' | 'syncing' | 'connected' | 'error';

export interface ProjectState {
  dirHandle: FileSystemDirectoryHandle | null;
  projectName: string | null;
  syncStatus: SyncStatus;
  setConnected: (handle: FileSystemDirectoryHandle) => void;
  disconnect: () => void;
  setSyncStatus: (status: SyncStatus) => void;
}

export function createProjectStore() {
  return createStore<ProjectState>((set) => ({
    dirHandle: null,
    projectName: null,
    syncStatus: 'disconnected',
    setConnected: (handle) =>
      set({ dirHandle: handle, projectName: handle.name, syncStatus: 'connected' }),
    disconnect: () =>
      set({ dirHandle: null, projectName: null, syncStatus: 'disconnected' }),
    setSyncStatus: (status) => set({ syncStatus: status }),
  }));
}
