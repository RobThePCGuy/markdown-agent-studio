# Real-time Run Experience & Settings Modal Design

**Date:** 2026-02-16
**Branch:** feat/markdown-agent-studio
**Approach:** A - "Expose & Connect" (sessionStore as reactive bridge)

## Overview

Wire the existing kernel runtime to the UI so agents come alive during execution. Add a settings modal for API key, model selection, and kernel configuration. The kernel already tracks sessions, streams from Gemini, and emits events - the work is connecting that state to React components through a new Zustand store.

## 1. Session Store

New Zustand store that the kernel writes to and UI components subscribe to.

### Shape

```typescript
interface SessionState {
  sessions: Map<string, LiveSession>;
  openSession(agentId: string, activationId: string): void;
  appendChunk(activationId: string, chunk: StreamChunk): void;
  updateStatus(activationId: string, status: SessionStatus): void;
  closeSession(activationId: string, finalStatus: SessionStatus): void;
  clearAll(): void;
}

interface LiveSession {
  agentId: string;
  activationId: string;
  status: SessionStatus;        // running | paused | completed | aborted | error
  messages: ChatMessage[];       // full conversation history
  streamingText: string;         // current incomplete assistant response
  toolCalls: ToolCallRecord[];   // tool calls with results
  tokenCount: number;
  startedAt: number;
  completedAt?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCall?: ToolCallRecord;     // if role=tool, the call that produced this
}
```

### Kernel Integration

Kernel receives sessionStore at construction (same pattern as vfsStore and eventLogStore):

- `runSession()` start: `sessionStore.openSession(agentId, activationId)`
- Each stream chunk: `sessionStore.appendChunk(activationId, chunk)` - accumulates text, records tool calls, updates token count
- Session end: `sessionStore.closeSession(activationId, finalStatus)`
- `killAll()`: iterate sessions, close each with 'aborted'

No changes to kernel's internal logic - just adding store calls at the same points where it already appends to the event log.

## 2. Live Graph Nodes

### useGraphData.ts Changes

- Subscribe to sessionStore
- When building nodes, look up `sessions.get(agentId)` for each agent
- If a live session exists, use its `.status` for the node
- If no session, default to `'idle'`
- Return `tokenCount` from live session for node display

### AgentNode.tsx Changes

- Subtle CSS pulse animation on border when status is `'running'` (soft glow, 1.5s cycle)
- Display token count below label when > 0
- CSS transition on border-color (300ms) for smooth status changes

### GraphView.tsx Changes

- Replace `useNodesState` with direct `nodes` prop from useGraphData so it re-renders on session changes

### Visual States (Catppuccin Mocha palette)

| Status    | Border Color       | Animation    |
|-----------|--------------------|--------------|
| idle      | #6c7086 (overlay1) | none         |
| running   | #a6e3a1 (green)    | subtle pulse |
| paused    | #f9e2af (yellow)   | none         |
| completed | #89dceb (sky)      | none         |
| error     | #f38ba8 (red)      | none         |
| aborted   | #fab387 (peach)    | none         |

## 3. Terminal-style ChatLog

### Data Flow

- InspectorPanel reads `selectedAgentId` from uiStore
- Looks up `sessionStore.sessions.get(selectedAgentId)` for the LiveSession
- Passes `session.messages`, `session.streamingText`, and `session.toolCalls` to ChatLog

### Rendering Format

```
[12:34:05] user > What are the key themes in chapter 3?
[12:34:06] assistant > I'll analyze chapter 3 for recurring themes...
           (streaming text appears here, character by character)
[12:34:08] > tool_call: vfs_read({ path: "chapters/03.md" })
           > result: (1,247 chars) [click to expand]
[12:34:10] assistant > Based on my analysis, the key themes are:
           1. Identity and belonging
           2. The tension between...
```

### Behaviors

- Monospace font, Catppuccin Mocha background (#1e1e2e)
- Role prefixes: `user >` (sapphire #74c7ec), `assistant >` (green #a6e3a1), tool calls (mauve #cba6f7)
- Timestamps in dim overlay text (#585b70)
- `streamingText` renders at bottom with blinking cursor
- Tool calls inline as collapsible rows (collapsed by default, 200 char preview)
- Auto-scroll to bottom with "stick to bottom" behavior (stop if user scrolls up, re-enable when they scroll to bottom)
- No markdown rendering - raw text, terminal aesthetic
- Empty state: dim placeholder "Run an agent to see output here"

## 4. Settings Modal

### Trigger

Gear icon in TopBar (right side). Opens modal via `settingsOpen: boolean` in uiStore.

### Layout

- Dark overlay backdrop (semi-transparent black)
- Centered card (~500px wide), Catppuccin surface0 (#313244) background
- Close on X button, Escape key, or backdrop click

### Sections

**API Configuration:**
- API Key: password input with show/hide toggle. Stored in uiStore, persisted to localStorage.
- Model: dropdown select. Options: gemini-2.0-flash (default), gemini-2.0-flash-lite, gemini-2.5-pro.

**Kernel Limits:**
- Max concurrency: number input (default 3, range 1-10)
- Max depth: number input (default 5, range 1-20)
- Max fanout: number input (default 5, range 1-20)
- Token budget: number input (default 500000, step 50000)

**Danger Zone:**
- "Clear Workspace" button (red). Requires typing CLEAR to confirm.

### Behavior

- All settings take effect immediately (no save button)
- API key validated on blur with lightweight test call (green checkmark or red X)
- Changing concurrency mid-run: takes effect on next semaphore acquire
- Changing model mid-run: only affects new sessions

## 5. Error Handling

- Streaming failure mid-response: session status -> 'error', ChatLog shows red error message, node turns red
- Depth/fanout/loop guard hit: event logged, ChatLog shows yellow warning
- Missing API key on Run: toast notification "Set your API key in Settings", auto-open settings modal
- Token budget exceeded: kernel pauses (existing behavior), TopBar shows "Budget exceeded - paused" in yellow
- Multiple activations of same agent: sessionStore keyed by activationId, node shows most recent activation's status
- Rapid status changes: CSS transitions (300ms) smooth out visual flicker

## 6. Testing

- Unit tests for sessionStore (open/append/close lifecycle)
- Unit test for useGraphData with mock sessionStore (verify status derivation)
- Integration test: mock kernel run -> verify ChatLog renders streaming content
- Settings modal: render test, verify inputs write to uiStore
