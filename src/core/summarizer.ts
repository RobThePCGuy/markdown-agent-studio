import type { MemoryManager } from './memory-manager';
import type { WorkingMemoryEntry, MemoryType } from '../types/memory';
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
// Summarizer
// ---------------------------------------------------------------------------

const MAX_MESSAGES_PER_SESSION = 20;
const MAX_MESSAGE_CHARS = 500;

export class Summarizer {
  private manager: MemoryManager;
  private summarizeFn: SummarizeFn;
  private vfs?: Store<VFSState>;

  constructor(manager: MemoryManager, summarizeFn: SummarizeFn, vfs?: Store<VFSState>) {
    this.manager = manager;
    this.summarizeFn = summarizeFn;
    this.vfs = vfs;
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

    if (extracted.length === 0) {
      return;
    }

    // Determine the agent ID to associate memories with.
    // If all sessions belong to a single agent, use that agentId.
    // If multiple agents (or no sessions), use 'global'.
    const uniqueAgentIds = new Set(sessions.map((s) => s.agentId));
    const agentId = uniqueAgentIds.size === 1
      ? [...uniqueAgentIds][0]
      : 'global';

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
}
