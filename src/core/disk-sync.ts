import type { VFSState } from '../stores/vfs-store';
import type { ProjectState } from '../stores/project-store';
import type { AgentRegistryState } from '../stores/agent-registry';

type Store<T> = {
  getState(): T;
  subscribe(listener: (state: T, prev: T) => void): () => void;
};

export const DEBOUNCE_MS = 500;

export class DiskSync {
  private vfs: Store<VFSState>;
  private project: Store<ProjectState>;
  private agentRegistry: Store<AgentRegistryState>;
  private unsubscribe: (() => void) | null = null;
  private loading = false;

  private _pendingWrites = new Map<string, string>();
  private _pendingDeletes = new Set<string>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _onUnload: (() => void) | null = null;
  private _onVisibilityChange: (() => void) | null = null;

  constructor(
    vfs: Store<VFSState>,
    project: Store<ProjectState>,
    agentRegistry: Store<AgentRegistryState>,
  ) {
    this.vfs = vfs;
    this.project = project;
    this.agentRegistry = agentRegistry;
  }

  /** Flush all pending writes and deletes to disk immediately. */
  flush(): void {
    const dirHandle = this.project.getState().dirHandle;
    if (!dirHandle) return;

    for (const [path, content] of this._pendingWrites) {
      this.writeFile(dirHandle, path, content).catch((err) => {
        console.error(`DiskSync: failed to write ${path}:`, err);
        this.project.getState().setSyncStatus('error');
      });
    }
    for (const path of this._pendingDeletes) {
      this.deleteFile(dirHandle, path).catch((err) => {
        console.error(`DiskSync: failed to delete ${path}:`, err);
      });
    }
    this._pendingWrites.clear();
    this._pendingDeletes.clear();
  }

  /** Schedule a debounced flush. */
  private scheduleFlush(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
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

      const currentPaths = new Set(state.getAllPaths());
      const currentContents = new Map<string, string>();
      for (const p of currentPaths) {
        currentContents.set(p, state.read(p) ?? '');
      }

      // Find new or changed files
      for (const path of currentPaths) {
        const content = currentContents.get(path)!;
        if (!prevPaths.has(path) || prevContents.get(path) !== content) {
          this._pendingWrites.set(path, content);
          this._pendingDeletes.delete(path); // cancel any pending delete for same path
        }
      }

      // Find deleted files
      for (const path of prevPaths) {
        if (!currentPaths.has(path)) {
          this._pendingDeletes.add(path);
          this._pendingWrites.delete(path); // cancel any pending write for same path
        }
      }

      this.flush();

      prevPaths = currentPaths;
      prevContents = currentContents;
    });

    // Flush pending changes on page unload or tab switch
    this._onUnload = () => this.flush();
    this._onVisibilityChange = () => { if (document.hidden) this.flush(); };
    window.addEventListener('beforeunload', this._onUnload);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  /** Stop syncing and disconnect. */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Clean up event listeners
    if (this._onUnload) {
      window.removeEventListener('beforeunload', this._onUnload);
      this._onUnload = null;
    }
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    // Clear debounce timer and do a final flush
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this.flush();
    this.project.getState().disconnect();
  }
}
