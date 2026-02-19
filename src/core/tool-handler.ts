import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { ToolPluginRegistry, ToolContext } from './tool-plugin';
import type { AgentPolicy } from '../types/agent';

type Store<T> = { getState(): T };

const BUILT_IN_TOOLS = new Set([
  'vfs_read',
  'vfs_write',
  'vfs_list',
  'vfs_delete',
  'spawn_agent',
  'signal_parent',
  'web_fetch',
  'web_search',
]);

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
  policy?: AgentPolicy;
  apiKey?: string;
  preferredModel?: string;
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

    const policyError = this.policyError(toolName, args);
    if (policyError) {
      eventLog.getState().append({
        type: 'warning',
        agentId: this.config.currentAgentId,
        activationId: this.config.currentActivationId,
        data: { message: policyError, tool: toolName },
      });
      eventLog.getState().append({
        type: 'tool_result',
        agentId: this.config.currentAgentId,
        activationId: this.config.currentActivationId,
        data: { tool: toolName, result: policyError.slice(0, 500) },
      });
      return policyError;
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
        spawnCount: this.spawnCount,
        onSpawnActivation: this.config.onSpawnActivation,
        incrementSpawnCount: () => { this.spawnCount++; },
        apiKey: this.config.apiKey,
        preferredModel: this.config.preferredModel,
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
        if (!path) return null;
        if (!this.matchesAnyPattern(path, policy.reads)) {
          return `Policy blocked read '${path}'. Add it to frontmatter 'reads'.`;
        }
        return null;
      }

      case 'vfs_list': {
        const prefix = typeof args.prefix === 'string' ? args.prefix : '';
        if (!prefix) return null;
        if (!this.prefixAllowed(prefix, policy.reads)) {
          return `Policy blocked list prefix '${prefix}'. Add an allowed read scope in frontmatter 'reads'.`;
        }
        return null;
      }

      case 'vfs_write': {
        const path = typeof args.path === 'string' ? args.path : '';
        if (!path) return null;
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
    return path.replace(/\\/g, '/').replace(/^\.\//, '');
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
    const wildcardIndex = normalized.search(/[\*]/);
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
      return normalizedPrefix.startsWith(base) || base.startsWith(normalizedPrefix);
    });
  }
}
