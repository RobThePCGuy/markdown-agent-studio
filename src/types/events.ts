export type EventType =
  | 'activation'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'spawn'
  | 'signal'
  | 'warning'
  | 'error'
  | 'abort'
  | 'complete';

export interface EventLogEntry {
  id: string;
  timestamp: number;
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}
