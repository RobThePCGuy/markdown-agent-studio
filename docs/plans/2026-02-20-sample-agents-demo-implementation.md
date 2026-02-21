# Sample Agents & Demo Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 3-agent sample with a 6-agent website-building team and a ScriptedAIProvider that runs zero-cost demo sessions through the real kernel pipeline.

**Architecture:** A `ScriptedAIProvider` implements `AIProvider` and yields pre-written `StreamChunk` arrays per agent per turn with simulated streaming delays. `RunController.createKernel()` uses it when no API key is set. Six new sample agents demonstrate every feature. DiskSync gains immediate-flush on every VFS write.

**Tech Stack:** TypeScript, Zustand, Vitest, existing AIProvider/Kernel/ToolHandler interfaces

---

### Task 1: ScriptedAIProvider

**Files:**
- Create: `src/core/scripted-provider.ts`
- Test: `src/core/scripted-provider.test.ts`

**Step 1: Write the failing test**

```typescript
// src/core/scripted-provider.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptedAIProvider } from './scripted-provider';
import type { StreamChunk } from '../types';

describe('ScriptedAIProvider', () => {
  it('yields chunks from the script for the correct agent', async () => {
    const script: Record<string, StreamChunk[][]> = {
      'agents/writer.md': [
        [
          { type: 'text', text: 'Hello from writer' },
          { type: 'done', tokenCount: 5 },
        ],
      ],
    };
    const provider = new ScriptedAIProvider(script);
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat(
      { sessionId: 'sess-1', systemPrompt: '', model: 'test' },
      [{ role: 'user', content: 'go' }],
      [],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello from writer' });
    expect(chunks[1]).toEqual({ type: 'done', tokenCount: 5 });
  });

  it('advances turn index on subsequent calls for the same agent', async () => {
    const script: Record<string, StreamChunk[][]> = {
      'agents/a.md': [
        [{ type: 'text', text: 'turn 1' }, { type: 'done', tokenCount: 1 }],
        [{ type: 'text', text: 'turn 2' }, { type: 'done', tokenCount: 1 }],
      ],
    };
    const provider = new ScriptedAIProvider(script);

    const collect = async (sessionId: string) => {
      const out: StreamChunk[] = [];
      for await (const c of provider.chat(
        { sessionId, systemPrompt: '', model: 'test' },
        [{ role: 'user', content: 'go' }],
        [],
      )) out.push(c);
      return out;
    };

    const t1 = await collect('sess-1');
    const t2 = await collect('sess-1');
    expect(t1[0].text).toBe('turn 1');
    expect(t2[0].text).toBe('turn 2');
  });

  it('yields a fallback done chunk when agent has no script', async () => {
    const provider = new ScriptedAIProvider({});
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat(
      { sessionId: 'sess-x', systemPrompt: '', model: 'test' },
      [{ role: 'user', content: 'go' }],
      [],
    )) chunks.push(chunk);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe('text');
    expect(chunks[1].type).toBe('done');
  });

  it('yields a fallback done chunk when turns are exhausted', async () => {
    const script: Record<string, StreamChunk[][]> = {
      'agents/a.md': [
        [{ type: 'text', text: 'only turn' }, { type: 'done', tokenCount: 1 }],
      ],
    };
    const provider = new ScriptedAIProvider(script);

    // Consume the only turn
    for await (const _ of provider.chat(
      { sessionId: 's1', systemPrompt: '', model: 'test' },
      [{ role: 'user', content: 'go' }],
      [],
    )) {}

    // Next call should get fallback
    const chunks: StreamChunk[] = [];
    for await (const c of provider.chat(
      { sessionId: 's1', systemPrompt: '', model: 'test' },
      [{ role: 'user', content: 'go' }],
      [],
    )) chunks.push(c);

    expect(chunks[0].type).toBe('text');
    expect(chunks[1].type).toBe('done');
  });

  it('supports abort', async () => {
    const script: Record<string, StreamChunk[][]> = {
      'agents/a.md': [
        [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' world' },
          { type: 'done', tokenCount: 2 },
        ],
      ],
    };
    const provider = new ScriptedAIProvider(script);
    await provider.abort('sess-1');

    const chunks: StreamChunk[] = [];
    for await (const c of provider.chat(
      { sessionId: 'sess-1', systemPrompt: '', model: 'test' },
      [{ role: 'user', content: 'go' }],
      [],
    )) chunks.push(c);

    expect(chunks[0].type).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/scripted-provider.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/scripted-provider.ts
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export type ScriptMap = Record<string, StreamChunk[][]>;

const CHUNK_DELAY_MS = 40;

export class ScriptedAIProvider implements AIProvider {
  private scripts: ScriptMap;
  private turnCounters = new Map<string, number>();
  private aborted = new Set<string>();

  constructor(scripts: ScriptMap) {
    this.scripts = scripts;
  }

  /**
   * Resolve agent path from sessionId.
   * Session IDs follow the pattern "act-N" and the kernel stores the agentId
   * on the activation. But the provider only sees the sessionId, so we need
   * a mapping. We track it via registerSession() called before chat().
   */
  private sessionAgentMap = new Map<string, string>();

  registerSession(sessionId: string, agentPath: string): void {
    this.sessionAgentMap.set(sessionId, agentPath);
  }

  async *chat(
    config: AgentConfig,
    _history: Message[],
    _tools: ToolDeclaration[],
  ): AsyncIterable<StreamChunk> {
    if (this.aborted.has(config.sessionId)) {
      yield { type: 'error', error: 'Aborted' };
      return;
    }

    const agentPath = this.sessionAgentMap.get(config.sessionId);
    const agentTurns = agentPath ? this.scripts[agentPath] : undefined;

    if (!agentTurns) {
      yield { type: 'text', text: '(No script for this agent)' };
      yield { type: 'done', tokenCount: 0 };
      return;
    }

    const turnIndex = this.turnCounters.get(config.sessionId) ?? 0;
    this.turnCounters.set(config.sessionId, turnIndex + 1);

    if (turnIndex >= agentTurns.length) {
      yield { type: 'text', text: '(Script complete)' };
      yield { type: 'done', tokenCount: 0 };
      return;
    }

    const chunks = agentTurns[turnIndex];
    for (const chunk of chunks) {
      if (this.aborted.has(config.sessionId)) {
        yield { type: 'error', error: 'Aborted' };
        return;
      }
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
      yield chunk;
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.aborted.add(sessionId);
  }

  endSession(sessionId: string): void {
    this.turnCounters.delete(sessionId);
    this.sessionAgentMap.delete(sessionId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/scripted-provider.test.ts`
