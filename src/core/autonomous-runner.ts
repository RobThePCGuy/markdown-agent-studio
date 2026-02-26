import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { createBuiltinRegistry } from './plugins';
import { taskQueueReadPlugin } from './plugins/task-queue-read';
import { taskQueueWritePlugin } from './plugins/task-queue-write';
import { Summarizer, createGeminiSummarizeFn, createGeminiConsolidateFn } from './summarizer';
import {
  prepareMissionState,
  saveMissionState,
  type AutonomousMissionState,
  type PendingActivationSnapshot,
} from './autonomous-state';
import type { MemoryManager } from './memory-manager';
import type { KernelConfig } from '../types';
import type { TaskItem, TaskQueueState } from '../stores/task-queue-store';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { SessionStoreState } from '../stores/session-store';
import type { MemoryStoreState } from '../stores/memory-store';
import { MCPClientManager, type MCPServerConfig } from './mcp-client';
import { computeHash } from '../utils/vfs-helpers';

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

export interface AutonomousRunnerConfig {
  maxCycles: number;
  minCycles?: number;
  wrapUpThreshold: number;
  agentPath: string;
  missionPrompt: string;
  kernelConfig: KernelConfig;
  resumeMission?: boolean;
  stopWhenComplete?: boolean;
  seedTaskWhenIdle?: boolean;
}

export interface AutonomousRunnerDeps {
  memoryManager: MemoryManager;
  taskQueueStore: Store<TaskQueueState>;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  sessionStore: Store<SessionStoreState>;
  memoryStore: Store<MemoryStoreState>;
  apiKey: string;
  globalMcpServers?: MCPServerConfig[];
}

export type AutonomousStateListener = (state: {
  currentCycle: number;
  maxCycles: number;
  totalTokensAllCycles: number;
}) => void;

