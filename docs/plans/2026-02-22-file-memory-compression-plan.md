# Two-Phase Memory Extraction & Consolidation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the post-run summarizer to extract knowledge from agent-created files and consolidate it against existing long-term memories with adaptive capacity tiers.

**Architecture:** Two LLM calls per run -- Phase 1 extracts candidate memories from files + chat + working memory, Phase 2 consolidates candidates against existing memories using CRUD operations (ADD/UPDATE/DELETE/KEEP/SKIP) with aggressiveness tuned by capacity tier (GENEROUS under 30%, SELECTIVE 30-50%, HEAVY_CUT over 50%).

**Tech Stack:** TypeScript, Vitest, Zustand (VFS store), Google Generative AI SDK

**Design doc:** `docs/plans/2026-02-22-file-memory-compression-design.md`

---

### Task 1: Add 'skill' to MemoryType

**Files:**
- Modify: `src/types/memory.ts:1`
- Modify: `src/components/inspector/MemoryPanel.tsx:8-14`

**Step 1: Update the MemoryType union**

In `src/types/memory.ts` line 1, change:
```typescript
export type MemoryType = 'fact' | 'procedure' | 'observation' | 'mistake' | 'preference';
```
to:
```typescript
export type MemoryType = 'fact' | 'procedure' | 'observation' | 'mistake' | 'preference' | 'skill';
```

**Step 2: Add skill color to MemoryPanel**

In `src/components/inspector/MemoryPanel.tsx` lines 8-14, add `skill` to the typeColors map:
```typescript
const typeColors: Record<string, string> = {
  fact: 'var(--status-blue)',
  procedure: 'var(--status-cyan)',
  observation: 'var(--status-green)',
  mistake: 'var(--status-red)',
  preference: 'var(--status-purple)',
  skill: 'var(--status-yellow)',
};
```

**Step 3: Run tests to verify no breakage**

Run: `npx vitest run src/types/memory.test.ts src/core/memory-manager.test.ts`
Expected: All existing tests pass (they use specific types like 'fact'/'mistake', not exhaustive checks)

**Step 4: Commit**

```bash
git add src/types/memory.ts src/components/inspector/MemoryPanel.tsx
git commit -m "feat: add 'skill' memory type for learned capabilities"
```

---

### Task 2: Add VFS file contents to Summarizer context

**Files:**
- Modify: `src/core/summarizer.ts:2,52-59,65-70,107-150`
- Test: `src/core/summarizer.test.ts`

**Step 1: Write failing tests for VFS file inclusion**

Add to `src/core/summarizer.test.ts`. The Summarizer constructor will need a VFS state reader, so tests need to provide one:

```typescript
import { createVFSStore } from '../stores/vfs-store';

// Add a helper near the top:
function makeVFSFiles(): Map<string, { content: string; createdBy?: string }> {
  const vfs = createVFSStore();
  vfs.getState().write('research/findings.md', '# Research\nKey finding: X works best', {
    authorAgentId: 'agent-1',
    activationId: 'act-1',
  });
  vfs.getState().write('agents/researcher.md', '---\nname: researcher\n---', {});
  return vfs.getState().files;
}
```

Add these tests inside the existing `describe('Summarizer', ...)`:

```typescript
it('includes VFS file contents in context when files are provided', async () => {
  const vfs = createVFSStore();
  vfs.getState().write('research/findings.md', '# Research\nKey finding: X works best', {
    authorAgentId: 'agent-1',
    activationId: 'act-1',
  });
  const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
  mockSummarizeFn.mockResolvedValue([]);

  await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

  const contextArg = mockSummarizeFn.mock.calls[0][0];
  expect(contextArg).toContain('## Files Created This Run');
  expect(contextArg).toContain('research/findings.md');
  expect(contextArg).toContain('Key finding: X works best');
});

it('excludes agent definition files from file context', async () => {
  const vfs = createVFSStore();
  vfs.getState().write('agents/researcher.md', '---\nname: researcher\n---', {});
  vfs.getState().write('output.md', 'Some output', { authorAgentId: 'agent-1' });
  const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
  mockSummarizeFn.mockResolvedValue([]);

  await summarizer.summarize('run-1', [], [makeSession()]);

  const contextArg = mockSummarizeFn.mock.calls[0][0];
  expect(contextArg).not.toContain('agents/researcher.md');
  expect(contextArg).toContain('output.md');
});

it('excludes memory/long-term-memory.json from file context', async () => {
  const vfs = createVFSStore();
  vfs.getState().write('memory/long-term-memory.json', '[{"id":"ltm-1"}]', {});
  vfs.getState().write('report.md', 'Report content', { authorAgentId: 'agent-1' });
  const summarizer = new Summarizer(manager, mockSummarizeFn, vfs);
  mockSummarizeFn.mockResolvedValue([]);

  await summarizer.summarize('run-1', [], [makeSession()]);

  const contextArg = mockSummarizeFn.mock.calls[0][0];
  expect(contextArg).not.toContain('long-term-memory.json');
  expect(contextArg).toContain('report.md');
});

it('works without VFS (backwards compatible)', async () => {
  // No vfs passed -- same as old behavior
  const summarizer = new Summarizer(manager, mockSummarizeFn);
  mockSummarizeFn.mockResolvedValue(sampleExtracted);

  await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

  const all = await manager.getAll();
  expect(all).toHaveLength(2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: New tests FAIL (Summarizer constructor doesn't accept VFS arg yet)

**Step 3: Update Summarizer to accept VFS and include file contents**

In `src/core/summarizer.ts`:

Add import at top:
```typescript
import type { VFSState } from '../stores/vfs-store';

type Store<T> = { getState(): T };
```

Update the class to accept optional VFS:
```typescript
export class Summarizer {
  private manager: MemoryManager;
  private summarizeFn: SummarizeFn;
  private vfs?: Store<VFSState>;