Expected: PASS (5 tests)

Note: The test creates the provider directly and uses `chat()` without `registerSession()`, which means `agentPath` will be undefined and it will hit the fallback. The tests need adjustment OR we use a simpler lookup for tests. **The simplest approach for tests:** make the constructor also accept a `sessionIdToAgent` map, OR make the script keys match sessionIds in tests. **Simpler: use sessionId as the lookup key when no agentPath registered.** Update the `chat` method to fall through: `const agentTurns = agentPath ? this.scripts[agentPath] : this.scripts[config.sessionId]`. But this is fragile. **Best approach for tests:** call `registerSession()` in the test before calling `chat()`. Update tests accordingly:

- Before each `chat()` call in tests, call `provider.registerSession('sess-1', 'agents/writer.md')` etc.

**Step 5: Commit**

```bash
git add src/core/scripted-provider.ts src/core/scripted-provider.test.ts
git commit -m "feat: ScriptedAIProvider for zero-cost demo playback"
```

---

### Task 2: Wire ScriptedAIProvider into RunController

**Files:**
- Modify: `src/core/run-controller.ts:55-62` (createKernel method)
- Modify: `src/core/kernel.ts:186` (runSession - register session with provider)

**Step 1: Update createKernel to use ScriptedAIProvider**

In `src/core/run-controller.ts`, replace the MockAIProvider fallback:

```typescript
// At top of file, add import:
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';

// In createKernel(), replace lines 57-62:
private createKernel(config: KernelConfig): Kernel {
    const apiKey = uiStore.getState().apiKey;
    const provider = apiKey && apiKey !== 'your-api-key-here'
      ? new GeminiProvider(apiKey)
      : new ScriptedAIProvider(DEMO_SCRIPT);

    const kernel = new Kernel({
      aiProvider: provider,
      // ... rest unchanged
```

**Step 2: Register session agent mapping in Kernel**

The ScriptedAIProvider needs to know which agent each sessionId belongs to. In `src/core/kernel.ts`, add registration calls in `runSession()` and `_runSessionForResult()` right before the first `aiProvider.chat()` call.

In `runSession()` around line 290, before the stream:
```typescript
// Register session with scripted provider if applicable
if ('registerSession' in this.deps.aiProvider) {
  (this.deps.aiProvider as any).registerSession(activation.id, activation.agentId);
}
```

Same in `_runSessionForResult()` around line 538.

**Step 3: Run existing kernel tests to verify nothing broke**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: PASS (11 tests)

**Step 4: Commit**

