import { GoogleGenAI } from '@google/genai';
import type { GroundingChunk } from '@google/genai';
import type { ToolPlugin } from '../tool-plugin';

export const webSearchPlugin: ToolPlugin = {
  name: 'web_search',
  description:
    'Search the web using Google Search. Returns a summary with source URLs. Requires a Gemini API key.',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
  },
  async handler(args, ctx) {
    const query = args.query as string;

    // Resolve the Gemini API key: use the dedicated Gemini key from the
    // per-provider key map. Only fall back to ctx.apiKey if the per-provider
    // map is not available (backward compat for single-key setups).
    const geminiKey = ctx.providerApiKeys
      ? ctx.providerApiKeys.gemini
      : ctx.apiKey;

    if (!geminiKey) {
      return 'Error: No Gemini API key available for web search. Web search requires a Gemini API key — set one in Settings even if you use another provider.';
    }

    try {
      const client = new GoogleGenAI({ apiKey: geminiKey });

      // 30-second timeout to prevent indefinite hangs
      const result = await Promise.race([
        client.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: query,
          config: {
            tools: [{ googleSearch: {} }],
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('web_search timed out after 30 s')), 30_000),
        ),
      ]);
      const candidate = result.candidates?.[0];
      const text = result.text ?? '';

      // Extract grounding sources from metadata
      const chunks: GroundingChunk[] =
        candidate?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .filter((c) => c.web)
        .map((c) => ({
          title: c.web?.title ?? '',
          url: c.web?.uri ?? '',
        }));

      if (sources.length > 0) {
        return JSON.stringify({ summary: text, sources });
      }

      // Fallback: return the text response if no grounding chunks
      return text || 'No results found.';
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
