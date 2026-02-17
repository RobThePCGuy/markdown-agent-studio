# Real-time Run Experience & Settings Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the kernel runtime to the UI so agents come alive during execution, and add a settings modal for configuration.

**Architecture:** New `sessionStore` (Zustand vanilla) acts as reactive bridge - kernel pushes session state in, UI components subscribe out. Graph nodes derive status from sessionStore. ChatLog renders terminal-style streaming output. Settings modal reads/writes uiStore.

**Tech Stack:** React 19, Zustand 5, @xyflow/react, Monaco Editor, Vitest

---

### Task 1: Create Session Store - Types and Tests

**Files:**
- Create: `src/types/session.ts`
- Create: `src/stores/session-store.ts`
- Create: `src/stores/session-store.test.ts`

**Step 1: Define session types**

Create `src/types/session.ts`:

```typescript
import type { SessionStatus, ToolCallRecord } from './kernel';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: ToolCallRecord;
}

export interface LiveSession {
  agentId: string;
  activationId: string;
  status: SessionStatus;
  messages: ChatMessage[];
  streamingText: string;
  toolCalls: ToolCallRecord[];
  tokenCount: number;
  startedAt: number;
  completedAt?: number;
}
```

**Step 2: Export from types barrel**

In `src/types/index.ts`, add:

```typescript
export * from './session';
```

**Step 3: Write failing tests**

Create `src/stores/session-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionStore } from './session-store';

describe('sessionStore', () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore();
  });

  it('opens a session', () => {
    store.getState().openSession('agent-a', 'act-1');
    const session = store.getState().sessions.get('act-1');
    expect(session).toBeDefined();
    expect(session!.agentId).toBe('agent-a');
    expect(session!.status).toBe('running');
    expect(session!.messages).toHaveLength(0);
    expect(session!.streamingText).toBe('');
  });

  it('appends text chunks to streamingText', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().appendChunk('act-1', { type: 'text', text: 'Hello ' });
    store.getState().appendChunk('act-1', { type: 'text', text: 'world' });
    const session = store.getState().sessions.get('act-1')!;
    expect(session.streamingText).toBe('Hello world');
  });

  it('flushes streamingText to message on done', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().appendChunk('act-1', { type: 'text', text: 'Response text' });
    store.getState().appendChunk('act-1', { type: 'done', tokenCount: 42 });
    const session = store.getState().sessions.get('act-1')!;
    expect(session.streamingText).toBe('');
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('assistant');
    expect(session.messages[0].content).toBe('Response text');
    expect(session.tokenCount).toBe(42);
  });

  it('records tool calls', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().appendChunk('act-1', {
      type: 'tool_call',
      toolCall: { id: 'tc-1', name: 'vfs_read', args: { path: 'test.md' } },
    });
    const session = store.getState().sessions.get('act-1')!;
    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0].name).toBe('vfs_read');
  });

  it('records error chunks', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().appendChunk('act-1', { type: 'error', error: 'API failed' });
    const session = store.getState().sessions.get('act-1')!;
    expect(session.status).toBe('error');
    expect(session.messages.at(-1)?.content).toBe('Error: API failed');
  });

  it('adds a user message', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().addUserMessage('act-1', 'Do the thing');
    const session = store.getState().sessions.get('act-1')!;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('Do the thing');
  });

  it('adds a tool result message', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().addToolResult('act-1', {
      id: 'tc-1', name: 'vfs_read', args: { path: 'f.md' }, result: 'file contents', timestamp: 1,
    });
    const session = store.getState().sessions.get('act-1')!;
    expect(session.messages.at(-1)?.role).toBe('tool');
    expect(session.messages.at(-1)?.toolCall?.name).toBe('vfs_read');
  });

  it('closes a session', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().closeSession('act-1', 'completed');
    const session = store.getState().sessions.get('act-1')!;
    expect(session.status).toBe('completed');
    expect(session.completedAt).toBeGreaterThan(0);
  });

  it('clears all sessions', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().openSession('agent-b', 'act-2');
    store.getState().clearAll();
    expect(store.getState().sessions.size).toBe(0);
  });

  it('getSessionForAgent returns most recent activation', () => {
    store.getState().openSession('agent-a', 'act-1');
    store.getState().closeSession('act-1', 'completed');
    store.getState().openSession('agent-a', 'act-2');
    const session = store.getState().getSessionForAgent('agent-a');
    expect(session?.activationId).toBe('act-2');
  });

  it('ignores chunks for unknown sessions', () => {
    // Should not throw
    store.getState().appendChunk('nonexistent', { type: 'text', text: 'hello' });
    expect(store.getState().sessions.size).toBe(0);
  });
});
```

