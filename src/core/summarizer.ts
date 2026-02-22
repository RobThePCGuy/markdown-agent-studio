import type { MemoryManager } from './memory-manager';
import type { WorkingMemoryEntry, MemoryType, LongTermMemory } from '../types/memory';
import type { LiveSession } from '../types/session';
import type { VFSState } from '../stores/vfs-store';

type Store<T> = { getState(): T };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  tags: string[];
}

export type SummarizeFn = (context: string) => Promise<ExtractedMemory[]>;

// ---------------------------------------------------------------------------
// System prompt for the LLM summarizer
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Consolidation types and prompt
// ---------------------------------------------------------------------------

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

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

const VALID_MEMORY_TYPES = new Set<string>(['fact', 'procedure', 'observation', 'mistake', 'preference', 'skill']);

// ---------------------------------------------------------------------------
// Summarizer
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_SESSION = 20;
const MAX_MESSAGE_CHARS = 500;

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

  /**
   * Summarize a completed run's working memory and session histories into
   * long-term memory entries via the provided summarize function.
   */
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
      // Gracefully handle summarize function errors - just return
      return;
    }

    if (extracted.length === 0 && !this.consolidateFn) {
      return;
    }

    // Determine the agent ID to associate memories with.
    // If all sessions belong to a single agent, use that agentId.
    // If multiple agents (or no sessions), use 'global'.
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
        await this.applyConsolidation(result, agentId, runId);
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

  /**
   * Build a readable context string from working memory entries and session
   * message histories for the summarize function to consume.
   */
  private buildContext(
    workingMemory: WorkingMemoryEntry[],
    sessions: LiveSession[],
  ): string {
    const parts: string[] = [];

    // VFS files section
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

    // Working memory section
    if (workingMemory.length > 0) {
      parts.push('## Working Memory');
      parts.push('');
      for (const entry of workingMemory) {
        const tagsStr = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
        parts.push(`- ${entry.key}: ${entry.value}${tagsStr}`);
      }
      parts.push('');
    }

    // Session histories section
    if (sessions.length > 0) {
      parts.push('## Session Histories');
      parts.push('');

      for (const session of sessions) {
        parts.push(`### Agent: ${session.agentId} (activation: ${session.activationId})`);
        parts.push('');

        // Take the last N messages per session
        const recentMessages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);

        for (const msg of recentMessages) {
          // Truncate message content to MAX_MESSAGE_CHARS
          const content = msg.content.length > MAX_MESSAGE_CHARS
            ? msg.content.slice(0, MAX_MESSAGE_CHARS) + '...'
            : msg.content;

          parts.push(`[${msg.role}]: ${content}`);
        }

        parts.push('');
      }
    }

    return parts.join('\n');
  }

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
    agentId: string,
    runId: string,
  ): Promise<void> {
    for (const op of result.operations) {
      switch (op.action) {
        case 'ADD':
          if (op.content && op.type && VALID_MEMORY_TYPES.has(op.type)) {
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
            await this.manager.update(op.id, {
              content: op.content,
              tags: op.tags,
            });
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
}

// ---------------------------------------------------------------------------
// Factory helpers for creating LLM-backed summarize/consolidate functions
// ---------------------------------------------------------------------------

export function createGeminiSummarizeFn(apiKey: string, model: string): SummarizeFn {
  return async (context: string) => {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const client = new GoogleGenerativeAI(apiKey);
      const genModel = client.getGenerativeModel({ model });
      const result = await genModel.generateContent(
        SUMMARIZER_SYSTEM_PROMPT + '\n\n---\n\n' + context
      );
      const text = result.response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  };
}

export function createGeminiConsolidateFn(apiKey: string, model: string): ConsolidateFn {
  return async (context: string) => {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const client = new GoogleGenerativeAI(apiKey);
      const genModel = client.getGenerativeModel({ model });
      const result = await genModel.generateContent(
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
}
