import OpenAI from 'openai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

type ChatMessage = OpenAI.ChatCompletionMessageParam;

/**
 * OpenAI provider using the Chat Completions API with streaming.
 * Manages conversation history per session and supports tool calls.
 */
export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private activeStreams = new Map<string, AbortController>();
  private sessionMessages = new Map<string, ChatMessage[]>();

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  async *chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    const controller = new AbortController();
    this.activeStreams.set(config.sessionId, controller);

    try {
      let messages: ChatMessage[];

      if (this.sessionMessages.has(config.sessionId)) {
        // Follow-up turn: append tool results from kernel history
        messages = [...this.sessionMessages.get(config.sessionId)!];

        // Find the last assistant message to get tool_call IDs
        const lastAssistant = messages[messages.length - 1];
        const toolCallIds = new Set<string>();
        if (lastAssistant?.role === 'assistant' && 'tool_calls' in lastAssistant && lastAssistant.tool_calls) {
          for (const tc of lastAssistant.tool_calls) {
            toolCallIds.add(tc.id);
          }
        }

        // Collect trailing tool messages and match by ID
        const toolMsgs: Message[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'tool') toolMsgs.unshift(history[i]);
          else break;
        }

        for (const t of toolMsgs) {
          if (t.toolCall && toolCallIds.has(t.toolCall.id)) {
            messages.push({
              role: 'tool',
              tool_call_id: t.toolCall.id,
              content: t.content,
            });
          }
        }
      } else {
        // First call: build messages from kernel history
        messages = [
          { role: 'system', content: config.systemPrompt },
        ];
        for (const m of history) {
          if (m.role === 'tool') continue;
          messages.push({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content,
          });
        }
      }

      const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools.length > 0
        ? tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: {
                type: 'object' as const,
                properties: t.parameters.properties,
                required: t.parameters.required,
              },
            },
          }))
        : undefined;

      const stream = await this.client.chat.completions.create({
        model: config.model ?? 'gpt-4o',
        messages,
        tools: openaiTools,
        stream: true,
      }, { signal: controller.signal });

      // Accumulate tool calls from streaming deltas
      const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();
      let completionTokens = 0;

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          yield { type: 'text', text: delta.content };
        }

        // Tool call deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
            }
            const accum = toolCallAccum.get(idx)!;
            if (tc.id) accum.id = tc.id;
            if (tc.function?.name) accum.name = tc.function.name;
            if (tc.function?.arguments) accum.args += tc.function.arguments;
          }
        }

        // Token usage (available in the final chunk)
        if (chunk.usage) {
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
      }

      // Emit accumulated tool calls
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
      for (const [, accum] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(accum.args || '{}');
        } catch (e) {
          console.warn(`OpenAI: failed to parse tool args for "${accum.name}":`, e);
        }

        toolCalls.push({
          id: accum.id,
          type: 'function',
          function: { name: accum.name, arguments: accum.args || '{}' },
        });

        yield {
          type: 'tool_call',
          toolCall: { id: accum.id, name: accum.name, args },
        };
      }

      // Store the assistant's response for follow-up turns
      const assistantMsg: ChatMessage = toolCalls.length > 0
        ? { role: 'assistant', tool_calls: toolCalls, content: null }
        : { role: 'assistant', content: '' };
      messages.push(assistantMsg);
      this.sessionMessages.set(config.sessionId, messages);

      yield { type: 'done', tokenCount: completionTokens };
    } catch (err) {
      if (controller.signal.aborted) {
        yield { type: 'error', error: 'Aborted' };
      } else {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      this.activeStreams.delete(config.sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(sessionId);
    }
    this.sessionMessages.delete(sessionId);
  }

  endSession(sessionId: string): void {
    this.sessionMessages.delete(sessionId);
  }
}