**Step 4: Run tests to verify they fail**

Run: `npx vitest run src/stores/session-store.test.ts`
Expected: FAIL - module not found

**Step 5: Implement session store**

Create `src/stores/session-store.ts`:

```typescript
import { createStore } from 'zustand/vanilla';
import type { SessionStatus, ToolCallRecord } from '../types/kernel';
import type { StreamChunk } from '../types/ai-provider';
import type { LiveSession, ChatMessage } from '../types/session';

export interface SessionStoreState {
  sessions: Map<string, LiveSession>;
  openSession(agentId: string, activationId: string): void;
  appendChunk(activationId: string, chunk: StreamChunk): void;
  addUserMessage(activationId: string, content: string): void;
  addToolResult(activationId: string, record: ToolCallRecord): void;
  updateStatus(activationId: string, status: SessionStatus): void;
  closeSession(activationId: string, finalStatus: SessionStatus): void;
  getSessionForAgent(agentId: string): LiveSession | undefined;
  clearAll(): void;
}

export function createSessionStore() {
  return createStore<SessionStoreState>((set, get) => ({
    sessions: new Map(),

    openSession(agentId: string, activationId: string): void {
      set((state) => {
        const next = new Map(state.sessions);
        next.set(activationId, {
          agentId,
          activationId,
          status: 'running',
          messages: [],
          streamingText: '',
          toolCalls: [],
          tokenCount: 0,
          startedAt: Date.now(),
        });
        return { sessions: next };
      });
    },

    appendChunk(activationId: string, chunk: StreamChunk): void {
      set((state) => {
        const session = state.sessions.get(activationId);
        if (!session) return state;

        const updated = { ...session };
        const next = new Map(state.sessions);

        switch (chunk.type) {
          case 'text':
            updated.streamingText += chunk.text ?? '';
            break;

          case 'tool_call':
            if (chunk.toolCall) {
              updated.toolCalls = [...updated.toolCalls, {
                id: chunk.toolCall.id,
                name: chunk.toolCall.name,
                args: chunk.toolCall.args,
                result: '',
                timestamp: Date.now(),
              }];
              updated.messages = [...updated.messages, {
                role: 'tool' as const,
                content: `Calling ${chunk.toolCall.name}...`,
                timestamp: Date.now(),
                toolCall: {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.name,
                  args: chunk.toolCall.args,
                  result: '',
                  timestamp: Date.now(),
                },
              }];
            }
            break;

          case 'done': {
            if (updated.streamingText) {
              updated.messages = [...updated.messages, {
                role: 'assistant' as const,
                content: updated.streamingText,
                timestamp: Date.now(),
              }];
              updated.streamingText = '';
            }
            if (chunk.tokenCount) {
              updated.tokenCount = chunk.tokenCount;
            }
            break;
          }

          case 'error':
            updated.status = 'error';
            updated.messages = [...updated.messages, {
              role: 'assistant' as const,
              content: `Error: ${chunk.error}`,
              timestamp: Date.now(),
            }];
            break;
        }

        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    addUserMessage(activationId: string, content: string): void {
      set((state) => {
        const session = state.sessions.get(activationId);
        if (!session) return state;
        const next = new Map(state.sessions);
        next.set(activationId, {
          ...session,
          messages: [...session.messages, {
            role: 'user' as const,
            content,
            timestamp: Date.now(),
          }],
        });
        return { sessions: next };
      });
    },

    addToolResult(activationId: string, record: ToolCallRecord): void {
      set((state) => {
        const session = state.sessions.get(activationId);
        if (!session) return state;
        const next = new Map(state.sessions);
        next.set(activationId, {
          ...session,
          messages: [...session.messages, {
            role: 'tool' as const,
            content: record.result,
            timestamp: record.timestamp,
            toolCall: record,
          }],
        });
        return { sessions: next };
      });
    },

    updateStatus(activationId: string, status: SessionStatus): void {
      set((state) => {
        const session = state.sessions.get(activationId);
        if (!session) return state;
        const next = new Map(state.sessions);
        next.set(activationId, { ...session, status });
        return { sessions: next };
      });
    },

    closeSession(activationId: string, finalStatus: SessionStatus): void {
      set((state) => {
        const session = state.sessions.get(activationId);
        if (!session) return state;
        const next = new Map(state.sessions);
        const updated = { ...session, status: finalStatus, completedAt: Date.now() };
        // Flush any remaining streamingText
        if (updated.streamingText) {
          updated.messages = [...updated.messages, {
            role: 'assistant' as const,
            content: updated.streamingText,
            timestamp: Date.now(),
          }];
          updated.streamingText = '';
        }
        next.set(activationId, updated);
        return { sessions: next };
      });
    },

    getSessionForAgent(agentId: string): LiveSession | undefined {
      const sessions = [...get().sessions.values()]
        .filter((s) => s.agentId === agentId)
        .sort((a, b) => b.startedAt - a.startedAt);
      return sessions[0];
    },

    clearAll(): void {
      set({ sessions: new Map() });
    },
  }));
}
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/stores/session-store.test.ts`
Expected: All 10 tests PASS

