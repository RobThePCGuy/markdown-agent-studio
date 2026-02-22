import type { AIProvider, Activation, AgentSession, KernelConfig, StreamChunk } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { SessionStoreState } from '../stores/session-store';
import { Semaphore } from './semaphore';
import { ToolHandler } from './tool-handler';
import { ToolPluginRegistry } from './tool-plugin';
import { createBuiltinRegistry } from './plugins';
import { createCustomToolPlugin } from './plugins/custom-tool-plugin';
import { computeHash } from '../utils/vfs-helpers';
import { resolvePolicyForInput } from '../utils/parse-agent';
import { createMemoryStore, type MemoryStoreState } from '../stores/memory-store';
import type { TaskQueueState } from '../stores/task-queue-store';
import type { MemoryManager } from './memory-manager';

const WORKSPACE_PREAMBLE =
  'You are an agent in a multi-agent workspace with access to a virtual filesystem and shared memory.\n' +
  'Always write final deliverables, reports, and code as files using vfs_write -- these persist across runs.\n' +
  'Use memory_write only for temporary inter-agent coordination during a run (it is cleared when the run ends).\n' +
  'When stuck on a complex sub-problem, use spawn_agent to create a specialist sub-agent for focused research.\n';

const TOOL_FAILURE_PATTERNS = [
  /^error:/i,
  /not found/i,
  /policy blocked/i,
  /permission denied/i,
  /failed to/i,
  /invalid/i,
];

function isToolFailure(result: string): boolean {
  if (!result || result.trim() === '') return true;
  return TOOL_FAILURE_PATTERNS.some((p) => p.test(result));
}

function buildNudgePrompt(currentTurn: number, maxTurns: number, nudgeCount: number): string {
  const remaining = maxTurns - currentTurn;
  if (nudgeCount <= 1) {
    return (
      `You still have ${remaining} turns remaining. Review your progress so far. ` +
      'What is missing? Try a different approach or use web_search / spawn_agent to make progress.'
    );
  }
  if (nudgeCount === 2) {
    return (
      'You stopped twice without using tools. Before finishing, you MUST do at least one of: ' +
      'write your findings to a file with vfs_write, try a different approach, or spawn a sub-agent for help.'
    );
  }
  return (
    'Last chance before session ends. Write your output to a file using vfs_write ' +
    'or record what you learned with memory_write.'
  );
}

const REFLECTION_PROMPT =
  'Before this session ends, reflect on your work. Use memory_write to record:\n' +
  '- Key "session-reflection": What you accomplished and key learnings\n' +
  '- Key "mistakes": Any approaches that failed and why\n' +
  '- Key "next-steps": What remains incomplete and what to try next';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const LEGACY_GEMINI_MODEL = /^gemini-1\.5/i;
const QUOTA_ERROR_PATTERNS = [
  /quota/i,
  /rate[\s-]?limit/i,
  /\b429\b/,
  /too many requests/i,
  /resource[_\s-]?exhausted/i,
  /exceeded.*quota/i,
];

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

interface KernelDeps {
  aiProvider: AIProvider;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  config: KernelConfig;
  sessionStore?: Store<SessionStoreState>;
  memoryStore?: Store<MemoryStoreState>;
  memoryManager?: MemoryManager;
  toolRegistry?: ToolPluginRegistry;
  taskQueueStore?: Store<TaskQueueState>;
  apiKey?: string;
  onSessionUpdate?: (session: AgentSession) => void;
  onStreamChunk?: (agentId: string, chunk: StreamChunk) => void;
  onBudgetWarning?: (activationId: string) => void;
}

/** Interface for providers that support session registration (e.g. ScriptedAIProvider). */
interface SessionRegisterable {
  registerSession(sessionId: string, agentPath: string): void;
}

function hasRegisterSession(provider: AIProvider): provider is AIProvider & SessionRegisterable {
  return 'registerSession' in provider;
}

let activationCounter = 0;

