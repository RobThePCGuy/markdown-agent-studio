import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { createBuiltinRegistry } from './plugins';
import { taskQueueReadPlugin } from './plugins/task-queue-read';
import { taskQueueWritePlugin } from './plugins/task-queue-write';
import { Summarizer, createGeminiSummarizeFn, createGeminiConsolidateFn } from './summarizer';
import type { MemoryManager } from './memory-manager';
import type { KernelConfig } from '../types';
import type { TaskQueueState } from '../stores/task-queue-store';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { SessionStoreState } from '../stores/session-store';
import type { MemoryStoreState } from '../stores/memory-store';

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

export interface AutonomousRunnerConfig {
  maxCycles: number;
  minCycles?: number;
  wrapUpThreshold: number;
  agentPath: string;
  missionPrompt: string;
  kernelConfig: KernelConfig;
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
}

export type AutonomousStateListener = (state: {
  currentCycle: number;
  maxCycles: number;
  totalTokensAllCycles: number;
}) => void;

export class AutonomousRunner {
  private config: AutonomousRunnerConfig;
  private deps: AutonomousRunnerDeps;
  private currentKernel: Kernel | null = null;
  private _currentCycle = 0;
  private _totalTokensAllCycles = 0;
  private _stopped = false;
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
      maxCycles: this.config.maxCycles,
      totalTokensAllCycles: this._totalTokensAllCycles,
    };
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  async run(): Promise<void> {
    // Clear task queue for a fresh autonomous run
    this.deps.taskQueueStore.getState().clear();
    const minCycles = this.config.minCycles ?? 1;

    for (let cycle = 1; cycle <= this.config.maxCycles; cycle++) {
      if (this._stopped) break;

      this._currentCycle = cycle;
      this.emit();

      const cycleInput = this.buildCycleInput(cycle);
      const kernel = this.createCycleKernel();
      this.currentKernel = kernel;

      kernel.enqueue({
        agentId: this.config.agentPath,
        input: cycleInput,
        spawnDepth: 0,
        priority: 0,
      });

      await kernel.runUntilEmpty();

      this._totalTokensAllCycles += kernel.totalTokens;
      this.emit();

      if (this._stopped) break;

      // Post-cycle summarization
      await this.runSummarization(kernel);

      // Assess whether work is complete
      const completeness = this.assessCompletion(kernel);
      if (completeness === 'complete' && cycle >= minCycles) {
        this.deps.sessionStore.getState().clearAll();
        this.currentKernel = null;
        break;
      }

      // Clear session store for next cycle (keeps VFS and task queue intact)
      this.deps.sessionStore.getState().clearAll();
      this.currentKernel = null;
    }
  }

  stop(): void {
    this._stopped = true;
    this.currentKernel?.killAll();
  }

  pause(): void {
    this.currentKernel?.pause();
  }

  resume(): void {
    this.currentKernel?.resume();
  }

  get isPaused(): boolean {
    return this.currentKernel?.isPaused ?? false;
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

  private buildCycleInput(cycle: number): string {
    const parts: string[] = [];

    // Mission
    parts.push('## Mission');
    parts.push(this.config.missionPrompt);
    parts.push('');

    // Cycle info
    parts.push(`## Cycle ${cycle} of ${this.config.maxCycles}`);
    if (cycle > 1) {
      parts.push(
        'This is a continuation. Your previous context was compressed into long-term memory. ' +
        'Use memory_read to recall previous findings. Check the task queue for remaining work.'
      );
    }
    parts.push('');

    // Task queue state
    const tasks = this.deps.taskQueueStore.getState().getAll();
    if (tasks.length > 0) {
      parts.push('## Task Queue');
      for (const t of tasks) {
        const notes = t.notes ? ` | ${t.notes}` : '';
        parts.push(`- [${t.id}] (${t.status}) ${t.description}${notes}`);
      }
      parts.push('');
    }

    // Work ethic
    parts.push('## Work Ethic');
    parts.push(
      'Be thorough and persistent. Do NOT give up after a single attempt. ' +
      'If a tool call fails, try a different approach. If a search returns no results, ' +
      'rephrase your query. If you are stuck, spawn a sub-agent to research the problem. ' +
      'Use ALL available tools before concluding. Write all deliverables to files ' +
      'using vfs_write - text responses alone are not enough.'
    );
    parts.push('');

    // Instructions about available tools
    parts.push('## Autonomous Mode Tools');
    parts.push(
      'You have access to task_queue_read and task_queue_write tools to manage a persistent task queue ' +
      'that survives across cycles. Use these to track work items, maintain continuity, and plan future cycles. ' +
      'Write deliverables and outputs as files using vfs_write. Use memory_write only for inter-agent notes that should persist to long-term memory.'
    );

    return parts.join('\n');
  }

  private createCycleKernel(): Kernel {
    const { kernelConfig } = this.config;
    const { apiKey } = this.deps;

    const provider = apiKey && apiKey !== 'your-api-key-here'
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
      apiKey,
      onSessionUpdate: () => {
        this._totalTokensAllCycles =
          this._totalTokensAllCycles - (this.currentKernel?.totalTokens ?? 0) + kernel.totalTokens;
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
        'Write any final outputs as files using vfs_write. Save inter-agent notes using memory_write. ' +
        'Update or add remaining tasks using task_queue_write. ' +
        'The next cycle will have access to your memories and task queue.\n\n' +
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

  private async runSummarization(kernel: Kernel): Promise<void> {
    const { kernelConfig } = this.config;
    if (kernelConfig.memoryEnabled === false) return;

    const workingSnapshot = kernel.lastWorkingMemorySnapshot;
    const completedSessions = [...this.deps.sessionStore.getState().sessions.values()]
      .filter((s) => s.completedAt);

    const { apiKey } = this.deps;
    if (!apiKey || completedSessions.length === 0) return;

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
    } catch {
      // Summarization is best-effort
    }
  }
}
