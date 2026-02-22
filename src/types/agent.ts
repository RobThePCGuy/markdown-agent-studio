export interface CustomToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  prompt: string;
  model?: string;
  resultSchema?: Record<string, unknown>;
}

export type AgentExecutionMode = 'safe' | 'balanced' | 'gloves_off';

export interface AgentPermissions {
  spawnAgents: boolean;
  editAgents: boolean;
  deleteFiles: boolean;
  webAccess: boolean;
  signalParent: boolean;
  customTools: boolean;
}

export interface AgentPolicy {
  mode: AgentExecutionMode;
  reads: string[];
  writes: string[];
  allowedTools: string[];
  blockedTools: string[];
  glovesOffTriggers: string[];
  permissions: AgentPermissions;
}

export interface AutonomousConfig {
  maxCycles: number;
}

export interface AgentProfile {
  id: string;
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
  policy: AgentPolicy;
  customTools?: CustomToolDef[];
  autonomousConfig?: AutonomousConfig;
}
