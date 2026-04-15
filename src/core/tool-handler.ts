import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { ToolPluginRegistry, ToolContext } from './tool-plugin';
import type { AgentPolicy } from '../types/agent';
import type { MemoryStoreState } from '../stores/memory-store';
import type { TaskQueueState } from '../stores/task-queue-store';
import type { PubSubState } from '../stores/pub-sub-store';
import type { BlackboardState } from '../stores/blackboard-store';
import { type ToolResult, successResult, errorResult } from './tool-result';

type Store<T> = { getState(): T };

const BUILT_IN_TOOLS = new Set([
  'vfs_read',
  'vfs_write',
  'vfs_list',
  'vfs_delete',
  'spawn_agent',
  'signal_parent',
  'delegate',
  'web_fetch',
  'web_search',
  'memory_read',
  'memory_write',
  'task_queue_read',
  'task_queue_write',
  'knowledge_query',
  'knowledge_contribute',
  'publish',
  'subscribe',
  'blackboard_write',
  'blackboard_read',
]);

export interface ToolHandlerConfig {
  pluginRegistry: ToolPluginRegistry;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  onSpawnActivation: (activation: Omit<Activation, 'id' | 'createdAt'>) => void;
  onRunSessionAndReturn?: (activation: Omit<Activation, 'id' | 'createdAt'>) => Promise<string>;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
  policy?: AgentPolicy;
  apiKey?: string;
  providerApiKeys?: Record<string, string>;
  preferredModel?: string;
  memoryStore?: Store<MemoryStoreState>;
  taskQueueStore?: Store<TaskQueueState>;
  pubSubStore?: Store<PubSubState>;
  blackboardStore?: Store<BlackboardState>;
  vectorStore?: ToolContext['vectorStore'];
}

export class ToolHandler {
  private config: ToolHandlerConfig;
  private _spawnCount = 0;

  constructor(config: ToolHandlerConfig) {
    this.config = config;
  }

  /** Number of agents spawned by this handler in the current session. */
  get spawnCount(): number {
    return this._spawnCount;
  }

  async handle(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const { eventLog } = this.config;

    eventLog.getState().append({
      type: 'tool_call',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, args },
    });

