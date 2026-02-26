# Plan: Fix Anthropic tool_result Error + Dynamic Model Retrieval

## Context

The Anthropic provider throws a 400 error when an agent makes tool calls on consecutive turns:
```
messages.4.content.0: unexpected tool_use_id found in tool_result blocks:
Each tool_result block must have a corresponding tool_use block in the previous message.
```

The root cause is that all three providers (Anthropic, OpenAI, Gemini) use the same flawed "grab all trailing tool messages" extraction pattern when building follow-up turn messages. When two consecutive turns both produce tool calls, the kernel history accumulates tool messages from BOTH turns with no separator between them. The backward-walk extraction picks up ALL of them, but only the most recent turn's tool_use IDs exist in the last assistant message - causing a mismatch.

Additionally, the model dropdown in the UI is hardcoded. We'll add dynamic model fetching from each provider's API.

Working directory: `/home/rob/markdown-agent-studio/.worktrees/multi-provider`

---

## Fix 1: Tool Result Mismatch (Bug)

### Root Cause Trace

1. **Turn N**: Provider sends messages, assistant responds with `tool_use(id: toolu_1)`. Provider stores `[..., assistant(toolu_1)]` in sessionMessages. Kernel pushes `{role:'tool', toolCall.id: toolu_1}` to history. Since `hadToolCalls=true`, no model text is added to history.

2. **Turn N+1**: Provider retrieves stored messages, walks backward through kernel history collecting trailing tool messages. Finds `toolu_1`, creates `tool_result(toolu_1)`, appends it. API call succeeds. Assistant responds with `tool_use(id: toolu_2)`. Provider stores `[..., assistant(toolu_1), user(tool_result(toolu_1)), assistant(toolu_2)]`. Kernel pushes `{role:'tool', toolCall.id: toolu_2}` to history.

3. **Turn N+2**: Provider retrieves stored messages (last is `assistant(toolu_2)`). Walks backward through kernel history: `i=last -> tool(toolu_2), i=last-1 -> tool(toolu_1)` -- both collected because they're consecutive. Creates `tool_result(toolu_1)` AND `tool_result(toolu_2)`. But `assistant(toolu_2)` only has `tool_use(toolu_2)`. **ERROR**: `toolu_1` has no matching tool_use in the previous assistant message.

### Fix: ID-based extraction (Anthropic/OpenAI), name-based (Gemini)

Instead of blindly collecting all trailing tool messages, extract only those whose IDs match the tool_use blocks in the last stored assistant message.

#### `src/core/anthropic-provider.ts` (lines 47-66)

Replace the trailing-tool-extraction with:
```typescript
messages = [...this.sessionMessages.get(config.sessionId)!];

// Only collect tool results that match the last assistant message's tool_use IDs
const lastMsg = messages[messages.length - 1];
const expectedIds = new Set<string>();
if (lastMsg?.role === 'assistant' && Array.isArray(lastMsg.content)) {
  for (const block of lastMsg.content) {
    if (block.type === 'tool_use') expectedIds.add(block.id);
  }
}

if (expectedIds.size > 0) {
  const resultBlocks: AnthropicContentBlock[] = [];
  for (const m of history) {
    if (m.role === 'tool' && m.toolCall && expectedIds.has(m.toolCall.id)) {
      resultBlocks.push({
        type: 'tool_result' as const,
        tool_use_id: m.toolCall.id,
        content: m.content,
      });
    }
  }
  if (resultBlocks.length > 0) {
    messages.push({ role: 'user', content: resultBlocks });
  }
}
```

#### `src/core/openai-provider.ts` (lines 47-64)

Same pattern, reading IDs from the assistant's `tool_calls` array:
```typescript
messages = [...this.sessionMessages.get(config.sessionId)!];

const lastMsg = messages[messages.length - 1];
const expectedIds = new Set<string>();
if (lastMsg?.role === 'assistant' && lastMsg.tool_calls) {
  for (const tc of lastMsg.tool_calls) expectedIds.add(tc.id);
}

if (expectedIds.size > 0) {
  for (const m of history) {
    if (m.role === 'tool' && m.toolCall && expectedIds.has(m.toolCall.id)) {
      messages.push({ role: 'tool', content: m.content, tool_call_id: m.toolCall.id });
    }
  }
}
```

#### `src/core/gemini-provider.ts` (lines 58-76)

Gemini uses function names (not IDs) in its protocol. Extract expected names from the last model content's `functionCall` parts:
```typescript
contents = [...this.sessionContents.get(config.sessionId)!];

const lastContent = contents[contents.length - 1];
const expectedNames = new Set<string>();
if (lastContent?.role === 'model') {
  for (const part of lastContent.parts) {
    if (part.functionCall) expectedNames.add(part.functionCall.name);
  }
}

if (expectedNames.size > 0) {
  const responseParts: Part[] = [];
  for (const m of history) {
    if (m.role === 'tool' && m.toolCall && expectedNames.has(m.toolCall.name)) {
      responseParts.push({
        functionResponse: { name: m.toolCall.name, response: { result: m.content } },
      });
    }
  }
  if (responseParts.length > 0) {
    contents.push({ role: 'function', parts: responseParts });
  }
}
```

**Note on Gemini edge case**: If the model calls the same function name twice in one turn, both results will be collected. This matches the current behavior and is correct since Gemini matches by name.

---

## Fix 2: Dynamic Model Retrieval (Feature)

### New file: `src/utils/fetch-models.ts`

Exports `fetchModelsForProvider(provider, apiKey): Promise<FetchedModel[]>` with provider-specific fetch logic:

- **Anthropic**: `GET https://api.anthropic.com/v1/models` with `x-api-key` + `anthropic-version` + `anthropic-dangerous-direct-browser-access` headers. Filter to `type === 'model'` entries.
- **OpenAI**: `GET https://api.openai.com/v1/models` with `Authorization: Bearer` header. Filter to chat-capable models (IDs starting with `gpt-` or `o`), exclude embeddings/whisper/dall-e/fine-tuned.
- **Gemini**: `GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY`. Filter to models with `generateContent` in `supportedGenerationMethods`. Strip `models/` prefix from name.

Returns `[]` on any error (fallback to hardcoded list).

### New file: `src/hooks/useProviderModels.ts`

Custom React hook `useProviderModels(provider, apiKey)` that:
- Returns `{ models: string[], loading: boolean }`
- Falls back to `PROVIDER_CONFIGS[provider].models` when no API key or fetch fails
- Debounces fetches by 500ms (avoids firing on every keystroke of API key)
- Caches results per provider+key with 5-minute TTL
- Merges fetched models with hardcoded fallbacks (fetched first, then any hardcoded not already present)

### Modified: `src/components/settings/SettingsModal.tsx`

- Import and call `useProviderModels(activeProvider, providerKeys[activeProvider])`
- Replace `providerConfig.models` with hook's `models` array in the model dropdown
- Update `modelInList` check to use dynamic list
- Show "(loading...)" next to Model label while fetching

---

## Implementation Order

1. Fix the three providers (bug fix - functional correctness)
2. Create `fetch-models.ts` utility
3. Create `useProviderModels.ts` hook
4. Update `SettingsModal.tsx` to use dynamic models

## Verification

- Run `npm run build` (or `npx tsc --noEmit`) to confirm no type errors
- Manual test: run an agent with Anthropic provider that makes 2+ consecutive tool calls - should no longer get the 400 error
- Manual test: enter a valid API key in settings, confirm model dropdown populates dynamically
- Manual test: enter an invalid key, confirm fallback to hardcoded list
