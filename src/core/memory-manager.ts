import type { LongTermMemory, MemoryType } from '../types/memory';
import type { MemoryDB } from './memory-db';

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
  ): Promise<string> {
    const memories = await this.retrieve(agentId, taskContext, maxEntries);
    if (memories.length === 0) {
      return '';
    }

    const lines = ['## Memory Context', ''];
    for (const m of memories) {
      lines.push(`- **[${m.type}]** ${m.content} _(tags: ${m.tags.join(', ')})_`);
    }

    return lines.join('\n');
  }
}

/** Reset the internal counter - only for testing */
export function _resetLtmCounter(): void {
  ltmCounter = 0;
}