  constructor(manager: MemoryManager, summarizeFn: SummarizeFn, vfs?: Store<VFSState>) {
    this.manager = manager;
    this.summarizeFn = summarizeFn;
    this.vfs = vfs;
  }
```

Update `buildContext()` signature and add file section at the top (files first, so the LLM sees them prominently):
```typescript
private buildContext(
  workingMemory: WorkingMemoryEntry[],
  sessions: LiveSession[],
): string {
  const parts: string[] = [];

  // VFS files section (excluding agent defs and memory file)
  if (this.vfs) {
    const state = this.vfs.getState();
    const allPaths = state.getAllPaths();
    const filePaths = allPaths.filter(
      (p) => !p.startsWith('agents/') && p !== 'memory/long-term-memory.json'
    );
    if (filePaths.length > 0) {
      parts.push('## Files Created This Run');
      parts.push('');
      for (const path of filePaths) {
        const content = state.read(path);
        if (content !== null) {
          parts.push(`### ${path}`);
          parts.push(content);
          parts.push('');
        }
      }
    }
  }

  // Working memory section (unchanged)
  ...
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: ALL tests pass (old and new)

**Step 5: Commit**

```bash
git add src/core/summarizer.ts src/core/summarizer.test.ts
git commit -m "feat: include VFS file contents in summarizer context"
```

---

### Task 3: Replace extraction prompt with enhanced version

**Files:**
- Modify: `src/core/summarizer.ts:21-43`

**Step 1: Replace `SUMMARIZER_SYSTEM_PROMPT`**

Replace the entire `SUMMARIZER_SYSTEM_PROMPT` constant (lines 21-43) with:

```typescript
export const SUMMARIZER_SYSTEM_PROMPT = `You are a knowledge extraction system. Analyze a completed agent run (files produced, working memory, and conversation history) and extract structured memories worth retaining for future runs.

Each memory must be one of these types:
- "skill": A technique, method, or capability the agent demonstrated or learned (e.g. "Use web_search then vfs_write to research and document a topic systematically").
- "fact": A verified piece of knowledge about the domain or project (e.g. "The API uses JWT authentication with RS256 signing").
- "procedure": A step-by-step workflow that was discovered or confirmed (e.g. "To deploy, run build then push to the deploy branch").
- "observation": A pattern, trend, or notable behavior observed (e.g. "The test suite takes ~4 minutes and flakes on CI about 10% of the time").
- "mistake": An error or failed approach that should be avoided. PRIORITIZE THESE - they prevent repeated failures (e.g. "Do not use fs.writeFileSync in the renderer process - it causes the app to freeze"). Identify the misconception, then express as actionable advice.
- "preference": A user or project preference for style, tooling, or approach (e.g. "User prefers functional components over class components").

Guidelines:
- Extract as many memories as the content warrants. Quality over quantity, but do not artificially limit yourself.
- Each memory must be self-contained and useful without additional context.
- Use specific dates (not "today" or "recently") since memories persist indefinitely.
- For files: extract the KEY KNOWLEDGE from their contents, not just "a file was created." What did the agent learn?
- For mistakes: identify the misconception, then express as actionable advice.
- Tags should be lowercase, short, and relevant for future retrieval.
- Do NOT include trivial or overly generic observations.
- Return ONLY a JSON array of objects with { type, content, tags } fields. No other text.

Example output:
[
  { "type": "skill", "content": "Research workflow: use web_search to gather sources, then vfs_write to save structured findings as markdown files", "tags": ["research", "workflow", "web_search", "vfs_write"] },
  { "type": "mistake", "content": "Do not call signal_parent when operating as a root agent - check if a parent exists first to avoid errors", "tags": ["agent_hierarchy", "error", "root_agent"] },
  { "type": "fact", "content": "The project uses Vitest for testing with the jsdom environment", "tags": ["testing", "vitest", "config"] }
]`;
```

**Step 2: Run tests to verify no breakage**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: All pass (tests check for content in context, not the prompt text)

**Step 3: Commit**

```bash
git add src/core/summarizer.ts
git commit -m "feat: enhance extraction prompt with skill type and file knowledge guidance"
```

---

### Task 4: Add consolidation phase to Summarizer

**Files:**
- Modify: `src/core/summarizer.ts`
- Test: `src/core/summarizer.test.ts`

This is the biggest task. The Summarizer gains a `consolidate()` method and the `summarize()` method is updated to call it.

**Step 1: Write failing tests for consolidation**

Add to `src/core/summarizer.test.ts`:

```typescript
describe('consolidation', () => {
  it('calls consolidateFn with candidates and existing memories', async () => {
    // Pre-populate some existing memories
    await manager.store({
      agentId: 'agent-1',
      type: 'fact',
      content: 'Old fact',
      tags: ['old'],
      runId: 'run-0',
    });

    const candidates: ExtractedMemory[] = [
      { type: 'skill', content: 'New skill', tags: ['new'] },
    ];
    mockSummarizeFn.mockResolvedValue(candidates);

    const mockConsolidateFn = vi.fn().mockResolvedValue({
      operations: [
        { action: 'KEEP', id: (await manager.getAll())[0].id },
        { action: 'ADD', type: 'skill', content: 'New skill', tags: ['new'] },
      ],
    });

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    expect(mockConsolidateFn).toHaveBeenCalledOnce();
    const consolidateArg = mockConsolidateFn.mock.calls[0][0];
    expect(consolidateArg).toContain('Old fact');
    expect(consolidateArg).toContain('New skill');
  });

  it('applies ADD operations from consolidation', async () => {
    mockSummarizeFn.mockResolvedValue([
      { type: 'skill', content: 'Learned skill', tags: ['skill'] },
    ]);

    const mockConsolidateFn = vi.fn().mockResolvedValue({
      operations: [
        { action: 'ADD', type: 'skill', content: 'Learned skill', tags: ['skill'] },
      ],
    });

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Learned skill');
    expect(all[0].type).toBe('skill');
  });

  it('applies UPDATE operations from consolidation', async () => {
    const existing = await manager.store({
      agentId: 'agent-1',
      type: 'fact',
      content: 'Old content',
      tags: ['old'],
      runId: 'run-0',
    });

    mockSummarizeFn.mockResolvedValue([]);

    const mockConsolidateFn = vi.fn().mockResolvedValue({
      operations: [
        { action: 'UPDATE', id: existing.id, content: 'Updated content', tags: ['updated'] },
      ],
    });

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
    await summarizer.summarize('run-1', [], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Updated content');
    expect(all[0].tags).toEqual(['updated']);
  });

  it('applies DELETE operations from consolidation', async () => {
    const existing = await manager.store({
      agentId: 'agent-1',
      type: 'fact',
      content: 'To be deleted',
      tags: ['old'],
      runId: 'run-0',
    });

    mockSummarizeFn.mockResolvedValue([]);

    const mockConsolidateFn = vi.fn().mockResolvedValue({
      operations: [
        { action: 'DELETE', id: existing.id },
      ],
    });

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
    await summarizer.summarize('run-1', [], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(0);
  });

  it('falls back to adding all candidates when consolidation fails', async () => {
    mockSummarizeFn.mockResolvedValue([
      { type: 'fact', content: 'Fallback fact', tags: ['fallback'] },
    ]);

    const mockConsolidateFn = vi.fn().mockRejectedValue(new Error('LLM failed'));

    const summarizer = new Summarizer(manager, mockSummarizeFn, undefined, mockConsolidateFn);
    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Fallback fact');
  });

  it('falls back when no consolidateFn is provided', async () => {
    mockSummarizeFn.mockResolvedValue(sampleExtracted);

    // No consolidateFn passed -- old behavior
    const summarizer = new Summarizer(manager, mockSummarizeFn);
    await summarizer.summarize('run-1', [makeWorkingMemory()], [makeSession()]);

    const all = await manager.getAll();
    expect(all).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/summarizer.test.ts`
Expected: FAIL (Summarizer constructor doesn't accept consolidateFn yet)

**Step 3: Implement consolidation**

In `src/core/summarizer.ts`, add a new type and the consolidation prompt:

```typescript
export type ConsolidateFn = (context: string) => Promise<ConsolidationResult>;

export interface ConsolidationOperation {
  action: 'KEEP' | 'UPDATE' | 'DELETE' | 'ADD' | 'SKIP';
  id?: string;
  type?: MemoryType;
  content?: string;
  tags?: string[];
  candidateIndex?: number;
}

export interface ConsolidationResult {
  operations: ConsolidationOperation[];
}

export const CONSOLIDATION_SYSTEM_PROMPT = `You are a memory consolidation system. Compare new candidate memories against existing long-term memories and produce a set of operations.

For each EXISTING memory, choose one action:
- KEEP: Still accurate and not redundant with new candidates.
- UPDATE: Should be updated with new information. Provide new content and tags.
- DELETE: Outdated, superseded, contradicted, or low-value.

For each CANDIDATE memory, choose one action:
- ADD: Adds knowledge not captured by existing memories.
- SKIP: Already covered by existing memories (after any updates).

## Capacity Tier Instructions

GENEROUS (under 30%):
  - Freely ADD new memories. Only SKIP exact duplicates.
  - UPDATE when new info genuinely improves an existing memory.
  - Rarely DELETE -- only if clearly wrong or superseded.

SELECTIVE (30-50%):
  - ADD only if the knowledge is genuinely new and valuable.
  - Merge related memories by UPDATE-ing one and DELETE-ing others.
  - DELETE memories with 0 access count that are generic or obvious.

HEAVY_CUT (over 50%):
  - Strongly prefer UPDATE over ADD (compress new knowledge into existing entries).
  - Aggressively merge and compress. Combine related memories.
  - DELETE low-access, generic, or redundant memories.
  - Target reducing total memory count by 10-20%.

Return ONLY a JSON object (no other text):
{
  "operations": [
    { "action": "KEEP", "id": "ltm-1-..." },
    { "action": "UPDATE", "id": "ltm-2-...", "content": "new content", "tags": ["tag1"] },
    { "action": "DELETE", "id": "ltm-3-..." },
    { "action": "ADD", "type": "skill", "content": "new memory", "tags": ["tag1"] },
    { "action": "SKIP", "candidateIndex": 0 }
  ]
}`;
```

Update the Summarizer class:

```typescript
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

export class Summarizer {
  private manager: MemoryManager;
  private summarizeFn: SummarizeFn;
  private vfs?: Store<VFSState>;
  private consolidateFn?: ConsolidateFn;

  constructor(
    manager: MemoryManager,
    summarizeFn: SummarizeFn,
    vfs?: Store<VFSState>,
    consolidateFn?: ConsolidateFn,
  ) {
    this.manager = manager;
    this.summarizeFn = summarizeFn;
    this.vfs = vfs;
    this.consolidateFn = consolidateFn;
  }

  async summarize(
    runId: string,
    workingMemory: WorkingMemoryEntry[],
    sessions: LiveSession[],
  ): Promise<void> {
    const context = this.buildContext(workingMemory, sessions);

    let extracted: ExtractedMemory[];
    try {
      extracted = await this.summarizeFn(context);
    } catch {
      return;
    }

    if (extracted.length === 0) {
      return;
    }

    const uniqueAgentIds = new Set(sessions.map((s) => s.agentId));
    const agentId = uniqueAgentIds.size === 1
      ? [...uniqueAgentIds][0]
      : 'global';

    // Phase 2: Consolidation (if consolidateFn provided)
    if (this.consolidateFn) {
      try {
        const existing = await this.manager.getAll();
        const consolidationContext = this.buildConsolidationContext(extracted, existing);
        const result = await this.consolidateFn(consolidationContext);
        await this.applyConsolidation(result, extracted, agentId, runId);
        return;
      } catch {
        // Fall through to legacy add-all behavior
      }
    }

    // Legacy fallback: add all extracted memories directly
    for (const memory of extracted) {
      await this.manager.store({
        agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
        runId,
      });
    }
  }
```

Add the consolidation helper methods:

```typescript
  private buildConsolidationContext(
    candidates: ExtractedMemory[],
    existing: LongTermMemory[],
  ): string {
    const parts: string[] = [];

    // Capacity calculation
    const existingJson = JSON.stringify(existing);
    const estimatedTokens = Math.ceil(existingJson.length / 4);
    const capacityPct = (estimatedTokens / DEFAULT_CONTEXT_WINDOW) * 100;
    const tier = capacityPct < 30 ? 'GENEROUS' : capacityPct < 50 ? 'SELECTIVE' : 'HEAVY_CUT';

    parts.push('## Capacity Status');
    parts.push(`Current: ~${estimatedTokens} tokens (${capacityPct.toFixed(1)}% of ${DEFAULT_CONTEXT_WINDOW} context window)`);
    parts.push(`Tier: ${tier}`);
    parts.push('');

    // Existing memories
    if (existing.length > 0) {
      parts.push('## Existing Long-Term Memories');
      parts.push('');
      for (const mem of existing) {
        parts.push(`- [${mem.id}] (${mem.type}, ${mem.accessCount} accesses) ${mem.content} [tags: ${mem.tags.join(', ')}]`);
      }
      parts.push('');
    }

    // Candidates
    parts.push('## Candidate Memories From This Run');
    parts.push('');
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      parts.push(`- [candidate ${i}] (${c.type}) ${c.content} [tags: ${c.tags.join(', ')}]`);
    }

    return parts.join('\n');
  }

  private async applyConsolidation(
    result: ConsolidationResult,
    candidates: ExtractedMemory[],
    agentId: string,
    runId: string,
  ): Promise<void> {
    for (const op of result.operations) {
      switch (op.action) {
        case 'ADD':
          if (op.content && op.type) {
            await this.manager.store({
              agentId,
              type: op.type,
              content: op.content,
              tags: op.tags ?? [],
              runId,
            });
          }
          break;

        case 'UPDATE':
          if (op.id) {
            const all = await this.manager.getAll();
            const entry = all.find((m) => m.id === op.id);
            if (entry) {
              const updated = { ...entry };
              if (op.content) updated.content = op.content;
              if (op.tags) updated.tags = op.tags;
              await this.manager.db.put(updated);
            }
          }
          break;

        case 'DELETE':
          if (op.id) {
            await this.manager.delete(op.id);
          }
          break;

        // KEEP and SKIP are no-ops
      }
    }
  }
```

Note: The `applyConsolidation` UPDATE path needs access to `manager.db.put()` directly. The MemoryManager's `store()` creates new entries, but UPDATE needs to modify in place. We need to either:
- Make `db` on MemoryManager accessible (add a getter or make it `public readonly`)
- Or add an `update()` method to MemoryManager

Add to `src/core/memory-manager.ts` a new `update` method:
```typescript
async update(id: string, changes: Partial<Pick<LongTermMemory, 'content' | 'tags'>>): Promise<void> {
  const all = await this.db.getAll();
  const entry = all.find((m) => m.id === id);
  if (!entry) return;
  if (changes.content !== undefined) entry.content = changes.content;
  if (changes.tags !== undefined) entry.tags = changes.tags;
  await this.db.put(entry);
}
```

Then `applyConsolidation` UPDATE becomes:
```typescript
case 'UPDATE':
  if (op.id) {
    await this.manager.update(op.id, {
      content: op.content,
      tags: op.tags,
    });
  }
  break;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/summarizer.test.ts src/core/memory-manager.test.ts`
Expected: ALL tests pass

**Step 5: Commit**

```bash
git add src/core/summarizer.ts src/core/summarizer.test.ts src/core/memory-manager.ts
git commit -m "feat: add consolidation phase with CRUD operations and capacity tiers"
```

---

### Task 5: Wire VFS and consolidation into run-controller.ts

**Files:**
- Modify: `src/core/run-controller.ts:109-140`

**Step 1: Update the summarizer construction in run-controller**

In `src/core/run-controller.ts`, the post-run summarization block (lines 109-140) creates a `Summarizer` and a `summarizeFn`. We need to:
1. Pass `vfsStore` as the third argument to `Summarizer`
2. Create a `consolidateFn` that calls the LLM with the consolidation prompt
3. Pass it as the fourth argument

Replace lines 136-139:
```typescript
const summarizer = new Summarizer(this.memoryManager, summarizeFn);
summarizer
  .summarize(`run-${Date.now()}`, workingSnapshot, completedSessions)
  .catch(() => {});
```

with:
```typescript
const consolidateFn = async (context: string) => {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: summarizeModel });
    const result = await model.generateContent(
      CONSOLIDATION_SYSTEM_PROMPT + '\n\n---\n\n' + context
    );
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { operations: [] };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { operations: [] };
  }
};
const summarizer = new Summarizer(this.memoryManager, summarizeFn, vfsStore, consolidateFn);
summarizer
  .summarize(`run-${Date.now()}`, workingSnapshot, completedSessions)
  .catch(() => {});
```

Also add `CONSOLIDATION_SYSTEM_PROMPT` to the import from `./summarizer`:
```typescript
import { Summarizer, SUMMARIZER_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPT } from './summarizer';
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add src/core/run-controller.ts
git commit -m "feat: wire VFS and consolidation into single-run summarization"
```

---

### Task 6: Wire VFS and consolidation into autonomous-runner.ts

**Files:**
- Modify: `src/core/autonomous-runner.ts:247-286`

**Step 1: Update `runSummarization` in autonomous-runner**

The autonomous runner has its own `runSummarization()` method (lines 247-286) with a nearly identical pattern. Apply the same changes:

Replace lines 276-282:
```typescript
const summarizer = new Summarizer(this.deps.memoryManager, summarizeFn);
try {
  await summarizer.summarize(
    `autonomous-cycle-${this._currentCycle}-${Date.now()}`,
    workingSnapshot,
    completedSessions,
  );
```

with:
```typescript
const consolidateFn = async (context: string) => {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: summarizeModel });
    const result = await model.generateContent(
      CONSOLIDATION_SYSTEM_PROMPT + '\n\n---\n\n' + context
    );
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { operations: [] };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { operations: [] };
  }
};
const summarizer = new Summarizer(this.deps.memoryManager, summarizeFn, this.deps.vfs, consolidateFn);
try {
  await summarizer.summarize(
    `autonomous-cycle-${this._currentCycle}-${Date.now()}`,
    workingSnapshot,
    completedSessions,
  );
```

Update the import:
```typescript
import { Summarizer, SUMMARIZER_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPT } from './summarizer';
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All 249+ tests pass

**Step 3: Commit**

```bash
git add src/core/autonomous-runner.ts
git commit -m "feat: wire VFS and consolidation into autonomous-mode summarization"
```

---

### Task 7: Final integration verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Verify the VFS memory persistence from the earlier change still works**

Check that `memory/long-term-memory.json` is still written correctly by the VFSMemoryDB when memories are stored (this was implemented in the previous commit set).

**Step 3: Commit any remaining changes and verify clean state**

```bash
git status
git log --oneline -10
```

Expected: Clean working tree, series of focused commits.
