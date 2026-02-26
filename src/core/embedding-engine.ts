import { pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Wraps Transformers.js to generate text embeddings using the
 * all-MiniLM-L6-v2 sentence-transformer model.
 *
 * The model is lazy-loaded on the first call to embed() or embedBatch()
 * so construction is synchronous and free of side-effects.
 */
export class EmbeddingEngine {
  private _pipe: ReturnType<typeof pipeline> | null = null;
  private _ready = false;

  /** Returns true once the model has been loaded and at least one embedding produced. */
  isReady(): boolean {
    return this._ready;
  }

  /**
   * Generate an embedding for a single text string.
   * Returns a plain number[] of length 384.
   */
  async embed(text: string): Promise<number[]> {
    const pipe = await this._getPipeline();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Transformers.js pipeline types don't expose pooling/normalize options
    const output = await pipe(text, { pooling: 'mean', normalize: true } as any);
    this._ready = true;
    return Array.from((output as { data: Float32Array }).data).slice(0, EMBEDDING_DIM);
  }

  /**
   * Generate embeddings for multiple text strings.
   * Returns one number[] per input text, each of length 384.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /** Lazy-load the pipeline on first use. */
  private async _getPipeline() {
    if (this._pipe === null) {
      this._pipe = pipeline('feature-extraction', MODEL_NAME);
    }
    return this._pipe;
  }
}
