import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ToolPlugin } from '../tool-plugin';

export const webSearchPlugin: ToolPlugin = {
  name: 'web_search',
  description: 'Search the web using Google Search. Returns an array of results with title, url, and snippet.',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
    maxResults: { type: 'number', description: 'Maximum number of results to return (default: 5)' },
  },
  async handler(args, ctx) {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) ?? 5;

    if (!ctx.apiKey) {
      return 'Error: No API key available for web search.';
    }

    try {
      const client = new GoogleGenerativeAI(ctx.apiKey);
      const model = client.getGenerativeModel({
        model: 'gemini-2.0-flash',
        tools: [{ googleSearch: {} } as any],
      });

      const result = await model.generateContent(
        `Search the web for: "${query}". Return ONLY a JSON array of the top ${maxResults} results, each with "title", "url", and "snippet" fields. No other text.`
      );

      const text = result.response.text();

      // Try to extract JSON from the response
      try {
        // Handle case where model wraps JSON in markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const jsonStr = jsonMatch[1]?.trim() ?? text;
        const parsed = JSON.parse(jsonStr);
        return JSON.stringify(Array.isArray(parsed) ? parsed.slice(0, maxResults) : parsed);
      } catch {
        return text;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
