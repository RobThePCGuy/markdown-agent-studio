# Merge Worktree into Main: Fill Implementation Gaps

## Context

The worktree at `.worktrees/v0.4.0-foundation` (branch `feature/v0.4.0-complete-foundation`, commit `cffcb2d`) contains significant functionality that main lacks - most critically, real MCP SDK integration (main has stubs), kernel code deduplication, a workflow step runner abstraction, persistent IndexedDB vector store, and a custom WorkflowStepNode component. All changes are committed. A `git merge-tree` simulation shows **8 auto-merges** and **5 conflicts**. We merge, then resolve the 5 conflicts.

---

## Step 1: Merge with Conflicts

```bash
git merge feature/v0.4.0-complete-foundation --no-commit
```

This brings in all auto-merged files and marks the 5 conflicts for manual resolution.

**Auto-merged cleanly (no action needed):**
- `src/components/graph/GraphView.tsx`
- `src/core/mcp-client.ts` (real SDK integration - the big win)
- `src/core/mcp-client.test.ts` (expanded to 215 lines)
- `src/core/workflow-engine.ts`
- `src/core/tool-plugin.ts` (`any` -> `Store<PubSubState>`)
- `src/core/vector-store.ts` (`IVectorStore` interface + export `cosineSimilarity`)
- `src/core/vector-memory-db.ts` (accept `IVectorStore` via constructor)
- `src/hooks/useKernel.ts`
- `package.json` / `package-lock.json` (`fake-indexeddb` dev dep)

**New files added cleanly:**
- `src/core/workflow-runner.ts` + `src/core/workflow-runner.test.ts`
- `src/core/persistent-vector-store.ts` + `src/core/persistent-vector-store.test.ts`
- `src/components/graph/WorkflowStepNode.tsx` + `.module.css`

---

## Step 2: Resolve 5 Conflicts

### 2a. `src/components/settings/SettingsModal.tsx`

**Resolution: Keep worktree's MCP section, keep main's everything else.**

Both sides added an MCP Servers section. Worktree's is better: supports all 3 transports (http, sse, stdio with warning), collapsible form with `mcpFormOpen` state, CSS class styling, uses individual `addMcpServer()`/`removeMcpServer()` methods. Main's section can be dropped since the worktree's supercedes it. The worktree also added the `.mcpServerRow`, `.mcpForm`, etc. CSS classes in `SettingsModal.module.css` (auto-merged).

Conflict is likely in the MCP section insertion point. Take worktree's block, ensure it sits after main's existing sections.

### 2b. `src/core/kernel.ts`

**Resolution: Worktree's `_executeSession()` unification + main's `setupAgentMcp()` inlined.**

- Take worktree's structure: `runSession()` becomes thin wrapper calling `_executeSession({...all true})`, `runSessionAndReturn()` calls `_executeSession({...all false})`
- Delete `_runSessionForResult()` entirely (absorbed into `_executeSession()`)
- Delete main's separate `setupAgentMcp()` method - inline the MCP setup into `_executeSession()`. The worktree's `connect()` now handles stdio gracefully (returns early, logs warning), so the elaborate filtering in `setupAgentMcp()` is unnecessary. Just loop and call `connect()` + bridge tools.
- Keep main's error handling patterns (try/catch around connect with warning events)
- Net result: ~1074 lines -> ~800 lines

### 2c. `src/core/run-controller.ts`

**Resolution: Keep main's rich `runWorkflow()`/`resumeWorkflow()`, adopt worktree's abort support.**

Main's version is more mature: has variable extraction, modal, per-step token tracking, output file writing, resume support. Worktree's version is simpler but lacks these features.

From worktree, take:
- `workflowAbort: AbortController | null` field
- `this.workflowAbort.abort()` in `killAll()` for cancel support
- `abort.signal` passed to `engine.execute()`

Don't refactor to `createStepRunner()` yet - main's inline step logic has richer token/state tracking that doesn't cleanly fit the worktree's simpler interface. The `workflow-runner.ts` file still gets added (auto-merge) for future use.

### 2d. `src/hooks/useGraphData.ts`

**Resolution: Take worktree's WorkflowStepNode-based visualization.**

Worktree has step-level nodes with status colors, dependency edges, and agent-to-step edges. Main's offset-based approach is too simple. Take worktree's additions.

Fix the duplicate key bug in the return object:
```typescript
// BAD (worktree has this):
return { nodes: [...], edges, activeWorkflowName, activeWorkflowName };
// GOOD:
return { nodes: [...], edges, activeWorkflowName };
```

Also register `workflowStepNode` in the `nodeTypes` map in `GraphView.tsx` (if the auto-merge doesn't handle this - verify).

### 2e. `src/stores/use-stores.ts`

**Resolution: Keep main's fields + add worktree's individual MCP methods.**

Keep from main:
- `globalMcpServers: MCPServerConfig[]` (name + localStorage key)
- `setGlobalMcpServers()` bulk setter
- `workflowVariableModal` state + setter
- `MCPClientManager.parseServerConfigs()` for localStorage validation

Add from worktree:
- `addMcpServer()` - appends to `globalMcpServers`, persists
- `removeMcpServer()` - filters from `globalMcpServers`, persists
- `updateMcpServer()` - maps over `globalMcpServers`, persists

No duplicate `mcpServers` field - the individual methods operate on `globalMcpServers`.

---

## Step 3: Post-Merge Fixups

1. **Register WorkflowStepNode in GraphView.tsx** - Add to `nodeTypes` map:
   ```typescript
   import { WorkflowStepNode } from './WorkflowStepNode';
   const nodeTypes: NodeTypes = { agentNode: AgentNode, workflowStepNode: WorkflowStepNode };
   ```

2. **Update SettingsModal to use correct store field** - Worktree's SettingsModal references `s.mcpServers`, but main uses `s.globalMcpServers`. Update the worktree's SettingsModal code to reference `globalMcpServers` and use `addMcpServer`/`removeMcpServer` methods.

3. **Remove stale imports** - If `setupAgentMcp()` is removed from kernel.ts, remove any references. Check `MCPClientManager.createWithGlobalServers()` - if worktree's `connect()` now handles stdio gracefully, this helper may be simplified or removed.

4. **Fix useGraphData duplicate key** - Remove the doubled `activeWorkflowName` in the return object.

5. **Run `npm install`** - The worktree added `fake-indexeddb` to devDependencies.

---

## Step 4: Verification

1. `npm install` - picks up `fake-indexeddb`
2. `npx tsc --noEmit` - TypeScript build clean
3. `npx vitest run` - all tests pass (baseline: 401 passed, 4 skipped + new tests from worktree)
4. Spot-check: `src/core/mcp-client.ts` has real SDK imports, not stubs
5. Spot-check: `src/core/kernel.ts` has single `_executeSession()` method, no `_runSessionForResult()`
6. Commit the merge

---

## Summary of What We Gain

| Feature | Before (main) | After (merged) |
|---------|---------------|----------------|
| MCP connect/callTool | Stubs returning errors | Real SDK with HTTP/SSE transports |
| Kernel session code | 585 lines duplicated across 2 methods | ~300 lines in unified `_executeSession()` |
| Workflow step runner | Inline in run-controller | Clean `createStepRunner()` factory |
| Vector store persistence | In-memory only | IndexedDB-backed with cache |
| Workflow graph viz | Offset-based grouping | Per-step nodes with status + edges |
| PubSubState typing | `any` | `Store<PubSubState>` |
| MCP settings granularity | Bulk setter only | add/remove/update individual servers |
| Test coverage | 401 tests | +3 new test files (~500 lines) |
