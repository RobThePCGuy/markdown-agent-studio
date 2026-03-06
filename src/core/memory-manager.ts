import type { LongTermMemory, MemoryType } from '../types/memory';
import type { MemoryDB } from './memory-db';
import { VectorMemoryDB } from './vector-memory-db';

let ltmCounter = 0;

// ---------------------------------------------------------------------------
// Type-aware recency decay rates
// ---------------------------------------------------------------------------
// Each type decays at a different rate per day, reflecting how long that
// category of knowledge stays relevant.

const RECENCY_DECAY_RATES: Record<MemoryType, number> = {
  mistake: 0.03,      // ~100 days to zero — prevent repeated failures long-term
  procedure: 0.1,     // ~30 days — workflows stay relevant for weeks
  skill: 0.1,         // ~30 days — techniques stay relevant
  fact: 0.1,          // ~30 days — knowledge evolves
  observation: 0.3,   // ~10 days — patterns are time-sensitive
  preference: 0,      // never decays — style choices are evergreen
};

const MAX_RECENCY_BONUS = 3;

export interface StoreInput {
  agentId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  runId: string;
}

export class MemoryManager {
  private db: MemoryDB;

  constructor(db: MemoryDB) {
    this.db = db;
  }

  /** Expose the underlying database (used by Summarizer for type detection). */
  getDB(): MemoryDB {
    return this.db;
  }

  /** Check if vector-backed memory is active. */
  get isVectorEnabled(): boolean {
    return this.db instanceof VectorMemoryDB;
  }

  /** Expose a ToolContext-compatible vectorStore when the DB supports it. */
  get vectorStoreAdapter(): {
    semanticSearch: (query: string, agentId: string, limit?: number) => Promise<{ type: string; content: string; tags: string[]; agentId: string }[]>;
    markShared: (id: string, shared: boolean) => Promise<void>;
    contribute: (content: string, type: string, tags: string[], agentId: string, runId?: string) => Promise<string>;
  } | undefined {
    if (!(this.db instanceof VectorMemoryDB)) return undefined;
    const vectorDb = this.db;
    return {
      async semanticSearch(query, agentId, limit) {
        const results = await vectorDb.semanticSearch(query, agentId, limit);
        return results.map((r) => ({ type: r.type, content: r.content, tags: [...r.tags], agentId: r.agentId }));
      },
      async markShared(id, shared) {
        await vectorDb.markShared(id, shared);
      },
      contribute: async (content, type, tags, agentId, runId) => {
        const entry = await this.store({
          agentId,
          type: type as MemoryType,
          content,
          tags: [...tags, 'shared'],
          runId: runId ?? `run-${Date.now()}`,
        });
        // Mark as shared so other agents can find it
        await vectorDb.markShared(entry.id, true);
        return entry.id;
      },
    };
  }

  async store(input: StoreInput): Promise<LongTermMemory> {
    const now = Date.now();
    const entry: LongTermMemory = {
      id: `ltm-${++ltmCounter}-${now}`,
      agentId: input.agentId,
      type: input.type,
      content: input.content,
      tags: input.tags,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      runId: input.runId,
    };
    await this.db.put(entry);
    return entry;
  }

  async update(id: string, changes: Partial<Pick<LongTermMemory, 'content' | 'tags'>>): Promise<void> {
    const all = await this.db.getAll();
    const entry = all.find((m) => m.id === id);
    if (!entry) return;
    if (changes.content !== undefined) entry.content = changes.content;
    if (changes.tags !== undefined) entry.tags = changes.tags;
    await this.db.put(entry);
  }

