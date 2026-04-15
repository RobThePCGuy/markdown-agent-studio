import type { ToolPlugin } from '../tool-plugin';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const webFetchPlugin: ToolPlugin = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the page content as text. HTML is automatically converted to readable text.',
  parameters: {
    url: { type: 'string', description: 'The URL to fetch', required: true },
    maxLength: { type: 'number', description: 'Maximum characters to return (default: 50000)' },
  },
  retryable: true,
  async handler(args, _ctx) {
    const url = args.url as string;
    const maxLength = (args.maxLength as number) ?? 50000;

    // Network errors now propagate (caught by tool-handler retry wrapper)
    const response = await fetch(url, {
      headers: { 'Accept': 'text/html,text/plain,application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // Retryable HTTP errors (429, 500, 502, 503, 529) — throw so retryWithBackoff can retry
      const retryableStatuses = new Set([429, 500, 502, 503, 529]);
      if (retryableStatuses.has(response.status)) {
        const retryAfter = response.headers.get('retry-after');
        const err = new Error(`HTTP ${response.status} ${response.statusText}`);
        (err as Error & { status: number }).status = response.status;
        if (retryAfter) {
          (err as Error & { retryAfter: string }).retryAfter = retryAfter;
        }
        throw err;
      }
      // Non-retryable HTTP errors (404, 403, etc.) — return string (permanent failure)
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') ?? '';
    let text = await response.text();

    if (contentType.includes('text/html')) {
      text = stripHtml(text);
    }

    if (text.length > maxLength) {
      const pctKept = Math.round((maxLength / text.length) * 100);
      return text.slice(0, maxLength) +
        `\n[truncated: showing ${pctKept}% of content (${maxLength} of ${text.length} chars). Use maxLength parameter to retrieve more.]`;
    }

    return text;
  },
};
