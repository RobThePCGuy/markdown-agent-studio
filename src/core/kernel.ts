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
import type { MemoryManager } from './memory-manager';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
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
  apiKey?: string;
  onSessionUpdate?: (session: AgentSession) => void;
  onStreamChunk?: (agentId: string, chunk: StreamChunk) => void;
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
    });

    try {
      const MAX_AGENT_TURNS = 25;

      // Inject long-term memory context into system prompt
      let systemPrompt = profile.systemPrompt;
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
        if ('registerSession' in this.deps.aiProvider) {
          (this.deps.aiProvider as any).registerSession(activation.id, activation.agentId);
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
              const tc = chunk.toolCall!;
              const result = await toolHandler.handle(tc.name, tc.args);

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

        // Exit loop if no tool calls (model finished) or session errored/aborted
        if (!hadToolCalls || session.status !== 'running') break;

        // Token budget check between turns
        if (this._totalTokens >= this.deps.config.tokenBudget) {
          this.haltForBudget(activation, 'mid-session');
          break;
        }
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
    });

    let finalText = '';

    try {
      const MAX_AGENT_TURNS = 25;

      // Inject long-term memory context into system prompt
      let systemPrompt = profile.systemPrompt;
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
        if ('registerSession' in this.deps.aiProvider) {
          (this.deps.aiProvider as any).registerSession(activation.id, activation.agentId);
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
              const tc = chunk.toolCall!;
              const result = await toolHandler.handle(tc.name, tc.args);

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

        if (!hadToolCalls || session.status !== 'running') break;

        if (this._totalTokens >= this.deps.config.tokenBudget) {
          this.haltForBudget(activation, 'mid-session');
          break;
        }
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

  private resolvePreferredModel(): string {
    const configured = typeof this.deps.config.model === 'string' ? this.deps.config.model.trim() : '';
    if (configured && !LEGACY_GEMINI_MODEL.test(configured)) {
      return configured;
    }
    return DEFAULT_MODEL;
  }

  private resolveSessionModel(profileModel: string | undefined): string {
    // Settings (config) model takes priority - it's the user's explicit global choice.
    // Agent profile model is only used as a per-agent fallback when no config model is set.
    const preferred = this.resolvePreferredModel();
    if (preferred !== DEFAULT_MODEL) {
      return preferred;
    }
    const profile = typeof profileModel === 'string' ? profileModel.trim() : '';
    if (profile && !LEGACY_GEMINI_MODEL.test(profile)) {
      return profile;
    }
    return preferred;
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
