import { EmbeddingEngine } from './embedding-engine';
import {
  cosineSimilarity,
  type IVectorStore,
  type MemoryVector,
  type SearchOptions,
  type VectorSearchResult,
} from './vector-store';

const DB_NAME = 'mas-vector-store';
const STORE_NAME = 'vectors';
const DB_VERSION = 2;

/**
 * IndexedDB-backed vector store. Keeps an in-memory cache for fast cosine
 * similarity search while persisting all mutations to IndexedDB so data
 * survives page reloads.
 */
export class PersistentVectorStore implements IVectorStore {
  private _engine: EmbeddingEngine;
  private _cache = new Map<string, MemoryVector>();

  constructor() {
    this._engine = new EmbeddingEngine();
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          return;
        }
        // Migration harness: keep future version upgrades centralized here.
        // v2 currently does not require shape changes for existing records.
        if (request.transaction) {
          request.transaction.objectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbGetAll(): Promise<MemoryVector[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => { db.close(); resolve(request.result as MemoryVector[]); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  private async idbPut(vector: MemoryVector): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(vector);
      request.onsuccess = () => { db.close(); resolve(); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  private async idbDelete(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => { db.close(); resolve(); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  private async idbClear(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => { db.close(); resolve(); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async init(): Promise<void> {
    // Load all persisted vectors into cache
    const stored = await this.idbGetAll();
    this._cache.clear();
    for (const vec of stored) {
      this._cache.set(vec.id, vec);
    }
    // Warm the embedding engine
    await this._engine.embed('warmup');
  }

  async add(input: Omit<MemoryVector, 'embedding'>): Promise<MemoryVector> {
    const embedding = await this._engine.embed(input.content);
    const vector: MemoryVector = { ...input, embedding };
    this._cache.set(vector.id, vector);
    await this.idbPut(vector);
    return vector;
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryVector[]> {
    const { results } = await this.searchWithDiagnostics(query, options);
    return results;
  }

  async searchWithDiagnostics(query: string, options?: SearchOptions): Promise<VectorSearchResult> {
    const startedAt = Date.now();
    const limit = options?.limit ?? 15;
    const minScore = options?.minScore;
    const queryEmbedding = await this._engine.embed(query);

    let candidates = Array.from(this._cache.values());
    const totalVectors = candidates.length;

    if (options?.agentId) {
      const agentId = options.agentId;
      candidates = candidates.filter(
        (v) => v.agentId === agentId || v.shared === true,
      );
    }

    if (options?.type) {
      const type = options.type;
      candidates = candidates.filter((v) => v.type === type);
    }

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

  async update(
    id: string,
    changes: Partial<Pick<MemoryVector, 'content' | 'tags' | 'type' | 'shared'>>,
  ): Promise<void> {
    const existing = this._cache.get(id);
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
    this._cache.set(id, updated);
    await this.idbPut(updated);
  }

  async delete(id: string): Promise<void> {
    this._cache.delete(id);
    await this.idbDelete(id);
  }

  async clear(): Promise<void> {
    this._cache.clear();
    await this.idbClear();
  }

  async getAll(): Promise<MemoryVector[]> {
    return Array.from(this._cache.values());
  }

  async getById(id: string): Promise<MemoryVector | null> {
    return this._cache.get(id) ?? null;
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
