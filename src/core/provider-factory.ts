import type { AIProvider } from '../types';
import type { ProviderType } from '../stores/use-stores';
import { GeminiProvider } from './gemini-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';

/**
 * Creates the appropriate AIProvider based on the selected provider type and API key.
 */
export function createProvider(providerType: ProviderType, apiKey: string): AIProvider {
  switch (providerType) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'gemini':
    default:
      return new GeminiProvider(apiKey);
  }
}