**Step 7: Commit**

```bash
git add src/types/session.ts src/types/index.ts src/stores/session-store.ts src/stores/session-store.test.ts
git commit -m "feat: add session store with tests for real-time run tracking"
```

---

### Task 2: Register Session Store as Singleton and Hook

**Files:**
- Modify: `src/stores/use-stores.ts`

**Step 1: Add session store singleton and hook**

In `src/stores/use-stores.ts`, add the import and singleton:

```typescript
import { createSessionStore, type SessionStoreState } from './session-store';

// Add after eventLogStore:
export const sessionStore = createSessionStore();

// Add after useUI:
export function useSessionStore<T>(selector: (state: SessionStoreState) => T): T {
  return useStore(sessionStore, selector);
}
```

**Step 2: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: register session store singleton and React hook"
```

---

### Task 3: Wire Kernel to Session Store

**Files:**
- Modify: `src/core/kernel.ts`
- Modify: `src/hooks/useKernel.ts`
- Modify: `src/core/kernel.test.ts`

**Step 1: Add sessionStore to KernelDeps**

In `src/core/kernel.ts`, add to imports:

```typescript
import type { SessionStoreState } from '../stores/session-store';
```

Add to `KernelDeps` interface:

```typescript
sessionStore?: Store<SessionStoreState>;
```

**Step 2: Add session store calls in kernel**

In `Kernel.runSession()`, after `this.activeSessions.set(activation.id, session)` (line 152), add:

```typescript
this.deps.sessionStore?.getState().openSession(activation.agentId, activation.id);
this.deps.sessionStore?.getState().addUserMessage(activation.id, activation.input);
```

After `this.deps.onStreamChunk?.(activation.agentId, chunk)` (line 203), add:

```typescript
this.deps.sessionStore?.getState().appendChunk(activation.id, chunk);
```

After each tool call result is pushed to session.history (after line 235), add:

```typescript
this.deps.sessionStore?.getState().addToolResult(activation.id, record);
```

In the `finally` block (line 299), before `release()`, add:

```typescript
this.deps.sessionStore?.getState().closeSession(activation.id, session.status);
```

In `killAll()`, after setting `session.status = 'aborted'` (line 69), add:

```typescript
this.deps.sessionStore?.getState().closeSession(session.activationId, 'aborted');
```

**Step 3: Wire sessionStore in useKernel hook**

In `src/hooks/useKernel.ts`, add import:

```typescript
import { sessionStore } from '../stores/use-stores';
```

In `createKernel`, add `sessionStore` to the Kernel constructor deps object:

```typescript
const kernel = new Kernel({
  aiProvider: provider,
  vfs: vfsStore,
  registry: agentRegistry,
  eventLog: eventLogStore,
  config,
  sessionStore,
  onSessionUpdate: () => {
    setTotalTokens(kernel.totalTokens);
    setActiveCount(kernel.activeSessionCount);
    setQueueCount(kernel.queueLength);
  },
});
```

**Step 4: Run existing kernel tests**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: All existing tests PASS (sessionStore is optional, so no breakage)

**Step 5: Commit**

```bash
git add src/core/kernel.ts src/hooks/useKernel.ts src/core/kernel.test.ts
git commit -m "feat: wire session store into kernel for real-time state broadcasting"
```

---

### Task 4: Live Graph Nodes - Status from Session Store

**Files:**
- Modify: `src/hooks/useGraphData.ts`

**Step 1: Subscribe to session store and derive status**

Replace `src/hooks/useGraphData.ts` contents:

```typescript
import { useMemo } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { useAgentRegistry, useEventLog, useSessionStore } from '../stores/use-stores';

