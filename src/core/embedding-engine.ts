import { pipeline } from '@huggingface/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Wraps Transformers.js to generate text embeddings using the
 * all-MiniLM-L6-v2 sentence-transformer model.
 *
 * The model is lazy-loaded on the first call to embed() or embedBatch()
 * so construction is synchronous and free of side-effects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- v3 pipeline() returns a complex union too deep for ReturnType
type FeatureExtractionPipeline = (text: string, options?: any) => Promise<{ data: Float32Array }>;

export class EmbeddingEngine {
  private _pipe: Promise<FeatureExtractionPipeline> | null = null;
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
    const output = await pipe(text, { pooling: 'mean', normalize: true });
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
  private async _getPipeline(): Promise<FeatureExtractionPipeline> {
    if (this._pipe === null) {
      // @ts-expect-error -- v3 pipeline() return type union is too complex for TS to represent
      this._pipe = pipeline('feature-extraction', MODEL_NAME);
    }
    return this._pipe!;
  }
}