```bash
git add src/core/run-controller.ts src/core/kernel.ts
git commit -m "feat: wire ScriptedAIProvider into kernel for demo mode"
```

---

### Task 3: Sample Agent Definitions (6 agents)

**Files:**
- Modify: `src/core/sample-project.ts` (replace SAMPLE_AGENTS array)

**Step 1: Write the 6 agent definitions**

Replace `SAMPLE_AGENTS` in `src/core/sample-project.ts` with the full team. Each agent has carefully designed frontmatter showcasing different safety modes, permissions, and capabilities.

The agents:
1. **Project Lead** (balanced, spawns, web, custom_tools)
2. **UX Researcher** (safe, web, signals)
3. **Designer** (balanced, signals)
4. **HTML Developer** (safe, signals)
5. **CSS Developer** (safe, signals)
6. **QA Reviewer** (gloves_off, custom_tools, signals)

QA Reviewer includes a custom tool definition in frontmatter:
```yaml
tools:
  - name: design_review
    description: "Review a web page for design quality, accessibility, and best practices"
    parameters:
      html_path:
        type: string
        description: "Path to the HTML file to review"
      css_path:
        type: string
        description: "Path to the CSS file to review"
    prompt: |
      Review the following web page files for design quality, accessibility, and best practices.
      HTML file ({{html_path}}): read it via vfs_read.
      CSS file ({{css_path}}): read it via vfs_read.
      Provide a structured review with scores and recommendations.
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: PASS (232 tests - sample project is data, no logic change)

**Step 3: Commit**

```bash
git add src/core/sample-project.ts
git commit -m "feat: 6-agent website-building team for sample project"
```

---

### Task 4: Demo Script Data

**Files:**
- Create: `src/core/demo-script.ts`

This is the largest task - it contains all pre-scripted agent responses. Each agent gets a realistic conversation script with tool calls that flow through the real kernel.

**Step 1: Write the demo script**

The script must produce realistic streaming text and tool calls in the correct order. Key interactions:

**Project Lead Turn 1:** Think aloud, write plan to memory, spawn UX Researcher
**Project Lead Turn 2 (after signal):** Acknowledge research, spawn Designer + HTML Dev + CSS Dev
**Project Lead Turn 3 (after signals):** Spawn QA Reviewer
**Project Lead Turn 4 (after QA signal):** Write final summary

**UX Researcher Turn 1:** web_search for "modern portfolio website design trends 2026", memory_write findings, signal_parent

**Designer Turn 1:** memory_read research, vfs_write artifacts/design-spec.md, signal_parent

**HTML Dev Turn 1:** memory_read spec, vfs_read artifacts/design-spec.md, vfs_write site/index.html, signal_parent

**CSS Dev Turn 1:** memory_read spec, vfs_read artifacts/design-spec.md, vfs_write site/styles.css, signal_parent

**QA Reviewer Turn 1:** vfs_read site/index.html, vfs_read site/styles.css, vfs_write artifacts/qa-report.md, signal_parent

Each tool_call chunk needs a unique `id` field (e.g., `tc-demo-001`).

The HTML file should be a complete, attractive portfolio page. The CSS should be a full stylesheet. These are the "wow" artifacts the user can open in the editor or sync to disk.

```typescript
// src/core/demo-script.ts
import type { StreamChunk } from '../types';
import type { ScriptMap } from './scripted-provider';

// Helper to create a tool call chunk
function tc(id: string, name: string, args: Record<string, unknown>): StreamChunk {
  return { type: 'tool_call', toolCall: { id, name, args } };
}

function text(t: string): StreamChunk {
  return { type: 'text', text: t };
}

function done(tokens: number): StreamChunk {
  return { type: 'done', tokenCount: tokens };
}

