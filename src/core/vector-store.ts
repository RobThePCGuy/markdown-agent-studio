import { EmbeddingEngine } from './embedding-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryVector {
  id: string;
  agentId: string;
  content: string;
  type: 'skill' | 'fact' | 'procedure' | 'observation' | 'mistake' | 'preference';
  tags: string[];
  embedding: number[];
  createdAt: number;
  updatedAt: number;
  cycleId?: string;
  shared: boolean;
}

export interface SearchOptions {
  agentId?: string;
  limit?: number;
  type?: MemoryVector['type'];
  tags?: string[];
}

export interface VectorStoreOptions {
  inMemory?: boolean;
  dbPath?: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IVectorStore {
  init(): Promise<void>;
  add(input: Omit<MemoryVector, 'embedding'>): Promise<MemoryVector>;
  search(query: string, options?: SearchOptions): Promise<MemoryVector[]>;
  update(id: string, changes: Partial<Pick<MemoryVector, 'content' | 'tags' | 'type' | 'shared'>>): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  getAll(): Promise<MemoryVector[]>;
  getById(id: string): Promise<MemoryVector | null>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Cosine similarity between two equal-length number arrays. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

/**
 * In-memory vector store backed by the EmbeddingEngine for semantic search
 * across memory vectors.
 *
 * Stores MemoryVector entries and provides search with cosine-similarity
 * ranking plus filtering by agentId, type, and tags.
 */
export class VectorStore implements IVectorStore {
  private _engine: EmbeddingEngine;
  private _vectors: Map<string, MemoryVector> = new Map();

  constructor(_options?: VectorStoreOptions) {
    this._engine = new EmbeddingEngine();
  }

  /**
   * Pre-warm the embedding model by generating a throwaway embedding.
   * Call this once during startup so the first real search is fast.
   */
  async init(): Promise<void> {
    // Trigger model loading by embedding a short warm-up string
    await this._engine.embed('warmup');
  }

  /**
   * Embed content and store the resulting MemoryVector.
   * The input should omit the `embedding` field - it is generated here.
   */
  async add(input: Omit<MemoryVector, 'embedding'>): Promise<MemoryVector> {
    const embedding = await this._engine.embed(input.content);
    const vector: MemoryVector = { ...input, embedding };
    this._vectors.set(vector.id, vector);
    return vector;
  }

  /**
   * Semantic search with filtering.
   *
   * - Filters by agentId: only returns vectors where `v.agentId === agentId || v.shared === true`
   * - Filters by type if provided
   * - Filters by tags if provided (OR logic - any matching tag)
   * - Ranks by cosine similarity to query embedding
   * - Returns top `limit` results (default 15)
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryVector[]> {
    const limit = options?.limit ?? 15;
    const queryEmbedding = await this._engine.embed(query);

    let candidates = Array.from(this._vectors.values());

    // Filter by agentId: own memories + shared
    if (options?.agentId) {
      const agentId = options.agentId;
      candidates = candidates.filter(
        (v) => v.agentId === agentId || v.shared === true,
      );
    }

    // Filter by type
    if (options?.type) {
      const type = options.type;
      candidates = candidates.filter((v) => v.type === type);
    }

    // Filter by tags (OR logic - any matching tag)
    if (options?.tags && options.tags.length > 0) {
      const searchTags = new Set(options.tags);
      candidates = candidates.filter((v) =>
        v.tags.some((t) => searchTags.has(t)),
      );
    }

    // Rank by cosine similarity (descending)
    const scored = candidates.map((v) => ({
      vector: v,
      score: cosineSimilarity(queryEmbedding, v.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => s.vector);
  }

  /**
   * Update fields on an existing vector.
   * If `content` changes, the embedding is regenerated.
   */
  async update(
    id: string,
    changes: Partial<Pick<MemoryVector, 'content' | 'tags' | 'type' | 'shared'>>,
  ): Promise<void> {
    const existing = this._vectors.get(id);
    if (!existing) return;

    const updated: MemoryVector = { ...existing };

    if (changes.tags !== undefined) updated.tags = changes.tags;
    if (changes.type !== undefined) updated.type = changes.type;
    if (changes.shared !== undefined) updated.shared = changes.shared;

    if (changes.content !== undefined && changes.content !== existing.content) {
      updated.content = changes.content;
      updated.embedding = await this._engine.embed(changes.content);
    }

    updated.updatedAt = Date.now();
    this._vectors.set(id, updated);
  }

  /** Remove a single vector by id. */
  async delete(id: string): Promise<void> {
    this._vectors.delete(id);
  }

  /** Remove all stored vectors. */
  async clear(): Promise<void> {
    this._vectors.clear();
  }

  /** Return all stored vectors. */
  async getAll(): Promise<MemoryVector[]> {
    return Array.from(this._vectors.values());
  }

  /** Return a single vector by id, or null if not found. */
  async getById(id: string): Promise<MemoryVector | null> {
    return this._vectors.get(id) ?? null;
  }
}
