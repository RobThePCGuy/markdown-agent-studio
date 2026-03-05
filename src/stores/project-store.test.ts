import { describe, it, expect } from 'vitest';
import { createProjectStore } from './project-store';

describe('projectStore', () => {
  it('starts disconnected with no handle', () => {
    const store = createProjectStore();
    const state = store.getState();
    expect(state.dirHandle).toBeNull();
    expect(state.projectName).toBeNull();
    expect(state.syncStatus).toBe('disconnected');
  });

  it('setConnected stores handle and project name', () => {
    const store = createProjectStore();
    const mockHandle = { name: 'my-project' } as FileSystemDirectoryHandle;
    store.getState().setConnected(mockHandle);
    expect(store.getState().dirHandle).toBe(mockHandle);
    expect(store.getState().projectName).toBe('my-project');
    expect(store.getState().syncStatus).toBe('connected');
  });

  it('disconnect clears handle and resets status', () => {
    const store = createProjectStore();
    const mockHandle = { name: 'my-project' } as FileSystemDirectoryHandle;
    store.getState().setConnected(mockHandle);
    store.getState().disconnect();
    expect(store.getState().dirHandle).toBeNull();
    expect(store.getState().projectName).toBeNull();
    expect(store.getState().syncStatus).toBe('disconnected');
  });

  it('setSyncStatus updates status', () => {
    const store = createProjectStore();
    store.getState().setSyncStatus('syncing');
    expect(store.getState().syncStatus).toBe('syncing');
    store.getState().setSyncStatus('error');
    expect(store.getState().syncStatus).toBe('error');
  });
});
