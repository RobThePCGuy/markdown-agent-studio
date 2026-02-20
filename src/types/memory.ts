export type MemoryType = 'fact' | 'procedure' | 'observation' | 'mistake' | 'preference';

export interface WorkingMemoryEntry {
  id: string;
  key: string;
  value: string;
  tags: string[];
  authorAgentId: string;
  timestamp: number;
  runId: string;
}

export interface LongTermMemory {
  id: string;
  agentId: string;
  type: MemoryType;
  content: string;
  tags: string[];
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  runId: string;
}
