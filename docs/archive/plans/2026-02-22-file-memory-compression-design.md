# Design: Two-Phase Memory Extraction & Consolidation

## Problem

When agents create files during a run (research docs, code, reports), the knowledge in those files is lost to future runs. The existing summarizer only looks at working memory entries and truncated chat messages -- it ignores VFS file contents entirely. An agent that wrote 13 research documents has no memory of what it learned.

## Solution

Extend the post-run summarizer into a two-phase pipeline:

1. **Extract** -- Build context from VFS files + working memory + chat history, ask the LLM to extract candidate memories (skills, facts, procedures, observations, mistakes, preferences)
2. **Consolidate** -- Compare candidates against existing long-term memories using CRUD operations (ADD/UPDATE/DELETE/KEEP/SKIP), with adaptive aggressiveness based on memory capacity

## Architecture

```
Run completes
    |
    v
Phase 1: EXTRACT
    Input:  VFS file contents + working memory + session chat history
    Output: Candidate memories (no hard cap)
    |
    v
Phase 2: CONSOLIDATE
    Input:  Candidate memories + existing long-term-memory.json + capacity tier
    Output: CRUD operations on the memory file
    |
    v
Apply operations to long-term-memory.json in VFS
    |
    v
DiskSync writes to project folder on disk
```

Both phases run where summarization already triggers:
- `run-controller.ts` after `kernel.runUntilEmpty()` (single runs)
- `autonomous-runner.ts` `runSummarization()` (after each autonomous cycle)

## Phase 1: Extraction

### Context Building

The `Summarizer.buildContext()` method is enhanced to include VFS file contents:

```
## Files Created This Run

### path/to/file.md
<full file contents>

## Working Memory
<key/value entries from inter-agent coordination>

## Session Histories
<last 20 messages per session, truncated to 500 chars each>
```

Full file contents are included (no truncation). The VFS tracks `authorAgentId` metadata per file, enabling filtering to files written during the current run.

### Extraction Prompt

```
You are a knowledge extraction system. Analyze a completed agent run
(files produced, working memory, and conversation history) and extract
structured memories worth retaining.

Each memory must be one of these types:
- "skill": A technique, method, or capability the agent demonstrated
  or learned (e.g., "Use web_search then vfs_write to research and
  document a topic systematically")
- "fact": A verified piece of knowledge about the domain or project
- "procedure": A step-by-step workflow that was discovered or confirmed
- "observation": A pattern, trend, or notable behavior observed
- "mistake": An error or failed approach that should be avoided.
  PRIORITIZE THESE -- they prevent repeated failures.
- "preference": A user or project preference for style or approach

Guidelines:
- Extract as many memories as the content warrants. Quality over quantity,
  but do not artificially limit yourself.
- Each memory must be self-contained and useful without additional context.
- Use specific dates (not "today" or "recently") since memories persist
  indefinitely.
- For files: extract the KEY KNOWLEDGE from their contents, not just
  "a file was created." What did the agent learn?
- For mistakes: identify the misconception, then express as actionable
  advice.
- Tags should be lowercase and relevant for future retrieval.

Return ONLY a JSON array: [{ "type", "content", "tags" }]
```

Key design decisions:
- New "skill" memory type captures transferable capabilities
- No hard cap on extraction count (current prompt limits to 3-8)
- Temporal anchoring: "use specific dates, not today/recently" (from Letta)
- Mistake distillation: "identify the misconception, then express as advice" (from AutoGen)
- Explicit instruction to extract knowledge FROM files, not just note existence

## Phase 2: Consolidation

### Capacity Tiers

Memory capacity is estimated as `Math.ceil(jsonString.length / 4)` tokens. Context window defaults to 1,000,000 tokens (gemini-2.5-flash).

| Tier | Threshold | Behavior |
|------|-----------|----------|
| GENEROUS | 0-30% | Freely ADD. Only SKIP exact duplicates. Rarely DELETE. |
| SELECTIVE | 30-50% | ADD only if genuinely new. Merge related via UPDATE + DELETE. Prune zero-access generics. |
| HEAVY_CUT | 50%+ | Prefer UPDATE over ADD. Aggressively merge/compress. Target 10-20% count reduction. |

### Consolidation Prompt

```
You are a memory consolidation system. Compare new candidate memories
against existing long-term memories and produce a set of operations.

For each EXISTING memory, choose one action:
- KEEP: Still accurate and not redundant with new candidates.
- UPDATE: Should be updated with new information. Provide new content.
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
  - DELETE memories with 0 access count that are generic/obvious.

HEAVY_CUT (over 50%):
  - Strongly prefer UPDATE over ADD (compress new knowledge into
    existing entries).
  - Aggressively merge and compress. Combine related memories.
  - DELETE low-access, generic, or redundant memories.
  - Target reducing total memory count by 10-20%.

Return a JSON object:
{
  "operations": [
    { "action": "KEEP", "id": "ltm-1-..." },
    { "action": "UPDATE", "id": "ltm-2-...", "content": "...", "tags": [...] },
    { "action": "DELETE", "id": "ltm-3-..." },
    { "action": "ADD", "type": "skill", "content": "...", "tags": [...] },
    { "action": "SKIP", "candidateIndex": 0 }
  ]
}
```

### Applying Operations

After parsing the consolidation response:
1. KEEP -- no-op
2. UPDATE -- modify content/tags of existing entry in memory array
3. DELETE -- remove entry from memory array
4. ADD -- create new `LongTermMemory` entry via MemoryManager
5. SKIP -- no-op

Write the updated array to `memory/long-term-memory.json` via VFS.

## Files to Modify

| File | Change |
|------|--------|
| `src/types/memory.ts` | Add `'skill'` to `MemoryType` union |
| `src/core/summarizer.ts` | Enhanced `buildContext()` with VFS files, new extraction prompt, new `consolidate()` method, updated `summarize()` flow |
| `src/core/run-controller.ts` | Pass VFS store to Summarizer |
| `src/core/autonomous-runner.ts` | Pass VFS store to Summarizer |
| `src/components/inspector/MemoryPanel.tsx` | Add 'skill' type color |

## Error Handling

- Both LLM calls wrapped in try/catch (same as current behavior)
- Extraction failure: no memories added (graceful no-op)
- Consolidation failure: fall back to adding all extracted candidates without consolidation
- Unparseable consolidation JSON: skip consolidation, add all candidates
- Capacity calculation failure: default to GENEROUS tier

## Verification

1. `npx vitest run` -- all existing tests pass
2. Run an agent that creates files, verify extracted memories reference file contents (not just "file was created")
3. Run the same agent again, verify consolidation deduplicates -- no exact duplicate memories
4. Check memory panel shows the new 'skill' type with correct color
5. Inspect `memory/long-term-memory.json` on disk to verify it updates correctly
