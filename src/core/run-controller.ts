import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { agentRegistry, eventLogStore, sessionStore, uiStore, vfsStore, memoryStore, taskQueueStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';
import type { EventLogEntry } from '../types/events';
import { restoreCheckpoint } from '../utils/replay';
import { MemoryManager } from './memory-manager';
import { createMemoryDB } from './memory-db';
import { Summarizer, createGeminiSummarizeFn, createGeminiConsolidateFn } from './summarizer';
import { AutonomousRunner } from './autonomous-runner';
import { MCPClientManager } from './mcp-client';
import { WorkflowEngine } from './workflow-engine';
import { parseWorkflow } from './workflow-parser';
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

class RunController {
  private kernel: Kernel | null = null;
  private autonomousRunner: AutonomousRunner | null = null;
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
    const apiKey = uiStore.getState().apiKey;
    const provider = this.hasUsableApiKey(apiKey)
      ? new GeminiProvider(apiKey)
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
        globalMcpServers: uiStore.getState().globalMcpServers,
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

    // 1. Read and parse workflow
    const content = vfsStore.getState().readFile(workflowPath);
    if (!content) return;
    const workflow = parseWorkflow(workflowPath, content);

    // 2. Extract variables
    const requiredVars = extractWorkflowVariables(workflow);

    // 3. If variables needed but not provided, show modal and return
    if (requiredVars.length > 0 && !variables) {
      uiStore.getState().setWorkflowVariableModal({
        workflowPath,
        variables: requiredVars,
        onSubmit: (values) => { this.runWorkflow(workflowPath, values); },
      });
      return;
    }

    const config = uiStore.getState().kernelConfig;
    this.refreshMemoryManager(config);
    sessionStore.getState().clearAll();

    // 4. Set running state
    const stepCount = workflow.executionOrder.length;
    this.setState({
      isRunning: true,
      isPaused: false,
      isWorkflow: true,
      workflowName: workflow.name,
      workflowStepCount: stepCount,
      workflowCompletedSteps: 0,
      totalTokens: 0,
    });

    // Emit workflow_start event
    eventLogStore.getState().append({
      type: 'workflow_start',
      agentId: 'system',
      activationId: 'system',
      data: { workflowPath, name: workflow.name, stepCount },
    });

    // 5. Track per-step tokens
    const stepTokens = new Map<string, number>();
    const stepAgents = new Map<string, string>();

    // 6. Create engine with runStep callback
    const engine = new WorkflowEngine({
      runStep: async (stepId, prompt, agentPath, _context) => {
        // Emit step event
        eventLogStore.getState().append({
          type: 'workflow_step',
          agentId: agentPath,
          activationId: 'system',
          data: { stepId, workflowPath, agentPath },
        });

        stepAgents.set(stepId, agentPath);

        // Create fresh kernel for this step
        sessionStore.getState().clearAll();
        const kernel = await this.createKernel(config);
        kernel.enqueue({
          agentId: agentPath,
          input: prompt,
          spawnDepth: 0,
          priority: 0,
        });

        await kernel.runUntilEmpty();

        // Track tokens
        const tokens = kernel.totalTokens;
        stepTokens.set(stepId, tokens);

        // Update total tokens (sum all step tokens)
        let totalTokens = 0;
        for (const t of stepTokens.values()) totalTokens += t;

        const completed = (this.state.workflowCompletedSteps ?? 0) + 1;
        this.setState({
          workflowCompletedSteps: completed,
          totalTokens,
          activeCount: 0,
          queueCount: 0,
        });

        // Extract last model message from completed sessions
        const completedSessions = kernel.completedSessions;
        let resultText = '';
        if (completedSessions.length > 0) {
          const lastSession = completedSessions[completedSessions.length - 1];
          const lastModelMsg = [...lastSession.history]
            .reverse()
            .find((m) => m.role === 'model');
          if (lastModelMsg) {
            resultText = lastModelMsg.content;
          }
        }

        return { result: resultText };
      },
    });

    try {
      // 7. Execute workflow
      const outputs = await engine.execute(workflow, variables ?? {});

      // 8. Write output file
      let totalTokens = 0;
      for (const t of stepTokens.values()) totalTokens += t;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = `outputs/${workflow.name.replace(/\s+/g, '-').toLowerCase()}-${timestamp}.md`;

      const stepSections = workflow.executionOrder.map((stepId) => {
        const agent = stepAgents.get(stepId) ?? 'unknown';
        const tokens = stepTokens.get(stepId) ?? 0;
        const output = outputs[stepId];
        const resultText = output?.result ?? '';
        return `## Step: ${stepId} (agent: ${agent})\nTokens: ${tokens}\n\n${resultText}`;
      }).join('\n\n---\n\n');

      const outputContent = [
        '---',
        `workflow: ${workflow.name}`,
        `completed: ${new Date().toISOString()}`,
        `totalTokens: ${totalTokens}`,
        '---',
        `# Workflow Output: ${workflow.name}`,
        '',
        '## Summary',
        `- Steps: ${workflow.executionOrder.length}/${workflow.executionOrder.length}`,
        `- Tokens: ${Math.round(totalTokens / 1000)}K`,
        '',
        stepSections,
      ].join('\n');

      vfsStore.getState().writeFile(outputPath, outputContent);

      // 9. Emit workflow_complete event
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
        },
      });

      // 10. Open output in editor
      uiStore.getState().openFileInEditor(outputPath);

    } catch (err) {
      // On failure, emit workflow_complete with status 'failed'
      const perStepTokens: Record<string, number> = {};
      for (const [id, t] of stepTokens) perStepTokens[id] = t;

      // Collect completed step statuses for potential resume
      const statuses = engine.getStatus();
      const completedStepIds: string[] = [];
      for (const [stepId, status] of Object.entries(statuses)) {
        if (status === 'completed') {
          completedStepIds.push(stepId);
        }
      }

      let totalTokens = 0;
      for (const t of stepTokens.values()) totalTokens += t;

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
          completedSteps: this.state.workflowCompletedSteps ?? 0,
          totalSteps: workflow.executionOrder.length,
          variables: variables ?? {},
        },
      });
    } finally {
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

  async resumeWorkflow(workflowPath: string): Promise<void> {
    if (this.state.isRunning) return;

    // Find the most recent failed workflow_complete event for this path
    const entries = eventLogStore.getState().entries;
    let failedEvent: EventLogEntry | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'workflow_complete' && e.data.workflowPath === workflowPath && e.data.status === 'failed') {
        failedEvent = e;
        break;
      }
    }
    if (!failedEvent) return;

    // Extract variables and completed step data from the failed event
    const variables = (failedEvent.data.variables as Record<string, string>) ?? {};

    // Read and parse the workflow
    const content = vfsStore.getState().readFile(workflowPath);
    if (!content) return;
    const workflow = parseWorkflow(workflowPath, content);

    const config = uiStore.getState().kernelConfig;
    this.refreshMemoryManager(config);
    sessionStore.getState().clearAll();

    // Determine which steps were completed
    const statuses = failedEvent.data.perStepTokens as Record<string, number> | undefined;
    const completedStepCount = (failedEvent.data.completedSteps as number) ?? 0;
    const completedOutputs: Record<string, Record<string, unknown>> = {};

    // Build completed outputs from the execution order up to completedStepCount
    for (let i = 0; i < completedStepCount && i < workflow.executionOrder.length; i++) {
      const stepId = workflow.executionOrder[i];
      completedOutputs[stepId] = { result: '[resumed from previous run]', tokens: statuses?.[stepId] ?? 0 };
    }

    const stepCount = workflow.executionOrder.length;
    this.setState({
      isRunning: true,
      isPaused: false,
      isWorkflow: true,
      workflowName: workflow.name,
      workflowStepCount: stepCount,
      workflowCompletedSteps: completedStepCount,
      totalTokens: 0,
    });

    eventLogStore.getState().append({
      type: 'workflow_start',
      agentId: 'system',
      activationId: 'system',
      data: { workflowPath, name: workflow.name, stepCount, resumed: true, resumedFrom: completedStepCount },
    });

    const stepTokens = new Map<string, number>();
    const stepAgents = new Map<string, string>();

    // Pre-populate token tracking for completed steps
    if (statuses) {
      for (const [stepId, tokens] of Object.entries(statuses)) {
        if (stepId in completedOutputs) {
          stepTokens.set(stepId, tokens);
        }
      }
    }

    const engine = new WorkflowEngine({
      runStep: async (stepId, prompt, agentPath, _context) => {
        eventLogStore.getState().append({
          type: 'workflow_step',
          agentId: agentPath,
          activationId: 'system',
          data: { stepId, workflowPath, agentPath },
        });

        stepAgents.set(stepId, agentPath);
        sessionStore.getState().clearAll();
        const kernel = await this.createKernel(config);
        kernel.enqueue({ agentId: agentPath, input: prompt, spawnDepth: 0, priority: 0 });
        await kernel.runUntilEmpty();

        const tokens = kernel.totalTokens;
        stepTokens.set(stepId, tokens);
        let totalTokens = 0;
        for (const t of stepTokens.values()) totalTokens += t;

        const completed = (this.state.workflowCompletedSteps ?? 0) + 1;
        this.setState({ workflowCompletedSteps: completed, totalTokens, activeCount: 0, queueCount: 0 });

        const completedSessions = kernel.completedSessions;
        let resultText = '';
        if (completedSessions.length > 0) {
          const lastSession = completedSessions[completedSessions.length - 1];
          const lastModelMsg = [...lastSession.history].reverse().find((m) => m.role === 'model');
          if (lastModelMsg) resultText = lastModelMsg.content;
        }
        return { result: resultText };
      },
    });

    try {
      const outputs = await engine.resumeFrom(workflow, variables, completedOutputs);

      // Write output (same format as runWorkflow)
      let totalTokens = 0;
      for (const t of stepTokens.values()) totalTokens += t;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = `outputs/${workflow.name.replace(/\s+/g, '-').toLowerCase()}-${timestamp}.md`;

      const stepSections = workflow.executionOrder.map((stepId) => {
        const agent = stepAgents.get(stepId) ?? 'unknown';
        const tokens = stepTokens.get(stepId) ?? 0;
        const output = outputs[stepId];
        const resultText = output?.result ?? '';
        return `## Step: ${stepId} (agent: ${agent})\nTokens: ${tokens}\n\n${resultText}`;
      }).join('\n\n---\n\n');

      const outputContent = [
        '---', `workflow: ${workflow.name}`, `completed: ${new Date().toISOString()}`,
        `totalTokens: ${totalTokens}`, `resumed: true`, '---',
        `# Workflow Output: ${workflow.name} (Resumed)`, '',
        '## Summary', `- Steps: ${stepCount}/${stepCount}`,
        `- Tokens: ${Math.round(totalTokens / 1000)}K`, `- Resumed from step: ${completedStepCount + 1}`, '',
        stepSections,
      ].join('\n');

      vfsStore.getState().writeFile(outputPath, outputContent);

      const perStepTokens: Record<string, number> = {};
      for (const [id, t] of stepTokens) perStepTokens[id] = t;

      eventLogStore.getState().append({
        type: 'workflow_complete', agentId: 'system', activationId: 'system',
        data: { workflowPath, name: workflow.name, status: 'completed', totalTokens, perStepTokens, outputPath, completedSteps: stepCount, totalSteps: stepCount, resumed: true },
      });

      uiStore.getState().openFileInEditor(outputPath);
    } catch (err) {
      const perStepTokens: Record<string, number> = {};
      for (const [id, t] of stepTokens) perStepTokens[id] = t;
      let totalTokens = 0;
      for (const t of stepTokens.values()) totalTokens += t;

      eventLogStore.getState().append({
        type: 'workflow_complete', agentId: 'system', activationId: 'system',
        data: { workflowPath, name: workflow.name, status: 'failed', error: err instanceof Error ? err.message : String(err), totalTokens, perStepTokens, completedSteps: this.state.workflowCompletedSteps ?? 0, totalSteps: stepCount, variables },
      });
    } finally {
      this.setState({ isRunning: false, isPaused: false, isWorkflow: false, workflowName: undefined, workflowStepCount: undefined, workflowCompletedSteps: undefined });
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
