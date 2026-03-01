import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

/**
 * Anthropic provider using the Messages API with streaming.
 * Manages conversation history per session and supports tool use.
 */
export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private activeStreams = new Map<string, AbortController>();
  private sessionMessages = new Map<string, Anthropic.MessageParam[]>();

  constructor(apiKey: string) {
    this.client = new Anthropic({
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
      let messages: Anthropic.MessageParam[];

      if (this.sessionMessages.has(config.sessionId)) {
        // Follow-up turn: append tool results from kernel history
        messages = [...this.sessionMessages.get(config.sessionId)!];

        // Find the last assistant message to get tool_use IDs
        const lastAssistant = messages[messages.length - 1];
        const toolUseIds = new Set<string>();
        if (lastAssistant?.role === 'assistant') {
          const content = lastAssistant.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === 'object' && 'type' in block && block.type === 'tool_use') {
                toolUseIds.add(block.id);
              }
            }
          }
        }

        // Collect trailing tool messages and match by ID
        const toolMsgs: Message[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'tool') toolMsgs.unshift(history[i]);
          else break;
        }

        if (toolMsgs.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = toolMsgs
            .filter(t => t.toolCall && toolUseIds.has(t.toolCall.id))
            .map(t => ({
              type: 'tool_result' as const,
              tool_use_id: t.toolCall!.id,
              content: t.content,
            }));
          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
          }
        }
      } else {
        // First call: build messages from kernel history
        messages = [];
        for (const m of history) {
          if (m.role === 'tool') continue;
          messages.push({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content,
          });
        }
        // Ensure messages alternate and start with user
        if (messages.length === 0 || messages[0].role !== 'user') {
          messages.unshift({ role: 'user', content: 'Begin.' });
        }
      }

      const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object' as const,
          properties: t.parameters.properties as Record<string, unknown>,
          required: t.parameters.required,
        },
      }));

      const stream = await this.client.messages.create({
        model: config.model ?? 'claude-sonnet-4-5-20250929',
        max_tokens: config.maxTokens ?? 8192,
        system: config.systemPrompt,
        messages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        stream: true,
      }, { signal: controller.signal });

      const assistantContent: Anthropic.ContentBlockParam[] = [];
      let currentToolUse: { id: string; name: string; jsonAccum: string } | null = null;
      let outputTokens = 0;

      for await (const event of stream) {
        if (controller.signal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              currentToolUse = { id: block.id, name: block.name, jsonAccum: '' };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text', text: delta.text };
            } else if (delta.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.jsonAccum += delta.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            if (currentToolUse) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(currentToolUse.jsonAccum || '{}');
              } catch (e) {
                console.warn(`Anthropic: failed to parse tool args for "${currentToolUse.name}":`, e);
              }

              assistantContent.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: args,
              });

              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  args,
                },
              };
              currentToolUse = null;
            }
            break;
          }
          case 'message_delta': {
            if (event.usage) {
              outputTokens = event.usage.output_tokens;
            }
            break;
          }
        }
      }

      // Store the assistant's response for follow-up turns
      if (assistantContent.length > 0) {
        messages.push({ role: 'assistant', content: assistantContent });
      }
      this.sessionMessages.set(config.sessionId, messages);

      yield { type: 'done', tokenCount: outputTokens };
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
