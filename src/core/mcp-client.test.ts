import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock function refs - must use vi.hoisted() so they are available to hoisted vi.mock()
const { mockConnect, mockClose, mockListTools, mockCallTool } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockListTools: vi.fn(),
  mockCallTool: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class MockClient {
    connect = mockConnect;
    close = mockClose;
    listTools = mockListTools;
    callTool = mockCallTool;
  }
  return { Client: MockClient };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class MockHTTPTransport {
    url: URL;
    constructor(url: URL) { this.url = url; }
  }
  return { StreamableHTTPClientTransport: MockHTTPTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
  class MockSSETransport {
    url: URL;
    constructor(url: URL) { this.url = url; }
  }
  return { SSEClientTransport: MockSSETransport };
});

import { MCPClientManager } from './mcp-client';

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    manager = new MCPClientManager();
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
      ],
    });
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  it('can be instantiated', () => {
    expect(manager).toBeDefined();
  });

  it('getConnectedServers returns empty initially', () => {
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('getTools returns empty when no servers connected', () => {
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
    const result = await manager.callTool('unknown', 'tool', {});
    expect(result).toContain('not connected');
  });

  it('connect() with http transport creates client and discovers tools', async () => {
    await manager.connect({
      name: 'test-http',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockListTools).toHaveBeenCalledTimes(1);
    expect(manager.getConnectedServers()).toEqual(['test-http']);
    expect(manager.getTools()).toHaveLength(2);
    expect(manager.getTools()[0].name).toBe('read_file');
  });

  it('connect() with sse transport creates SSEClientTransport', async () => {
    await manager.connect({
      name: 'test-sse',
      transport: 'sse',
      url: 'http://localhost:3000/sse',
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(manager.getConnectedServers()).toEqual(['test-sse']);
  });

  it('connect() with stdio transport sets connected=false', async () => {
    await manager.connect({
      name: 'test-stdio',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    expect(mockConnect).not.toHaveBeenCalled();
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('connect() timeout produces error', async () => {
    mockConnect.mockRejectedValue(new Error('Connection timed out'));

    await expect(manager.connect({
      name: 'timeout-server',
      transport: 'http',
      url: 'http://localhost:9999/mcp',
    })).rejects.toThrow('Connection timed out');

    // Server should be stored but not connected
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('callTool() returns formatted text content', async () => {
    await manager.connect({
      name: 'tool-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    mockCallTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ],
    });

    const result = await manager.callTool('tool-server', 'read_file', { path: '/test' });
    expect(result).toBe('line 1\nline 2');
  });

  it('callTool() on disconnected server returns error', async () => {
    await manager.connect({
      name: 'stdio-server',
      transport: 'stdio',
      command: 'node',
    });

    const result = await manager.callTool('stdio-server', 'some_tool', {});
    expect(result).toContain('not connected');
  });

  it('discoverTools() maps listTools response to MCPTool[]', async () => {
    await manager.connect({
      name: 'discover-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    // Now discover with new tools
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'new_tool', description: 'A new tool', inputSchema: { type: 'object' } },
      ],
    });

    const tools = await manager.discoverTools('discover-server');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('new_tool');
    expect(tools[0].serverName).toBe('discover-server');
  });

  it('disconnect() calls client.close()', async () => {
    await manager.connect({
      name: 'close-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    await manager.disconnect('close-server');
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(manager.getConnectedServers()).toEqual([]);
  });

  it('skips if already connected', async () => {
    await manager.connect({
      name: 'dup-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    await manager.connect({
      name: 'dup-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    });

    // connect should only be called once
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
