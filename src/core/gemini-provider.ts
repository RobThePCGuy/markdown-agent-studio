import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, FunctionCall, FunctionDeclarationSchema, GenerateContentRequest, GenerateContentStreamResult, Part, Tool } from '@google/generative-ai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

/**
 * Raw part from Gemini stream response. May include opaque fields
 * (thought, thoughtSignature) that the SDK type system does not expose.
 */
type RawPart = Part & Record<string, unknown>;

/**
 * Gemini provider that manages conversation history manually using raw Content
 * objects and model.generateContentStream() instead of ChatSession.
 *
 * This avoids ChatSession's async history-update timing issues and preserves
 * thought signatures (opaque fields Gemini 3 returns on model Content) by
 * storing the model's raw response Content and replaying it verbatim.
 */
export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  private activeStreams = new Map<string, AbortController>();
  /** Raw Gemini Content[] per session - preserves thought signatures exactly. */
  private sessionContents = new Map<string, Content[]>();

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
        model: config.model ?? 'gemini-2.5-flash',
        systemInstruction: config.systemPrompt,
      });

      const geminiTools: Tool[] | undefined = tools.length > 0 ? [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as FunctionDeclarationSchema,
        })),
      }] : undefined;

      let contents: Content[];

      if (this.sessionContents.has(config.sessionId)) {
        // Follow-up turn: retrieve stored contents (includes model's raw
        // response with thought signatures) and append function responses.
        contents = [...this.sessionContents.get(config.sessionId)!];

        // Determine which function names the model called in its last Content
        const lastContent = contents[contents.length - 1];
        const calledNames = new Set<string>();
        if (lastContent?.role === 'model') {
          for (const part of lastContent.parts ?? []) {
            if (part.functionCall) {
              calledNames.add(part.functionCall.name);
            }
          }
        }

        // Extract trailing tool messages from kernel history
        const toolMsgs: Message[] = [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'tool') toolMsgs.unshift(history[i]);
          else break;
        }

        // Only include tool results whose names match the model's function calls
        const matchedToolMsgs = toolMsgs.filter(t => t.toolCall && calledNames.has(t.toolCall.name));

        // Append as a single "function" role Content (matches SDK convention)
        if (matchedToolMsgs.length > 0) {
          contents.push({
            role: 'function',
            parts: matchedToolMsgs.map(t => ({
              functionResponse: {
                name: t.toolCall!.name, // safe: filtered by toolCall above
                response: { result: t.content },
              },
            })),
          });
        }
      } else {
        // First call: build contents from kernel history
        contents = history
          .filter((m) => m.role !== 'tool')
          .map((m) => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
      }

      const result: GenerateContentStreamResult = await model.generateContentStream(
        { contents, tools: geminiTools } as GenerateContentRequest,
        { signal: controller.signal },
      );

      let totalTokens = 0;
      // Collect raw parts from stream chunks (not from aggregated response,
      // which strips thought/thoughtSignature fields via aggregateResponses).
      const rawModelParts: RawPart[] = [];
      let modelRole = 'model';

      for await (const chunk of result.stream) {
        if (controller.signal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        if (candidate.content?.role) {
          modelRole = candidate.content.role;
        }

        for (const part of candidate.content?.parts ?? []) {
          // Store the raw part reference - preserves thought, thoughtSignature,
          // and any other opaque fields from the JSON-parsed SSE data.
          // Cast needed: SDK Part union types lack index signatures but the
          // JSON-parsed SSE data may carry additional opaque fields.
          rawModelParts.push(part as RawPart);

          if (part.text) {
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: (part.functionCall as FunctionCall & { id?: string }).id ?? `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              },
            };
          }
        }

        if (chunk.usageMetadata) {
          // Track output tokens only - totalTokenCount includes input which
          // grows with history and causes quadratic budget consumption in
          // agentic loops. candidatesTokenCount is the actual new work.
          totalTokens = chunk.usageMetadata.candidatesTokenCount ?? totalTokens;
        }
      }

      // Build model Content from raw stream parts (preserves thought signatures).
      // Do NOT use result.response - the SDK's aggregateResponses strips unknown fields.
      if (rawModelParts.length > 0) {
        const modelContent = { role: modelRole, parts: rawModelParts };
        this.sessionContents.set(config.sessionId, [...contents, modelContent]);
      } else {
        this.sessionContents.set(config.sessionId, contents);
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
    this.sessionContents.delete(sessionId);
  }

  /** Clean up a completed session's Content history. */
  endSession(sessionId: string): void {
    this.sessionContents.delete(sessionId);
  }
}
