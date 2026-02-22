# Autonomous Mode - Implementation Plan

## Context

Markdown Agent Studio currently runs agents in single-shot mode: create a kernel, process one activation queue, summarize, stop. Agents are limited to 25 turns and one context window. The user's vision is for agents that can run indefinitely -- learning, exploring, and building knowledge across many context windows. When context fills up, the system compresses what was learned into long-term memory and starts a fresh cycle with the mission re-injected. This is the missing piece that turns MAS from a "run once" tool into a true autonomous learning system.

The existing architecture already has the foundation: long-term memory with scoring/retrieval (MemoryManager), post-run summarization (Summarizer), memory injection into system prompts, and working memory for intra-run sharing. Autonomous mode builds on all of these.

## Design Decisions (from user input)

- **Continuation strategy**: Goal-driven loop with persistent task queue. Each cycle re-injects the agent's mission + compressed memories + task queue state.
- **Context compression**: End-of-cycle summarization. At ~80% token budget, inject a wrap-up signal. Agent gets 2-3 final turns to save findings. Existing Summarizer compresses into long-term memory.
- **Stop conditions**: Configurable cycle limit (default 10) + manual stop. No agent self-termination tool.
- **Activation**: Agent frontmatter can declare `mode: autonomous` (sets default). TopBar provides a run-mode dropdown to override at runtime.

---

## Implementation

### Step 1: Type changes

**`src/types/kernel.ts`** -- Add to `KernelConfig`:
- `wrapUpThreshold?: number` (0.0-1.0, used internally by AutonomousRunner, not user-facing)
- `autonomousMaxCycles?: number` (user-facing setting, default 10)

Add to `DEFAULT_KERNEL_CONFIG`:
- `autonomousMaxCycles: 10`

**`src/types/agent.ts`** -- Add:
```typescript
export interface AutonomousConfig {
  maxCycles: number;
}
```
Add `autonomousConfig?: AutonomousConfig` to `AgentProfile`.

### Step 2: Agent frontmatter parsing

**`src/utils/parse-agent.ts`** -- Add `parseAutonomousConfig()`:
- If frontmatter has `mode: 'autonomous'`, parse `autonomous.max_cycles` (default 10, clamp 1-100)
- Return `AutonomousConfig | undefined`
- Call from `parseAgentFile()`, add result to returned profile

Example frontmatter:
```yaml
---
name: Research Agent
mode: autonomous
autonomous:
  max_cycles: 15
safety_mode: gloves_off
---
```

### Step 3: Task queue store

**New file: `src/stores/task-queue-store.ts`**
- Zustand vanilla store
- `TaskItem`: id, description, status (pending/in_progress/done/blocked), notes, priority, timestamps
- Methods: `add()`, `update()`, `remove()`, `getAll()`, `getPending()`, `clear()`
- Persists across cycles within an autonomous run; cleared when a new run starts

**`src/stores/use-stores.ts`** -- Add:
- `export const taskQueueStore = createTaskQueueStore()`
- `export function useTaskQueueStore<T>(selector): T`

### Step 4: Task queue tool plugins

**New file: `src/core/plugins/task-queue-read.ts`**
- `task_queue_read` tool: reads task queue with optional status filter
- Returns formatted task list or "empty" message
- Returns error if not in autonomous mode (no taskQueueStore in context)

**New file: `src/core/plugins/task-queue-write.ts`**
- `task_queue_write` tool: add/update/remove tasks
- Parameters: action (add/update/remove), description, task_id, status, notes, priority

**`src/core/tool-plugin.ts`** -- Add `taskQueueStore?: Store<TaskQueueState>` to `ToolContext`

**`src/core/tool-handler.ts`** -- Add:
- `taskQueueStore` to `ToolHandlerConfig`
- Pass it into `ToolContext` construction (line 83-101)
- Add `'task_queue_read'` and `'task_queue_write'` to the `BUILT_IN_TOOLS` set

These tools are only registered in the tool registry when running in autonomous mode (AutonomousRunner clones the builtin registry and adds them). Single-run mode never sees them.

### Step 5: Kernel changes

**`src/core/kernel.ts`** -- Minimal changes:

1. Add to `KernelDeps`:
   ```typescript
   onBudgetWarning?: (activationId: string) => void;
   ```

2. Add private field `_wrapUpInjected = false`

