import { Kernel } from './kernel';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { createProvider } from './provider-factory';
import { agentRegistry, eventLogStore, sessionStore, uiStore, vfsStore, memoryStore, taskQueueStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';
import type { EventLogEntry } from '../types/events';
import { restoreCheckpoint } from '../utils/replay';
import { MemoryManager } from './memory-manager';
import { createMemoryDB } from './memory-db';
import { Summarizer, createGeminiSummarizeFn, createGeminiConsolidateFn } from './summarizer';
import { AutonomousRunner } from './autonomous-runner';
import { MCPClientManager } from './mcp-client';
import { pubSubStore, blackboardStore } from '../stores/use-stores';
import { VectorMemoryDB } from './vector-memory-db';
import { WorkflowEngine } from './workflow-engine';
import { parseWorkflow, type WorkflowDefinition } from './workflow-parser';
import { extractWorkflowVariables } from './workflow-variables';

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
  isWorkflow: boolean;
  workflowName?: string;
  workflowStepCount?: number;
  workflowCompletedSteps?: number;
}

type Listener = (state: RunControllerState) => void;

interface WorkflowResumePayload {
  variables: Record<string, string>;
  completedOutputs: Record<string, Record<string, unknown>>;
  perStepTokens: Record<string, number>;
  completedSteps: number;
}

class RunController {
  private kernel: Kernel | null = null;
  private autonomousRunner: AutonomousRunner | null = null;
  private workflowAbort: AbortController | null = null;
  private memoryManager = new MemoryManager(createMemoryDB(vfsStore));

