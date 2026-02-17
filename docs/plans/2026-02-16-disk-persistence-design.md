# Disk Persistence Design

## Goal

Persist VFS files to a local project folder on disk so agent outputs (artifacts, memory, spawned agents) survive page refreshes and are accessible as regular files.

## Approach

VFS Subscription Layer (Approach A). A `DiskSync` module subscribes to VFS store changes and syncs them to disk via the File System Access API. Zero changes to the VFS store, kernel, or plugins.

## File System Access API

- User clicks "Open Project" in TopBar
- Browser shows native folder picker via `window.showDirectoryPicker()`
- Returned `FileSystemDirectoryHandle` stored in a `projectStore` (Zustand vanilla store)
- No handle persistence across sessions -- user re-picks folder each time
- When no project is open, app works exactly as before (in-memory only)

## Project Folder Structure

Mirrors VFS paths exactly:

```
my-project/
  agents/
    orchestrator.md
    researcher.md
  artifacts/
    report.md
  memory/
    notes.md
```

## DiskSync Module (`src/core/disk-sync.ts`)

### Loading from disk (on project open)

1. Recursively walk the directory handle
2. Read each file content
3. Call `vfs.write(path, content, {})` for each file to populate VFS
4. Agent files auto-register via existing VFS -> agent registry flow
5. Set a loading flag to prevent echo writes back to disk

### Writing to disk (on VFS changes)

1. Subscribe to `vfsStore` via Zustand `subscribe()`
2. On each state change, compare previous and current `files` Map
3. New/changed files: create directories as needed, write content
4. Deleted files: remove from disk
5. Skip writes during initial disk load (echo prevention flag)

### Data Flow

```
User picks folder --> DiskSync.open(handle)
  --> reads all files --> vfs.write() each --> VFS populated

Agent runs --> vfs_write plugin --> VFS updated
  --> DiskSync subscription fires --> writes to disk

Editor save --> VFS updated
  --> DiskSync subscription fires --> writes to disk
```

## Project Store (`src/stores/project-store.ts`)

Zustand vanilla store:

```typescript
interface ProjectState {
  dirHandle: FileSystemDirectoryHandle | null;
  projectName: string | null;
  syncStatus: 'disconnected' | 'syncing' | 'connected' | 'error';
  open(handle: FileSystemDirectoryHandle): Promise<void>;
  close(): void;
}
```

## UI Changes

### TopBar

- Folder icon button next to gear icon
- Shows "Open Project" when disconnected
- Shows folder name + sync status indicator when connected
- Click to open folder picker or disconnect

### Status Indicator

- Small colored dot in TopBar: gray (disconnected), blue (syncing), green (connected), red (error)

## Error Handling

- Permission denied on folder picker: show brief status message, no crash
- File write failure mid-session: catch error, log to console, set status to 'error', don't crash agent run
- File read failure during load: skip file, console warning
- Unsupported browser (no File System Access API): hide "Open Project" button

## Scope Limits (YAGNI)

- No file watching -- external disk edits require re-opening project
- No conflict resolution -- VFS is source of truth
- No selective sync -- all VFS files get written
- No handle persistence via IndexedDB -- user re-picks each session
- No nested folder creation UI -- only VFS path-based auto-creation

## Testing Strategy

- Unit tests for DiskSync with mocked FileSystemDirectoryHandle
- Unit tests for projectStore state transitions
- Existing VFS tests unchanged (VFS store not modified)
