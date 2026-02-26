import type { ProviderType } from '../stores/use-stores';

/**
 * Fetches available models for a given provider using their REST API.
 * Returns an empty array on any error (caller should fall back to hardcoded defaults).
 */
export async function fetchModelsForProvider(
  provider: ProviderType,
  apiKey: string
): Promise<string[]> {
  if (!apiKey) return [];

  try {
    switch (provider) {
      case 'gemini':
        return await fetchGeminiModels(apiKey);
      case 'anthropic':
        return await fetchAnthropicModels(apiKey);
      case 'openai':
        return await fetchOpenAIModels(apiKey);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  interface GeminiModel {
    name: string;
    supportedGenerationMethods?: string[];
  }
  return (data.models as GeminiModel[])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort();
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  interface AnthropicModel {
    id: string;
    type: string;
  }
  return (data.data as AnthropicModel[])
    .filter((m) => m.type === 'model')
    .map((m) => m.id)
    .sort();
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  interface OpenAIModel {
    id: string;
  }
  const chatPrefixes = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt'];
  const excludePatterns = ['embedding', 'whisper', 'dall-e', 'tts', 'moderation', 'davinci', 'babbage'];
  return (data.data as OpenAIModel[])
    .filter((m) => {
      const id = m.id.toLowerCase();
      const isChat = chatPrefixes.some((p) => id.startsWith(p));
      const isExcluded = excludePatterns.some((p) => id.includes(p));
      return isChat && !isExcluded;
    })
    .map((m) => m.id)
    .sort();
}
