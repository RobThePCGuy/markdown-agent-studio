import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { ToolPluginRegistry, ToolContext } from './tool-plugin';

type Store<T> = { getState(): T };

export interface ToolHandlerConfig {
  pluginRegistry: ToolPluginRegistry;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  onSpawnActivation: (activation: Omit<Activation, 'id' | 'createdAt'>) => void;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
  apiKey?: string;
}

export class ToolHandler {
  private config: ToolHandlerConfig;
  private spawnCount = 0;

  constructor(config: ToolHandlerConfig) {
    this.config = config;
  }

  async handle(toolName: string, args: Record<string, unknown>): Promise<string> {
    const { eventLog } = this.config;

    eventLog.getState().append({
      type: 'tool_call',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, args },
    });

    const plugin = this.config.pluginRegistry.get(toolName);
    let result: string;

    if (plugin) {
      const ctx: ToolContext = {
        vfs: this.config.vfs,
        registry: this.config.agentRegistry,
        eventLog: this.config.eventLog,
        currentAgentId: this.config.currentAgentId,
        currentActivationId: this.config.currentActivationId,
        parentAgentId: this.config.parentAgentId,
        spawnDepth: this.config.spawnDepth,
        maxDepth: this.config.maxDepth,
        maxFanout: this.config.maxFanout,
        childCount: this.config.childCount,
        spawnCount: this.spawnCount,
        onSpawnActivation: this.config.onSpawnActivation,
        incrementSpawnCount: () => { this.spawnCount++; },
        apiKey: this.config.apiKey,
      };
      result = await plugin.handler(args, ctx);
    } else {
      const available = this.config.pluginRegistry.getAll().map((p) => p.name).join(', ');
      result = `Error: Unknown tool '${toolName}'. Available tools: ${available}`;
    }

    eventLog.getState().append({
      type: 'tool_result',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, result: result.slice(0, 500) },
    });

    return result;
  }
}
