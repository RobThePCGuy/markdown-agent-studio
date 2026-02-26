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
  minScore?: number;
  keywordFilter?: string | string[];
}

export interface VectorStoreOptions {
  inMemory?: boolean;
  dbPath?: string;
}

export interface VectorSearchDiagnostics {
  query: string;
  totalVectors: number;
  candidateCount: number;
  filteredOutByKeywords: number;
  filteredOutByMinScore: number;
  durationMs: number;
}

export interface VectorSearchResult {
  results: MemoryVector[];
  diagnostics: VectorSearchDiagnostics;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IVectorStore {
  init(): Promise<void>;
  add(input: Omit<MemoryVector, 'embedding'>): Promise<MemoryVector>;
  search(query: string, options?: SearchOptions): Promise<MemoryVector[]>;
  searchWithDiagnostics(query: string, options?: SearchOptions): Promise<VectorSearchResult>;
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
    const { results } = await this.searchWithDiagnostics(query, options);
    return results;
  }

  async searchWithDiagnostics(query: string, options?: SearchOptions): Promise<VectorSearchResult> {
    const startedAt = Date.now();
    const limit = options?.limit ?? 15;
    const minScore = options?.minScore;
    const queryEmbedding = await this._engine.embed(query);

    let candidates = Array.from(this._vectors.values());
    const totalVectors = candidates.length;

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
    const keywordTokens = normalizeKeywordTokens(options?.keywordFilter);
    let filteredOutByKeywords = 0;
    if (keywordTokens.length > 0) {
      const before = candidates.length;
      candidates = candidates.filter((v) => includesAnyKeyword(v.content, keywordTokens));
      filteredOutByKeywords = before - candidates.length;
    }
    const candidateCount = candidates.length;

    // Rank by cosine similarity (descending)
    const scored = candidates.map((v) => ({
      vector: v,
      score: cosineSimilarity(queryEmbedding, v.embedding),
    }));

    let filteredOutByMinScore = 0;
    if (typeof minScore === 'number') {
      const before = scored.length;
      scored.splice(0, scored.length, ...scored.filter((s) => s.score >= minScore));
      filteredOutByMinScore = before - scored.length;
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      results: scored.slice(0, limit).map((s) => s.vector),
      diagnostics: {
        query,
        totalVectors,
        candidateCount,
        filteredOutByKeywords,
        filteredOutByMinScore,
        durationMs: Date.now() - startedAt,
      },
    };
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

function normalizeKeywordTokens(value?: string | string[]): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => entry.split(/\s+/))
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function includesAnyKeyword(content: string, keywords: string[]): boolean {
  const haystack = content.toLowerCase();
  return keywords.some((token) => haystack.includes(token));
}
