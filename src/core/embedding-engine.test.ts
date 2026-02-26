import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { EmbeddingEngine as EmbeddingEngineType } from './embedding-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cosine similarity between two equal-length number arrays. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Build a deterministic fake embedding from text (module-level so hoisted mock can use it). */
function fakeEmbedding(text: string): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = ((text.charCodeAt(i % text.length) + i) % 100) / 100;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Module-level mock for @xenova/transformers
// vi.mock is hoisted to the top of the file so all references must be
// available at the module scope.
// ---------------------------------------------------------------------------

const mockPipe = vi.fn(async (text: string) => ({
  data: fakeEmbedding(text),
}));

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(async () => mockPipe),
}));

// ---------------------------------------------------------------------------
// Mock-based tests (always run, no model download required)
// ---------------------------------------------------------------------------

describe('EmbeddingEngine (mocked)', () => {
  let EmbeddingEngine: typeof EmbeddingEngineType;

  beforeAll(async () => {
    const mod = await import('./embedding-engine');
    EmbeddingEngine = mod.EmbeddingEngine;
  });

  it('isReady() returns false before any embed call', () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady()).toBe(false);
  });

  it('embed() returns a number[] of length 384', async () => {
    const engine = new EmbeddingEngine();
    const result = await engine.embed('hello world');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(384);
    result.forEach((v) => expect(typeof v).toBe('number'));
  });

  it('isReady() returns true after first embed call', async () => {
    const engine = new EmbeddingEngine();
    expect(engine.isReady()).toBe(false);
    await engine.embed('hello');
    expect(engine.isReady()).toBe(true);
  });

  it('embedBatch() returns correct number of embeddings', async () => {
    const engine = new EmbeddingEngine();
    const texts = ['cats are nice', 'dogs are loyal', 'the sun is bright'];
    const results = await engine.embedBatch(texts);

    expect(results).toHaveLength(3);
    results.forEach((emb) => {
      expect(emb).toHaveLength(384);
      emb.forEach((v) => expect(typeof v).toBe('number'));
    });
  });

  it('embedBatch() with empty array returns empty array', async () => {
    const engine = new EmbeddingEngine();
    const results = await engine.embedBatch([]);
    expect(results).toEqual([]);
  });

  it('embedBatch() with single item works', async () => {
    const engine = new EmbeddingEngine();
    const results = await engine.embedBatch(['single item']);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(384);
  });

  it('lazy-loads the model only on first use', async () => {
    const { pipeline } = await import('@xenova/transformers');
    const pipelineFn = vi.mocked(pipeline);
    pipelineFn.mockClear();

    const engine = new EmbeddingEngine();
    // No pipeline call yet
    expect(pipelineFn).not.toHaveBeenCalled();

    await engine.embed('first');
    expect(pipelineFn).toHaveBeenCalledTimes(1);

    // Second call should reuse the pipeline
    await engine.embed('second');
    expect(pipelineFn).toHaveBeenCalledTimes(1);
  });

  it('embed() produces different vectors for different inputs', async () => {
    const engine = new EmbeddingEngine();
    const vecA = await engine.embed('cats are cute');
    const vecB = await engine.embed('quantum physics');

    // With the deterministic fake, different text produces different vectors
    const same = vecA.every((v, i) => v === vecB[i]);
    expect(same).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests with real model (skip by default - slow, requires download)
// Set EMBEDDING_INTEGRATION=1 env var to enable.
// ---------------------------------------------------------------------------

const INTEGRATION = (globalThis as Record<string, unknown>).process
  ? ((globalThis as Record<string, unknown>).process as { env?: Record<string, string> }).env?.EMBEDDING_INTEGRATION === '1'
  : false;

describe.skipIf(!INTEGRATION)('EmbeddingEngine (integration - real model)', () => {
  let engine: EmbeddingEngineType;

  beforeAll(async () => {
    // Must use dynamic import to avoid the mock from the above suite
    vi.restoreAllMocks();
    vi.resetModules();
    const mod = await import('./embedding-engine');
    engine = new mod.EmbeddingEngine();
  });

  it('embed() returns 384-dimensional vector', async () => {
    const result = await engine.embed('the quick brown fox');
    expect(result).toHaveLength(384);
    result.forEach((v) => expect(typeof v).toBe('number'));
  }, 60_000);

  it('similar texts have higher cosine similarity than dissimilar texts', async () => {
    const embCat = await engine.embed('I love cats');
    const embKitten = await engine.embed('kittens are adorable');
    const embCar = await engine.embed('the car engine needs repair');

    const simSimilar = cosineSimilarity(embCat, embKitten);
    const simDissimilar = cosineSimilarity(embCat, embCar);

    expect(simSimilar).toBeGreaterThan(simDissimilar);
  }, 60_000);

  it('isReady() returns true after embedding', () => {
    expect(engine.isReady()).toBe(true);
  });

  it('embedBatch() returns correct number of results', async () => {
    const results = await engine.embedBatch(['alpha', 'beta', 'gamma']);
    expect(results).toHaveLength(3);
    results.forEach((emb) => expect(emb).toHaveLength(384));
  }, 60_000);
});
