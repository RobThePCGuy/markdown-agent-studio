export type SessionStatus = 'running' | 'paused' | 'completed' | 'aborted' | 'error';

export interface Activation {
  id: string;
  agentId: string;
  input: string;
  parentId?: string;
  spawnDepth: number;
  priority: number;
  createdAt: number;
}

export interface Message {
  role: 'user' | 'model' | 'tool';
  content: string;
  toolCall?: ToolCallRecord;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

export interface AgentSession {
  agentId: string;
  activationId: string;
  controller: AbortController;
  status: SessionStatus;
  history: Message[];
  toolCalls: ToolCallRecord[];
  tokenCount: number;
}

export interface KernelConfig {
  maxConcurrency: number;
  maxDepth: number;
  maxFanout: number;
  tokenBudget: number;
  model?: string;
  memoryEnabled?: boolean;
  memoryTokenBudget?: number;
}

export const DEFAULT_KERNEL_CONFIG: KernelConfig = {
  maxConcurrency: 3,
  maxDepth: 5,
  maxFanout: 5,
  tokenBudget: 250000,
  memoryEnabled: true,
  memoryTokenBudget: 2000,
};