export class Kernel {
  private deps: KernelDeps;
  private semaphore: Semaphore;
  private globalController: AbortController;
  private queue: Array<Activation> = [];
  private activeSessions = new Map<string, AgentSession>();
  private _completedSessions: AgentSession[] = [];
  private _paused = false;
  private _totalTokens = 0;
  private childCounts = new Map<string, number>();
  private seenHashes = new Set<string>();
  private memoryManager: MemoryManager | undefined;
  private memoryStore: Store<MemoryStoreState> | undefined;
  private _workingMemorySnapshot: import('../types/memory').WorkingMemoryEntry[] = [];
  private currentRunId: string | null = null;
  private quotaHaltTriggered = false;
  private budgetHaltTriggered = false;
  private _wrapUpInjected = false;

  constructor(deps: KernelDeps) {
    this.deps = deps;
    this.semaphore = new Semaphore(deps.config.maxConcurrency);
    this.globalController = new AbortController();
    this.memoryManager = deps.memoryManager;
    if (deps.config.memoryEnabled !== false) {
      this.memoryStore = deps.memoryStore ?? createMemoryStore();
    }
    if (!this.deps.toolRegistry) {
      this.deps.toolRegistry = createBuiltinRegistry();
    }
  }

  get isPaused(): boolean { return this._paused; }
  get totalTokens(): number { return this._totalTokens; }
  get completedSessions(): AgentSession[] { return this._completedSessions; }
  get activeSessionCount(): number { return this.activeSessions.size; }
  get queueLength(): number { return this.queue.length; }
  get lastWorkingMemorySnapshot(): import('../types/memory').WorkingMemoryEntry[] {
    return this._workingMemorySnapshot;
  }

  getActiveSession(activationId: string): AgentSession | undefined {
    return this.activeSessions.get(activationId);
  }

