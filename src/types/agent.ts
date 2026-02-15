export interface AgentProfile {
  id: string;
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
}