export const DEMO_SCRIPT: ScriptMap = {
  'agents/project-lead.md': [
    // Turn 1: Plan + spawn researcher
    [
      text("I'll build a portfolio website for you. Let me start by planning the project and assembling the team.\n\nFirst, I'll document the project plan, then bring in a UX researcher to study current design trends."),
      tc('tc-d-001', 'memory_write', {
        key: 'project-plan',
        value: 'Portfolio Website Build\n\nPhases:\n1. Research modern portfolio design trends\n2. Create component specifications\n3. Build HTML structure\n4. Style with CSS\n5. QA review\n\nTarget: Clean, modern single-page portfolio with hero, about, projects, and contact sections.',
        tags: 'plan,project',
      }),
      tc('tc-d-002', 'spawn_agent', {
        filename: 'ux-researcher.md',
        content: '(already exists in VFS)',
        task: 'Research modern portfolio website design trends for 2026. Focus on layout patterns, color schemes, typography, and interaction design. Search the web for current best practices.',
      }),
      done(180),
    ],
    // Turn 2: After researcher signals - spawn build team
    [
      text("Great research findings. Now I'll assemble the build team - a designer for specifications, plus HTML and CSS developers working in parallel."),
      tc('tc-d-003', 'spawn_agent', {
        filename: 'designer.md',
        content: '(already exists in VFS)',
        task: 'Read the UX research findings from memory and create a detailed component specification for a portfolio website. Write the spec to artifacts/design-spec.md.',
      }),
      tc('tc-d-004', 'spawn_agent', {
        filename: 'html-dev.md',
        content: '(already exists in VFS)',
        task: 'Read the design specification and build the HTML structure for a portfolio website. Write the complete HTML to site/index.html.',
      }),
      tc('tc-d-005', 'spawn_agent', {
        filename: 'css-dev.md',
        content: '(already exists in VFS)',
        task: 'Read the design specification and create the stylesheet for a portfolio website. Write the complete CSS to site/styles.css.',
      }),
      done(120),
    ],
    // Turn 3: After build team signals - spawn QA
    [ ... ],
    // Turn 4: After QA signals - final summary
    [ ... ],
  ],
  'agents/ux-researcher.md': [ ... ],
  'agents/designer.md': [ ... ],
  'agents/html-dev.md': [ ... ],
  'agents/css-dev.md': [ ... ],
  'agents/qa-reviewer.md': [ ... ],
};
```

Full content for each agent's turns will include realistic streaming text and complete file contents (HTML/CSS/markdown).

**Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/core/demo-script.ts
git commit -m "feat: pre-scripted demo conversation for website-building team"
```

---

### Task 5: Handle spawn_agent for pre-existing agents

**Files:**
- Modify: `src/core/plugins/spawn-agent.ts`

**Problem:** The demo script's spawn_agent calls include `content: '(already exists in VFS)'` because the agents are already loaded as sample agents. The spawn plugin currently always writes the content to VFS. We need it to detect when an agent already exists and just activate it instead of overwriting.

**Step 1: Read current spawn-agent.ts**

Read: `src/core/plugins/spawn-agent.ts`

**Step 2: Add pre-existing agent detection**

Before the VFS write in the spawn handler, check if the agent already exists in the registry. If so, skip the write and just enqueue the activation:

```typescript
// After the path is constructed but before writing:
const existing = ctx.registry.getState().get(path);
if (existing) {
  // Agent already registered - just activate it with the task
  ctx.onSpawnActivation({
    agentId: path,
    input: args.task as string,
    parentId: ctx.currentAgentId,
    spawnDepth: ctx.spawnDepth + 1,
    priority: 0,
  });
  ctx.incrementSpawnCount();
  ctx.eventLog.getState().append({
    type: 'spawn',
    agentId: ctx.currentAgentId,
    activationId: ctx.currentActivationId,
    data: { childAgent: path, depth: ctx.spawnDepth + 1 },
  });
  return `Activated existing agent "${existing.name}" at ${path} (depth ${ctx.spawnDepth + 1}).`;
}
// ... existing write + register logic continues below
```

**Step 3: Run existing tests**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: PASS (11 tests)

**Step 4: Commit**

```bash
git add src/core/plugins/spawn-agent.ts
git commit -m "fix: spawn_agent activates pre-existing agents without overwriting"
```

---

### Task 6: DiskSync Immediate Flush

**Files:**
- Modify: `src/core/disk-sync.ts:153-183` (VFS subscription handler)
- Test: `src/core/disk-sync.test.ts` (new, optional)

**Step 1: Add immediate flush after scheduling**

In the VFS subscription handler in `disk-sync.ts`, after `this.scheduleFlush()` on line 179, add an immediate flush call. This ensures every VFS write goes to disk right away when connected:

```typescript
// Replace line 179:
// this.scheduleFlush();

// With:
this.flush();
```

This is the simplest change -- every VFS mutation triggers an immediate disk write. The debounce timer is no longer needed for the subscription path but `scheduleFlush()` can remain for any other callers.

Actually, calling `flush()` directly is better than `scheduleFlush()` since it ensures immediate persistence. The async `writeFile` calls inside `flush()` are fire-and-forget with error logging, so this won't block the UI.

**Step 2: Run existing tests**

Run: `npx vitest run`
Expected: PASS (232 tests)

**Step 3: Commit**

```bash
git add src/core/disk-sync.ts
git commit -m "fix: DiskSync flushes immediately on every VFS write"
```