  async retrieve(
    agentId: string,
    taskContext: string,
    maxEntries = 25,
  ): Promise<LongTermMemory[]> {
    // Use semantic search if database supports it, with time-weighted re-ranking
    if (this.db instanceof VectorMemoryDB) {
      // Fetch more candidates than needed so re-ranking has room to promote
      const fetchLimit = Math.min(maxEntries * 3, 75);
      const results = await this.db.semanticSearch(taskContext, agentId, fetchLimit);

      // Apply secondary scoring: recency + access frequency bonuses
      const now = Date.now();
      const reranked = results.map((mem) => {
        const ageDays = (now - mem.createdAt) / (1000 * 60 * 60 * 24);
        const decayRate = RECENCY_DECAY_RATES[mem.type] ?? 0.1;
        const recencyBonus = Math.max(0, MAX_RECENCY_BONUS - ageDays * decayRate);
        const accessBonus = Math.log2((mem.accessCount || 0) + 1) * 0.5;
        return { mem, bonus: recencyBonus + accessBonus };
      });

      // Re-sort by bonus descending to break ties among semantically similar memories
      reranked.sort((a, b) => b.bonus - a.bonus);
      const top = reranked.slice(0, maxEntries).map((r) => r.mem);

      // Update access tracking on retrieved results
      for (const mem of top) {
        mem.accessCount = (mem.accessCount || 0) + 1;
        mem.lastAccessedAt = now;
        await this.db.put(mem);
      }
      return top;
    }

    // Fallback: keyword scoring for non-vector databases
    const all = await this.db.getAll();

    // Filter: agentId matches OR memory is global
    const filtered = all.filter(
      (m) => m.agentId === agentId || m.agentId === 'global',
    );

    // Tokenize task context into lowercase words
    const contextWords = taskContext
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 0);

    const now = Date.now();

    // Score each memory
    const scored = filtered.map((m) => {
      let score = 0;

      // Tag match: +3 per matching word
      const lowerTags = m.tags.map((t) => t.toLowerCase());
      for (const word of contextWords) {
        if (lowerTags.includes(word)) {
          score += 3;
        }
      }

      // Content match: +1 per matching word
      const lowerContent = m.content.toLowerCase();
      for (const word of contextWords) {
        if (lowerContent.includes(word)) {
          score += 1;
        }
      }

      // Type-aware recency bonus
      const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
      const decayRate = RECENCY_DECAY_RATES[m.type] ?? 0.1;
      score += Math.max(0, MAX_RECENCY_BONUS - ageDays * decayRate);

      // Access frequency: log2(accessCount + 1) * 0.5
      score += Math.log2(m.accessCount + 1) * 0.5;

      // Type-based scoring priorities
      const typePriority: Record<string, number> = {
        mistake: 3,
        procedure: 1.5,
        skill: 1,
        fact: 0.5,
        observation: 0,
        preference: 0,
      };
      score += typePriority[m.type] ?? 0;

      return { memory: m, score };
    });

    // Sort by score descending, take top maxEntries
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, maxEntries);

    // Update accessCount and lastAccessedAt for returned memories
    for (const { memory } of top) {
      memory.accessCount += 1;
      memory.lastAccessedAt = now;
      await this.db.put(memory);
    }

    return top.map((s) => s.memory);
  }

  async getAll(): Promise<LongTermMemory[]> {
    return this.db.getAll();
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(id);
  }

  async clearAll(): Promise<void> {
    await this.db.clear();
  }

  async buildMemoryPrompt(
    agentId: string,
    taskContext: string,
    maxEntries?: number,
    tokenBudget?: number,
  ): Promise<string> {
    const memories = await this.retrieve(agentId, taskContext, maxEntries);
    if (memories.length === 0) {
      return '';
    }

    const lines = ['## Memory Context', ''];
    const normalizedBudget = typeof tokenBudget === 'number' && tokenBudget > 0
      ? tokenBudget
      : Number.POSITIVE_INFINITY;
    let usedTokens = Math.ceil(lines.join('\n').length / 4);

    for (const m of memories) {
      const line = `- **[${m.type}]** ${m.content} _(tags: ${m.tags.join(', ')})_`;
      const lineTokens = Math.ceil(line.length / 4);
      if (usedTokens + lineTokens > normalizedBudget && lines.length > 2) {
        break;
      }
      lines.push(line);
      usedTokens += lineTokens;
    }

    if (lines.length === 2) {
      return '';
    }

    // Warn when memories were omitted due to budget
    const includedCount = lines.length - 2; // subtract header and blank line
    if (memories.length > includedCount) {
      lines.push('');
      lines.push(`_[${memories.length - includedCount} additional memories omitted due to token budget. Use memory_read for targeted retrieval.]_`);
    }

    return lines.join('\n');
  }
}

/** Reset the internal counter - only for testing */
export function _resetLtmCounter(): void {
  ltmCounter = 0;
}