function hasUsableApiKey(apiKey: string | undefined): apiKey is string {
  return Boolean(apiKey && apiKey !== 'your-api-key-here');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AutonomousRunner {
  private config: AutonomousRunnerConfig;
  private deps: AutonomousRunnerDeps;
  private currentKernel: Kernel | null = null;
  private _currentCycle = 0;
  private _displayMaxCycle = 0;
  private _totalTokensAllCycles = 0;
  private _baseTokensBeforeCycle = 0;
  private _stopped = false;
  private _paused = false;
  private missionState: AutonomousMissionState | null = null;
  private missionStatePath: string | null = null;
  private listeners = new Set<AutonomousStateListener>();

  constructor(config: AutonomousRunnerConfig, deps: AutonomousRunnerDeps) {
    this.config = config;
    this.deps = deps;
  }

  get currentCycle(): number { return this._currentCycle; }
  get totalTokensAllCycles(): number { return this._totalTokensAllCycles; }

  subscribe(listener: AutonomousStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = {
      currentCycle: this._currentCycle,
      maxCycles: this._displayMaxCycle || this.config.maxCycles,
      totalTokensAllCycles: this._totalTokensAllCycles,
    };
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  async run(): Promise<void> {
    this.deps.sessionStore.getState().clearAll();
    this.bootstrapMissionState();

    const minCycles = this.config.minCycles ?? 1;
    const stopWhenComplete = this.config.stopWhenComplete ?? false;
    const seedTaskWhenIdle = this.config.seedTaskWhenIdle ?? true;
    let stoppedAsComplete = false;

    for (let cycle = this._currentCycle + 1; cycle <= this._displayMaxCycle; cycle++) {
      await this.waitWhilePaused();
      if (this._stopped) break;

      this._currentCycle = cycle;
      this.emit();

      const cycleInput = this.buildCycleInput(cycle);
      const kernel = await this.createCycleKernel();
      this.currentKernel = kernel;

      kernel.enqueue({
        agentId: this.config.agentPath,
        input: cycleInput,
        spawnDepth: 0,
        priority: 0,
      });

      await kernel.runUntilEmpty();

      const pendingActivations = kernel.getPendingActivations();
      if (pendingActivations.length > 0) {
        this.promotePendingActivationsToTasks(pendingActivations, cycle);
      }

      this._totalTokensAllCycles = this._baseTokensBeforeCycle + kernel.totalTokens;
      this.emit();

      await this.waitWhilePaused();

      let summarized = false;
      if (!this._stopped) {
        summarized = await this.runSummarization(kernel);
      }

      const completeness = this._stopped ? 'incomplete' : this.assessCompletion(kernel);
      const shouldStopForCompletion =
        stopWhenComplete &&
        completeness === 'complete' &&
        cycle >= minCycles;

      if (!shouldStopForCompletion && !this._stopped && seedTaskWhenIdle) {
        this.seedTaskIfIdle(cycle);
      }

      const cycleNote = this.buildCycleNote(kernel, completeness, pendingActivations.length);
      this.updateMissionState({
        status: shouldStopForCompletion ? 'completed' : 'running',
        totalCycles: cycle,
        totalTokens: this._totalTokensAllCycles,
        taskQueue: this.snapshotTaskQueue(),
        pendingActivations,
        cycleNotes: [...(this.missionState?.cycleNotes ?? []), cycleNote].slice(-12),
        lastSummaryAt: summarized ? Date.now() : this.missionState?.lastSummaryAt,
        lastError: undefined,
      });
      this.persistMissionState();

      this.deps.sessionStore.getState().clearAll();
      this.currentKernel = null;

      if (this._stopped) break;

      if (shouldStopForCompletion) {
        stoppedAsComplete = true;
        break;
      }
    }

    this.deps.sessionStore.getState().clearAll();
    this.currentKernel = null;

    this.updateMissionState({
      status: this._stopped ? 'stopped' : (stoppedAsComplete ? 'completed' : 'paused'),
      totalCycles: this._currentCycle,
      totalTokens: this._totalTokensAllCycles,
      taskQueue: this.snapshotTaskQueue(),
      pendingActivations: [],
      lastRunFinishedAt: Date.now(),
    });
    this.persistMissionState();
  }

  stop(): void {
    this._stopped = true;
    this.currentKernel?.killAll();
  }

  pause(): void {
    this._paused = true;
    this.currentKernel?.pause();
  }

  resume(): void {
    this._paused = false;
    this.currentKernel?.resume();
  }

  get isPaused(): boolean {
    return this._paused || (this.currentKernel?.isPaused ?? false);
  }

  get activeSessionCount(): number {
    return this.currentKernel?.activeSessionCount ?? 0;
  }

  get queueLength(): number {
    return this.currentKernel?.queueLength ?? 0;
  }

  get currentKernelTokens(): number {
    return this.currentKernel?.totalTokens ?? 0;
  }

  private bootstrapMissionState(): void {
    const prepared = prepareMissionState(
      this.deps.vfs,
      this.config.agentPath,
      this.config.missionPrompt,
      this.config.resumeMission ?? true,
    );

    this.missionState = prepared.state;
    this.missionStatePath = prepared.statePath;

    if (prepared.resumed) {
      this.deps.taskQueueStore.getState().replaceAll(prepared.state.taskQueue);
      if (prepared.state.pendingActivations.length > 0) {
        this.promotePendingActivationsToTasks(prepared.state.pendingActivations, prepared.state.totalCycles);
      }
    } else {
      this.deps.taskQueueStore.getState().clear();
    }

    this._currentCycle = prepared.state.totalCycles;
    this._totalTokensAllCycles = prepared.state.totalTokens;
    this._displayMaxCycle = this._currentCycle + this.config.maxCycles;

    this.updateMissionState({
      status: 'running',
      totalCycles: this._currentCycle,
      totalTokens: this._totalTokensAllCycles,
      taskQueue: this.snapshotTaskQueue(),
      pendingActivations: [],
      lastRunStartedAt: Date.now(),
      lastError: undefined,
    });
    this.persistMissionState();
    this.emit();
  }

  private updateMissionState(patch: Partial<AutonomousMissionState>): void {
    if (!this.missionState) return;
    this.missionState = {
      ...this.missionState,
      ...patch,
      updatedAt: Date.now(),
    };
  }

  private persistMissionState(): void {
    if (!this.missionState || !this.missionStatePath) return;
    saveMissionState(this.deps.vfs, this.missionStatePath, this.missionState);
  }

  private snapshotTaskQueue(): TaskItem[] {
    return this.deps.taskQueueStore
      .getState()
      .getAll()
      .map((task) => ({ ...task }));
  }

  private async waitWhilePaused(): Promise<void> {
    while (this._paused && !this._stopped) {
      await sleep(80);
    }
  }

  private buildCycleInput(cycle: number): string {
    const parts: string[] = [];

    // Mission
    parts.push('## Mission');
    parts.push(this.config.missionPrompt);
    parts.push('');

    // Cycle info
    parts.push(`## Cycle ${cycle}`);
    parts.push(
      `This launch will run until cycle ${this._displayMaxCycle} unless stopped sooner. ` +
      `Use task_queue_write and memory_write to preserve continuity.`
    );
    if (cycle > 1) {
      parts.push(
        'This is a continuation. Previous cycle context has been summarized into long-term memory. ' +
        'Use memory_read to recall prior findings and continue unfinished work from the task queue.'
      );
    }
    parts.push('');

    const notes = this.missionState?.cycleNotes ?? [];
    if (notes.length > 0) {
      parts.push('## Prior Cycle Notes');
      for (const note of notes.slice(-4)) {
        parts.push(`- ${note}`);
      }
      parts.push('');
    }

    // Task queue state
    const tasks = this.deps.taskQueueStore.getState().getAll();
    if (tasks.length > 0) {
      parts.push('## Task Queue');
      for (const t of tasks) {
        const notesText = t.notes ? ` | ${t.notes}` : '';
        parts.push(`- [${t.id}] (${t.status}) ${t.description}${notesText}`);
      }
      parts.push('');
    }

    // Work ethic
    parts.push('## Work Ethic');
    parts.push(
      'Be thorough and persistent. Do NOT give up after a single attempt. ' +
      'If a tool call fails, try a different approach. If a search returns no results, ' +
      'rephrase your query. If you are stuck, spawn a sub-agent specialist to research the problem. ' +
      'Use available custom tools where relevant. Write all deliverables to files ' +
      'using vfs_write; text responses alone are not enough.'
    );
    parts.push('');

    // Instructions about available tools
    parts.push('## Autonomous Mode Tools');
    parts.push(
      'You have access to task_queue_read and task_queue_write tools to manage a persistent task queue ' +
      'that survives across cycles and future autonomous launches. Use these tools to track continuity. ' +
      'Use memory_write for concise, reusable lessons that should survive context resets.'
    );

    return parts.join('\n');
  }

  private async createCycleKernel(): Promise<Kernel> {
    const { kernelConfig } = this.config;
    const { apiKey } = this.deps;

    const provider = hasUsableApiKey(apiKey)
      ? new GeminiProvider(apiKey)
      : new ScriptedAIProvider(DEMO_SCRIPT);

    // Clone builtin registry and add task queue tools
    const registry = createBuiltinRegistry().cloneWith([
      taskQueueReadPlugin,
      taskQueueWritePlugin,
    ]);

    const cycleConfig: KernelConfig = {
      ...kernelConfig,
      wrapUpThreshold: this.config.wrapUpThreshold,
    };

    this._baseTokensBeforeCycle = this._totalTokensAllCycles;

    // Instantiate MCPClientManager and pre-connect global servers
    const mcpManager = new MCPClientManager();
    const globalServers = this.deps.globalMcpServers ?? [];
    if (globalServers.length > 0) {
      const { compatible, skipped } = MCPClientManager.filterBrowserCompatible(globalServers);
      for (const server of skipped) {
        this.deps.eventLog.getState().append({
          type: 'warning',
          agentId: 'system',
          activationId: 'system',
          data: {
            message: `Skipping MCP server "${server.name}" - stdio transport is not available in the browser.`,
          },
        });
      }
      for (const server of compatible) {
        await mcpManager.connect(server);
        this.deps.eventLog.getState().append({
          type: 'mcp_connect',
          agentId: 'system',
          activationId: 'system',
          data: { serverName: server.name, transport: server.transport },
        });
      }
    }

    const kernel = new Kernel({
      aiProvider: provider,
      vfs: this.deps.vfs,
      agentRegistry: this.deps.agentRegistry,
      eventLog: this.deps.eventLog,
      config: cycleConfig,
      sessionStore: this.deps.sessionStore,
      memoryStore: kernelConfig.memoryEnabled !== false ? this.deps.memoryStore : undefined,
      memoryManager: kernelConfig.memoryEnabled !== false ? this.deps.memoryManager : undefined,
      toolRegistry: registry,
      taskQueueStore: this.deps.taskQueueStore,
      mcpManager,
      apiKey,
      onSessionUpdate: () => {
        this._totalTokensAllCycles = this._baseTokensBeforeCycle + kernel.totalTokens;
        this.emit();
      },
      onBudgetWarning: (activationId: string) => {
        this.injectWrapUpMessage(kernel, activationId);
      },
    });

    return kernel;
  }

  private injectWrapUpMessage(kernel: Kernel, activationId: string): void {
    const session = kernel.getActiveSession(activationId);
    if (!session) return;

    session.history.push({
      role: 'user',
      content:
        'CONTEXT LIMIT APPROACHING. You have 2-3 turns remaining in this cycle. ' +
        'Write final outputs using vfs_write. Save reusable lessons with memory_write. ' +
        'Update or add remaining tasks using task_queue_write. ' +
        'The next cycle will resume from your memory and task queue.\n\n' +
        '## Required Reflection\n' +
        'Before ending, write a memory_write entry with key "cycle-reflection" that answers:\n' +
        '- What approaches worked in this cycle?\n' +
        '- What approaches FAILED and should not be repeated?\n' +
        '- What is the most promising next step for the next cycle?',
    });

    this.deps.sessionStore.getState().addUserMessage(
      activationId,
      '[System] Context limit approaching - wrapping up cycle.'
    );
  }

  private assessCompletion(kernel: Kernel): 'complete' | 'incomplete' | 'uncertain' {
    // Check for pending tasks in the queue
    const tasks = this.deps.taskQueueStore.getState().getAll();
    const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    if (pendingTasks.length > 0) return 'incomplete';

    // Examine completed sessions
    const sessions = kernel.completedSessions;
    if (sessions.length === 0) return 'incomplete';

    // Check if any session ended in error
    if (sessions.some((s) => s.status === 'error')) return 'incomplete';

    // Check if agent barely tried (very few tool calls total)
    const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolCalls.length, 0);
    if (totalToolCalls <= 2) return 'incomplete';

    // Check the last model message for incompleteness signals
    const lastSession = sessions[sessions.length - 1];
    const lastModelMsg = [...lastSession.history]
      .reverse()
      .find((m) => m.role === 'model');
    if (lastModelMsg) {
      const text = lastModelMsg.content.toLowerCase();
      const incompletePatterns = [
        'could not', 'unable to', 'need more', 'next step',
        'incomplete', 'not yet', 'remains to', 'todo', 'to do',
        'further research', 'more work', 'follow up', 'blocked',
      ];
      if (incompletePatterns.some((p) => text.includes(p))) return 'incomplete';
    }

    // If all tasks are done, consider complete
    if (tasks.length > 0 && tasks.every((t) => t.status === 'done')) return 'complete';

    return 'uncertain';
  }

  private buildCycleNote(
    kernel: Kernel,
    completeness: 'complete' | 'incomplete' | 'uncertain',
    pendingActivationCount: number,
  ): string {
    const sessionCount = kernel.completedSessions.length;
    const toolCalls = kernel.completedSessions.reduce((sum, s) => sum + s.toolCalls.length, 0);
    const lastSession = kernel.completedSessions[kernel.completedSessions.length - 1];
    const lastModel = lastSession
      ? [...lastSession.history].reverse().find((m) => m.role === 'model')
      : undefined;
    const summary = lastModel?.content
      ? this.compactText(lastModel.content, 180)
      : 'No final model summary produced.';

    const rolloverText = pendingActivationCount > 0
      ? ` ${pendingActivationCount} pending activation(s) rolled into task queue.`
      : '';

    return `Cycle ${this._currentCycle}: ${completeness}. Sessions=${sessionCount}, tool_calls=${toolCalls}.${rolloverText} ${summary}`;
  }

  private compactText(input: string, maxChars: number): string {
    const clean = input.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars - 3)}...`;
  }

  private promotePendingActivationsToTasks(
    pendingActivations: PendingActivationSnapshot[],
    cycle: number,
  ): void {
    if (pendingActivations.length === 0) return;

    const queueState = this.deps.taskQueueStore.getState();
    const existingNotes = new Set(
      queueState.getAll().map((t) => t.notes),
    );

    for (const pending of pendingActivations) {
      const marker = `carryover:${computeHash(`${pending.agentId}:${pending.input}`)}`;
      const alreadyTracked = [...existingNotes].some((note) => note.includes(marker));
      if (alreadyTracked) continue;

      const description =
        `Resume ${pending.agentId}: ${this.compactText(pending.input, 120)}`;
      const taskId = queueState.add(description, Math.max(0, pending.priority));
      const notes =
        `Recovered from cycle ${cycle} context rollover [${marker}]` +
        (pending.parentId ? ` parent=${pending.parentId}` : '') +
        ` depth=${pending.spawnDepth}`;
      queueState.update(taskId, { status: 'pending', notes });
      existingNotes.add(notes);
    }
  }

  private seedTaskIfIdle(cycle: number): void {
    const queueState = this.deps.taskQueueStore.getState();
    const pending = queueState.getPending();
    if (pending.length > 0) return;

    const marker = `auto-seed:cycle-${cycle + 1}`;
    const alreadySeeded = queueState.getAll().some((task) => task.notes.includes(marker));
    if (alreadySeeded) return;

    const taskId = queueState.add(
      `Continue learning and improve mission strategy: ${this.compactText(this.config.missionPrompt, 130)}`,
      0,
    );
    queueState.update(taskId, {
      status: 'pending',
      notes:
        `Autonomous continuation task [${marker}]. ` +
        'Try a new method, compare outcomes, and write concrete results to artifacts/.',
    });
  }

  private async runSummarization(kernel: Kernel): Promise<boolean> {
    const { kernelConfig } = this.config;
    if (kernelConfig.memoryEnabled === false) return false;

    const workingSnapshot = kernel.lastWorkingMemorySnapshot;
    const completedSessions = [...this.deps.sessionStore.getState().sessions.values()]
      .filter((s) => s.completedAt);

    const { apiKey } = this.deps;
    if (!hasUsableApiKey(apiKey) || completedSessions.length === 0) return false;

    const summarizeModel = kernelConfig.model || 'gemini-2.0-flash';
    const summarizer = new Summarizer(
      this.deps.memoryManager,
      createGeminiSummarizeFn(apiKey, summarizeModel),
      this.deps.vfs,
      createGeminiConsolidateFn(apiKey, summarizeModel),
    );
    try {
      await summarizer.summarize(
        `autonomous-cycle-${this._currentCycle}-${Date.now()}`,
        workingSnapshot,
        completedSessions,
      );
      return true;
    } catch {
      // Summarization is best-effort
      return false;
    }
  }
}
