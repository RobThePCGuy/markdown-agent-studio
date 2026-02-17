import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentStreamResult, Tool } from '@google/generative-ai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

type GeminiPart = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } } | { functionResponse: { name: string; response: { result: string } } };
type GeminiMessage = { role: 'user' | 'model'; parts: GeminiPart[] };

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  private activeStreams = new Map<string, AbortController>();

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  /** Convert kernel history (user/model/tool messages) to Gemini format with functionCall/functionResponse pairs. */
  private convertHistory(history: Message[]): GeminiMessage[] {
    const result: GeminiMessage[] = [];
    let i = 0;

    while (i < history.length) {
      const msg = history[i];

      if (msg.role === 'user') {
        result.push({ role: 'user', parts: [{ text: msg.content }] });
        i++;
      } else if (msg.role === 'model') {
        const parts: GeminiPart[] = [];
        if (msg.content) parts.push({ text: msg.content });
        i++;

        // Check if followed by tool messages (function calls from this model turn)
        if (i < history.length && history[i].role === 'tool') {
          const toolMsgs: Message[] = [];
          while (i < history.length && history[i].role === 'tool') {
            toolMsgs.push(history[i]);
            i++;
          }
          for (const t of toolMsgs) {
            parts.push({ functionCall: { name: t.toolCall!.name, args: t.toolCall!.args } });
          }
          result.push({ role: 'model', parts });
          result.push({
            role: 'user',
            parts: toolMsgs.map(t => ({
              functionResponse: { name: t.toolCall!.name, response: { result: t.content } },
            })),
          });
        } else if (parts.length > 0) {
          result.push({ role: 'model', parts });
        }
      } else if (msg.role === 'tool') {
        // Tool messages without a preceding model message (model emitted only function calls, no text)
        const toolMsgs: Message[] = [];
        while (i < history.length && history[i].role === 'tool') {
          toolMsgs.push(history[i]);
          i++;
        }
        result.push({
          role: 'model',
          parts: toolMsgs.map(t => ({
            functionCall: { name: t.toolCall!.name, args: t.toolCall!.args },
          })),
        });
        result.push({
          role: 'user',
          parts: toolMsgs.map(t => ({
            functionResponse: { name: t.toolCall!.name, response: { result: t.content } },
          })),
        });
      }
    }

    return result;
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

      const geminiHistory = this.convertHistory(history);

      const lastMsg = geminiHistory.pop();
      if (!lastMsg) {
        yield { type: 'error', error: 'No input message' };
        return;
      }

      const chat = model.startChat({
        history: geminiHistory,
        tools: geminiTools,
      });

      const result: GenerateContentStreamResult = await chat.sendMessageStream(
        lastMsg.parts as any,
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
                id: `tc-${Date.now()}`,
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
  }
}