  /** Re-create the memory DB (and manager) based on the current kernel config. */
  private async refreshMemoryManager(config: KernelConfig): Promise<void> {
    const db = createMemoryDB(vfsStore, {
      useVectorStore: config.useVectorMemory ?? false,
    });
    if (db instanceof VectorMemoryDB) {
      try {
        await db.init();
      } catch (err) {
        console.warn('[RunController] Vector memory init failed, falling back to plain memory:', err);
        const fallback = createMemoryDB(vfsStore, { useVectorStore: false });
        this.memoryManager = new MemoryManager(fallback);
        return;
      }
    }
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
    isWorkflow: false,
    workflowName: undefined,
    workflowStepCount: undefined,
    workflowCompletedSteps: undefined,
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

  private async createKernel(config: KernelConfig): Promise<Kernel> {
    const { apiKey, provider: providerType } = uiStore.getState();
    const provider = this.hasUsableApiKey(apiKey)
      ? createProvider(providerType, apiKey)
      : new ScriptedAIProvider(DEMO_SCRIPT);

    // Pre-connect global MCP servers (skips stdio with warning)
    const mcpManager = await MCPClientManager.createWithGlobalServers(
      uiStore.getState().globalMcpServers,
      eventLogStore,
    );

    const kernel = new Kernel({
      aiProvider: provider,
      vfs: vfsStore,
      agentRegistry: agentRegistry,
      eventLog: eventLogStore,
      config,
      sessionStore,
      memoryStore: config.memoryEnabled !== false ? memoryStore : undefined,
      memoryManager: config.memoryEnabled !== false ? this.memoryManager : undefined,
      mcpManager,
      apiKey,
      pubSubStore,
      blackboardStore,
      vectorStore: config.memoryEnabled !== false ? this.memoryManager.vectorStoreAdapter : undefined,
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
    await this.refreshMemoryManager(config);
    // Keep per-run session context isolated for correct summarization.
    sessionStore.getState().clearAll();
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();
    const kernel = await this.createKernel(config);
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
    await this.refreshMemoryManager(config);
    // Ensure autonomous-cycle summarization only includes this autonomous run.
    sessionStore.getState().clearAll();
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();

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
        providerType: uiStore.getState().provider,
        globalMcpServers: uiStore.getState().globalMcpServers,
        pubSubStore,
        blackboardStore,
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

  async runWorkflow(workflowPath: string, variables?: Record<string, string>): Promise<void> {
    if (this.state.isRunning) return;

    const content = vfsStore.getState().read(workflowPath);
    if (!content) return;
    const workflow = parseWorkflow(workflowPath, content);
    const requiredVars = extractWorkflowVariables(workflow);

    if (requiredVars.length > 0 && !variables) {
      uiStore.getState().setWorkflowVariableModal({
        workflowPath,
        variables: requiredVars,
        onSubmit: (values) => { this.runWorkflow(workflowPath, values); },
      });
      return;
    }

    const config = uiStore.getState().kernelConfig;
    await this.refreshMemoryManager(config);
    sessionStore.getState().clearAll();
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();

    await this.executeWorkflow({
      workflowPath,
      workflow,
      config,
      variables: variables ?? {},
    });
  }

  async resumeWorkflow(workflowPath: string): Promise<void> {
    if (this.state.isRunning) return;

    const content = vfsStore.getState().read(workflowPath);
    if (!content) return;
    const workflow = parseWorkflow(workflowPath, content);
    const resume = this.getWorkflowResumePayload(workflowPath, workflow);
    if (!resume) return;

    const config = uiStore.getState().kernelConfig;
    await this.refreshMemoryManager(config);
    sessionStore.getState().clearAll();
    pubSubStore.getState().clear();
    blackboardStore.getState().clear();

    await this.executeWorkflow({
      workflowPath,
      workflow,
      config,
      variables: resume.variables,
      resume,
    });
  }

  private findLatestFailedWorkflowEvent(workflowPath: string): EventLogEntry | null {
    const entries = eventLogStore.getState().entries;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'workflow_complete' && e.data.workflowPath === workflowPath && e.data.status === 'failed') {
        return e;
      }
    }
    return null;
  }

  private getWorkflowResumePayload(
    workflowPath: string,
    workflow: WorkflowDefinition,
  ): WorkflowResumePayload | null {
    const failedEvent = this.findLatestFailedWorkflowEvent(workflowPath);
    if (!failedEvent) return null;

    const resumeRaw = failedEvent.data.workflowResume as Record<string, unknown> | undefined;
    if (resumeRaw && typeof resumeRaw === 'object') {
      const variables = (resumeRaw.variables as Record<string, string>) ?? {};
      const completedOutputs =
        (resumeRaw.completedOutputs as Record<string, Record<string, unknown>>) ?? {};
      const perStepTokens = (resumeRaw.perStepTokens as Record<string, number>) ?? {};
      const completedStepsRaw = resumeRaw.completedSteps;
      const completedSteps = typeof completedStepsRaw === 'number'
        ? completedStepsRaw
        : Object.keys(completedOutputs).length;
      return { variables, completedOutputs, perStepTokens, completedSteps };
    }

    // Backward-compat fallback for legacy failed events.
    const variables = (failedEvent.data.variables as Record<string, string>) ?? {};
    const perStepTokens = (failedEvent.data.perStepTokens as Record<string, number>) ?? {};
    const completedStepCount = (failedEvent.data.completedSteps as number) ?? 0;
    const completedOutputs: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < completedStepCount && i < workflow.executionOrder.length; i++) {
      const stepId = workflow.executionOrder[i];
      completedOutputs[stepId] = {
        result: '[resumed from previous run]',
        tokens: perStepTokens[stepId] ?? 0,
      };
    }

    return {
      variables,
      completedOutputs,
      perStepTokens,
      completedSteps: completedStepCount,
    };
  }

  private extractLastModelMessage(kernel: Kernel): string {
    const completedSessions = kernel.completedSessions;
    if (completedSessions.length === 0) return '';
    const lastSession = completedSessions[completedSessions.length - 1];
    const lastModelMsg = [...lastSession.history].reverse().find((m) => m.role === 'model');
    return lastModelMsg?.content ?? '';
  }

  private countTokens(stepTokens: Map<string, number>): number {
    let total = 0;
    for (const t of stepTokens.values()) total += t;
    return total;
  }

  private formatWorkflowOutput(
    workflow: WorkflowDefinition,
    outputs: Record<string, Record<string, unknown>>,
    stepAgents: Map<string, string>,
    stepTokens: Map<string, number>,
    resumedFrom?: number,
  ): string {
    const totalTokens = this.countTokens(stepTokens);
    const stepSections = workflow.executionOrder.map((stepId) => {
      const agent = stepAgents.get(stepId) ?? 'unknown';
      const tokens = stepTokens.get(stepId) ?? 0;
      const output = outputs[stepId];
      const result = output?.result ?? output?.text ?? '';
      const resultText = typeof result === 'string' ? result : JSON.stringify(result);
      return `## Step: ${stepId} (agent: ${agent})\nTokens: ${tokens}\n\n${resultText}`;
    }).join('\n\n---\n\n');

    const summary = [
      '## Summary',
      `- Steps: ${workflow.executionOrder.length}/${workflow.executionOrder.length}`,
      `- Tokens: ${Math.round(totalTokens / 1000)}K`,
      ...(typeof resumedFrom === 'number' ? [`- Resumed from step: ${resumedFrom + 1}`] : []),
      '',
    ];

    return [
      '---',
      `workflow: ${workflow.name}`,
      `completed: ${new Date().toISOString()}`,
      `totalTokens: ${totalTokens}`,
      ...(typeof resumedFrom === 'number' ? ['resumed: true'] : []),
      '---',
      `# Workflow Output: ${workflow.name}${typeof resumedFrom === 'number' ? ' (Resumed)' : ''}`,
      '',
      ...summary,
      stepSections,
    ].join('\n');
  }

  private async executeWorkflow(params: {
    workflowPath: string;
    workflow: WorkflowDefinition;
    config: KernelConfig;
    variables: Record<string, string>;
    resume?: WorkflowResumePayload;
  }): Promise<void> {
    const { workflowPath, workflow, config, variables, resume } = params;
    const abort = new AbortController();
    this.workflowAbort = abort;

    const stepTokens = new Map<string, number>();
    const stepAgents = new Map<string, string>(workflow.steps.map((s) => [s.id, s.agent]));
    if (resume) {
      for (const [stepId, tokens] of Object.entries(resume.perStepTokens)) {
        if (workflow.executionOrder.includes(stepId)) {
          stepTokens.set(stepId, tokens);
        }
      }
    }

    const stepCount = workflow.executionOrder.length;
    this.setState({
      isRunning: true,
      isPaused: false,
      isWorkflow: true,
      workflowName: workflow.name,
      workflowStepCount: stepCount,
      workflowCompletedSteps: resume?.completedSteps ?? 0,
      totalTokens: this.countTokens(stepTokens),
    });

    eventLogStore.getState().append({
      type: 'workflow_start',
      agentId: 'system',
      activationId: 'system',
      data: {
        workflowPath,
        name: workflow.name,
        stepCount,
        resumed: Boolean(resume),
        resumedFrom: resume?.completedSteps ?? 0,
      },
    });

    const engine = new WorkflowEngine({
      maxParallelSteps: config.workflowMaxParallelSteps ?? 1,
      runStep: async (stepId, prompt, agentPath, _context) => {
        eventLogStore.getState().append({
          type: 'workflow_step',
          agentId: agentPath,
          activationId: 'system',
          data: { stepId, workflowPath, agentPath, status: 'running' },
        });

        try {
          stepAgents.set(stepId, agentPath);
          sessionStore.getState().clearAll();
          const kernel = await this.createKernel(config);
          kernel.enqueue({
            agentId: agentPath,
            input: prompt,
            spawnDepth: 0,
            priority: 0,
          });
          await kernel.runUntilEmpty();

          const tokens = kernel.totalTokens;
          stepTokens.set(stepId, tokens);

          const totalTokens = this.countTokens(stepTokens);
          const completed = (this.state.workflowCompletedSteps ?? 0) + 1;
          this.setState({
            workflowCompletedSteps: completed,
            totalTokens,
            activeCount: 0,
            queueCount: 0,
          });

          const resultText = this.extractLastModelMessage(kernel);
          eventLogStore.getState().append({
            type: 'workflow_step',
            agentId: agentPath,
            activationId: 'system',
            data: { stepId, workflowPath, agentPath, status: 'completed', tokens },
          });

          return { result: resultText };
        } catch (err) {
          eventLogStore.getState().append({
            type: 'workflow_step',
            agentId: agentPath,
            activationId: 'system',
            data: {
              stepId,
              workflowPath,
              agentPath,
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw err;
        }
      },
    });

    try {
      const outputs = resume
        ? await engine.resumeFrom(workflow, variables, resume.completedOutputs, abort.signal)
        : await engine.execute(workflow, variables, abort.signal);

      const totalTokens = this.countTokens(stepTokens);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = `outputs/${workflow.name.replace(/\s+/g, '-').toLowerCase()}-${timestamp}.md`;
      const outputContent = this.formatWorkflowOutput(
        workflow,
        outputs,
        stepAgents,
        stepTokens,
        resume?.completedSteps,
      );
      vfsStore.getState().write(outputPath, outputContent, {
        authorAgentId: 'system',
        activationId: 'system',
      });

      const perStepTokens: Record<string, number> = {};
      for (const [id, t] of stepTokens) perStepTokens[id] = t;

      eventLogStore.getState().append({
        type: 'workflow_complete',
        agentId: 'system',
        activationId: 'system',
        data: {
          workflowPath,
          name: workflow.name,
          status: 'completed',
          totalTokens,
          perStepTokens,
          outputPath,
          completedSteps: workflow.executionOrder.length,
          totalSteps: workflow.executionOrder.length,
          resumed: Boolean(resume),
          workflowResume: {
            variables,
            completedOutputs: outputs,
            perStepTokens,
            completedSteps: workflow.executionOrder.length,
          },
        },
      });

      uiStore.getState().openFileInEditor(outputPath);
    } catch (err) {
      const perStepTokens: Record<string, number> = {};
      for (const [id, t] of stepTokens) perStepTokens[id] = t;

      const status = engine.getStatus();
      const outputs = engine.getOutputs();
      const completedOutputs: Record<string, Record<string, unknown>> = {};
      const completedStepIds: string[] = [];
      let failedStepId: string | undefined;

      for (const stepId of workflow.executionOrder) {
        const stepStatus = status[stepId];
        if (stepStatus === 'completed' && outputs[stepId]) {
          completedStepIds.push(stepId);
          completedOutputs[stepId] = outputs[stepId];
        } else if (stepStatus === 'failed' && !failedStepId) {
          failedStepId = stepId;
        }
      }

      const totalTokens = this.countTokens(stepTokens);
      const completedSteps = completedStepIds.length;
      eventLogStore.getState().append({
        type: 'workflow_complete',
        agentId: 'system',
        activationId: 'system',
        data: {
          workflowPath,
          name: workflow.name,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          totalTokens,
          perStepTokens,
          completedSteps,
          totalSteps: workflow.executionOrder.length,
          variables,
          failedStepId,
          resumableFromStep: Math.min(completedSteps + 1, workflow.executionOrder.length),
          workflowResume: {
            variables,
            completedOutputs,
            perStepTokens,
            completedSteps,
          },
        },
      });
    } finally {
      this.workflowAbort = null;
      this.setState({
        isRunning: false,
        isPaused: false,
        isWorkflow: false,
        workflowName: undefined,
        workflowStepCount: undefined,
        workflowCompletedSteps: undefined,
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
      isWorkflow: false,
      workflowName: undefined,
      workflowStepCount: undefined,
      workflowCompletedSteps: undefined,
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