  enqueue(input: Omit<Activation, 'id' | 'createdAt'>): void {
    const activation: Activation = {
      ...input,
      id: `act-${++activationCounter}`,
      createdAt: Date.now(),
    };
    this.queue.push(activation);
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  pause(): void { this._paused = true; }
  resume(): void {
    this._paused = false;
    this.quotaHaltTriggered = false;
    this.budgetHaltTriggered = false;
    this.processQueue();
  }

  killAll(): void {
    this.globalController.abort();
    this._paused = true;
    for (const session of this.activeSessions.values()) {
      session.controller.abort();
      session.status = 'aborted';
      this.deps.sessionStore?.getState().closeSession(session.activationId, 'aborted');
    }
    this.activeSessions.clear();
    this.queue = [];
    this.quotaHaltTriggered = false;
    this.budgetHaltTriggered = false;
    this.globalController = new AbortController();
  }

  killSession(activationId: string): void {
    const session = this.activeSessions.get(activationId);
    if (session) {
      session.controller.abort();
      session.status = 'aborted';
      this.deps.sessionStore?.getState().closeSession(activationId, 'aborted');
      this._completedSessions.push(session);
      this.activeSessions.delete(activationId);
    }
  }

  async runUntilEmpty(): Promise<void> {
    if (this.memoryStore) {
      this.currentRunId = `run-${Date.now()}`;
      this.memoryStore.getState().initRun(this.currentRunId);
    }
    await this.processQueue();

    // Wait for all active sessions to complete.
    // If paused with queued work, return so caller can decide when to resume.
    while (true) {
      const hasActive = this.activeSessions.size > 0;
      const hasQueued = this.queue.length > 0;
      if (!hasActive && (!hasQueued || this._paused)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
      if (!this._paused) {
        await this.processQueue();
      }
    }
    if (this.memoryStore) {
      this._workingMemorySnapshot = this.memoryStore.getState().endRun();
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && !this._paused && !this.globalController.signal.aborted) {
      if (this.semaphore.available <= 0) break;

      const activation = this.queue.shift();
      if (!activation) break;

      // Loop detection
      const loopHash = computeHash(`${activation.agentId}:${activation.input}`);
      if (this.seenHashes.has(loopHash)) {
        this.deps.eventLog.getState().append({
          type: 'warning',
          agentId: activation.agentId,
          activationId: activation.id,
          data: { message: 'Loop detected, skipping activation' },
        });
        continue;
      }
      this.seenHashes.add(loopHash);

      // Token budget check
      if (this._totalTokens >= this.deps.config.tokenBudget) {
        this.queue.unshift(activation);
        this.haltForBudget(activation, 'before-start');
        break;
      }

      this.runSession(activation);
    }
  }

  private async runSession(activation: Activation): Promise<void> {
    const release = await this.semaphore.acquire();

    const controller = new AbortController();
    // Wire to global controller
    const onGlobalAbort = () => controller.abort();
    this.globalController.signal.addEventListener('abort', onGlobalAbort);

    const session: AgentSession = {
      agentId: activation.agentId,
      activationId: activation.id,
      controller,
      status: 'running',
      history: [{ role: 'user', content: activation.input }],
      toolCalls: [],
      tokenCount: 0,
    };

    this.activeSessions.set(activation.id, session);
    this.deps.onSessionUpdate?.(session);
    this.deps.sessionStore?.getState().openSession(activation.agentId, activation.id);
    this.deps.sessionStore?.getState().addUserMessage(activation.id, activation.input);

    this.deps.eventLog.getState().append({
      type: 'activation',
      agentId: activation.agentId,
      activationId: activation.id,
      data: { input: activation.input, depth: activation.spawnDepth },
    });

    const profile = this.deps.agentRegistry.getState().get(activation.agentId);
    if (!profile) {
      session.status = 'error';
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      release();
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      return;
    }

    // Build per-agent tool list (built-in + custom)
    let sessionRegistry = this.deps.toolRegistry!;
    if (profile.customTools && profile.customTools.length > 0) {
      const customPlugins = profile.customTools.map(createCustomToolPlugin);
      sessionRegistry = this.deps.toolRegistry!.cloneWith(customPlugins);
    }

    const policyResolution = resolvePolicyForInput(profile.policy, activation.input);
    if (policyResolution.escalated) {
      this.deps.eventLog.getState().append({
        type: 'warning',
        agentId: activation.agentId,
        activationId: activation.id,
        data: {
          message:
            `Task input matched frontmatter gloves_off trigger '${policyResolution.trigger}'. ` +
            'Policy escalated to gloves_off for this activation.',
        },
      });
    }

    const toolHandler = new ToolHandler({
      pluginRegistry: sessionRegistry,
      vfs: this.deps.vfs,
      agentRegistry: this.deps.agentRegistry,
      eventLog: this.deps.eventLog,
      onSpawnActivation: (act) => this.enqueue(act),
      onRunSessionAndReturn: (act) => this.runSessionAndReturn(act),
      currentAgentId: activation.agentId,
      currentActivationId: activation.id,
      parentAgentId: activation.parentId,
      spawnDepth: activation.spawnDepth,
      maxDepth: this.deps.config.maxDepth,
      maxFanout: this.deps.config.maxFanout,
      childCount: this.childCounts.get(activation.agentId) ?? 0,
      policy: policyResolution.policy,
      apiKey: this.deps.apiKey,
      preferredModel: this.resolvePreferredModel(),
      memoryStore: this.memoryStore,
      taskQueueStore: this.deps.taskQueueStore,
    });

    try {
      const MAX_AGENT_TURNS = 25;
      let nudgeCount = 0;
      const maxNudges = this.deps.config.maxNudges ?? 3;
      const minTurns = this.deps.config.minTurnsBeforeStop ?? 0;
      const toolFailures: Array<{ tool: string; args: string; error: string }> = [];
      let sessionUsedTools = false;

      // Inject workspace preamble and long-term memory context into system prompt
      let systemPrompt = WORKSPACE_PREAMBLE + '\n' + profile.systemPrompt;
      if (this.memoryManager && this.deps.config.memoryEnabled !== false) {
        try {
          const memoryContext = await this.memoryManager.buildMemoryPrompt(
            activation.agentId,
            activation.input
          );
          if (memoryContext) {
            systemPrompt = memoryContext + '\n\n' + systemPrompt;
          }
        } catch {
          // Memory injection is best-effort
        }
      }

      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        let textAccumulator = '';
        let hadToolCalls = false;

        // Register session with scripted provider if applicable
        if (hasRegisterSession(this.deps.aiProvider)) {
          this.deps.aiProvider.registerSession(activation.id, activation.agentId);
        }

        const stream = this.deps.aiProvider.chat(
          {
            sessionId: activation.id,
            systemPrompt,
            model: this.resolveSessionModel(profile.model),
          },
          session.history,
          sessionRegistry.toToolDefinitions()
        );

        for await (const chunk of stream) {
          if (controller.signal.aborted) {
            session.status = 'aborted';
            break;
          }

          this.deps.onStreamChunk?.(activation.agentId, chunk);
          this.deps.sessionStore?.getState().appendChunk(activation.id, chunk);

          switch (chunk.type) {
            case 'text':
              textAccumulator += chunk.text ?? '';
              break;

            case 'tool_call': {
              if (this._paused) {
                await this.waitForResume(controller.signal);
                if (controller.signal.aborted) {
                  session.status = 'aborted';
                  break;
                }
              }

              hadToolCalls = true;
              sessionUsedTools = true;
              const tc = chunk.toolCall!;
              const result = await toolHandler.handle(tc.name, tc.args);

              // Track tool failures
              if (isToolFailure(result)) {
                toolFailures.push({
                  tool: tc.name,
                  args: JSON.stringify(tc.args).slice(0, 200),
                  error: result.slice(0, 300),
                });
              }

              const record = {
                id: tc.id,
                name: tc.name,
                args: tc.args,
                result,
                timestamp: Date.now(),
              };
              session.toolCalls.push(record);
              session.history.push({
                role: 'tool' as const,
                content: result,
                toolCall: record,
              });
              this.deps.sessionStore?.getState().addToolResult(activation.id, record.id, record.name, record.args, record.result);

              if (tc.name === 'spawn_agent') {
                const count = this.childCounts.get(activation.agentId) ?? 0;
                this.childCounts.set(activation.agentId, count + 1);
              }
              break;
            }

            case 'done':
              if (chunk.tokenCount) {
                session.tokenCount += chunk.tokenCount;
                this._totalTokens += chunk.tokenCount;
              }
              break;

            case 'error':
              session.status = 'error';
              {
                const errorMessage = chunk.error ?? 'Unknown stream error';
                if (this.isQuotaError(errorMessage)) {
                  this.haltForQuota(activation, errorMessage);
                }
              }
              this.deps.eventLog.getState().append({
                type: 'error',
                agentId: activation.agentId,
                activationId: activation.id,
                data: { error: chunk.error },
              });
              break;
          }
        }

        // Only add model text to history when no tool calls were made.
        // When there are tool calls, the ChatSession tracks the model's text
        // internally, and adding it here would break the trailing-tool-messages
        // extraction that the provider uses for function responses.
        if (textAccumulator && !hadToolCalls) {
          session.history.push({ role: 'model', content: textAccumulator });
        }

        // Nudge system: if model stopped without tool calls too early, push it to keep going
        if (!hadToolCalls && session.status === 'running') {
          if (turn < minTurns && nudgeCount < maxNudges) {
            nudgeCount++;
            const nudge = buildNudgePrompt(turn, MAX_AGENT_TURNS, nudgeCount);
            session.history.push({ role: 'user', content: nudge });
            continue;
          }
          break;
        }

        // Exit if session errored/aborted
        if (session.status !== 'running') break;

        // Wrap-up threshold check (for autonomous mode)
        if (this.deps.onBudgetWarning && !this._wrapUpInjected) {
          const threshold = this.deps.config.wrapUpThreshold ?? 1.0;
          if (this._totalTokens >= this.deps.config.tokenBudget * threshold) {
            this._wrapUpInjected = true;
            this.deps.onBudgetWarning(activation.id);
          }
        }

        // Token budget check between turns
        if (this._totalTokens >= this.deps.config.tokenBudget) {
          this.haltForBudget(activation, 'mid-session');
          break;
        }
      }

      // Auto-record tool failures to working memory
      if ((this.deps.config.autoRecordFailures ?? true) && toolFailures.length > 0 && this.memoryStore) {
        const summary = toolFailures
          .map((f) => `- ${f.tool}(${f.args}): ${f.error}`)
          .join('\n');
        this.memoryStore.getState().write({
          key: 'tool-failures',
          value: `Tool failures detected in session:\n${summary}`,
          tags: ['mistake', 'tool-failure', 'auto-detected'],
          authorAgentId: activation.agentId,
        });
      }

      // Forced reflection: inject a reflection prompt and run one more turn
      if (
        (this.deps.config.forceReflection ?? false) &&
        sessionUsedTools &&
        session.status === 'running' &&
        this._totalTokens < this.deps.config.tokenBudget
      ) {
        session.history.push({ role: 'user', content: REFLECTION_PROMPT });
        await this.runReflectionTurn(session, activation, systemPrompt, sessionRegistry, profile.model);
      }

      if (session.status === 'running') {
        session.status = 'completed';
      }

      this.deps.eventLog.getState().append({
        type: 'complete',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { status: session.status, tokens: session.tokenCount },
      });

    } catch (err) {
      session.status = 'error';
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this.isQuotaError(errorMessage)) {
        this.haltForQuota(activation, errorMessage);
      }
      this.deps.eventLog.getState().append({
        type: 'error',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { error: errorMessage },
      });
    } finally {
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      this.deps.sessionStore?.getState().closeSession(activation.id, session.status);
      this.deps.aiProvider.endSession?.(activation.id);
      release();
      this.deps.onSessionUpdate?.(session);

      // Try to process more from queue
      if (!this._paused) {
        this.processQueue();
      }
    }
  }