3. In `runSession()`, between turns (after line 397, before the existing budget check at line 400), add threshold check:
   ```typescript
   if (this.deps.onBudgetWarning && !this._wrapUpInjected) {
     const threshold = this.deps.config.wrapUpThreshold ?? 1.0;
     if (this._totalTokens >= this.deps.config.tokenBudget * threshold) {
       this._wrapUpInjected = true;
       this.deps.onBudgetWarning(activation.id);
     }
   }
   ```

4. Add public getter:
   ```typescript
   getActiveSession(activationId: string): AgentSession | undefined {
     return this.activeSessions.get(activationId);
   }
   ```

### Step 6: AutonomousRunner

**New file: `src/core/autonomous-runner.ts`** (~200 lines)

Core class that orchestrates the cycle loop:

```
AutonomousRunner
  - config: { maxCycles, wrapUpThreshold (0.8), agentPath, missionPrompt, kernelConfig }
  - holds: MemoryManager, taskQueueStore reference, current Kernel
  - tracks: currentCycle, totalTokensAllCycles, stopped flag
  - emits state changes to listeners (cycle number, totals)

  run():
    for cycle 1..maxCycles:
      if stopped: break
      cycleInput = buildCycleInput()
      kernel = createCycleKernel()    // fresh kernel per cycle
      kernel.enqueue(activation)
      await kernel.runUntilEmpty()
      if stopped: break
      await runSummarization(kernel)
      clear sessionStore for next cycle

  buildCycleInput():
    1. "## Mission\n" + original mission prompt
    2. "## Cycle N of M\n" + continuation note if N > 1
    3. "## Task Queue\n" + formatted task list from taskQueueStore
    4. "## Instructions\n" + info about available tools

  createCycleKernel():
    - Creates Kernel with wrapUpThreshold: 0.8
    - Clones builtin registry + task_queue_read + task_queue_write
    - Sets onBudgetWarning callback that injects wrap-up message into session history
    - Passes taskQueueStore to ToolHandler via deps

  onBudgetWarning callback:
    - Gets active session via kernel.getActiveSession()
    - Pushes a user-role message: "Context limit approaching. Save findings to memory_write,
      write remaining tasks to task_queue_write. 2-3 turns remaining."

  stop(): sets _stopped = true, kills current kernel
  pause()/resume(): delegates to current kernel
```

Long-term memory injection happens automatically -- the kernel already calls `memoryManager.buildMemoryPrompt()` at the start of each activation (kernel.ts lines 281-293). No changes needed there.

### Step 7: RunController changes

**`src/core/run-controller.ts`**

1. Extend `RunControllerState`:
   ```typescript
   isAutonomous: boolean;    // default false
   currentCycle: number;     // default 0
   maxCycles: number;        // default 0
   ```

2. Add `runAutonomous(agentPath: string, input: string)` method:
   - Reads `kernelConfig.autonomousMaxCycles` from settings
   - Reads agent profile for frontmatter `autonomousConfig.maxCycles` (fallback)
   - Priority: settings override > agent frontmatter > default 10
   - Creates AutonomousRunner with config
   - Subscribes to runner state for cycle updates
   - Sets `isAutonomous: true` in state
   - Awaits runner.run()
   - Cleans up: sets `isAutonomous: false`

3. Update `pause()`, `resume()`, `killAll()` to delegate to AutonomousRunner when active

4. Store private `autonomousRunner: AutonomousRunner | null` reference

### Step 8: useKernel hook

**`src/hooks/useKernel.ts`** -- Extend `run` callback:
```typescript
const run = useCallback(async (
  agentPath: string,
  input: string,
  options?: { autonomous?: boolean }
) => {
  if (options?.autonomous) {
    await runController.runAutonomous(agentPath, input);
  } else {
    await runController.run(agentPath, input);
  }
}, []);
```

Return `isAutonomous`, `currentCycle`, `maxCycles` from state.

### Step 9: TopBar UI

**`src/components/layout/TopBar.tsx`**

1. Add run-mode state: `const [runMode, setRunMode] = useState<'once' | 'autonomous'>('once')`

2. Default from selected agent's frontmatter:
   ```typescript
   useEffect(() => {
     const profile = selectedAgent ? agentsMap.get(selectedAgent) : null;
     setRunMode(profile?.autonomousConfig ? 'autonomous' : 'once');
   }, [selectedAgent, agentsMap]);
   ```

