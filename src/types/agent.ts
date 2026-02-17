export interface CustomToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  prompt: string;
  model?: string;
  resultSchema?: Record<string, unknown>;
}

export interface AgentProfile {
  id: string;
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
  customTools?: CustomToolDef[];
}
