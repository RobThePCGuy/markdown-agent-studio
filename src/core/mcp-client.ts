import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

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
  client: Client | null;
  tools: MCPTool[];
  connected: boolean;
}

const CONNECT_TIMEOUT_MS = 30_000;

export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();

  static filterBrowserCompatible(configs: MCPServerConfig[]): {
    compatible: MCPServerConfig[];
    skipped: MCPServerConfig[];
  } {
    const compatible: MCPServerConfig[] = [];
    const skipped: MCPServerConfig[] = [];
    for (const cfg of configs) {
      if (cfg.transport === 'stdio') {
        skipped.push(cfg);
      } else {
        compatible.push(cfg);
      }
    }
    return { compatible, skipped };
  }

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
    // Skip if already connected
    const existing = this.servers.get(config.name);
    if (existing?.connected) return;

    if (config.transport === 'stdio') {
      // stdio requires Node.js native process spawning - not available in browser
      this.servers.set(config.name, {
        config,
        client: null,
        tools: [],
        connected: false,
      });
      console.warn(`MCP: stdio transport not available in browser for "${config.name}"`);
      return;
    }

    if (!config.url) {
      throw new Error(`MCP server "${config.name}" requires a url for ${config.transport} transport`);
    }

    const url = new URL(config.url);
    const transport = config.transport === 'sse'
      ? new SSEClientTransport(url)
      : new StreamableHTTPClientTransport(url);

    const client = new Client({
      name: 'markdown-agent-studio',
      version: '0.4.0',
    });

    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });

      // Discover tools on connect
      const toolsResult = await client.listTools();
      const tools: MCPTool[] = (toolsResult.tools ?? []).map((t) => ({
        serverName: config.name,
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      }));

      this.servers.set(config.name, {
        config,
        client,
        tools,
        connected: true,
      });
    } catch (err) {
      this.servers.set(config.name, {
        config,
        client: null,
        tools: [],
        connected: false,
      });
      throw err;
    }
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server?.client) {
      try {
        await server.client.close();
      } catch {
        // Best-effort close
      }
    }
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    for (const name of names) {
      await this.disconnect(name);
    }
  }

  async discoverTools(serverName: string): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    if (!server?.connected || !server.client) return [];

    const toolsResult = await server.client.listTools();
    const tools: MCPTool[] = (toolsResult.tools ?? []).map((t) => ({
      serverName,
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));

    server.tools = tools;
    return tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server?.connected || !server.client) {
      return `Error: MCP server "${serverName}" is not connected.`;
    }

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Extract text content from the result
      const content = result.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c): c is { type: 'text'; text: string } =>
            c.type === 'text' && typeof c.text === 'string'
          )
          .map((c) => c.text);
        if (textParts.length > 0) return textParts.join('\n');
      }

      // Fallback: stringify the result
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: MCP tool call failed: ${message}`;
    }
  }

  /**
   * Create an MCPClientManager with global servers pre-connected.
   * Skips stdio servers (browser-incompatible) and logs warnings/connections via eventLog.
   */
  static async createWithGlobalServers(
    globalServers: MCPServerConfig[],
    eventLog: { getState(): { append(entry: Record<string, unknown>): void } },
  ): Promise<MCPClientManager> {
    const manager = new MCPClientManager();
    if (globalServers.length === 0) return manager;

    const { compatible, skipped } = MCPClientManager.filterBrowserCompatible(globalServers);
    for (const server of skipped) {
      eventLog.getState().append({
        type: 'warning',
        agentId: 'system',
        activationId: 'system',
        data: {
          message: `Skipping MCP server "${server.name}" - stdio transport is not available in the browser.`,
        },
      });
    }
    for (const server of compatible) {
      try {
        await manager.connect(server);
        eventLog.getState().append({
          type: 'mcp_connect',
          agentId: 'system',
          activationId: 'system',
          data: { serverName: server.name, transport: server.transport },
        });
      } catch (err) {
        eventLog.getState().append({
          type: 'warning',
          agentId: 'system',
          activationId: 'system',
          data: {
            message: `Failed to connect MCP server "${server.name}": ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
    }
    return manager;
  }
}
