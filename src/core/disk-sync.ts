import type { VFSState } from '../stores/vfs-store';
import type { ProjectState } from '../stores/project-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { KernelConfig } from '../types';
import type { MCPServerConfig } from './mcp-client';

type Store<T> = {
  getState(): T;
  subscribe(listener: (state: T, prev: T) => void): () => void;
};

/** Filename for persisted settings inside the project folder (not synced to VFS). */
const SETTINGS_FILE = '.mas-settings.json';

/** Settings that get persisted to disk (excludes API keys for security). */
export interface PersistedSettings {
  kernelConfig?: KernelConfig;
  provider?: string;
  soundEnabled?: boolean;
  globalMcpServers?: MCPServerConfig[];
}

export class DiskSync {
  private vfs: Store<VFSState>;
  private project: Store<ProjectState>;
  private agentRegistry: Store<AgentRegistryState>;
  private unsubscribe: (() => void) | null = null;
  private loading = false;

  private _pendingWrites = new Map<string, string>();
  private _pendingDeletes = new Set<string>();
  private _flushChain: Promise<void> = Promise.resolve();
  private _onUnload: (() => void) | null = null;
  private _onVisibilityChange: (() => void) | null = null;

  /** Callback to apply loaded settings to the UI store. */
  onSettingsLoaded?: (settings: PersistedSettings) => void;
  /** Callback to read current settings from the UI store for saving. */
  getSettings?: () => PersistedSettings;

  private _settingsUnsubscribe: (() => void) | null = null;
  private _settingsDirty = false;
  private _settingsFlushTimer: ReturnType<typeof setTimeout> | null = null;

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

    const writes = [...this._pendingWrites.entries()];
    const deletes = [...this._pendingDeletes];
    this._pendingWrites.clear();
    this._pendingDeletes.clear();

    // Also flush settings if dirty
    const shouldFlushSettings = this._settingsDirty;
    const settingsJson = shouldFlushSettings && this.getSettings
      ? JSON.stringify(this.getSettings(), null, 2)
      : null;
    if (shouldFlushSettings) {
      this._settingsDirty = false;
      if (this._settingsFlushTimer) {
        clearTimeout(this._settingsFlushTimer);
        this._settingsFlushTimer = null;
      }
    }

    if (writes.length === 0 && deletes.length === 0 && !settingsJson) return;

    this._flushChain = this._flushChain
      .then(async () => {
        for (const [path, content] of writes) {
          try {
            await this.writeFile(dirHandle, path, content);
          } catch (err) {
            console.error(`DiskSync: failed to write ${path}:`, err);
            this.project.getState().setSyncStatus('error');
          }
        }
        for (const path of deletes) {
          try {
            await this.deleteFile(dirHandle, path);
          } catch (err) {
            console.error(`DiskSync: failed to delete ${path}:`, err);
          }
        }
        // Write settings file
        if (settingsJson) {
          try {
            await this.writeFile(dirHandle, SETTINGS_FILE, settingsJson);
          } catch (err) {
            console.error('DiskSync: failed to write settings:', err);
          }
        }
      })
      .catch((err) => {
        console.error('DiskSync: unexpected flush failure:', err);
        this.project.getState().setSyncStatus('error');
      });
  }

  /** Mark settings as dirty — will be flushed on next flush or after a short debounce. */
  markSettingsDirty(): void {
    this._settingsDirty = true;
    // Debounce settings writes to avoid thrashing disk on rapid changes
    if (this._settingsFlushTimer) clearTimeout(this._settingsFlushTimer);
    this._settingsFlushTimer = setTimeout(() => {
      this._settingsFlushTimer = null;
      this.flush();
    }, 1000);
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

  /** Read and apply persisted settings from the project folder. */
  private async loadSettings(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      const fileHandle = await handle.getFileHandle(SETTINGS_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const settings: PersistedSettings = JSON.parse(text);
      this.onSettingsLoaded?.(settings);
      console.log('DiskSync: loaded project settings from', SETTINGS_FILE);
    } catch {
      // File doesn't exist or is invalid — that's fine, use defaults
    }
  }

  /** Directories to skip during recursive loading. */
  private static IGNORED_DIRS = new Set([
    '.git', 'node_modules', '.next', '.cache', '__pycache__',
    '.vscode', '.idea', 'dist', 'build', '.DS_Store',
  ]);

  /** File extensions to skip (binary / non-text). */
  private static IGNORED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.bz2', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.pdf', '.doc', '.xls', '.ppt',
    '.sqlite', '.db', '.lock',
  ]);

  /** Recursively read all files from a directory handle into VFS. */
  async readAllFiles(
    dirHandle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const entry of dirHandle.values()) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Skip the settings file — it's not a VFS file
      if (!prefix && entry.name === SETTINGS_FILE) continue;
      // Skip ignored directories
      if (entry.kind === 'directory' && DiskSync.IGNORED_DIRS.has(entry.name)) continue;
      // Skip binary / non-text files by extension
      const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop()!.toLowerCase() : '';
      if (entry.kind === 'file' && DiskSync.IGNORED_EXTENSIONS.has(ext)) continue;
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

    // Load persisted settings first (before files, so config is ready)
    await this.loadSettings(handle);

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
    if (this._settingsUnsubscribe) {
      this._settingsUnsubscribe();
      this._settingsUnsubscribe = null;
    }
    if (this._settingsFlushTimer) {
      clearTimeout(this._settingsFlushTimer);
      this._settingsFlushTimer = null;
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
    this.flush();
    this.project.getState().disconnect();
  }
}
