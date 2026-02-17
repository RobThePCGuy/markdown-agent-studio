import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../tool-plugin';

// Mock @google/generative-ai before importing the plugin
vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    getGenerativeModel() {
      return {
        generateContent: async () => ({
          response: {
            text: () => JSON.stringify([
              { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
              { title: 'Result 2', url: 'https://example.com/2', snippet: 'Second result' },
            ]),
          },
        }),
      };
    }
  }
  return { GoogleGenerativeAI: MockGoogleGenerativeAI };
});

// Import after mock
import { webSearchPlugin } from './web-search';

describe('web_search plugin', () => {
  const mockCtx = {
    apiKey: 'test-api-key',
  } as unknown as ToolContext;

  it('returns search results as JSON', async () => {
    const result = await webSearchPlugin.handler({ query: 'test query' }, mockCtx);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Result 1');
    expect(parsed[0].url).toBe('https://example.com/1');
  });

  it('returns error when no API key', async () => {
    const noKeyCtx = {} as ToolContext;
    const result = await webSearchPlugin.handler({ query: 'test' }, noKeyCtx);
    expect(result).toContain('Error');
    expect(result).toContain('No API key');
  });

  it('has correct plugin metadata', () => {
    expect(webSearchPlugin.name).toBe('web_search');
    expect(webSearchPlugin.parameters.query.required).toBe(true);
  });
});
