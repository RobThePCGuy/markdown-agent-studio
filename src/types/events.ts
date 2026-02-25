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
  | 'complete'
  | 'mcp_connect'
  | 'mcp_disconnect'
  | 'mcp_tool_call'
  | 'channel_publish'
  | 'channel_subscribe'
  | 'blackboard_write'
  | 'blackboard_read'
  | 'delegate'
  | 'workflow_start'
  | 'workflow_step'
  | 'workflow_complete';

export interface EventLogEntry {
  id: string;
  timestamp: number;
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}

export interface ReplayCheckpoint {
  id: string;
  eventId: string;
  timestamp: number;
  eventType: EventType;
  agentId: string;
  activationId: string;
  files: Record<string, string>;
}
