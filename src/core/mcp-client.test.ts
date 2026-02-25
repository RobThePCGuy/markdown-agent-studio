import { describe, it, expect, vi } from 'vitest';
import { MCPClientManager, type MCPServerConfig } from './mcp-client';

describe('MCPClientManager', () => {
  it('can be instantiated', () => {
    const manager = new MCPClientManager();
    expect(manager).toBeDefined();
  });

  it('getConnectedServers returns empty initially', () => {
    const manager = new MCPClientManager();
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('getTools returns empty when no servers connected', () => {
    const manager = new MCPClientManager();
    expect(manager.getTools()).toEqual([]);
  });

  it('parseServerConfigs extracts valid configs from frontmatter', () => {
    const configs = MCPClientManager.parseServerConfigs([
      { name: 'test', transport: 'http', url: 'http://localhost:3000' },
    ]);
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test');
    expect(configs[0].transport).toBe('http');
  });

  it('parseServerConfigs rejects configs missing name', () => {
    const configs = MCPClientManager.parseServerConfigs([
      { transport: 'http', url: 'http://localhost:3000' },
    ]);
    expect(configs).toHaveLength(0);
  });

  it('callTool returns error for unknown server', async () => {
    const manager = new MCPClientManager();
    const result = await manager.callTool('unknown', 'tool', {});
    expect(result).toContain('not connected');
  });
});
