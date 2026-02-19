import type { ToolDeclaration } from '../types/ai-provider';
import type { Activation } from '../types/kernel';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';

type Store<T> = { getState(): T };

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
}

export interface ToolContext {
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
  spawnCount: number;
  onSpawnActivation: (act: Omit<Activation, 'id' | 'createdAt'>) => void;
  incrementSpawnCount: () => void;
  apiKey?: string;
  preferredModel?: string;
}

export interface ToolPlugin {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export class ToolPluginRegistry {
  private plugins = new Map<string, ToolPlugin>();

  register(plugin: ToolPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  get(name: string): ToolPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): ToolPlugin[] {
    return [...this.plugins.values()];
  }

  toToolDefinitions(): ToolDeclaration[] {
    return this.getAll().map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(plugin.parameters).map(([key, param]) => [
            key,
            { type: param.type, description: param.description },
          ])
        ),
        required: Object.entries(plugin.parameters)
          .filter(([, param]) => param.required)
          .map(([key]) => key),
      },
    }));
  }

  cloneWith(extras: ToolPlugin[]): ToolPluginRegistry {
    const cloned = new ToolPluginRegistry();
    for (const plugin of this.plugins.values()) {
      cloned.register(plugin);
    }
    for (const plugin of extras) {
      cloned.register(plugin);
    }
    return cloned;
  }
}