---

### Task 7: Update Welcome Banner and Onboarding

**Files:**
- Modify: `src/components/graph/GraphView.tsx:134-138` (welcome banner text)
- Modify: `src/hooks/useOnboarding.ts` (no logic change needed, just verify)

**Step 1: Update welcome banner text**

```tsx
{showWelcome && (
  <div className={styles.welcomeBanner}>
    <span>Welcome to Markdown Agent Studio. Hit <strong>Run</strong> with the Project Lead agent selected to watch a team of AI agents build a portfolio website.</span>
    <button onClick={dismissWelcome} className={styles.welcomeDismiss}>Got it</button>
  </div>
)}
```

**Step 2: Verify onboarding still loads sample project**

The `useOnboarding` hook calls `loadSampleProject()` which now loads 6 agents instead of 3. No code change needed -- just verify the agent dropdown shows all 6 agents.

**Step 3: Build and verify**

Run: `npx vite build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/graph/GraphView.tsx
git commit -m "feat: update welcome banner for portfolio demo scenario"
```

---

### Task 8: Integration Test - Full Demo Run

**Files:**
- Create: `src/core/demo-integration.test.ts`

**Step 1: Write integration test**

This test verifies the complete demo runs through the kernel without errors and produces expected outputs:

```typescript
import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { createSessionStore } from '../stores/session-store';
import { SAMPLE_AGENTS } from './sample-project';

describe('Demo integration', () => {
  it('runs the full demo script and produces expected artifacts', async () => {
    const vfs = createVFSStore();
    const registry = createAgentRegistry();
    const eventLog = createEventLog(vfs);
    const sessionStore = createSessionStore();

    // Load sample agents into VFS and registry
    for (const agent of SAMPLE_AGENTS) {
      vfs.getState().write(agent.path, agent.content, {});
      registry.getState().registerFromFile(agent.path, agent.content);
    }

    const provider = new ScriptedAIProvider(DEMO_SCRIPT);
    const kernel = new Kernel({
      aiProvider: provider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: {
        maxConcurrency: 3,
        maxDepth: 5,
        maxFanout: 10,
        tokenBudget: 500000,
      },
      sessionStore,
    });

    kernel.enqueue({
      agentId: 'agents/project-lead.md',
      input: 'Build me a portfolio website',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    // Verify artifacts were created
    expect(vfs.getState().read('artifacts/design-spec.md')).toBeTruthy();
    expect(vfs.getState().read('site/index.html')).toBeTruthy();
    expect(vfs.getState().read('site/styles.css')).toBeTruthy();
    expect(vfs.getState().read('artifacts/qa-report.md')).toBeTruthy();
    expect(vfs.getState().read('artifacts/summary.md')).toBeTruthy();

    // Verify all agents ran
    const events = eventLog.getState().entries;
    const spawnEvents = events.filter((e) => e.type === 'spawn');
    expect(spawnEvents.length).toBeGreaterThanOrEqual(5); // 5 agents spawned

    const signalEvents = events.filter((e) => e.type === 'signal');
    expect(signalEvents.length).toBeGreaterThanOrEqual(5); // 5 signals back

    const completeEvents = events.filter((e) => e.type === 'complete');
    expect(completeEvents.length).toBeGreaterThanOrEqual(6); // 6 agents completed

    // Verify no errors
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(0);
  }, 30000); // 30s timeout for streaming delays
});
```

**Step 2: Run it**

Run: `npx vitest run src/core/demo-integration.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS (all tests including new ones)

**Step 4: Final build check**

Run: `npx vite build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/core/demo-integration.test.ts
git commit -m "test: integration test for full demo run through kernel"
```

---

## Task Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|---------------|
| 1 | ScriptedAIProvider | scripted-provider.ts, .test.ts | - |
| 2 | Wire into RunController | - | run-controller.ts, kernel.ts |
| 3 | 6 sample agent definitions | - | sample-project.ts |
| 4 | Demo script data | demo-script.ts | - |
| 5 | spawn_agent pre-existing detection | - | spawn-agent.ts |
| 6 | DiskSync immediate flush | - | disk-sync.ts |
| 7 | Welcome banner update | - | GraphView.tsx |
| 8 | Integration test | demo-integration.test.ts | - |

Tasks 1-2 are sequential (provider must exist before wiring).
Tasks 3-4 are sequential (agents must exist before script references them).
Task 5 is needed before the demo can run (spawn must handle existing agents).
Tasks 6-7 are independent and can run in parallel.
Task 8 depends on all prior tasks.
