import { createStore } from 'zustand/vanilla';
import type { SessionStatus, ToolCallRecord } from '../types/kernel';
import type { StreamChunk } from '../types/ai-provider';
import type { ChatMessage, LiveSession } from '../types/session';

export interface SessionStoreState {
  sessions: Map<string, LiveSession>;
  openSession(agentId: string, activationId: string): void;
  appendChunk(activationId: string, chunk: StreamChunk): void;
  addUserMessage(activationId: string, content: string): void;
  addToolResult(activationId: string, toolCallId: string, toolName: string, result: string): void;
  updateStatus(activationId: string, status: SessionStatus): void;
  closeSession(activationId: string, status: SessionStatus): void;
  getSessionForAgent(agentId: string): LiveSession | undefined;
  clearAll(): void;
}

export function createSessionStore() {
  return createStore<SessionStoreState>((set, get) => ({
    sessions: new Map<string, LiveSession>(),

    openSession(agentId: string, activationId: string): void {
      const session: LiveSession = {
        agentId,
        activationId,
        status: 'running',
        messages: [],
        streamingText: '',
        toolCalls: [],
        tokenCount: 0,
        startedAt: Date.now(),
      };
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, session);
        return { sessions: next };
      });
    },

    appendChunk(activationId: string, chunk: StreamChunk): void {
      const session = get().sessions.get(activationId);
      if (!session) return;

      switch (chunk.type) {
        case 'text': {
          const updated: LiveSession = {
            ...session,
            streamingText: session.streamingText + (chunk.text ?? ''),
          };
          set((state) => {
            const next = new Map(state.sessions);
            next.set(activationId, updated);
            return { sessions: next };
          });
          break;
        }

        case 'tool_call': {
          if (!chunk.toolCall) break;
          const now = Date.now();
          const toolRecord: ToolCallRecord = {
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            args: chunk.toolCall.args,
            result: '',
            timestamp: now,
          };
          const toolMessage: ChatMessage = {
            role: 'tool',
            content: `Tool call: ${chunk.toolCall.name}`,
            timestamp: now,
            toolCall: toolRecord,
          };
          const updated: LiveSession = {
            ...session,
            toolCalls: [...session.toolCalls, toolRecord],
            messages: [...session.messages, toolMessage],
          };
          set((state) => {
            const next = new Map(state.sessions);
            next.set(activationId, updated);
            return { sessions: next };
          });
          break;
        }

        case 'done': {
          const messages = [...session.messages];
          if (session.streamingText) {
            messages.push({
              role: 'assistant',
              content: session.streamingText,
              timestamp: Date.now(),
            });
          }
          const updated: LiveSession = {
            ...session,
            streamingText: '',
            messages,
            tokenCount: chunk.tokenCount ?? session.tokenCount,
          };
          set((state) => {
            const next = new Map(state.sessions);
            next.set(activationId, updated);
            return { sessions: next };
          });
          break;
        }

        case 'error': {
          const errorMessage: ChatMessage = {
            role: 'assistant',
            content: chunk.error ?? 'Unknown error',
            timestamp: Date.now(),
          };
          const updated: LiveSession = {
            ...session,
            status: 'error',
            messages: [...session.messages, errorMessage],
          };
          set((state) => {
            const next = new Map(state.sessions);
            next.set(activationId, updated);
            return { sessions: next };
          });
          break;
        }
      }
    },

    addUserMessage(activationId: string, content: string): void {
      const session = get().sessions.get(activationId);
      if (!session) return;

      const message: ChatMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      const updated: LiveSession = {
        ...session,
        messages: [...session.messages, message],
      };
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    addToolResult(activationId: string, toolCallId: string, toolName: string, result: string): void {
      const session = get().sessions.get(activationId);
      if (!session) return;

      const toolRecord: ToolCallRecord = {
        id: toolCallId,
        name: toolName,
        args: {},
        result,
        timestamp: Date.now(),
      };
      const message: ChatMessage = {
        role: 'tool',
        content: result,
        timestamp: Date.now(),
        toolCall: toolRecord,
      };
      const updated: LiveSession = {
        ...session,
        messages: [...session.messages, message],
      };
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    updateStatus(activationId: string, status: SessionStatus): void {
      const session = get().sessions.get(activationId);
      if (!session) return;

      const updated: LiveSession = { ...session, status };
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    closeSession(activationId: string, status: SessionStatus): void {
      const session = get().sessions.get(activationId);
      if (!session) return;

      const messages = [...session.messages];
      // Flush any remaining streamingText before closing
      if (session.streamingText) {
        messages.push({
          role: 'assistant',
          content: session.streamingText,
          timestamp: Date.now(),
        });
      }

      const updated: LiveSession = {
        ...session,
        status,
        messages,
        streamingText: '',
        completedAt: Date.now(),
      };
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    getSessionForAgent(agentId: string): LiveSession | undefined {
      let mostRecent: LiveSession | undefined;
      for (const session of get().sessions.values()) {
        if (session.agentId === agentId) {
          if (!mostRecent || session.startedAt >= mostRecent.startedAt) {
            mostRecent = session;
          }
        }
      }
      return mostRecent;
    },

    clearAll(): void {
      set({ sessions: new Map() });
    },
  }));
}