export function useGraphData() {
  const agentsMap = useAgentRegistry((s) => s.agents);
  const entries = useEventLog((s) => s.entries);
  const sessions = useSessionStore((s) => s.sessions);

  return useMemo(() => {
    const agents = [...agentsMap.values()];

    // Build a map of agentId -> most recent session status
    const statusMap = new Map<string, { status: string; tokenCount: number }>();
    for (const session of sessions.values()) {
      const existing = statusMap.get(session.agentId);
      if (!existing || session.startedAt > (existing as any)._startedAt) {
        (statusMap as any).set(session.agentId, {
          status: session.status,
          tokenCount: session.tokenCount,
          _startedAt: session.startedAt,
        });
      }
    }

    const nodes: Node[] = agents.map((agent, i) => {
      const live = statusMap.get(agent.path);
      return {
        id: agent.path,
        type: 'agentNode',
        position: { x: i * 200, y: 100 },
        data: {
          label: agent.name,
          path: agent.path,
          status: live?.status ?? 'idle',
          tokenCount: live?.tokenCount ?? 0,
        },
      };
    });

    const edges: Edge[] = [];
    const spawnEvents = entries.filter((e) => e.type === 'spawn');
    for (const evt of spawnEvents) {
      const spawned = evt.data.spawned as string;
      if (spawned && nodes.some((n) => n.id === spawned)) {
        edges.push({
          id: `edge-${evt.agentId}-${spawned}`,
          source: evt.agentId,
          target: spawned,
          animated: true,
          style: { stroke: '#89b4fa' },
        });
      }
    }

    return { nodes, edges };
  }, [agentsMap, entries, sessions]);
}
```

Wait - the `_startedAt` hack is ugly. Cleaner version for the status derivation:

```typescript
// Build a map of agentId -> most recent session
const latestByAgent = new Map<string, { status: string; tokenCount: number; startedAt: number }>();
for (const session of sessions.values()) {
  const existing = latestByAgent.get(session.agentId);
  if (!existing || session.startedAt > existing.startedAt) {
    latestByAgent.set(session.agentId, {
      status: session.status,
      tokenCount: session.tokenCount,
      startedAt: session.startedAt,
    });
  }
}
```

Then use `latestByAgent.get(agent.path)` when building nodes.

**Step 2: Commit**

```bash
git add src/hooks/useGraphData.ts
git commit -m "feat: derive graph node status from session store"
```

---

### Task 5: AgentNode Pulse Animation and Token Display

**Files:**
- Modify: `src/components/graph/AgentNode.tsx`

**Step 1: Add pulse animation and token count**

Replace `src/components/graph/AgentNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface AgentNodeData {
  label: string;
  path: string;
  status: string;
  tokenCount?: number;
}

