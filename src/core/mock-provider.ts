import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class MockAIProvider implements AIProvider {
  private responseQueue: StreamChunk[][];
  private callIndex = 0;
  private aborted = new Set<string>();
  readonly seenConfigs: AgentConfig[] = [];

  constructor(responses: StreamChunk[]) {
    this.responseQueue = [responses];
  }

  async *chat(
    config: AgentConfig,
    _history: Message[],
    _tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    this.seenConfigs.push(config);
    const responses = this.callIndex < this.responseQueue.length
      ? this.responseQueue[this.callIndex]
      : [{ type: 'done' as const, tokenCount: 0 }];
    this.callIndex++;

    for (const chunk of responses) {
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
    this.responseQueue = [responses];
    this.callIndex = 0;
  }

  setResponseQueue(queue: StreamChunk[][]): void {
    this.responseQueue = queue;
    this.callIndex = 0;
  }
}