  async runSessionAndReturn(activation: Omit<Activation, 'id' | 'createdAt'>): Promise<string> {
    const fullActivation: Activation = {
      ...activation,
      id: `act-${++activationCounter}`,
      createdAt: Date.now(),
    };
    const loopHash = computeHash(`${fullActivation.agentId}:${fullActivation.input}`);
    if (this.seenHashes.has(loopHash)) {
      return 'Error: Loop detected, skipping activation.';
    }
    this.seenHashes.add(loopHash);
    return this._runSessionForResult(fullActivation);
  }

  private async _runSessionForResult(activation: Activation): Promise<string> {
    // NOTE: No semaphore acquisition -- avoids deadlock when called from a
    // parent session that already holds a slot.

    const controller = new AbortController();
    const onGlobalAbort = () => controller.abort();
    this.globalController.signal.addEventListener('abort', onGlobalAbort);

    const session: AgentSession = {
      agentId: activation.agentId,
      activationId: activation.id,
      controller,
      status: 'running',
      history: [{ role: 'user', content: activation.input }],
      toolCalls: [],
      tokenCount: 0,
    };

    this.activeSessions.set(activation.id, session);
    this.deps.onSessionUpdate?.(session);
    this.deps.sessionStore?.getState().openSession(activation.agentId, activation.id);
    this.deps.sessionStore?.getState().addUserMessage(activation.id, activation.input);

    this.deps.eventLog.getState().append({
      type: 'activation',
      agentId: activation.agentId,
      activationId: activation.id,
      data: { input: activation.input, depth: activation.spawnDepth },
    });

    const profile = this.deps.agentRegistry.getState().get(activation.agentId);
    if (!profile) {
      session.status = 'error';
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      return 'Error: Agent profile not found.';
    }

    // Build per-agent tool list (built-in + custom)
    let sessionRegistry = this.deps.toolRegistry!;
    if (profile.customTools && profile.customTools.length > 0) {
      const customPlugins = profile.customTools.map(createCustomToolPlugin);
      sessionRegistry = this.deps.toolRegistry!.cloneWith(customPlugins);
    }

    const policyResolution = resolvePolicyForInput(profile.policy, activation.input);

    const toolHandler = new ToolHandler({
      pluginRegistry: sessionRegistry,
      vfs: this.deps.vfs,
      agentRegistry: this.deps.agentRegistry,
      eventLog: this.deps.eventLog,
      onSpawnActivation: (act) => this.enqueue(act),
      onRunSessionAndReturn: (act) => this.runSessionAndReturn(act),
      currentAgentId: activation.agentId,
      currentActivationId: activation.id,
      parentAgentId: activation.parentId,
      spawnDepth: activation.spawnDepth,
      maxDepth: this.deps.config.maxDepth,
      maxFanout: this.deps.config.maxFanout,
      childCount: this.childCounts.get(activation.agentId) ?? 0,
      policy: policyResolution.policy,
      apiKey: this.deps.apiKey,
      preferredModel: this.resolvePreferredModel(),
      memoryStore: this.memoryStore,
      taskQueueStore: this.deps.taskQueueStore,
    });

    let finalText = '';

    try {
      const MAX_AGENT_TURNS = 25;
      let nudgeCount = 0;
      const maxNudges = this.deps.config.maxNudges ?? 3;
      const minTurns = this.deps.config.minTurnsBeforeStop ?? 0;
      const toolFailures: Array<{ tool: string; args: string; error: string }> = [];
      let sessionUsedTools = false;

      // Inject workspace preamble and long-term memory context into system prompt
      let systemPrompt = WORKSPACE_PREAMBLE + '\n' + profile.systemPrompt;
      if (this.memoryManager && this.deps.config.memoryEnabled !== false) {
        try {
          const memoryContext = await this.memoryManager.buildMemoryPrompt(
            activation.agentId,
            activation.input
          );
          if (memoryContext) {
            systemPrompt = memoryContext + '\n\n' + systemPrompt;
          }
        } catch {
          // Memory injection is best-effort
        }
      }

      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        let textAccumulator = '';
        let hadToolCalls = false;

        // Register session with scripted provider if applicable
        if (hasRegisterSession(this.deps.aiProvider)) {
          this.deps.aiProvider.registerSession(activation.id, activation.agentId);
        }

        const stream = this.deps.aiProvider.chat(
          {
            sessionId: activation.id,
            systemPrompt,
            model: this.resolveSessionModel(profile.model),
          },
          session.history,
          sessionRegistry.toToolDefinitions()
        );

        for await (const chunk of stream) {
          if (controller.signal.aborted) {
            session.status = 'aborted';
            break;
          }

          this.deps.onStreamChunk?.(activation.agentId, chunk);
          this.deps.sessionStore?.getState().appendChunk(activation.id, chunk);

          switch (chunk.type) {
            case 'text':
              textAccumulator += chunk.text ?? '';
              break;

            case 'tool_call': {
              hadToolCalls = true;
              sessionUsedTools = true;
              const tc = chunk.toolCall!;
              const result = await toolHandler.handle(tc.name, tc.args);

              // Track tool failures
              if (isToolFailure(result)) {
                toolFailures.push({
                  tool: tc.name,
                  args: JSON.stringify(tc.args).slice(0, 200),
                  error: result.slice(0, 300),
                });
              }

              const record = {
                id: tc.id,
                name: tc.name,
                args: tc.args,
                result,
                timestamp: Date.now(),
              };
              session.toolCalls.push(record);
              session.history.push({
                role: 'tool' as const,
                content: result,
                toolCall: record,
              });
              this.deps.sessionStore?.getState().addToolResult(activation.id, record.id, record.name, record.args, record.result);

              if (tc.name === 'spawn_agent') {
                const count = this.childCounts.get(activation.agentId) ?? 0;
                this.childCounts.set(activation.agentId, count + 1);
              }
              break;
            }

            case 'done':
              if (chunk.tokenCount) {
                session.tokenCount += chunk.tokenCount;
                this._totalTokens += chunk.tokenCount;
              }
              break;

            case 'error':
              session.status = 'error';
              this.deps.eventLog.getState().append({
                type: 'error',
                agentId: activation.agentId,
                activationId: activation.id,
                data: { error: chunk.error },
              });
              break;
          }
        }

        if (textAccumulator && !hadToolCalls) {
          session.history.push({ role: 'model', content: textAccumulator });
          finalText = textAccumulator;
        }

        // Nudge system for sub-agent sessions
        if (!hadToolCalls && session.status === 'running') {
          if (turn < minTurns && nudgeCount < maxNudges) {
            nudgeCount++;
            const nudge = buildNudgePrompt(turn, MAX_AGENT_TURNS, nudgeCount);
            session.history.push({ role: 'user', content: nudge });
            continue;
          }
          break;
        }

        if (session.status !== 'running') break;

        if (this._totalTokens >= this.deps.config.tokenBudget) {
          this.haltForBudget(activation, 'mid-session');
          break;
        }
      }

      // Auto-record tool failures to working memory
      if ((this.deps.config.autoRecordFailures ?? true) && toolFailures.length > 0 && this.memoryStore) {
        const summary = toolFailures
          .map((f) => `- ${f.tool}(${f.args}): ${f.error}`)
          .join('\n');
        this.memoryStore.getState().write({
          key: 'tool-failures',
          value: `Tool failures detected in session:\n${summary}`,
          tags: ['mistake', 'tool-failure', 'auto-detected'],
          authorAgentId: activation.agentId,
        });
      }

      // Forced reflection for sub-agent sessions
      if (
        (this.deps.config.forceReflection ?? false) &&
        sessionUsedTools &&
        session.status === 'running' &&
        this._totalTokens < this.deps.config.tokenBudget
      ) {
        session.history.push({ role: 'user', content: REFLECTION_PROMPT });
        await this.runReflectionTurn(session, activation, systemPrompt, sessionRegistry, profile.model);
      }

      if (session.status === 'running') {
        session.status = 'completed';
      }

      this.deps.eventLog.getState().append({
        type: 'complete',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { status: session.status, tokens: session.tokenCount },
      });

    } catch (err) {
      session.status = 'error';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.deps.eventLog.getState().append({
        type: 'error',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { error: errorMessage },
      });
      finalText = `Error: ${errorMessage}`;
    } finally {
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      this.deps.sessionStore?.getState().closeSession(activation.id, session.status);
      this.deps.aiProvider.endSession?.(activation.id);
      this.deps.onSessionUpdate?.(session);
    }

