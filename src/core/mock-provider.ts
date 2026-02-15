import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class MockAIProvider implements AIProvider {
  private responses: StreamChunk[];
  private aborted = new Set<string>();

  constructor(responses: StreamChunk[]) {
    this.responses = responses;
  }

  async *chat(
    config: AgentConfig,
    _history: Message[],
    _tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    for (const chunk of this.responses) {
      if (this.aborted.has(config.sessionId)) {
        yield { type: 'error', error: 'Aborted' };
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
      yield chunk;
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.aborted.add(sessionId);
  }

  setResponses(responses: StreamChunk[]): void {
    this.responses = responses;
  }
}