3. Add dropdown between prompt input and Run button:
   ```tsx
   <select value={runMode} onChange={...} className={styles.select}>
     <option value="once">Run Once</option>
     <option value="autonomous">Autonomous</option>
   </select>
   ```

4. Update `handleRun()` to pass `{ autonomous: true }` when `runMode === 'autonomous'`

5. Add cycle counter to stats span:
   ```tsx
   {isRunning && isAutonomous && `Cycle ${currentCycle}/${maxCycles} | `}
   ```

### Step 10: Settings Modal

**`src/components/settings/SettingsModal.tsx`**

Add "Autonomous Mode" section between Memory System and Danger Zone:
```tsx
<div className={styles.section}>
  <h3 className={styles.sectionTitle}>Autonomous Mode</h3>
  <label className={styles.label}>
    <span className={styles.labelText}>Default Max Cycles</span>
    <input
      type="number" min={1} max={100}
      defaultValue={kernelConfig.autonomousMaxCycles ?? 10}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (!isNaN(v)) uiStore.getState().setKernelConfig({ autonomousMaxCycles: v });
      }}
      className={styles.input}
    />
  </label>
</div>
```

---

## File Summary

**New files (4):**
| File | Purpose | ~Lines |
|------|---------|--------|
| `src/core/autonomous-runner.ts` | Cycle loop orchestrator | 200 |
| `src/stores/task-queue-store.ts` | Persistent task queue store | 80 |
| `src/core/plugins/task-queue-read.ts` | Tool: read task queue | 40 |
| `src/core/plugins/task-queue-write.ts` | Tool: write task queue | 60 |

**Modified files (10):**
| File | Changes |
|------|---------|
| `src/types/kernel.ts` | Add `wrapUpThreshold`, `autonomousMaxCycles` to KernelConfig |
| `src/types/agent.ts` | Add `AutonomousConfig`, `autonomousConfig` to AgentProfile |
| `src/utils/parse-agent.ts` | Add `parseAutonomousConfig()`, call from `parseAgentFile()` |
| `src/core/kernel.ts` | Add `onBudgetWarning` callback, threshold check, `getActiveSession()` |
| `src/core/run-controller.ts` | Add `runAutonomous()`, extend state, delegate pause/resume/kill |
| `src/core/tool-plugin.ts` | Add `taskQueueStore` to `ToolContext` |
| `src/core/tool-handler.ts` | Add `taskQueueStore` to config + context, add tools to `BUILT_IN_TOOLS` set |
| `src/stores/use-stores.ts` | Add `taskQueueStore` singleton + `useTaskQueueStore` hook |
| `src/hooks/useKernel.ts` | Extend `run()` signature, return cycle state |
| `src/components/layout/TopBar.tsx` | Add run-mode dropdown, cycle counter |
| `src/components/settings/SettingsModal.tsx` | Add Autonomous Mode section with max cycles |

## Implementation Order

Steps 1-10 as listed above. Dependencies flow downward: types -> stores -> plugins -> kernel -> runner -> controller -> hooks -> UI.

## Edge Cases

- **Agent ignores wrap-up signal**: Existing hard budget halt at 100% kicks in. AutonomousRunner treats budget-halted kernel as cycle end, proceeds to summarization.
- **User clicks Kill All during autonomous mode**: Sets `_stopped` on runner, calls `kernel.killAll()` on current kernel. Cycle loop exits.
- **Cumulative token tracking**: Each cycle gets its own kernel with full token budget. RunControllerState `totalTokens` sums all cycles.
- **VFS persistence**: VFS is not cleared between cycles -- agent's file work accumulates correctly.
- **Working memory**: Cleared between cycles (existing behavior via `kernel.runUntilEmpty()` -> `endRun()`). Long-term memory persists via IndexedDB.
- **Task queue**: Persists across cycles, cleared when new autonomous run starts.

## Verification

1. **Unit**: The AutonomousRunner can be tested with ScriptedAIProvider by scripting multi-cycle responses
2. **Integration**: Create a test agent with `mode: autonomous`, run it, verify:
   - Cycles increment in UI
   - Wrap-up signal appears in chat log at ~80% budget
   - Long-term memories accumulate across cycles
   - Task queue persists across cycles
   - Manual stop works mid-cycle
   - Single-run mode still works unchanged
3. **Manual**: Open the app, select an agent, toggle "Autonomous" in dropdown, click Run. Watch cycles progress in TopBar stats. Click Kill All to stop.
