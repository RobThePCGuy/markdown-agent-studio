import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetchPlugin } from './web-fetch';
import type { ToolContext } from '../tool-plugin';

describe('web_fetch plugin', () => {
  const mockCtx = {} as ToolContext;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches plain text content', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => 'Hello world',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com/data.txt' }, mockCtx);
    expect(result).toBe('Hello world');
    expect(fetch).toHaveBeenCalledWith('https://example.com/data.txt', expect.any(Object));
  });

  it('strips HTML tags from HTML responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><h1>Title</h1><p>Content here</p></body></html>',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com' }, mockCtx);
    expect(result).toContain('Title');
    expect(result).toContain('Content here');
    expect(result).not.toContain('<h1>');
  });

  it('truncates to maxLength', async () => {
    const longText = 'x'.repeat(200);
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => longText,
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com', maxLength: 50 }, mockCtx);
    expect(result).toContain('[truncated]');
    expect(result.length).toBeLessThanOrEqual(62); // 50 + '\n[truncated]'
  });

  it('returns error for non-ok responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com/nope' }, mockCtx);
    expect(result).toContain('Error');
    expect(result).toContain('404');
  });

  it('returns error for network failures', async () => {
    (fetch as any).mockRejectedValue(new Error('Network error'));

    const result = await webFetchPlugin.handler({ url: 'https://example.com' }, mockCtx);
    expect(result).toContain('Error');
    expect(result).toContain('Network error');
  });

  it('has correct plugin metadata', () => {
    expect(webFetchPlugin.name).toBe('web_fetch');
    expect(webFetchPlugin.parameters.url.required).toBe(true);
  });
});
