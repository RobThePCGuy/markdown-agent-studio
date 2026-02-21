import type { AIProvider, AgentConfig, StreamChunk, ToolDeclaration } from '../types';
import type { Message } from '../types/kernel';

/**
 * A dictionary keyed by agent path (e.g. "agents/project-lead.md").
 * Each value is an array of turns, where each turn is a StreamChunk[] array.
 * Turn 0 is yielded the first time chat() is called for that agent session,
 * turn 1 the second time, and so on.
 */
export type ScriptMap = Record<string, StreamChunk[][]>;

const CHUNK_DELAY_MS: Record<string, number> = {
  text: 120,
  tool_call: 600,
  done: 1200,
  error: 0,
};

const FALLBACK_TEXT = '[ScriptedAIProvider] No script available for this agent or turn.';

/**
 * AIProvider that replays pre-scripted chunk sequences instead of calling
 * a real LLM. Used for zero-cost demo mode in Markdown Agent Studio.
 *
 * Usage:
 *   1. Construct with a ScriptMap.
 *   2. Call registerSession(sessionId, agentPath) before the kernel starts
 *      streaming for that session so the provider knows which script to use.
 *   3. Each call to chat() for a given session advances that session's turn
 *      counter and yields the corresponding chunk array from the script.
 */
export class ScriptedAIProvider implements AIProvider {
  private scripts: ScriptMap;

  /** Maps sessionId -> agent path (set via registerSession) */
  private sessionAgentMap = new Map<string, string>();

  /** Maps sessionId -> current turn index */
  private turnCounters = new Map<string, number>();

  /** Set of sessionIds that have been aborted */
  private aborted = new Set<string>();

  constructor(scripts: ScriptMap) {
    this.scripts = scripts;
  }

  /**
   * Register which agent script a session should use.
   * Must be called before the first chat() call for that session.
   */
  registerSession(sessionId: string, agentPath: string): void {
    this.sessionAgentMap.set(sessionId, agentPath);
    // Only initialize the turn counter if this is a genuinely new session.
    // The kernel calls registerSession before every chat() turn, so we must
    // avoid resetting the counter for sessions that are already in progress.
    if (!this.turnCounters.has(sessionId)) {
      this.turnCounters.set(sessionId, 0);
    }
  }

  async *chat(
    config: AgentConfig,
    _history: Message[],
    _tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    const { sessionId } = config;

    // Check abort before starting
    if (this.aborted.has(sessionId)) {
      yield { type: 'error', error: 'Aborted' };
      return;
    }

    const agentPath = this.sessionAgentMap.get(sessionId);
    const agentTurns = agentPath ? this.scripts[agentPath] : undefined;
    const turnIndex = this.turnCounters.get(sessionId) ?? 0;

    // Determine chunks to yield - fall back if no script or turn exhausted
    let chunks: StreamChunk[];
    if (!agentTurns || turnIndex >= agentTurns.length) {
      chunks = [
        { type: 'text', text: FALLBACK_TEXT },
        { type: 'done', tokenCount: 0 },
      ];
    } else {
      chunks = agentTurns[turnIndex];
    }

    // Advance turn counter
    this.turnCounters.set(sessionId, turnIndex + 1);

    // Yield chunks with a small delay to simulate streaming
    for (const chunk of chunks) {
      if (this.aborted.has(sessionId)) {
        yield { type: 'error', error: 'Aborted' };
        return;
      }
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS[chunk.type] ?? 120));
      yield chunk;
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.aborted.add(sessionId);
  }

  endSession(sessionId: string): void {
    this.sessionAgentMap.delete(sessionId);
    this.turnCounters.delete(sessionId);
    this.aborted.delete(sessionId);
  }
}
