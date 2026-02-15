import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import { findSimilarPaths } from '../utils/vfs-helpers';

type Store<T> = { getState(): T };

export interface ToolHandlerConfig {
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  onSpawnActivation: (activation: Omit<Activation, 'id' | 'createdAt'>) => void;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
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

    let result: string;

    switch (toolName) {
      case 'vfs_read':
        result = this.handleRead(args.path as string);
        break;
      case 'vfs_write':
        result = this.handleWrite(args.path as string, args.content as string);
        break;
      case 'vfs_list':
        result = this.handleList(args.prefix as string);
        break;
      case 'vfs_delete':
        result = this.handleDelete(args.path as string);
        break;
      case 'spawn_agent':
        result = this.handleSpawn(
          args.filename as string,
          args.content as string,
          args.task as string
        );
        break;
      case 'signal_parent':
        result = this.handleSignalParent(args.message as string);
        break;
      default:
        result = `Error: Unknown tool '${toolName}'. Available tools: vfs_read, vfs_write, vfs_list, vfs_delete, spawn_agent, signal_parent`;
    }

    eventLog.getState().append({
      type: 'tool_result',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, result: result.slice(0, 500) },
    });

    return result;
  }

  private handleRead(path: string): string {
    const { vfs } = this.config;
    const content = vfs.getState().read(path);
    if (content !== null) return content;

    const allPaths = vfs.getState().getAllPaths();
    const similar = findSimilarPaths(path, allPaths);
    const suggestion = similar.length > 0
      ? `Similar: ${similar.map(p => `'${p}'`).join(', ')}. `
      : '';
    return `Error: '${path}' not found. ${suggestion}Available files: [${allPaths.join(', ')}]`;
  }

  private handleWrite(path: string, content: string): string {
    const { vfs, registry, eventLog } = this.config;
    const meta = {
      authorAgentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
    };

    vfs.getState().write(path, content, meta);

    if (path.startsWith('agents/')) {
      registry.getState().registerFromFile(path, content);
    }

    eventLog.getState().append({
      type: 'file_change',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { path, size: content.length },
    });

    return `Written to '${path}' (${content.length} chars)`;
  }

  private handleList(prefix: string): string {
    const { vfs } = this.config;
    const files = vfs.getState().list(prefix);
    if (files.length > 0) {
      return JSON.stringify(files);
    }
    const prefixes = vfs.getState().getExistingPrefixes();
    return `No files match prefix '${prefix}'. Existing prefixes: [${prefixes.join(', ')}]`;
  }

  private handleDelete(path: string): string {
    const { vfs, registry } = this.config;
    if (!vfs.getState().exists(path)) {
      return `Error: '${path}' not found.`;
    }
    vfs.getState().deleteFile(path);
    if (path.startsWith('agents/')) {
      registry.getState().unregister(path);
    }
    return `Deleted '${path}'`;
  }

  private handleSpawn(filename: string, content: string, task: string): string {
    const { vfs, registry, eventLog } = this.config;
    const path = filename.startsWith('agents/') ? filename : `agents/${filename}`;

    if (this.config.spawnDepth >= this.config.maxDepth) {
      return `Error: depth limit reached (${this.config.spawnDepth}/${this.config.maxDepth}). Cannot spawn more agents.`;
    }

    const totalChildren = this.config.childCount + this.spawnCount;
    if (totalChildren >= this.config.maxFanout) {
      return `Error: fanout limit reached (${totalChildren}/${this.config.maxFanout}). This agent cannot spawn more children.`;
    }

    const meta = {
      authorAgentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
    };
    vfs.getState().write(path, content, meta);
    const profile = registry.getState().registerFromFile(path, content);

    this.spawnCount++;

    const newDepth = this.config.spawnDepth + 1;

    this.config.onSpawnActivation({
      agentId: path,
      input: task,
      parentId: this.config.currentAgentId,
      spawnDepth: newDepth,
      priority: newDepth,
    });

    eventLog.getState().append({
      type: 'spawn',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { spawned: path, depth: newDepth, task },
    });

    return `Created and activated '${profile.name}' at '${path}' (depth ${newDepth}/${this.config.maxDepth})`;
  }

  private handleSignalParent(message: string): string {
    const { eventLog } = this.config;

    if (!this.config.parentAgentId) {
      return `Error: this agent has no parent. You are a root agent.`;
    }

    this.config.onSpawnActivation({
      agentId: this.config.parentAgentId,
      input: `[Signal from ${this.config.currentAgentId}]: ${message}`,
      parentId: undefined,
      spawnDepth: Math.max(0, this.config.spawnDepth - 1),
      priority: 0,
    });

    eventLog.getState().append({
      type: 'signal',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { parent: this.config.parentAgentId, message },
    });

    return `Message sent to parent '${this.config.parentAgentId}'. Parent will be re-activated.`;
  }
}
