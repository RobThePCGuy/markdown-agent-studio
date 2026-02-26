import { describe, it, expect, vi } from 'vitest';
import { createMCPBridgePlugins } from './mcp-bridge-plugin';
import type { MCPTool } from '../mcp-client';
import type { ToolContext } from '../tool-plugin';

describe('createMCPBridgePlugins', () => {
  it('creates a ToolPlugin for each MCP tool', () => {
    const tools: MCPTool[] = [
      { serverName: 'vault', name: 'query_documents', description: 'Search docs', inputSchema: { query: { type: 'string' } } },
      { serverName: 'vault', name: 'ingest_file', description: 'Add file', inputSchema: { path: { type: 'string' } } },
    ];
    const callTool = vi.fn();
    const plugins = createMCPBridgePlugins(tools, callTool);

    expect(plugins).toHaveLength(2);
    expect(plugins[0].name).toBe('mcp:vault:query_documents');
    expect(plugins[1].name).toBe('mcp:vault:ingest_file');
  });

  it('plugin handler calls through to MCP callTool', async () => {
    const tools: MCPTool[] = [
      { serverName: 'vault', name: 'query', description: 'Search', inputSchema: {} },
    ];
    const callTool = vi.fn().mockResolvedValue('result from mcp');
    const plugins = createMCPBridgePlugins(tools, callTool);

    const ctx = {} as unknown as ToolContext;
    const result = await plugins[0].handler({ q: 'test' }, ctx);

    expect(callTool).toHaveBeenCalledWith('vault', 'query', { q: 'test' });
    expect(result).toBe('result from mcp');
  });
});
