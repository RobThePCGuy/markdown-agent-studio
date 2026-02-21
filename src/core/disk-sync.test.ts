import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiskSync } from './disk-sync';
import { createVFSStore } from '../stores/vfs-store';
import { createProjectStore } from '../stores/project-store';
import { createAgentRegistry } from '../stores/agent-registry';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

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

  it('flushes each VFS write to disk', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Each write should eventually be flushed to disk.
    vfs.getState().write('file1.md', 'content1', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file1.md', 'content1');

    vfs.getState().write('file2.md', 'content2', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file2.md', 'content2');

    vfs.getState().write('file3.md', 'content3', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'file3.md', 'content3');

    sync.stop();
  });

  it('writes every version to disk when the same file is written multiple times', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Every version should be flushed in order.
    vfs.getState().write('file.md', 'version1', {});
    await flushMicrotasks();
    vfs.getState().write('file.md', 'version2', {});
    await flushMicrotasks();
    vfs.getState().write('file.md', 'version3', {});
    await flushMicrotasks();

    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenNthCalledWith(1, handle, 'file.md', 'version1');
    expect(writeSpy).toHaveBeenNthCalledWith(2, handle, 'file.md', 'version2');
    expect(writeSpy).toHaveBeenNthCalledWith(3, handle, 'file.md', 'version3');

    sync.stop();
  });

  it('flushes writes before stop so stop has nothing pending', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');

    await sync.start(handle);

    // Write a file and allow the queued flush to run.
    vfs.getState().write('pending.md', 'pending content', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'pending.md', 'pending content');

    // Stop calls flush again but nothing is pending
    sync.stop();
    expect(writeSpy).toHaveBeenCalledTimes(1); // no additional writes
  });

  it('write then delete flushes both in order', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Write first.
    vfs.getState().write('temp.md', 'temp content', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'temp.md', 'temp content');

    // Delete after write.
    vfs.getState().deleteFile('temp.md');
    await flushMicrotasks();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'temp.md');

    sync.stop();
  });

  it('delete then write flushes both in order', async () => {
    const handle = mockDirHandle({ 'existing.md': 'old content' });
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const writeSpy = vi.spyOn(sync, 'writeFile');
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    // Delete first.
    vfs.getState().deleteFile('existing.md');
    await flushMicrotasks();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'existing.md');

    // Re-create after delete.
    vfs.getState().write('existing.md', 'new content', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'existing.md', 'new content');

    sync.stop();
  });

  it('serializes overlapping flush calls so later writes wait for earlier writes', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const writeSpy = vi.spyOn(sync, 'writeFile');

    writeSpy
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementationOnce(async () => secondWrite.promise);

    await sync.start(handle);

    vfs.getState().write('race.md', 'v1', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenNthCalledWith(1, handle, 'race.md', 'v1');

    vfs.getState().write('race.md', 'v2', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenNthCalledWith(2, handle, 'race.md', 'v2');

    secondWrite.resolve();
    await flushMicrotasks();

    sync.stop();
  });

  it('preserves queued deletes while an earlier flush is still in flight', async () => {
    const handle = mockDirHandle();
    const sync = new DiskSync(vfs, projectStore, agentRegistry);
    const blockedWrite = deferred<void>();
    const writeSpy = vi.spyOn(sync, 'writeFile')
      .mockImplementation(async () => blockedWrite.promise);
    const deleteSpy = vi.spyOn(sync, 'deleteFile');

    await sync.start(handle);

    vfs.getState().write('queued.md', 'content', {});
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(handle, 'queued.md', 'content');

    vfs.getState().deleteFile('queued.md');
    await flushMicrotasks();
    expect(deleteSpy).toHaveBeenCalledTimes(0);

    blockedWrite.resolve();
    await flushMicrotasks();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(handle, 'queued.md');

    sync.stop();
  });
});
