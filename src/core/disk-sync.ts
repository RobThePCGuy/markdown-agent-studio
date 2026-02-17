import type { VFSState } from '../stores/vfs-store';
import type { ProjectState } from '../stores/project-store';
import type { AgentRegistryState } from '../stores/agent-registry';

type Store<T> = {
  getState(): T;
  subscribe(listener: (state: T, prev: T) => void): () => void;
};

export class DiskSync {
  private vfs: Store<VFSState>;
  private project: Store<ProjectState>;
  private agentRegistry: Store<AgentRegistryState>;
  private unsubscribe: (() => void) | null = null;
  private loading = false;

  constructor(
    vfs: Store<VFSState>,
    project: Store<ProjectState>,
    agentRegistry: Store<AgentRegistryState>,
  ) {
    this.vfs = vfs;
    this.project = project;
    this.agentRegistry = agentRegistry;
  }

  /** Write a file to disk, creating parent directories as needed. */
  async writeFile(
    rootHandle: FileSystemDirectoryHandle,
    path: string,
    content: string,
  ): Promise<void> {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dirHandle = rootHandle;
    for (const dir of parts) {
      dirHandle = await dirHandle.getDirectoryHandle(dir, { create: true });
    }
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /** Delete a file from disk. */
  async deleteFile(
    rootHandle: FileSystemDirectoryHandle,
    path: string,
  ): Promise<void> {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dirHandle = rootHandle;
    for (const dir of parts) {
      try {
        dirHandle = await dirHandle.getDirectoryHandle(dir);
      } catch {
        return; // Parent directory doesn't exist, nothing to delete
      }
    }
    try {
      await dirHandle.removeEntry(fileName);
    } catch {
      // File already gone
    }
  }

  /** Recursively read all files from a directory handle into VFS. */
  async readAllFiles(
    dirHandle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const entry of dirHandle.values()) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        try {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const content = await file.text();
          this.vfs.getState().write(entryPath, content, {});
          // Auto-register agents
          if (entryPath.startsWith('agents/') && entryPath.endsWith('.md')) {
            this.agentRegistry.getState().registerFromFile(entryPath, content);
          }
        } catch (err) {
          console.warn(`DiskSync: failed to read ${entryPath}:`, err);
        }
      } else if (entry.kind === 'directory') {
        const subDir = entry as FileSystemDirectoryHandle;
        await this.readAllFiles(subDir, entryPath);
      }
    }
  }

  /** Start syncing: load files from disk, then subscribe to VFS changes. */
  async start(handle: FileSystemDirectoryHandle): Promise<void> {
    this.project.getState().setSyncStatus('syncing');

    // Load existing files from disk into VFS
    this.loading = true;
    try {
      await this.readAllFiles(handle, '');
    } catch (err) {
      console.error('DiskSync: failed to load project:', err);
      this.project.getState().setSyncStatus('error');
      this.loading = false;
      return;
    }
    this.loading = false;

    this.project.getState().setConnected(handle);

    // Subscribe to VFS changes
    let prevPaths = new Set(this.vfs.getState().getAllPaths());
    let prevContents = new Map<string, string>();
    for (const path of prevPaths) {
      prevContents.set(path, this.vfs.getState().read(path) ?? '');
    }

    this.unsubscribe = this.vfs.subscribe((state) => {
      if (this.loading) return;

      const dirHandle = this.project.getState().dirHandle;
      if (!dirHandle) return;

      const currentPaths = new Set(state.getAllPaths());
      const currentContents = new Map<string, string>();
      for (const p of currentPaths) {
        currentContents.set(p, state.read(p) ?? '');
      }

      // Find new or changed files
      for (const path of currentPaths) {
        const content = currentContents.get(path)!;
        if (!prevPaths.has(path) || prevContents.get(path) !== content) {
          this.writeFile(dirHandle, path, content).catch((err) => {
            console.error(`DiskSync: failed to write ${path}:`, err);
            this.project.getState().setSyncStatus('error');
          });
        }
      }

      // Find deleted files
      for (const path of prevPaths) {
        if (!currentPaths.has(path)) {
          this.deleteFile(dirHandle, path).catch((err) => {
            console.error(`DiskSync: failed to delete ${path}:`, err);
          });
        }
      }

      prevPaths = currentPaths;
      prevContents = currentContents;
    });
  }

  /** Stop syncing and disconnect. */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.project.getState().disconnect();
  }
}
