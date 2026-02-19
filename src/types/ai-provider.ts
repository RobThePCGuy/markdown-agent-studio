import type { Message } from './kernel';

export interface AgentConfig {
  sessionId: string;
  systemPrompt: string;
  model?: string;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

export type StreamChunkType = 'text' | 'tool_call' | 'done' | 'error';

export interface StreamChunk {
  type: StreamChunkType;
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  error?: string;
  tokenCount?: number;
}

export interface AIProvider {
  chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk>;
  abort(sessionId: string): Promise<void>;
  endSession?(sessionId: string): void;
}
