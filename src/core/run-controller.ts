import { Kernel } from './kernel';
import { GeminiProvider } from './gemini-provider';
import { MockAIProvider } from './mock-provider';
import { agentRegistry, eventLogStore, sessionStore, uiStore, vfsStore, memoryStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';
import { restoreCheckpoint } from '../utils/replay';
import { MemoryManager } from './memory-manager';
import { createMemoryDB } from './memory-db';
import { Summarizer, SUMMARIZER_SYSTEM_PROMPT } from './summarizer';

export interface RunControllerState {
  isRunning: boolean;
  isPaused: boolean;
  totalTokens: number;
  activeCount: number;
  queueCount: number;
  lastReplayEventId: string | null;
}

type Listener = (state: RunControllerState) => void;

class RunController {
  private kernel: Kernel | null = null;
  private memoryManager = new MemoryManager(createMemoryDB());
  private state: RunControllerState = {
    isRunning: false,
    isPaused: false,
    totalTokens: 0,
    activeCount: 0,
    queueCount: 0,
    lastReplayEventId: null,
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

  private createKernel(config: KernelConfig): Kernel {
    const apiKey = uiStore.getState().apiKey;
    const provider = apiKey && apiKey !== 'your-api-key-here'
      ? new GeminiProvider(apiKey)
      : new MockAIProvider([
          { type: 'text', text: 'Mock response (no API key configured)' },
          { type: 'done', tokenCount: 10 },
        ]);

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
        const workingSnapshot = memoryStore.getState().entries.length > 0
          ? memoryStore.getState().endRun()
          : [];
        const completedSessions = [...sessionStore.getState().sessions.values()]
          .filter((s) => s.completedAt);

        // Run summarization in background
        const apiKey = uiStore.getState().apiKey;
        if (apiKey && completedSessions.length > 0) {
          const summarizeFn = async (context: string) => {
            try {
              const { GoogleGenerativeAI } = await import('@google/generative-ai');
              const client = new GoogleGenerativeAI(apiKey);
              const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
              const result = await model.generateContent(
                SUMMARIZER_SYSTEM_PROMPT + '\n\n---\n\n' + context
              );
              const text = result.response.text();
              // Extract JSON array from response (may have markdown code fences)
              const jsonMatch = text.match(/\[[\s\S]*\]/);
              if (!jsonMatch) return [];
              return JSON.parse(jsonMatch[0]);
            } catch {
              return [];
            }
          };
          const summarizer = new Summarizer(this.memoryManager, summarizeFn);
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

  pause(): void {
    this.kernel?.pause();
    this.setState({ isPaused: true });
  }

  resume(): void {
    this.kernel?.resume();
    this.setState({ isPaused: false });
  }

  killAll(): void {
    this.kernel?.killAll();
    this.setState({
      isRunning: false,
      isPaused: false,
      activeCount: 0,
      queueCount: 0,
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