const statusColors: Record<string, string> = {
  running: '#a6e3a1',
  idle: '#6c7086',
  error: '#f38ba8',
  aborted: '#fab387',
  completed: '#89dceb',
  paused: '#f9e2af',
};

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const color = statusColors[d.status] ?? '#6c7086';
  const isRunning = d.status === 'running';
  const tokens = d.tokenCount ?? 0;

  return (
    <div style={{
      background: '#1e1e2e',
      border: `2px solid ${color}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 120,
      color: '#cdd6f4',
      fontSize: 12,
      transition: 'border-color 300ms ease',
      animation: isRunning ? 'agentPulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
      <div style={{ fontSize: 10, opacity: 0.6 }}>{d.status}</div>
      {tokens > 0 && (
        <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2 }}>
          {tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : tokens} tokens
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 2: Add CSS keyframes**

In `src/main.tsx` (or a global CSS file if one exists), inject this style. Since the app uses inline styles, add a `<style>` tag in `main.tsx` or create `src/styles/animations.css`:

Create `src/styles/animations.css`:

```css
@keyframes agentPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(166, 227, 161, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(166, 227, 161, 0.3); }
}
```

Import in `src/main.tsx`:

```typescript
import './styles/animations.css';
```

**Step 3: Commit**

```bash
git add src/components/graph/AgentNode.tsx src/styles/animations.css src/main.tsx
git commit -m "feat: add pulse animation and token display to agent nodes"
```

---

### Task 6: Fix GraphView Reactivity

**Files:**
- Modify: `src/components/graph/GraphView.tsx`

**Step 1: Make graph reactive to session changes**

The current `GraphView` uses `useNodesState(initialNodes)` which captures the initial value and never updates. Replace with a reactive approach:

```tsx
import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode } from './AgentNode';
import { useGraphData } from '../../hooks/useGraphData';
import { uiStore } from '../../stores/use-stores';

const nodeTypes: NodeTypes = {
  agentNode: AgentNode as any,
};

export function GraphView() {
  const { nodes: derivedNodes, edges: derivedEdges } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(derivedEdges);

  // Sync derived data into React Flow state
  useEffect(() => {
    setNodes((prev) =>
      derivedNodes.map((dn) => {
        const existing = prev.find((n) => n.id === dn.id);
        return existing
          ? { ...existing, data: dn.data }  // preserve position, update data
          : dn;
      })
    );
  }, [derivedNodes, setNodes]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  const onNodeClick = useCallback((_: any, node: any) => {
    uiStore.getState().setSelectedAgent(node.id);
  }, []);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        style={{ background: '#11111b' }}
      >
        <Background color="#313244" gap={20} />
        <Controls />
        <MiniMap
          nodeColor="#45475a"
          maskColor="rgba(0,0,0,0.5)"
          style={{ background: '#1e1e2e' }}
        />
      </ReactFlow>
    </div>
  );
}
```

The key fix: `useEffect` syncs `derivedNodes` into React Flow's internal state whenever sessionStore changes, but preserves user-dragged positions by only updating `data` on existing nodes.

**Step 2: Commit**

```bash
git add src/components/graph/GraphView.tsx
git commit -m "feat: make graph view reactive to session state changes"
```

---

### Task 7: Terminal-style ChatLog

**Files:**
- Modify: `src/components/inspector/ChatLog.tsx`

**Step 1: Rewrite ChatLog with terminal aesthetic**

Replace `src/components/inspector/ChatLog.tsx`:

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChatMessage } from '../../types/session';
import type { ToolCallRecord } from '../../types/kernel';

interface Props {
  agentId: string;
  messages: ChatMessage[];
  streamingText: string;
}

const roleColors: Record<string, string> = {
  user: '#74c7ec',
  assistant: '#a6e3a1',
  tool: '#cba6f7',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function ToolCallEntry({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const preview = toolCall.result.length > 200
    ? toolCall.result.slice(0, 200) + '...'
    : toolCall.result;

  return (
    <div
      style={{ cursor: 'pointer', opacity: 0.8 }}
      onClick={() => setExpanded(!expanded)}
    >
      <span style={{ color: '#cba6f7' }}>
        {'> tool_call: '}{toolCall.name}({JSON.stringify(toolCall.args)})
      </span>
      {toolCall.result && (
        <div style={{ color: '#a6adc8', marginLeft: 16, marginTop: 2 }}>
          {'> result: '}
          {expanded ? (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {toolCall.result}
            </span>
          ) : (
            <span>({toolCall.result.length} chars) [click to expand]</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatLog({ agentId, messages, streamingText }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Auto-scroll when stickToBottom is true
  useEffect(() => {
    if (stickToBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingText, stickToBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setStickToBottom(atBottom);
  }, []);

  const hasContent = messages.length > 0 || streamingText;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.5,
        background: '#1e1e2e',
        color: '#cdd6f4',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: '#89b4fa', opacity: 0.7 }}>
        {agentId}
      </div>

      {!hasContent && (
        <div style={{ opacity: 0.3, fontSize: 12 }}>
          Run an agent to see output here
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          {msg.role === 'tool' && msg.toolCall ? (
            <ToolCallEntry toolCall={msg.toolCall} />
          ) : (
            <>
              <span style={{ color: '#585b70', marginRight: 8 }}>
                [{formatTime(msg.timestamp)}]
              </span>
              <span style={{ color: roleColors[msg.role] ?? '#cdd6f4' }}>
                {msg.role} {'> '}
              </span>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.content}
              </span>
            </>
          )}
        </div>
      ))}

      {streamingText && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#585b70', marginRight: 8 }}>
            [{formatTime(Date.now())}]
          </span>
          <span style={{ color: roleColors.assistant }}>
            assistant {'> '}
          </span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {streamingText}
          </span>
          <span style={{ animation: 'blink 1s step-end infinite' }}>|</span>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add blink animation**

In `src/styles/animations.css`, append:

```css
@keyframes blink {
  50% { opacity: 0; }
}
```

**Step 3: Commit**

```bash
git add src/components/inspector/ChatLog.tsx src/styles/animations.css
git commit -m "feat: rewrite ChatLog with terminal-style streaming display"
```

---

### Task 8: Wire InspectorPanel to Session Store

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`

**Step 1: Connect real session data**

Replace `src/components/inspector/InspectorPanel.tsx`:

```tsx
import { useUI, useSessionStore } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);

  if (!selectedAgentId) {
    return <EventLogView />;
  }

  // Find most recent session for this agent
  let latestSession;
  for (const session of sessions.values()) {
    if (session.agentId === selectedAgentId) {
      if (!latestSession || session.startedAt > latestSession.startedAt) {
        latestSession = session;
      }
    }
  }

  return (
    <ChatLog
      agentId={selectedAgentId}
      messages={latestSession?.messages ?? []}
      streamingText={latestSession?.streamingText ?? ''}
    />
  );
}
```

**Step 2: Commit**

```bash
git add src/components/inspector/InspectorPanel.tsx
git commit -m "feat: wire InspectorPanel to session store for live ChatLog data"
```

---

### Task 9: Settings Modal Component

**Files:**
- Create: `src/components/settings/SettingsModal.tsx`

**Step 1: Add settingsOpen to uiStore**

In `src/stores/use-stores.ts`, add to `UIState` interface:

```typescript
settingsOpen: boolean;
setSettingsOpen: (open: boolean) => void;
```

Add to the `createStore` initial state:

```typescript
settingsOpen: false,
setSettingsOpen: (open) => set({ settingsOpen: open }),
```

**Step 2: Build the Settings Modal**

Create `src/components/settings/SettingsModal.tsx`:

```tsx
import { useEffect, useCallback, useState } from 'react';
import { useUI, uiStore } from '../../stores/use-stores';
import { DEFAULT_KERNEL_CONFIG } from '../../types/kernel';

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const apiKey = useUI((s) => s.apiKey);
  const config = useUI((s) => s.kernelConfig);

  const [showKey, setShowKey] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');

  const close = useCallback(() => {
    uiStore.getState().setSettingsOpen(false);
    setClearConfirm('');
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  if (!open) return null;

  const setConfig = uiStore.getState().setKernelConfig;
  const setApiKey = uiStore.getState().setApiKey;

  const handleClearWorkspace = () => {
    if (clearConfirm === 'CLEAR') {
      // These will be imported from use-stores
      const { vfsStore, agentRegistry, eventLogStore, sessionStore } = require('../../stores/use-stores');
      vfsStore.getState().clear();
      agentRegistry.getState().clear();
      eventLogStore.getState().clear();
      sessionStore.getState().clearAll();
      setClearConfirm('');
      close();
    }
  };

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#313244',
          borderRadius: 12,
          padding: 24,
          width: 480,
          maxHeight: '80vh',
          overflow: 'auto',
          color: '#cdd6f4',
          fontSize: 13,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Settings</h2>
          <button
            onClick={close}
            style={{ background: 'none', border: 'none', color: '#6c7086', fontSize: 18, cursor: 'pointer' }}
          >
            X
          </button>
        </div>

        {/* API Configuration */}
        <Section title="API Configuration">
          <Label text="API Key">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                style={inputStyle({ flex: 1 })}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                style={smallBtnStyle}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Label>
          <Label text="Model">
            <select
              value={config.model ?? 'gemini-2.0-flash'}
              onChange={(e) => setConfig({ model: e.target.value } as any)}
              style={inputStyle({})}
            >
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            </select>
          </Label>
        </Section>

        <Divider />

        {/* Kernel Limits */}
        <Section title="Kernel Limits">
          <Label text="Max Concurrency">
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxConcurrency}
              onChange={(e) => setConfig({ maxConcurrency: Number(e.target.value) })}
              style={inputStyle({})}
            />
          </Label>
          <Label text="Max Depth">
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxDepth}
              onChange={(e) => setConfig({ maxDepth: Number(e.target.value) })}
              style={inputStyle({})}
            />
          </Label>
          <Label text="Max Fanout">
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxFanout}
              onChange={(e) => setConfig({ maxFanout: Number(e.target.value) })}
              style={inputStyle({})}
            />
          </Label>
          <Label text="Token Budget">
            <input
              type="number"
              min={50000}
              step={50000}
              value={config.tokenBudget}
              onChange={(e) => setConfig({ tokenBudget: Number(e.target.value) })}
              style={inputStyle({})}
            />
          </Label>
        </Section>

        <Divider />

        {/* Danger Zone */}
        <Section title="Danger Zone">
          <div style={{ padding: 12, border: '1px solid #f38ba8', borderRadius: 8 }}>
            <div style={{ fontSize: 12, marginBottom: 8, color: '#f38ba8' }}>
              Clear all workspace data (files, agents, logs, sessions).
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder='Type "CLEAR" to confirm'
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                style={inputStyle({ flex: 1 })}
              />
              <button
                onClick={handleClearWorkspace}
                disabled={clearConfirm !== 'CLEAR'}
                style={{
                  ...smallBtnStyle,
                  background: clearConfirm === 'CLEAR' ? '#f38ba8' : '#45475a',
                  color: clearConfirm === 'CLEAR' ? '#1e1e2e' : '#6c7086',
                  cursor: clearConfirm === 'CLEAR' ? 'pointer' : 'not-allowed',
                }}
              >
                Clear Workspace
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#89b4fa' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#a6adc8', marginBottom: 4 }}>{text}</div>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid #45475a', margin: '16px 0' }} />;
}

function inputStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    background: '#1e1e2e',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 12,
    outline: 'none',
    ...extra,
  };
}

const smallBtnStyle: React.CSSProperties = {
  background: '#45475a',
  color: '#cdd6f4',
  border: 'none',
  borderRadius: 4,
  padding: '6px 12px',
  fontSize: 11,
  cursor: 'pointer',
};
```

Note: The `handleClearWorkspace` uses `require()` as a quick approach. In the actual implementation, import the stores at the top of the file instead:

```typescript
import { useUI, uiStore, vfsStore, agentRegistry, eventLogStore, sessionStore } from '../../stores/use-stores';
```

And call `.getState().clear()` / `.getState().clearAll()` directly.

**Step 3: Commit**

```bash
git add src/stores/use-stores.ts src/components/settings/SettingsModal.tsx
git commit -m "feat: add settings modal with API config, kernel limits, and danger zone"
```

---

### Task 10: Add Gear Icon to TopBar and Mount Modal

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/AppLayout.tsx` (or wherever the root render is)

**Step 1: Add gear icon to TopBar**

In `src/components/layout/TopBar.tsx`, add import:

```typescript
import { uiStore } from '../../stores/use-stores';
```

After the token count `<span>` (before the closing `</div>`), add:

```tsx
<button
  onClick={() => uiStore.getState().setSettingsOpen(true)}
  style={{
    background: 'none',
    border: 'none',
    color: '#6c7086',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
    marginLeft: 4,
  }}
  title="Settings"
>
  &#9881;
</button>
```

**Step 2: Mount SettingsModal at app root**

In `src/components/layout/AppLayout.tsx` (or wherever the top-level layout component is), add:

```tsx
import { SettingsModal } from '../settings/SettingsModal';
```

And render `<SettingsModal />` inside the return, outside the main layout structure (so it renders as a fixed overlay):

```tsx
return (
  <>
    {/* existing layout */}
    <SettingsModal />
  </>
);
```

**Step 3: Commit**

```bash
git add src/components/layout/TopBar.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: add gear icon to TopBar and mount settings modal"
```

---

### Task 11: Add Model Field to KernelConfig and UIState

**Files:**
- Modify: `src/types/kernel.ts`
- Modify: `src/stores/use-stores.ts`

The settings modal has a model dropdown, but `KernelConfig` doesn't have a `model` field yet. We need to add it so it flows through to the AI provider.

**Step 1: Add model to KernelConfig**

In `src/types/kernel.ts`, add to the `KernelConfig` interface:

```typescript
model?: string;
```

And to `DEFAULT_KERNEL_CONFIG`:

```typescript
model: 'gemini-2.0-flash',
```

**Step 2: Verify the Gemini provider uses the model**

Check that `GeminiProvider.chat()` reads `config.model` from the `AgentConfig` passed in. The kernel already passes `model: profile.model` from the agent profile. For a global default, update `useKernel.ts` to pass `config.model` as a fallback when the agent profile doesn't specify one. This is optional and can be done in a follow-up.

**Step 3: Commit**

```bash
git add src/types/kernel.ts
git commit -m "feat: add model field to KernelConfig for settings modal"
```

---

### Task 12: localStorage Persistence for API Key and Settings

**Files:**
- Modify: `src/stores/use-stores.ts`

**Step 1: Load from localStorage on init, save on change**

In `src/stores/use-stores.ts`, update the uiStore creation:

```typescript
// Before creating uiStore, load persisted values
const persistedApiKey = localStorage.getItem('mas-api-key') ?? import.meta.env.VITE_GEMINI_API_KEY ?? '';
const persistedConfig = (() => {
  try {
    const raw = localStorage.getItem('mas-kernel-config');
    return raw ? { ...DEFAULT_KERNEL_CONFIG, ...JSON.parse(raw) } : DEFAULT_KERNEL_CONFIG;
  } catch {
    return DEFAULT_KERNEL_CONFIG;
  }
})();
```

Update the initial values:

```typescript
apiKey: persistedApiKey,
kernelConfig: persistedConfig,
```

Update the setters to persist:

```typescript
setApiKey: (key) => {
  localStorage.setItem('mas-api-key', key);
  set({ apiKey: key });
},
setKernelConfig: (partial) => set((s) => {
  const next = { ...s.kernelConfig, ...partial };
  localStorage.setItem('mas-kernel-config', JSON.stringify(next));
  return { kernelConfig: next };
}),
```

**Step 2: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: persist API key and kernel config to localStorage"
```

---

### Task 13: Integration Smoke Test

**Files:**
- Create: `src/components/inspector/ChatLog.test.tsx` (optional, if testing setup supports React component tests)

**Step 1: Manual smoke test checklist**

Run: `npm run dev`

Verify:
1. App loads without errors
2. Graph shows agent nodes with "idle" status
3. Click gear icon in TopBar - settings modal opens
4. Enter API key, change model, adjust limits - all save immediately
5. Close modal with X, Escape, or clicking backdrop
6. Reload page - settings persist
7. Run an agent (with mock or real API key):
   - Graph nodes turn green with pulse animation
   - ChatLog shows streaming text with blinking cursor
   - Tool calls appear as collapsible entries
   - After completion, node turns cyan ("completed")
   - Token count shows on node
8. Click different agent nodes - ChatLog switches to that agent's session
9. Kill All - nodes turn orange ("aborted")

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete real-time run experience and settings modal"
```
