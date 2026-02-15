import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentStreamResult } from '@google/generative-ai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  private activeStreams = new Map<string, AbortController>();

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
        model: config.model ?? 'gemini-1.5-pro',
        systemInstruction: config.systemPrompt,
      });

      const geminiTools = tools.length > 0 ? [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }] : undefined;

      const geminiHistory = history
        .filter((m) => m.role !== 'tool')
        .map((m) => ({
          role: m.role === 'model' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        }));

      const lastUserMsg = geminiHistory.pop();
      if (!lastUserMsg) {
        yield { type: 'error', error: 'No input message' };
        return;
      }

      const chat = model.startChat({
        history: geminiHistory,
        tools: geminiTools,
      });

      const result: GenerateContentStreamResult = await chat.sendMessageStream(
        lastUserMsg.parts,
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
