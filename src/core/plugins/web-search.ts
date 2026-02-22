import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Tool, GroundingChunk } from '@google/generative-ai';
import type { ToolPlugin } from '../tool-plugin';

export const webSearchPlugin: ToolPlugin = {
  name: 'web_search',
  description:
    'Search the web using Google Search. Returns a summary with source URLs.',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
  },
  async handler(args, ctx) {
    const query = args.query as string;

    if (!ctx.apiKey) {
      return 'Error: No API key available for web search. Set your Gemini API key in Settings.';
    }

    try {
      const client = new GoogleGenerativeAI(ctx.apiKey);
      const model = client.getGenerativeModel({
        model: 'gemini-2.5-flash',
        // googleSearch is the correct tool for Gemini 2.0+; the installed SDK
        // types only export googleSearchRetrieval (older models), so we cast.
        tools: [{ googleSearch: {} } as unknown as Tool],
      });

      const result = await model.generateContent(query);
      const candidate = result.response.candidates?.[0];
      const text = result.response.text();

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
