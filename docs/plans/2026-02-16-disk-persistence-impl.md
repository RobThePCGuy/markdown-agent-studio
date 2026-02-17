# Disk Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist VFS files to a local project folder via the File System Access API so agent outputs survive page refreshes and are accessible as regular files on disk.

**Architecture:** A `projectStore` holds the directory handle and sync status. A `DiskSync` class subscribes to the VFS store, diffs state changes, and writes/deletes files on disk. On project open, all files are read from disk into VFS. No changes to the VFS store itself.

**Tech Stack:** TypeScript, Zustand vanilla stores, File System Access API, Vitest

---

### Task 1: Project Store

**Files:**
- Create: `src/stores/project-store.ts`
- Test: `src/stores/project-store.test.ts`

**Context:** A Zustand vanilla store that tracks the directory handle, project name, and sync status. It does NOT do any file I/O itself -- that's DiskSync's job. This store is the source of truth for "is a project open?" that the UI reads.

**Step 1: Write the failing tests**

```typescript
// src/stores/project-store.test.ts
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/project-store.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/stores/project-store.ts
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/project-store.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/stores/project-store.ts src/stores/project-store.test.ts
git commit -m "feat: add project store for disk persistence state"
```

---

### Task 2: Export project store singleton and React hook

**Files:**
- Modify: `src/stores/use-stores.ts`

**Context:** Add the project store singleton alongside the other stores. Add a `useProjectStore` hook for React components. Follow the exact same pattern as `vfsStore`, `sessionStore`, etc.

**Step 1: Add project store to use-stores.ts**

Add import at top of `src/stores/use-stores.ts`:
```typescript
import { createProjectStore, type ProjectState } from './project-store';
```

Add singleton after the other store singletons (after line 14):
```typescript
export const projectStore = createProjectStore();
```

Add React hook after the other hooks (after `useSessionStore`):
```typescript
export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
  return useStore(projectStore, selector);
}
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS (no behavior change)

**Step 3: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: export project store singleton and React hook"
```

---

### Task 3: DiskSync - file system helpers

**Files:**
- Create: `src/core/disk-sync.ts`
- Test: `src/core/disk-sync.test.ts`

**Context:** The DiskSync class needs helpers to read/write/delete files via the File System Access API. We'll build these first with mock-based tests, then add the subscription logic in Task 4.

The File System Access API works with directory and file handles:
- `dirHandle.getDirectoryHandle(name, { create: true })` to get/create subdirectories
- `dirHandle.getFileHandle(name, { create: true })` to get/create files
- `fileHandle.createWritable()` to get a writable stream
- `fileHandle.getFile()` to read
- `dirHandle.removeEntry(name)` to delete

**Step 1: Write the failing tests**

```typescript
// src/core/disk-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      return mockDirHandle({});
    }),
    getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
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
    vfs = createVFSStore();
    projectStore = createProjectStore();
    agentRegistry = createAgentRegistry();
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
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/disk-sync.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/core/disk-sync.ts
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/disk-sync.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/disk-sync.ts src/core/disk-sync.test.ts
git commit -m "feat: add DiskSync class with file system helpers and VFS subscription"
```

---

### Task 4: DiskSync subscription integration test

**Files:**
- Modify: `src/core/disk-sync.test.ts` (add tests)

**Context:** Test the full start/stop lifecycle: start loads files from disk into VFS, VFS writes propagate to disk, deletes propagate to disk, stop disconnects.

**Step 1: Add integration tests**

Add these tests to the existing describe block in `src/core/disk-sync.test.ts`:

```typescript
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
```

**Step 2: Run tests**

Run: `npx vitest run src/core/disk-sync.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/core/disk-sync.test.ts
git commit -m "test: add DiskSync subscription integration tests"
```

---

### Task 5: Wire DiskSync singleton into use-stores

**Files:**
- Modify: `src/stores/use-stores.ts`

**Context:** Create a singleton DiskSync instance alongside the stores. Export it so the UI can call `diskSync.start(handle)` and `diskSync.stop()`.

**Step 1: Add DiskSync import and singleton**

At top of `src/stores/use-stores.ts`, add:
```typescript
import { DiskSync } from '../core/disk-sync';
```

After the `projectStore` singleton, add:
```typescript
export const diskSync = new DiskSync(vfsStore, projectStore, agentRegistry);
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: wire DiskSync singleton into store layer"
```

---

### Task 6: Add Open Project button to TopBar

**Files:**
- Modify: `src/components/layout/TopBar.tsx`

**Context:** Add a folder button to the TopBar that opens the native folder picker. When connected, show the project name and a colored status dot. When clicked while connected, disconnect. Uses `useProjectStore` hook for reactive UI and the `diskSync` singleton for start/stop.

**Step 1: Update TopBar.tsx**

Add imports at top:
```typescript
import { useProjectStore, diskSync } from '../../stores/use-stores';
```

Inside the TopBar component, add state:
```typescript
const projectName = useProjectStore((s) => s.projectName);
const syncStatus = useProjectStore((s) => s.syncStatus);
```

Add the handler function:
```typescript
const handleOpenProject = async () => {
  if (projectName) {
    diskSync.stop();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await diskSync.start(handle);
  } catch (err) {
    // User cancelled the picker or permission denied
    if ((err as Error).name !== 'AbortError') {
      console.error('Failed to open project:', err);
    }
  }
};
```

Add the UI elements before the gear button (before `<button onClick={() => uiStore.getState().setSettingsOpen(true)}>`):

```tsx
<button
  onClick={handleOpenProject}
  style={{
    background: 'none',
    border: 'none',
    color: projectName ? '#a6e3a1' : '#6c7086',
    fontSize: 13,
    cursor: 'pointer',
    padding: '4px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }}
  title={projectName ? `Project: ${projectName} (click to disconnect)` : 'Open project folder'}
>
  {syncStatus === 'syncing' && (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#89b4fa' }} />
  )}
  {syncStatus === 'connected' && (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#a6e3a1' }} />
  )}
  {syncStatus === 'error' && (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#f38ba8' }} />
  )}
  {projectName ? projectName : '\u{1F4C1}'}
</button>
```

**Step 2: Add `showDirectoryPicker` type declaration**

The File System Access API types may not be included by default. Check if `tsconfig.json` or a global `.d.ts` needs updating. If TypeScript complains about `showDirectoryPicker`, create a type declaration:

Create `src/types/file-system-access.d.ts`:
```typescript
interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }): Promise<FileSystemDirectoryHandle>;
}
```

**Step 3: Run TypeScript check and dev server**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run dev`
Manually verify: folder icon appears in TopBar, clicking opens folder picker.

**Step 4: Commit**

```bash
git add src/components/layout/TopBar.tsx src/types/file-system-access.d.ts
git commit -m "feat: add Open Project button to TopBar with folder picker"
```

---

### Task 7: Integration smoke test

**Files:** None (verification only)

**Context:** Run the full test suite, TypeScript check, and manually verify the feature end-to-end.

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Manual smoke test**

1. Run `npm run dev`
2. Create an agent in the editor and save
3. Click the folder icon in TopBar
4. Pick a folder on disk
5. Verify the agent file appears on disk in the selected folder
6. Run an agent with a task that writes to artifacts/
7. Verify the artifact file appears on disk
8. Refresh the page
9. Re-open the same folder
10. Verify files load back into VFS

**Step 4: Fix any issues and commit**

```bash
git commit -m "fix: address integration issues from disk persistence smoke test"
```
