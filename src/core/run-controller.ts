import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { agentRegistry, eventLogStore, sessionStore, uiStore, vfsStore, memoryStore, taskQueueStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';
import { restoreCheckpoint } from '../utils/replay';
import { MemoryManager } from './memory-manager';
import { createMemoryDB } from './memory-db';
import { Summarizer, createGeminiSummarizeFn, createGeminiConsolidateFn } from './summarizer';
import { AutonomousRunner } from './autonomous-runner';
import { parseWorkflow } from './workflow-parser';
import { WorkflowEngine } from './workflow-engine';
import { createStepRunner } from './workflow-runner';

export interface RunControllerState {
  isRunning: boolean;
  isPaused: boolean;
  totalTokens: number;
  activeCount: number;
  queueCount: number;
  lastReplayEventId: string | null;
  isAutonomous: boolean;
  currentCycle: number;
  maxCycles: number;
}

type Listener = (state: RunControllerState) => void;

class RunController {
  private kernel: Kernel | null = null;
  private autonomousRunner: AutonomousRunner | null = null;
  private workflowAbort: AbortController | null = null;
  private memoryManager = new MemoryManager(createMemoryDB(vfsStore));

  /** Re-create the memory DB (and manager) based on the current kernel config. */
  private refreshMemoryManager(config: KernelConfig): void {
    const db = createMemoryDB(vfsStore, {
      useVectorStore: config.useVectorMemory ?? false,
    });
    this.memoryManager = new MemoryManager(db);
  }

  private state: RunControllerState = {
    isRunning: false,
    isPaused: false,
    totalTokens: 0,
    activeCount: 0,
    queueCount: 0,
    lastReplayEventId: null,
    isAutonomous: false,
    currentCycle: 0,
    maxCycles: 0,
  };
  private listeners = new Set<Listener>();

  getState(): RunControllerState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private setState(partial: Partial<RunControllerState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private hasUsableApiKey(apiKey: string | undefined): apiKey is string {
    return Boolean(apiKey && apiKey !== 'your-api-key-here');
  }

  private createKernel(config: KernelConfig): Kernel {
    const apiKey = uiStore.getState().apiKey;
    const provider = this.hasUsableApiKey(apiKey)
      ? new GeminiProvider(apiKey)
      : new ScriptedAIProvider(DEMO_SCRIPT);

    const kernel = new Kernel({
      aiProvider: provider,
      vfs: vfsStore,
      agentRegistry: agentRegistry,
      eventLog: eventLogStore,
      config,
      sessionStore,
      memoryStore: config.memoryEnabled !== false ? memoryStore : undefined,
      memoryManager: config.memoryEnabled !== false ? this.memoryManager : undefined,
      apiKey,
      onSessionUpdate: () => {
        this.setState({
          totalTokens: kernel.totalTokens,
          activeCount: kernel.activeSessionCount,
          queueCount: kernel.queueLength,
        });
      },
    });

    this.kernel = kernel;
    return kernel;
  }

  async run(agentPath: string, input: string): Promise<void> {
    if (this.state.isRunning) return;

    const config = uiStore.getState().kernelConfig;
    this.refreshMemoryManager(config);
    // Keep per-run session context isolated for correct summarization.
    sessionStore.getState().clearAll();
    const kernel = this.createKernel(config);
    kernel.enqueue({
      agentId: agentPath,
      input,
      spawnDepth: 0,
      priority: 0,
    });

    this.setState({ isRunning: true, isPaused: false });
    try {
      await kernel.runUntilEmpty();

      // Post-run summarization
      if (config.memoryEnabled !== false) {
        const workingSnapshot = kernel.lastWorkingMemorySnapshot;
        const completedSessions = [...sessionStore.getState().sessions.values()]
          .filter((s) => s.completedAt);

        // Run summarization in background
        const apiKey = uiStore.getState().apiKey;
        if (this.hasUsableApiKey(apiKey) && completedSessions.length > 0) {
          const summarizeModel = config.model || 'gemini-2.0-flash';
          const summarizer = new Summarizer(
            this.memoryManager,
            createGeminiSummarizeFn(apiKey, summarizeModel),
            vfsStore,
            createGeminiConsolidateFn(apiKey, summarizeModel),
          );
          summarizer
            .summarize(`run-${Date.now()}`, workingSnapshot, completedSessions)
            .catch(() => {});
        }
      }
    } finally {
      const hasPendingWork = kernel.activeSessionCount > 0 || kernel.queueLength > 0;
      this.setState({
        isRunning: hasPendingWork,
        isPaused: kernel.isPaused,
        totalTokens: kernel.totalTokens,
        activeCount: kernel.activeSessionCount,
        queueCount: kernel.queueLength,
      });
    }
  }

  async runAutonomous(agentPath: string, input: string): Promise<void> {
    if (this.state.isRunning) return;

    const config = uiStore.getState().kernelConfig;
    this.refreshMemoryManager(config);
    // Ensure autonomous-cycle summarization only includes this autonomous run.
    sessionStore.getState().clearAll();

    // Resolve autonomous controls: agent frontmatter overrides global settings.
    const agentProfile = agentRegistry.getState().get(agentPath);
    const maxCycles = Math.max(1, Math.min(1000,
      agentProfile?.autonomousConfig?.maxCycles
      ?? config.autonomousMaxCycles
      ?? 10,
    ));
    const stopWhenComplete =
      agentProfile?.autonomousConfig?.stopWhenComplete
      ?? config.autonomousStopWhenComplete
      ?? false;
    const resumeMission =
      agentProfile?.autonomousConfig?.resumeMission
      ?? config.autonomousResumeMission
      ?? true;
    const seedTaskWhenIdle =
      agentProfile?.autonomousConfig?.seedTaskWhenIdle
      ?? config.autonomousSeedTaskWhenIdle
      ?? true;

    const runner = new AutonomousRunner(
      {
        maxCycles,
        minCycles: 1,
        wrapUpThreshold: 0.8,
        agentPath,
        missionPrompt: input,
        kernelConfig: config,
        resumeMission,
        stopWhenComplete,
        seedTaskWhenIdle,
      },
      {
        memoryManager: this.memoryManager,
        taskQueueStore,
        vfs: vfsStore,
        agentRegistry,
        eventLog: eventLogStore,
        sessionStore,
        memoryStore,
        apiKey: uiStore.getState().apiKey,
      },
    );

    this.autonomousRunner = runner;

    runner.subscribe((s) => {
      this.setState({
        currentCycle: s.currentCycle,
        maxCycles: s.maxCycles,
        totalTokens: s.totalTokensAllCycles,
        isPaused: runner.isPaused,
        activeCount: runner.activeSessionCount,
        queueCount: runner.queueLength,
      });
    });

    this.setState({
      isRunning: true,
      isPaused: false,
      isAutonomous: true,
      currentCycle: 0,
      maxCycles,
    });

    try {
      await runner.run();
    } finally {
      this.autonomousRunner = null;
      this.setState({
        isRunning: false,
        isPaused: false,
        isAutonomous: false,
        currentCycle: 0,
        maxCycles: 0,
        activeCount: 0,
        queueCount: 0,
      });
    }
  }

  async runWorkflow(workflowPath: string, variables: Record<string, unknown> = {}): Promise<void> {
    if (this.state.isRunning) return;

    const config = uiStore.getState().kernelConfig;
    this.refreshMemoryManager(config);
    sessionStore.getState().clearAll();

    const abort = new AbortController();
    this.workflowAbort = abort;
    this.setState({ isRunning: true, isPaused: false });

    let kernel: Kernel | null = null;
    try {
      // Read and parse workflow (inside try so YAML errors are caught)
      const content = vfsStore.getState().read(workflowPath);
      if (!content) throw new Error(`Workflow not found: ${workflowPath}`);

      const workflow = parseWorkflow(workflowPath, content);
      kernel = this.createKernel(config);

      // Emit workflow_start
      eventLogStore.getState().append({
        type: 'workflow_start',
        agentId: workflowPath,
        activationId: `wf-${workflowPath}`,
        data: {
          workflowPath,
          name: workflow.name,
          steps: workflow.steps.map((s) => s.id),
          variables,
        },
      });

      const stepRunner = createStepRunner({
        kernel,
        eventLog: eventLogStore,
        workflowPath,
      });
      const engine = new WorkflowEngine({ runStep: stepRunner });

      const outputs = await engine.execute(workflow, variables, abort.signal);

      eventLogStore.getState().append({
        type: 'workflow_complete',
        agentId: workflowPath,
        activationId: `wf-${workflowPath}`,
        data: {
          workflowPath,
          name: workflow.name,
          stepCount: workflow.steps.length,
          outputs: Object.keys(outputs),
        },
      });
    } catch (err) {
      eventLogStore.getState().append({
        type: 'error',
        agentId: workflowPath,
        activationId: `wf-${workflowPath}`,
        data: {
          error: `Workflow failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    } finally {
      this.workflowAbort = null;
      this.setState({
        isRunning: false,
        isPaused: false,
        totalTokens: kernel?.totalTokens ?? 0,
        activeCount: 0,
        queueCount: 0,
      });
    }
  }

  pause(): void {
    if (this.autonomousRunner) {
      this.autonomousRunner.pause();
    } else {
      this.kernel?.pause();
    }
    this.setState({ isPaused: true });
  }

  resume(): void {
    if (this.autonomousRunner) {
      this.autonomousRunner.resume();
    } else {
      this.kernel?.resume();
    }
    this.setState({ isPaused: false });
  }

  killAll(): void {
    if (this.workflowAbort) {
      this.workflowAbort.abort();
      this.workflowAbort = null;
    }
    if (this.autonomousRunner) {
      this.autonomousRunner.stop();
      this.autonomousRunner = null;
    } else {
      this.kernel?.killAll();
    }
    this.setState({
      isRunning: false,
      isPaused: false,
      isAutonomous: false,
      activeCount: 0,
      queueCount: 0,
      currentCycle: 0,
      maxCycles: 0,
    });
  }

  restoreFromEvent(eventId: string): { ok: boolean; message: string } {
    if (this.state.isRunning) {
      return {
        ok: false,
        message: 'Cannot restore while a run is active. Kill or wait for current run first.',
      };
    }

    const checkpoint = eventLogStore.getState().getCheckpoint(eventId);
    if (!checkpoint) {
      return { ok: false, message: `No checkpoint found for event '${eventId}'.` };
    }

    restoreCheckpoint(checkpoint, vfsStore, agentRegistry);
    sessionStore.getState().clearAll();
    uiStore.getState().setSelectedAgent(checkpoint.agentId);
    this.setState({ lastReplayEventId: eventId });
    return { ok: true, message: `Restored workspace snapshot from event '${eventId}'.` };
  }

  private resolveReplayInput(eventId: string, activationId: string): string {
    const entries = eventLogStore.getState().entries;
    const eventIndex = entries.findIndex((e) => e.id === eventId);
    if (eventIndex === -1) {
      return 'Continue from restored checkpoint.';
    }

    for (let i = eventIndex; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type !== 'activation') continue;
      if (entry.activationId !== activationId) continue;
      const rawInput = entry.data.input;
      if (typeof rawInput === 'string' && rawInput.trim().length > 0) {
        return rawInput;
      }
    }

    for (let i = eventIndex; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type !== 'activation') continue;
      const rawInput = entry.data.input;
      if (typeof rawInput === 'string' && rawInput.trim().length > 0) {
        return rawInput;
      }
    }

    return 'Continue from restored checkpoint.';
  }

  async replayFromEvent(eventId: string): Promise<{ ok: boolean; message: string }> {
    if (this.state.isRunning) {
      return {
        ok: false,
        message: 'Cannot replay while a run is active. Kill or wait for current run first.',
      };
    }

    const checkpoint = eventLogStore.getState().getCheckpoint(eventId);
    if (!checkpoint) {
      return { ok: false, message: `No checkpoint found for event '${eventId}'.` };
    }

    restoreCheckpoint(checkpoint, vfsStore, agentRegistry);
    sessionStore.getState().clearAll();
    uiStore.getState().setSelectedAgent(checkpoint.agentId);
    this.setState({ lastReplayEventId: eventId });

    const replayInput = this.resolveReplayInput(eventId, checkpoint.activationId);
    eventLogStore.getState().append({
      type: 'warning',
      agentId: checkpoint.agentId,
      activationId: checkpoint.activationId,
      data: {
        message:
          `Replay started from event '${eventId}' (${checkpoint.eventType}) ` +
          `for agent '${checkpoint.agentId}'.`,
      },
    });

    await this.run(checkpoint.agentId, replayInput);
    return { ok: true, message: `Replay completed from event '${eventId}'.` };
  }
}

export const runController = new RunController();
