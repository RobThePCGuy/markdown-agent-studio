import type { SessionStatus, ToolCallRecord } from './kernel';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: ToolCallRecord;
}

export interface LiveSession {
  agentId: string;
  activationId: string;
  status: SessionStatus;
  messages: ChatMessage[];
  streamingText: string;
  toolCalls: ToolCallRecord[];
  tokenCount: number;
  startedAt: number;
  completedAt?: number;
}
