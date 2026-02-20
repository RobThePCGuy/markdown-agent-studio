import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiskSync, DEBOUNCE_MS } from './disk-sync';
import { createVFSStore } from '../stores/vfs-store';
import { createProjectStore } from '../stores/project-store';
import { createAgentRegistry } from '../stores/agent-registry';

// Mock FileSystemDirectoryHandle
function mockDirHandle(files: Record<string, string> = {}): FileSystemDirectoryHandle {
  const entries = new Map<string, string>(Object.entries(files));
  const writtenFiles = new Map<string, string>();
  const deletedFiles = new Set<string>();

  const mockFileHandle = (name: string, content?: string) => ({
    kind: 'file' as const,
    name,
    getFile: async () => ({
      text: async () => content ?? entries.get(name) ?? '',
      name,
    }),
    createWritable: async () => {
      let data = '';
      return {
        write: async (chunk: string) => { data += chunk; },
        close: async () => { writtenFiles.set(name, data); },
      };
    },
  });

  const handle = {
    kind: 'directory' as const,
    name: 'test-project',
    getDirectoryHandle: vi.fn(async (_name: string, _opts?: { create?: boolean }) => {
      return mockDirHandle({});
    }),
    getFileHandle: vi.fn(async (name: string, _opts?: { create?: boolean }) => {
      return mockFileHandle(name);
    }),
    removeEntry: vi.fn(async (name: string) => {
      deletedFiles.add(name);
    }),
    values: vi.fn(async function* () {
      for (const [name, content] of entries) {
        yield mockFileHandle(name, content);
      }
    }),
    _written: writtenFiles,
    _deleted: deletedFiles,
  } as unknown as FileSystemDirectoryHandle & {
    _written: Map<string, string>;
    _deleted: Set<string>;
  };

  return handle;
}

describe('DiskSync', () => {
  let vfs: ReturnType<typeof createVFSStore>;
  let projectStore: ReturnType<typeof createProjectStore>;
  let agentRegistry: ReturnType<typeof createAgentRegistry>;

  beforeEach(() => {
    vi.useFakeTimers();
    vfs = createVFSStore();
    projectStore = createProjectStore();
    agentRegistry = createAgentRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writeFile creates file via directory handle', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    await sync.writeFile(handle, 'agents/test.md', '# Test');
    expect(handle.getDirectoryHandle).toHaveBeenCalledWith('agents', { create: true });
  });

  it('deleteFile removes file via directory handle', async () => {
    const handle = mockDirHandle({ 'test.md': '# Test' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    await sync.deleteFile(handle, 'test.md');
    expect(handle.removeEntry).toHaveBeenCalledWith('test.md');
  });

  it('readAllFiles loads files into VFS', async () => {
    const handle = mockDirHandle({ 'readme.md': '# Hello' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    await sync.readAllFiles(handle, '');
    expect(vfs.getState().read('readme.md')).toBe('# Hello');
  });

  it('start loads files from disk and subscribes to VFS changes', async () => {
    const handle = mockDirHandle({ 'notes.md': '# Notes' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);

    await sync.start(handle);

    // Files should be loaded into VFS
    expect(vfs.getState().read('notes.md')).toBe('# Notes');
    // Project should be connected
    expect(projectStore.getState().syncStatus).toBe('connected');
    expect(projectStore.getState().projectName).toBe('test-project');

    sync.stop();
    expect(projectStore.getState().syncStatus).toBe('disconnected');
  });

  it('stop cleans up subscription', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    await sync.start(handle);
    sync.stop();

    // Writing to VFS after stop should not attempt disk write
    vfs.getState().write('after-stop.md', 'test', {});
    // No error should occur -- subscription is gone
    expect(projectStore.getState().syncStatus).toBe('disconnected');
  });

  it('debounces multiple rapid VFS writes into a single flush', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Perform three rapid writes - these should be batched
    vfs.getState().write('file1.md', 'content1', {});
    vfs.getState().write('file2.md', 'content2', {});
    vfs.getState().write('file3.md', 'content3', {});

    // No disk writes should have happened yet (still within debounce window)
    expect(writeSpy).not.toHaveBeenCalled();

    // Advance past the debounce window
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    // Now all three files should be written in a single flush
    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file1.md', 'content1');
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file2.md', 'content2');
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file3.md', 'content3');

    sync.stop();
  });

  it('only keeps the latest content when the same file is written multiple times', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Write the same file three times rapidly
    vfs.getState().write('file.md', 'version1', {});
    vfs.getState().write('file.md', 'version2', {});
    vfs.getState().write('file.md', 'version3', {});

    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    // Should only write once with the latest content
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file.md', 'version3');

    sync.stop();
  });

  it('stop triggers a final flush of pending writes', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Write a file but don't advance timers
    vfs.getState().write('pending.md', 'pending content', {});

    // Writes should not have happened yet
    expect(writeSpy).not.toHaveBeenCalled();

    // Stop should trigger a final flush
    sync.stop();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'pending.md', 'pending content');
  });

  it('pending delete cancels a pending write for the same path', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Write a file then delete it before the debounce fires
    vfs.getState().write('temp.md', 'temp content', {});
    vfs.getState().deleteFile('temp.md');

    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    // The write should have been canceled; only delete should fire
    expect(writeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'temp.md');

    sync.stop();
  });

  it('pending write cancels a pending delete for the same path', async () => {
    const handle = mockDirHandle({ 'existing.md': 'old content' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Delete then re-create the file before debounce fires
    vfs.getState().deleteFile('existing.md');
    vfs.getState().write('existing.md', 'new content', {});

    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    // The delete should have been canceled; only write should fire
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'existing.md', 'new content');

    sync.stop();
  });
});
