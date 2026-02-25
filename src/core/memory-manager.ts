import type { LongTermMemory, MemoryType } from '../types/memory';
import type { MemoryDB } from './memory-db';
import { VectorMemoryDB } from './vector-memory-db';

let ltmCounter = 0;

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
    maxEntries = 15,
  ): Promise<LongTermMemory[]> {
    // Use semantic search if database supports it
    if (this.db instanceof VectorMemoryDB) {
      const results = await this.db.semanticSearch(taskContext, agentId, maxEntries);
      // Update access tracking on retrieved results
      const now = Date.now();
      for (const mem of results) {
        mem.accessCount = (mem.accessCount || 0) + 1;
        mem.lastAccessedAt = now;
        await this.db.put(mem);
      }
      return results;
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

      // Recency bonus: max(0, 2 - ageDays * 0.3)
      const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 2 - ageDays * 0.3);

      // Access frequency: log2(accessCount + 1) * 0.5
      score += Math.log2(m.accessCount + 1) * 0.5;

      // Mistake type bonus: +2
      if (m.type === 'mistake') {
        score += 2;
      }

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
    return lines.join('\n');
  }
}

/** Reset the internal counter - only for testing */
export function _resetLtmCounter(): void {
  ltmCounter = 0;
}
