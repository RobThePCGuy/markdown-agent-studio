import { useEffect, useSyncExternalStore } from 'react';
import type { ProviderType } from '../stores/use-stores';
import { fetchModelsForProvider } from '../utils/fetch-models';

const HARDCODED_MODELS: Record<ProviderType, string[]> = {
  gemini: [
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
  ],
  anthropic: [
    'claude-opus-4-5-20250929',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-3-5-20241022',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o4-mini',
    'o3',
  ],
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_MS = 500;

interface CacheEntry {
  models: string[];
  timestamp: number;
}

interface StoreState {
  models: string[];
  loading: boolean;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(provider: ProviderType, apiKey: string): string {
  return `${provider}:${apiKey.slice(0, 8)}`;
}

/** Merge fetched models with hardcoded fallbacks, putting hardcoded first. */
function mergeModels(provider: ProviderType, fetched: string[]): string[] {
  const defaults = HARDCODED_MODELS[provider] ?? [];
  const fetchedSet = new Set(fetched);
  const merged = [...defaults.filter(m => fetchedSet.has(m))];
  for (const m of fetched) {
    if (!defaults.includes(m)) merged.push(m);
  }
  return merged.length > 0 ? merged : defaults;
}

// Module-level store keyed by provider+apiKey prefix
let globalState: StoreState = { models: [], loading: false };
let currentProvider: ProviderType | null = null;
let currentApiKey = '';
const listeners = new Set<() => void>();
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const l of listeners) l();
}

function setGlobalState(next: Partial<StoreState>) {
  globalState = { ...globalState, ...next };
  emit();
}

function updateModels(provider: ProviderType, apiKey: string) {
  const providerChanged = provider !== currentProvider;
  const keyChanged = apiKey !== currentApiKey;
  if (!providerChanged && !keyChanged) return;

  currentProvider = provider;
  currentApiKey = apiKey;

  clearTimeout(debounceTimer);

  const defaults = HARDCODED_MODELS[provider] ?? [];

  if (!apiKey) {
    setGlobalState({ models: defaults, loading: false });
    return;
  }

  // Check cache
  const key = getCacheKey(provider, apiKey);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    setGlobalState({ models: mergeModels(provider, cached.models), loading: false });
    return;
  }

  setGlobalState({ models: defaults, loading: true });

  debounceTimer = setTimeout(async () => {
    const fetched = await fetchModelsForProvider(provider, apiKey);
    if (provider !== currentProvider || apiKey !== currentApiKey) return;
    if (fetched.length > 0) {
      cache.set(key, { models: fetched, timestamp: Date.now() });
      setGlobalState({ models: mergeModels(provider, fetched), loading: false });
    } else {
      setGlobalState({ loading: false });
    }
  }, DEBOUNCE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): StoreState {
  return globalState;
}

export function useProviderModels(
  provider: ProviderType,
  apiKey: string
): { models: string[]; loading: boolean } {
  // Trigger model update when inputs change
  useEffect(() => {
    updateModels(provider, apiKey);
    return () => clearTimeout(debounceTimer);
  }, [provider, apiKey]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
