export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  config: MCPServerConfig;
  tools: MCPTool[];
  connected: boolean;
}

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();

  static parseServerConfigs(raw: unknown[]): MCPServerConfig[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is MCPServerConfig => {
      if (!item || typeof item !== 'object') return false;
      const obj = item as Record<string, unknown>;
      return typeof obj.name === 'string' && obj.name.length > 0 &&
        typeof obj.transport === 'string';
    });
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([, s]) => s.connected)
      .map(([name]) => name);
  }

  getTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const server of this.servers.values()) {
      if (server.connected) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }

  async connect(config: MCPServerConfig): Promise<void> {
    this.servers.set(config.name, {
      config,
      tools: [],
      connected: true,
    });
  }

  async disconnect(name: string): Promise<void> {
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    this.servers.clear();
  }

  async discoverTools(serverName: string): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) return [];
    return server.tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server || !server.connected) {
      return `Error: MCP server "${serverName}" is not connected.`;
    }
    return `Error: Tool execution not yet implemented for ${serverName}:${toolName}`;
  }
}
