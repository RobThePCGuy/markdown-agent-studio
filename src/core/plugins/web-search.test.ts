import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../tool-plugin';

// Mock @google/genai before importing the plugin
vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = {
      generateContent: async () => ({
        text: 'Spain won Euro 2024, defeating England 2-1 in the final.',
        candidates: [
          {
            groundingMetadata: {
              webSearchQueries: ['euro 2024 winner'],
              groundingChunks: [
                { web: { uri: 'https://example.com/1', title: 'UEFA Euro 2024' } },
                { web: { uri: 'https://example.com/2', title: 'Sports News' } },
              ],
            },
          },
        ],
      }),
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

// Import after mock
import { webSearchPlugin } from './web-search';

describe('web_search plugin', () => {
  const mockCtx = {
    apiKey: 'test-api-key',
  } as unknown as ToolContext;

  it('returns summary with grounding sources', async () => {
    const result = await webSearchPlugin.handler({ query: 'euro 2024 winner' }, mockCtx);
    const parsed = JSON.parse(result);
    expect(parsed.summary).toContain('Spain');
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.sources[0].title).toBe('UEFA Euro 2024');
    expect(parsed.sources[0].url).toBe('https://example.com/1');
  });

  it('returns error when no API key', async () => {
    const noKeyCtx = {} as ToolContext;
    const result = await webSearchPlugin.handler({ query: 'test' }, noKeyCtx);
    expect(result).toContain('Error');
    expect(result).toContain('Gemini API key');
  });

  it('uses providerApiKeys.gemini when available', async () => {
    const ctxWithProviderKeys = {
      apiKey: 'anthropic-key',
      providerApiKeys: { gemini: 'gemini-key', anthropic: 'anthropic-key' },
    } as unknown as ToolContext;
    const result = await webSearchPlugin.handler({ query: 'test' }, ctxWithProviderKeys);
    // Should not error — should use the gemini key, not the anthropic key
    expect(result).not.toContain('Error');
  });

  it('returns error when providerApiKeys exists but gemini key is missing', async () => {
    const ctxNoGemini = {
      apiKey: 'anthropic-key',
      providerApiKeys: { anthropic: 'anthropic-key' },
    } as unknown as ToolContext;
    const result = await webSearchPlugin.handler({ query: 'test' }, ctxNoGemini);
    expect(result).toContain('Error');
    expect(result).toContain('Gemini API key');
  });

  it('has correct plugin metadata', () => {
    expect(webSearchPlugin.name).toBe('web_search');
    expect(webSearchPlugin.parameters.query.required).toBe(true);
  });
});
