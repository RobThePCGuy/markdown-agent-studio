# Persist long-term memory as files in the project folder

## Context

Long-term memory currently lives only in browser IndexedDB (`mas-long-term-memory` database). This means:
- Memories are invisible in the project folder -- nothing in the file explorer
- Memories are tied to the browser, not the project -- clearing browser data loses them
- Opening the same project folder on another machine has no memory

The user wants long-term memories saved as files in the project folder so that reopening the folder restores all previous memory.

## Approach: VFS-backed MemoryDB

Replace IndexedDB with a `VFSMemoryDB` that stores memories as a JSON file at `memory/long-term-memory.json` in the VFS. DiskSync already watches VFS changes and writes them to disk, so this gives file persistence for free.

**Lifecycle:**
1. User opens project folder -> DiskSync loads `memory/long-term-memory.json` into VFS
2. Agent runs -> summarizer creates LTM entries -> VFSMemoryDB writes JSON to VFS
3. DiskSync syncs VFS change to disk automatically
4. App closes, reopens project folder -> step 1 restores memories

## Changes

### 1. Add `VFSMemoryDB` to `src/core/memory-db.ts`

New class implementing the existing `MemoryDB` interface:
- Takes a VFS store reference in constructor
- Uses fixed path `memory/long-term-memory.json`
- `getAll()`: read VFS file at that path, parse JSON, return entries (empty array if file missing)
- `put()`: read all, upsert by `entry.id`, write back as pretty JSON
- `delete()`: read all, remove by id, write back
- `clear()`: write `[]` to the VFS path

Update `createMemoryDB()` factory to accept an optional VFS store:
```typescript
export function createMemoryDB(vfs?: Store<VFSState>): MemoryDB {
  if (vfs) return new VFSMemoryDB(vfs);
  if (typeof indexedDB !== 'undefined') return new IndexedDBMemoryDB();
  return new InMemoryMemoryDB();
}
```

### 2. Wire VFS into `src/core/run-controller.ts`

Change the MemoryManager initialization from:
```typescript
private memoryManager = new MemoryManager(createMemoryDB());
```
to:
```typescript
private memoryManager = new MemoryManager(createMemoryDB(vfsStore));
```

This routes all memory storage through the VFS (and thus to disk via DiskSync).

### 3. Fix `src/components/inspector/MemoryPanel.tsx`

The MemoryPanel currently creates its own `createMemoryDB()` + `MemoryManager` to read LTM (line 25-27). Update to pass `vfsStore`:
```typescript
const db = createMemoryDB(vfsStore);
```

Also import `vfsStore` from `use-stores`.

### 4. Keep existing backends for tests/SSR

`InMemoryMemoryDB` stays for tests. `IndexedDBMemoryDB` stays as fallback when no VFS is provided. No breaking changes to existing tests since they don't pass a VFS store.

## Files to modify

| File | Change |
|------|--------|
| `src/core/memory-db.ts` | Add `VFSMemoryDB` class, update `createMemoryDB()` signature |
| `src/core/run-controller.ts` | Pass `vfsStore` to `createMemoryDB()` |
| `src/components/inspector/MemoryPanel.tsx` | Pass `vfsStore` to `createMemoryDB()` |

## Verification

1. `npx vitest run` -- all existing tests pass (they use InMemoryMemoryDB, unaffected)
2. Open a project folder, run an agent with memory enabled, verify `memory/long-term-memory.json` appears in the file explorer and on disk
3. Close and reopen the project folder -- Long-Term Memory panel should show previously stored memories
4. Run another agent -- verify it receives the restored memories in its system prompt context
