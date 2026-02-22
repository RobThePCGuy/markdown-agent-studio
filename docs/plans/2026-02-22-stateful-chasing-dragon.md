# Agent Persistence: Don't Give Up

## Context

Agents in markdown-agent-studio give up too quickly. They make a few tool calls, produce a text response, and stop - well before hitting the 25-turn limit or token budget. This happens in both single-run mode and autonomous cycles. The user wants agents that are relentless: keep researching even when stuck, learn from mistakes, spawn sub-agents for help, and max out their context before stopping.

## Overview

Four interconnected changes to the kernel and autonomous runner:

1. **Nudge system** - push agents to keep working when they stop too early
2. **Tool failure tracking** - auto-detect and record mistakes in memory
3. **Forced reflection** - make agents write what they learned before ending
4. **Smart cycling** - detect incomplete work and keep cycling in autonomous mode

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/kernel.ts` | Add `minTurnsBeforeStop`, `maxNudges`, `forceReflection`, `autoRecordFailures` to `KernelConfig` |
| `src/core/kernel.ts` | Nudge system, tool failure tracking, reflection injection, WORKSPACE_PREAMBLE update |
| `src/core/autonomous-runner.ts` | Completeness assessment, enhanced wrap-up with reflection, persistence instructions in cycle input, `minCycles` config |
| `src/core/run-controller.ts` | Pass `minCycles` through to AutonomousRunner |
| `src/components/settings/SettingsModal.tsx` | Add UI controls for new persistence settings |
| `src/core/kernel.test.ts` | Tests for nudge behavior, failure tracking |

---

## Step 1: Extend KernelConfig

**File**: `src/types/kernel.ts`

Add to `KernelConfig` interface:
- `minTurnsBeforeStop?: number` - minimum turns before agent can stop without nudge (0 = disabled)
- `maxNudges?: number` - max nudge prompts per session (default 3)
- `forceReflection?: boolean` - inject reflection prompt at end of session
- `autoRecordFailures?: boolean` - auto-write tool failures to memory

Add to `DEFAULT_KERNEL_CONFIG`:
- `minTurnsBeforeStop: 5` (enabled by default - the whole point of this feature)
- `maxNudges: 3`
- `forceReflection: true`
- `autoRecordFailures: true`

## Step 2: Nudge System in Kernel

**File**: `src/core/kernel.ts`

### 2a. Add helper functions

Add `isToolFailure(result: string): boolean` - checks for error patterns in tool results (`error:`, `not found`, `policy blocked`, empty string, etc.)

Add `buildNudgePrompt(currentTurn, maxTurns, nudgeCount): string` - three escalating prompts:
- Nudge 1: "You still have N turns. Review your progress. What's missing? Try a different approach or use web_search / spawn_agent."
- Nudge 2: "You stopped twice. Before finishing, you MUST: write findings to vfs_write, try a different approach, or spawn a sub-agent."
- Nudge 3 (final): "Last chance. Write your output to a file or record what you learned with memory_write."

### 2b. Modify `runSession()` (lines 290-466)

Before the `for` loop, add:
```typescript
let nudgeCount = 0;
const maxNudges = this.deps.config.maxNudges ?? 3;
const minTurns = this.deps.config.minTurnsBeforeStop ?? 0;
const toolFailures: Array<{ tool: string; args: string; error: string }> = [];
```

In the `tool_call` case (line 342-375), after `toolHandler.handle()` returns, check `isToolFailure(result)` and push to `toolFailures`.

At the break condition (line 411), replace with nudge logic:
```
if (!hadToolCalls && session.status === 'running' && turn < minTurns && nudgeCount < maxNudges) {
  nudgeCount++;
  inject nudge prompt into session.history;
  continue;  // skip the break
}
break;
```

After the for loop exits, if `autoRecordFailures` and there are failures, write a summary to working memory with tags `['mistake', 'tool-failure', 'auto-detected']`.

### 2c. Forced reflection after loop

If `forceReflection` is enabled and the session used tools and there's room for one more turn, inject a reflection prompt and run one additional chat turn. The reflection prompt asks the agent to:
- Write `memory_write` with key "session-reflection" summarizing learnings
- Write `memory_write` with key "mistakes" for any failures
- Write `memory_write` with key "next-steps" for incomplete work

To avoid duplicating the streaming loop, extract the inner turn body into a private method `runSingleTurn(session, activation, systemPrompt, sessionRegistry, toolHandler)` that both the main loop and reflection can call.

### 2d. Apply same changes to `_runSessionForResult()` (lines 482-695)

This is the sub-agent path. Apply identical nudge, failure tracking, and reflection logic. Since we're extracting `runSingleTurn()`, both methods will share the implementation.

### 2e. Update WORKSPACE_PREAMBLE

Add one line:
```
'When stuck on a complex sub-problem, use spawn_agent to create a specialist sub-agent for focused research.\n'
```

## Step 3: Autonomous Runner Persistence

**File**: `src/core/autonomous-runner.ts`

### 3a. Add `minCycles` to AutonomousRunnerConfig

```typescript
minCycles?: number;  // minimum cycles before allowing early exit (default 1)
```

### 3b. Add "Work Ethic" section to `buildCycleInput()`

After the cycle info section, add:
```
## Work Ethic
Be thorough and persistent. Do NOT give up after a single attempt.
If a tool call fails, try a different approach. If a search returns no results,
rephrase your query. If you are stuck, spawn a sub-agent to research the problem.
Use ALL available tools before concluding. Write all deliverables to files
using vfs_write - text responses alone are not enough.
```

### 3c. Enhance `injectWrapUpMessage()` with reflection

Add reflection requirements to the wrap-up message:
```
## Required Reflection
Before ending, write a memory_write entry with key "cycle-reflection" that answers:
- What approaches worked in this cycle?
- What approaches FAILED and should not be repeated?
- What is the most promising next step for the next cycle?
```

### 3d. Add `assessCompletion()` method

Returns `'complete' | 'incomplete' | 'uncertain'` based on:
1. **Pending tasks in queue** -> `'incomplete'`
2. **Agent's last message mentions incompleteness** (keywords: "could not", "unable to", "need more", "next step", "incomplete", etc.) -> `'incomplete'`
3. **Very few tool calls** (<= 2 total) -> `'incomplete'` (agent barely tried)
4. **Session ended in error** -> `'incomplete'`
5. **All tasks marked done** -> `'complete'`
6. **Otherwise** -> `'uncertain'` (keep cycling)

### 3e. Wire into cycle loop

After `kernel.runUntilEmpty()` and summarization, check:
- If `assessCompletion()` returns `'complete'` AND `cycle >= minCycles`, break early
- If `'incomplete'` or `'uncertain'`, continue to next cycle

## Step 4: Wire Config Through RunController

**File**: `src/core/run-controller.ts`

In `runAutonomous()`, pass `minCycles: 1` to the AutonomousRunner config. The kernel config already flows through to the Kernel constructor, so the new fields (`minTurnsBeforeStop`, etc.) will be picked up automatically.

## Step 5: Settings UI

**File**: `src/components/settings/SettingsModal.tsx`

Add a new "Agent Persistence" section between "Kernel Limits" and "Memory System" with:
- **Min Turns Before Stop**: number input (0-25, default 5)
- **Force Reflection**: on/off toggle (default on)
- **Auto-Record Failures**: on/off toggle (default on)

## Step 6: Tests

**File**: `src/core/kernel.test.ts`

Add tests:
1. **Nudge fires when agent stops early**: MockAIProvider returns text-only on turn 1, then text+tool_call after nudge. Verify 2 completed turns.
2. **Nudge respects maxNudges cap**: Provider always returns text-only. Verify session completes after maxNudges attempts.
3. **Nudge disabled when minTurnsBeforeStop=0**: Provider returns text-only on turn 1. Verify session stops immediately.
4. **Tool failure detection**: Provider calls tool, result contains "Error:". Verify working memory gets failure entry.
5. **Reflection prompt injected**: With forceReflection=true, verify session.history contains the reflection prompt.

---

## Verification

1. `npm run typecheck` - verify no type errors from new config fields
2. `npm run test` - all existing + new tests pass
3. Manual test in browser:
   - Open Settings, verify new persistence controls appear
   - Set minTurnsBeforeStop to 5, run a single agent with a vague task
   - Verify in session inspector that nudge prompts appear when agent tries to stop early
   - Run autonomous mode, verify "Work Ethic" section in cycle input
   - Verify reflection entries appear in memory after run
   - Verify tool failures are recorded as mistake memories