    return finalText;
  }

  private async runReflectionTurn(
    session: AgentSession,
    activation: Activation,
    systemPrompt: string,
    sessionRegistry: ToolPluginRegistry,
    profileModel: string | undefined,
  ): Promise<void> {
    if (hasRegisterSession(this.deps.aiProvider)) {
      this.deps.aiProvider.registerSession(activation.id, activation.agentId);
    }

    const stream = this.deps.aiProvider.chat(
      {
        sessionId: activation.id,
        systemPrompt,
        model: this.resolveSessionModel(profileModel),
      },
      session.history,
      sessionRegistry.toToolDefinitions()
    );

    let textAccumulator = '';
    for await (const chunk of stream) {
      if (session.controller.signal.aborted) {
        session.status = 'aborted';
        break;
      }

      this.deps.onStreamChunk?.(activation.agentId, chunk);
      this.deps.sessionStore?.getState().appendChunk(activation.id, chunk);

      switch (chunk.type) {
        case 'text':
          textAccumulator += chunk.text ?? '';
          break;
        case 'tool_call': {
          // Allow the reflection turn to use tools (e.g. memory_write)
          const tc = chunk.toolCall!;
          const handler = new ToolHandler({
            pluginRegistry: sessionRegistry,
            vfs: this.deps.vfs,
            agentRegistry: this.deps.agentRegistry,
            eventLog: this.deps.eventLog,
            onSpawnActivation: (act) => this.enqueue(act),
            onRunSessionAndReturn: (act) => this.runSessionAndReturn(act),
            currentAgentId: activation.agentId,
            currentActivationId: activation.id,
            parentAgentId: activation.parentId,
            spawnDepth: activation.spawnDepth,
            maxDepth: this.deps.config.maxDepth,
            maxFanout: this.deps.config.maxFanout,
            childCount: this.childCounts.get(activation.agentId) ?? 0,
            policy: 'default',
            apiKey: this.deps.apiKey,
            preferredModel: this.resolvePreferredModel(),
            memoryStore: this.memoryStore,
            taskQueueStore: this.deps.taskQueueStore,
          });
          const result = await handler.handle(tc.name, tc.args);
          const record = { id: tc.id, name: tc.name, args: tc.args, result, timestamp: Date.now() };
          session.toolCalls.push(record);
          session.history.push({ role: 'tool' as const, content: result, toolCall: record });
          this.deps.sessionStore?.getState().addToolResult(activation.id, record.id, record.name, record.args, record.result);
          break;
        }
        case 'done':
          if (chunk.tokenCount) {
            session.tokenCount += chunk.tokenCount;
            this._totalTokens += chunk.tokenCount;
          }
          break;
        case 'error':
          // Don't fail the session for reflection errors
          break;
      }
    }

    if (textAccumulator) {
      session.history.push({ role: 'model', content: textAccumulator });
    }
  }

  private waitForResume(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this._paused || signal.aborted) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  /** Returns the user's explicitly configured model, or undefined if none set. */
  private resolvePreferredModel(): string | undefined {
    const configured = typeof this.deps.config.model === 'string' ? this.deps.config.model.trim() : '';
    if (configured && !LEGACY_GEMINI_MODEL.test(configured)) {
      return configured;
    }
    return undefined;
  }

  private resolveSessionModel(profileModel: string | undefined): string {
    // Settings (config) model takes priority - it's the user's explicit global choice.
    const preferred = this.resolvePreferredModel();
    if (preferred) {
      return preferred;
    }
    // Agent profile model is used as a per-agent fallback when no config model is set.
    const profile = typeof profileModel === 'string' ? profileModel.trim() : '';
    if (profile && !LEGACY_GEMINI_MODEL.test(profile)) {
      return profile;
    }
    return DEFAULT_MODEL;
  }

  private isQuotaError(message: unknown): boolean {
    if (typeof message !== 'string') return false;
    return QUOTA_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  }

  private haltForQuota(activation: Activation, errorMessage: string): void {
    if (this.quotaHaltTriggered) return;
    this.quotaHaltTriggered = true;
    this._paused = true;

    for (const [activationId, active] of this.activeSessions.entries()) {
      if (activationId !== activation.id) {
        active.controller.abort();
      }
    }

    this.deps.eventLog.getState().append({
      type: 'warning',
      agentId: activation.agentId,
      activationId: activation.id,
      data: {
        message:
          `Quota/rate-limit detected, pausing run and aborting other sessions. ` +
          `Error: ${errorMessage}`,
      },
    });
  }

  private haltForBudget(activation: Activation, phase: 'before-start' | 'mid-session'): void {
    if (this.budgetHaltTriggered) return;
    this.budgetHaltTriggered = true;
    this._paused = true;

    for (const [activationId, active] of this.activeSessions.entries()) {
      if (activationId !== activation.id) {
        active.controller.abort();
      }
    }

    const where = phase === 'before-start' ? 'before starting the next activation' : 'during an active session';
    this.deps.eventLog.getState().append({
      type: 'warning',
      agentId: activation.agentId,
      activationId: activation.id,
      data: {
        message:
          `Token budget reached (${this._totalTokens}/${this.deps.config.tokenBudget}) ${where}. ` +
          'Run paused and other sessions aborted.',
      },
    });
  }
}
