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
  async handler(args, _ctx) {
    const url = args.url as string;
    const maxLength = (args.maxLength as number) ?? 50000;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'text/html,text/plain,application/json' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
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
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
