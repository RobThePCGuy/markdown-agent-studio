import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { createBuiltinRegistry } from './plugins';
import { taskQueueReadPlugin } from './plugins/task-queue-read';
import { taskQueueWritePlugin } from './plugins/task-queue-write';
import { Summarizer, SUMMARIZER_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPT } from './summarizer';
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
        'The next cycle will have access to your memories and task queue.',
    });

    this.deps.sessionStore.getState().addUserMessage(
      activationId,
      '[System] Context limit approaching - wrapping up cycle.'
    );
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
    const summarizeFn = async (context: string) => {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({ model: summarizeModel });
        const result = await model.generateContent(
          SUMMARIZER_SYSTEM_PROMPT + '\n\n---\n\n' + context
        );
        const text = result.response.text();
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [];
        return JSON.parse(jsonMatch[0]);
      } catch {
        return [];
      }
    };

    const consolidateFn = async (context: string) => {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({ model: summarizeModel });
        const result = await model.generateContent(
          CONSOLIDATION_SYSTEM_PROMPT + '\n\n---\n\n' + context
        );
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { operations: [] };
        return JSON.parse(jsonMatch[0]);
      } catch {
        return { operations: [] };
      }
    };
    const summarizer = new Summarizer(this.deps.memoryManager, summarizeFn, this.deps.vfs, consolidateFn);
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
