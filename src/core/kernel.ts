import type { AIProvider, Activation, AgentSession, KernelConfig, StreamChunk } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { SessionStoreState } from '../stores/session-store';
import { Semaphore } from './semaphore';
import { ToolHandler } from './tool-handler';
import { AGENT_TOOLS } from './tools';
import { computeHash } from '../utils/vfs-helpers';

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

interface KernelDeps {
  aiProvider: AIProvider;
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  config: KernelConfig;
  sessionStore?: Store<SessionStoreState>;
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

  constructor(deps: KernelDeps) {
    this.deps = deps;
    this.semaphore = new Semaphore(deps.config.maxConcurrency);
    this.globalController = new AbortController();
  }

  get isPaused(): boolean { return this._paused; }
  get totalTokens(): number { return this._totalTokens; }
  get completedSessions(): AgentSession[] { return this._completedSessions; }
  get activeSessionCount(): number { return this.activeSessions.size; }
  get queueLength(): number { return this.queue.length; }

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
    this.globalController = new AbortController();
  }

  killSession(activationId: string): void {
    const session = this.activeSessions.get(activationId);
    if (session) {
      session.controller.abort();
      session.status = 'aborted';
      this._completedSessions.push(session);
      this.activeSessions.delete(activationId);
    }
  }

  async runUntilEmpty(): Promise<void> {
    await this.processQueue();

    // Wait for all active sessions to complete
    while (this.activeSessions.size > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
      if (!this._paused) {
        await this.processQueue();
      }
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
        this.deps.eventLog.getState().append({
          type: 'warning',
          agentId: activation.agentId,
          activationId: activation.id,
          data: { message: 'Token budget exceeded, pausing' },
        });
        this.queue.unshift(activation);
        this.pause();
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

    const profile = this.deps.registry.getState().get(activation.agentId);
    if (!profile) {
      session.status = 'error';
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      release();
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      return;
    }

    const toolHandler = new ToolHandler({
      vfs: this.deps.vfs,
      registry: this.deps.registry,
      eventLog: this.deps.eventLog,
      onSpawnActivation: (act) => this.enqueue(act),
      currentAgentId: activation.agentId,
      currentActivationId: activation.id,
      parentAgentId: activation.parentId,
      spawnDepth: activation.spawnDepth,
      maxDepth: this.deps.config.maxDepth,
      maxFanout: this.deps.config.maxFanout,
      childCount: this.childCounts.get(activation.agentId) ?? 0,
    });

    try {
      let textAccumulator = '';
      let noProgressStrikes = 0;
      let madeProgress = false;

      const stream = this.deps.aiProvider.chat(
        { sessionId: activation.id, systemPrompt: profile.systemPrompt, model: profile.model },
        session.history,
        AGENT_TOOLS
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
              // Wait for resume between tool calls
              await this.waitForResume(controller.signal);
              if (controller.signal.aborted) {
                session.status = 'aborted';
                break;
              }
            }

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
            this.deps.sessionStore?.getState().addToolResult(activation.id, record.id, record.name, record.result);
            madeProgress = true;

            // Track child spawns
            if (tc.name === 'spawn_agent') {
              const count = this.childCounts.get(activation.agentId) ?? 0;
              this.childCounts.set(activation.agentId, count + 1);
            }
            break;
          }

          case 'done':
            if (chunk.tokenCount) {
              session.tokenCount = chunk.tokenCount;
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

      if (textAccumulator) {
        session.history.push({ role: 'model', content: textAccumulator });
      }

      if (session.status === 'running') {
        if (!madeProgress) {
          noProgressStrikes++;
          if (noProgressStrikes >= 2) {
            this.deps.eventLog.getState().append({
              type: 'warning',
              agentId: activation.agentId,
              activationId: activation.id,
              data: { message: 'Agent halted: no progress after 2 consecutive steps' },
            });
          }
        }
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
      this.deps.eventLog.getState().append({
        type: 'error',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      this.deps.sessionStore?.getState().closeSession(activation.id, session.status);
      release();
      this.deps.onSessionUpdate?.(session);

      // Try to process more from queue
      if (!this._paused) {
        this.processQueue();
      }
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
}
