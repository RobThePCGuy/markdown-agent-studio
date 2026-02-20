import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiskSync } from './disk-sync';
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

  it('flushes each VFS write to disk immediately', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Each write triggers an immediate flush
    vfs.getState().write('file1.md', 'content1', {});
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file1.md', 'content1');

    vfs.getState().write('file2.md', 'content2', {});
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file2.md', 'content2');

    vfs.getState().write('file3.md', 'content3', {});
    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file3.md', 'content3');

    sync.stop();
  });

  it('writes every version to disk immediately when the same file is written multiple times', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Each write flushes immediately, so every version goes to disk
    vfs.getState().write('file.md', 'version1', {});
    vfs.getState().write('file.md', 'version2', {});
    vfs.getState().write('file.md', 'version3', {});

    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenNthCalledWith(1, handle, 'file.md', 'version1');
    expect(writeSpy).toHaveBeenNthCalledWith(2, handle, 'file.md', 'version2');
    expect(writeSpy).toHaveBeenNthCalledWith(3, handle, 'file.md', 'version3');

    sync.stop();
  });

  it('writes flush immediately so stop has nothing pending', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Write a file -- it flushes immediately
    vfs.getState().write('pending.md', 'pending content', {});
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'pending.md', 'pending content');

    // Stop calls flush again but nothing is pending
    sync.stop();
    expect(writeSpy).toHaveBeenCalledTimes(1); // no additional writes
  });

  it('write then delete flushes both immediately', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Write flushes immediately
    vfs.getState().write('temp.md', 'temp content', {});
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'temp.md', 'temp content');

    // Delete flushes immediately
    vfs.getState().deleteFile('temp.md');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'temp.md');

    sync.stop();
  });

  it('delete then write flushes both immediately', async () => {
    const handle = mockDirHandle({ 'existing.md': 'old content' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Delete flushes immediately
    vfs.getState().deleteFile('existing.md');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'existing.md');

    // Re-create flushes immediately
    vfs.getState().write('existing.md', 'new content', {});
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'existing.md', 'new content');

    sync.stop();
  });
});
