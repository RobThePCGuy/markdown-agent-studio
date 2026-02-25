import type { LongTermMemory } from '../types/memory';
import type { MemoryDB } from './memory-db';
import { VectorStore, type MemoryVector, type VectorStoreOptions } from './vector-store';

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a LongTermMemory entry to the fields needed by VectorStore.add().
 * The `shared` flag is derived from whether the agentId is 'global'.
 */
function toMemoryVector(entry: LongTermMemory): Omit<MemoryVector, 'embedding'> {
  return {
    id: entry.id,
    agentId: entry.agentId,
    content: entry.content,
    type: entry.type,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    updatedAt: entry.lastAccessedAt,
    shared: entry.agentId === 'global',
  };
}

/**
 * Convert a MemoryVector back to LongTermMemory.
 * Fields that don't exist in MemoryVector (accessCount, runId) get defaults.
 */
function toLongTermMemory(vec: MemoryVector): LongTermMemory {
  return {
    id: vec.id,
    agentId: vec.agentId,
    type: vec.type,
    content: vec.content,
    tags: [...vec.tags],
    createdAt: vec.createdAt,
    lastAccessedAt: vec.updatedAt,
    accessCount: 0,
    runId: '',
  };
}

// ---------------------------------------------------------------------------
// VectorMemoryDB
// ---------------------------------------------------------------------------

/**
 * A MemoryDB adapter backed by VectorStore. Provides the same interface as
 * InMemoryMemoryDB / IndexedDBMemoryDB but adds semantic search capabilities
 * through the underlying embedding engine.
 *
 * Usage:
 *   const db = new VectorMemoryDB({ inMemory: true });
 *   await db.init();  // MUST be called before use
 *   await db.put(entry);
 *   const results = await db.semanticSearch('query', 'agent-A');
 */
export class VectorMemoryDB implements MemoryDB {
  private _store: VectorStore;

  constructor(options?: VectorStoreOptions) {
    this._store = new VectorStore(options);
  }

  /**
   * Pre-warm the embedding engine. MUST be called before any other method.
   */
  async init(): Promise<void> {
    await this._store.init();
  }

  // ---- MemoryDB interface ----

  /**
   * Upsert a LongTermMemory entry. If an entry with the same id already
   * exists it is deleted first, then the new entry is added with a fresh
   * embedding.
   */
  async put(entry: LongTermMemory): Promise<void> {
    // Upsert: delete existing if present, then add
    const existing = await this._store.getById(entry.id);
    if (existing) {
      await this._store.delete(entry.id);
    }
    await this._store.add(toMemoryVector(entry));
  }

  /** Return all entries as LongTermMemory objects. */
  async getAll(): Promise<LongTermMemory[]> {
    const vectors = await this._store.getAll();
    return vectors.map(toLongTermMemory);
  }

  /** Delete a single entry by id. */
  async delete(id: string): Promise<void> {
    await this._store.delete(id);
  }

  /** Remove all entries. */
  async clear(): Promise<void> {
    await this._store.clear();
  }

  // ---- Extended methods ----

  /**
   * Semantic search: find memories relevant to a query string, scoped to the
   * given agentId (the agent's own memories plus any shared memories).
   *
   * Returns results as LongTermMemory objects, ranked by relevance.
   */
  async semanticSearch(
    query: string,
    agentId: string,
    limit?: number,
  ): Promise<LongTermMemory[]> {
    const vectors = await this._store.search(query, {
      agentId,
      limit,
    });
    return vectors.map(toLongTermMemory);
  }

  /**
   * Toggle the shared flag on a memory. Shared memories are visible to all
   * agents during semantic search.
   */
  async markShared(id: string, shared: boolean): Promise<void> {
    await this._store.update(id, { shared });
  }
}
