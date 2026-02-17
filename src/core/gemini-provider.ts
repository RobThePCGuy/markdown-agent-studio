import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentStreamResult, Tool, ChatSession } from '@google/generative-ai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  private activeStreams = new Map<string, AbortController>();
  private activeChats = new Map<string, ChatSession>();

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async *chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    const controller = new AbortController();
    this.activeStreams.set(config.sessionId, controller);

    try {
      const model = this.client.getGenerativeModel({
        model: config.model ?? 'gemini-3-flash-preview',
        systemInstruction: config.systemPrompt,
      });

      const geminiTools: Tool[] | undefined = tools.length > 0 ? [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as any,
        })),
      }] : undefined;

      // Reuse existing ChatSession if available (follow-up turn after tool calls).
      // The ChatSession internally tracks all history including thought signatures,
      // so we never have to reconstruct function call parts manually.
      let chat = this.activeChats.get(config.sessionId);
      let messageParts: any[];

      if (chat) {
        // Follow-up call: send function responses from the trailing tool messages
        const toolMsgs: Message[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'tool') toolMsgs.unshift(history[i]);
          else break;
        }
        messageParts = toolMsgs.map(t => ({
          functionResponse: { name: t.toolCall!.name, response: { result: t.content } },
        }));
      } else {
        // First call: create new ChatSession with initial history
        const geminiHistory = history
          .filter((m) => m.role !== 'tool')
          .map((m) => ({
            role: m.role === 'model' ? 'model' as const : 'user' as const,
            parts: [{ text: m.content }],
          }));

        const lastMsg = geminiHistory.pop();
        if (!lastMsg) {
          yield { type: 'error', error: 'No input message' };
          return;
        }

        chat = model.startChat({
          history: geminiHistory,
          tools: geminiTools,
        });
        messageParts = lastMsg.parts;
      }

      // Store the ChatSession for potential follow-up turns
      this.activeChats.set(config.sessionId, chat);

      const result: GenerateContentStreamResult = await chat.sendMessageStream(
        messageParts,
        { signal: controller.signal }
      );

      let totalTokens = 0;

      for await (const chunk of result.stream) {
        if (controller.signal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              },
            };
          }
        }

        if (chunk.usageMetadata) {
          totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens;
        }
      }

      yield { type: 'done', tokenCount: totalTokens };
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
    this.activeChats.delete(sessionId);
  }

  /** Clean up a completed session's ChatSession reference. */
  endSession(sessionId: string): void {
    this.activeChats.delete(sessionId);
  }
}
