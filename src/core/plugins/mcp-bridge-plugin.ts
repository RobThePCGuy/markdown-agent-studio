import type { ToolPlugin, ToolParameter } from '../tool-plugin';
import type { MCPTool } from '../mcp-client';

type CallToolFn = (server: string, tool: string, args: Record<string, unknown>) => Promise<string>;

export function createMCPBridgePlugins(
  tools: MCPTool[],
  callTool: CallToolFn
): ToolPlugin[] {
  return tools.map((tool) => ({
    name: `mcp:${tool.serverName}:${tool.name}`,
    description: `[MCP: ${tool.serverName}] ${tool.description}`,
    parameters: schemaToParams(tool.inputSchema),
    async handler(args) {
      return callTool(tool.serverName, tool.name, args);
    },
  }));
}

function schemaToParams(schema: Record<string, unknown>): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};
  if (!schema || typeof schema !== 'object') return params;

  const properties = (schema as any).properties ?? schema;
  const required = new Set((schema as any).required ?? []);

  for (const [key, val] of Object.entries(properties)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    params[key] = {
      type: mapType(String(v.type || 'string')),
      description: String(v.description || key),
      required: required.has(key),
    };
  }
  return params;
}

function mapType(t: string): 'string' | 'number' | 'boolean' | 'object' {
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object' || t === 'array') return 'object';
  return 'string';
}