    const policyErr = this.policyError(toolName, args);
    if (policyErr) {
      eventLog.getState().append({
        type: 'warning',
        agentId: this.config.currentAgentId,
        activationId: this.config.currentActivationId,
        data: { message: policyErr, tool: toolName },
      });
      eventLog.getState().append({
        type: 'tool_result',
        agentId: this.config.currentAgentId,
        activationId: this.config.currentActivationId,
        data: { tool: toolName, result: policyErr.slice(0, 500) },
      });
      return errorResult(policyErr, 'policy');
    }

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
        spawnCount: this._spawnCount,
        onSpawnActivation: this.config.onSpawnActivation,
        onRunSessionAndReturn: this.config.onRunSessionAndReturn,
        incrementSpawnCount: () => { this._spawnCount++; },
        apiKey: this.config.apiKey,
        providerApiKeys: this.config.providerApiKeys,
        preferredModel: this.config.preferredModel,
        memoryStore: this.config.memoryStore,
        taskQueueStore: this.config.taskQueueStore,
        pubSubStore: this.config.pubSubStore,
        blackboardStore: this.config.blackboardStore,
        vectorStore: this.config.vectorStore,
      };
      try {
        result = await plugin.handler(args, ctx);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result = `Error: ${msg}`;
        const truncated = result.length > 500;
        eventLog.getState().append({
          type: 'tool_result',
          agentId: this.config.currentAgentId,
          activationId: this.config.currentActivationId,
          data: { tool: toolName, result: result.slice(0, 500), truncated },
        });
        return errorResult(result, 'transient');
      }
    } else {
      const available = this.config.pluginRegistry.getAll().map((p) => p.name).join(', ');
      result = `Error: Unknown tool '${toolName}'. Available tools: ${available}`;
      const truncated = result.length > 500;
      eventLog.getState().append({
        type: 'tool_result',
        agentId: this.config.currentAgentId,
        activationId: this.config.currentActivationId,
        data: { tool: toolName, result: result.slice(0, 500), truncated },
      });
      return errorResult(result, 'permanent');
    }

    const truncated = result.length > 500;
    eventLog.getState().append({
      type: 'tool_result',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, result: result.slice(0, 500), truncated },
    });

    // Classify the string result from the plugin
    if (!result || result.trim() === '') {
      return errorResult(result, 'permanent');
    }
    if (result.length <= 500) {
      const trimmed = result.trimStart();
      if (trimmed.startsWith('Policy blocked')) {
        return errorResult(result, 'policy');
      }
      if (trimmed.startsWith('Error:') || trimmed.startsWith('error:')) {
        return errorResult(result, 'permanent');
      }
    }
    return successResult(result);
  }

  private policyError(toolName: string, args: Record<string, unknown>): string | null {
    const policy = this.config.policy;
    if (!policy || policy.mode === 'gloves_off') {
      return null;
    }

    const blockedTools = new Set(policy.blockedTools.map((t) => t.toLowerCase()));
    const allowedTools = new Set(policy.allowedTools.map((t) => t.toLowerCase()));
    const normalizedTool = toolName.toLowerCase();

    if (blockedTools.has(normalizedTool)) {
      return `Policy blocked tool '${toolName}' via frontmatter 'blocked_tools'.`;
    }

    if (allowedTools.size > 0 && !allowedTools.has(normalizedTool)) {
      return `Policy blocked tool '${toolName}'. It is not included in frontmatter 'allowed_tools'.`;
    }

    if (!BUILT_IN_TOOLS.has(toolName) && !policy.permissions.customTools) {
      return `Policy blocked custom tool '${toolName}'. Enable 'permissions.custom_tools' or switch mode to 'gloves_off'.`;
    }

    switch (toolName) {
      case 'spawn_agent':
        if (!policy.permissions.spawnAgents) {
          return "Policy blocked 'spawn_agent'. Enable 'permissions.spawn_agents' or set mode to 'gloves_off'.";
        }
        return null;

      case 'signal_parent':
        if (!policy.permissions.signalParent) {
          return "Policy blocked 'signal_parent'. Enable 'permissions.signal_parent'.";
        }
        return null;

      case 'web_fetch':
      case 'web_search':
        if (!policy.permissions.webAccess) {
          return `Policy blocked '${toolName}'. Enable 'permissions.web_access' or set mode to 'gloves_off'.`;
        }
        return null;

      case 'vfs_read': {
        const path = typeof args.path === 'string' ? args.path : '';
        if (!path.trim()) {
          return "Policy blocked 'vfs_read'. Provide a non-empty string 'path' that is allowed by frontmatter 'reads'.";
        }
        if (!this.matchesAnyPattern(path, policy.reads)) {
          return `Policy blocked read '${path}'. Add it to frontmatter 'reads'.`;
        }
        return null;
      }

      case 'vfs_list': {
        const prefix = typeof args.prefix === 'string' ? args.prefix : '';
        if (!prefix.trim()) {
          return "Policy blocked 'vfs_list'. Provide a non-empty string 'prefix' that is allowed by frontmatter 'reads'.";
        }
        if (!this.prefixAllowed(prefix, policy.reads)) {
          return `Policy blocked list prefix '${prefix}'. Add an allowed read scope in frontmatter 'reads'.`;
        }
        return null;
      }

      case 'vfs_write': {
        const path = typeof args.path === 'string' ? args.path : '';
        if (!path) return "Policy blocked 'vfs_write'. Provide a non-empty 'path'.";
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath.startsWith('agents/') && !policy.permissions.editAgents) {
          return `Policy blocked write '${path}'. Enable 'permissions.edit_agents' to modify agent files.`;
        }
        if (!this.matchesAnyPattern(path, policy.writes)) {
          return `Policy blocked write '${path}'. Add it to frontmatter 'writes'.`;
        }
        return null;
      }

      case 'vfs_delete': {
        const path = typeof args.path === 'string' ? args.path : '';
        if (!path) return "Policy blocked 'vfs_delete'. Provide a non-empty 'path'.";
        if (!policy.permissions.deleteFiles) {
          return "Policy blocked 'vfs_delete'. Enable 'permissions.delete_files' or set mode to 'gloves_off'.";
        }
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath.startsWith('agents/') && !policy.permissions.editAgents) {
          return `Policy blocked delete '${path}'. Enable 'permissions.edit_agents' to delete agent files.`;
        }
        if (path && !this.matchesAnyPattern(path, policy.writes)) {
          return `Policy blocked delete '${path}'. Add it to frontmatter 'writes'.`;
        }
        return null;
      }
    }

    return null;
  }

  private normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    // Collapse ../ sequences to prevent policy bypass (e.g. artifacts/../agents/x)
    const parts = normalized.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else if (part !== '.') {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  }

  private normalizePattern(pattern: string): string {
    const trimmed = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (trimmed.endsWith('/')) {
      return `${trimmed}**`;
    }
    return trimmed;
  }

  private patternToRegExp(pattern: string): RegExp {
    const normalized = this.normalizePattern(pattern);
    if (normalized === '**') {
      return /^.*$/;
    }

    const escaped = normalized
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DOUBLE_STAR__/g, '.*');

    return new RegExp(`^${escaped}$`);
  }

  private matchesAnyPattern(path: string, patterns: string[]): boolean {
    const normalizedPath = this.normalizePath(path);
    if (patterns.length === 0) return false;
    if (patterns.includes('**')) return true;

    return patterns.some((pattern) => this.patternToRegExp(pattern).test(normalizedPath));
  }

  private patternBase(pattern: string): string {
    const normalized = this.normalizePattern(pattern);
    if (normalized === '**') return '';
    const wildcardIndex = normalized.search(/[*]/);
    if (wildcardIndex === -1) return normalized;
    const beforeWildcard = normalized.slice(0, wildcardIndex);
    const slashIndex = beforeWildcard.lastIndexOf('/');
    if (slashIndex === -1) return beforeWildcard;
    return beforeWildcard.slice(0, slashIndex + 1);
  }

  private prefixAllowed(prefix: string, patterns: string[]): boolean {
    const normalizedPrefix = this.normalizePath(prefix);
    if (patterns.length === 0) return false;
    if (patterns.includes('**')) return true;

    return patterns.some((pattern) => {
      const base = this.patternBase(pattern);
      if (!base) return true;
      return normalizedPrefix.startsWith(base);
    });
  }
}
