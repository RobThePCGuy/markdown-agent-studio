import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionStore } from './session-store';
import type { StreamChunk } from '../types/ai-provider';

describe('Session Store', () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore();
  });

  it('opens a session (status running, empty messages, empty streamingText)', () => {
    store.getState().openSession('agents/writer.md', 'act-1');
    const session = store.getState().sessions.get('act-1');
    expect(session).toBeDefined();
    expect(session!.agentId).toBe('agents/writer.md');
    expect(session!.activationId).toBe('act-1');
    expect(session!.status).toBe('running');
    expect(session!.messages).toEqual([]);
    expect(session!.streamingText).toBe('');
    expect(session!.toolCalls).toEqual([]);
    expect(session!.tokenCount).toBe(0);
    expect(session!.startedAt).toBeGreaterThan(0);
    expect(session!.completedAt).toBeUndefined();
  });

  it('appends text chunks to streamingText', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    const chunk1: StreamChunk = { type: 'text', text: 'Hello ' };
    const chunk2: StreamChunk = { type: 'text', text: 'world' };

    store.getState().appendChunk('act-1', chunk1);
    store.getState().appendChunk('act-1', chunk2);

    const session = store.getState().sessions.get('act-1');
    expect(session!.streamingText).toBe('Hello world');
    expect(session!.messages).toHaveLength(0);
  });

  it('flushes streamingText to message on done chunk (role: assistant)', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    store.getState().appendChunk('act-1', { type: 'text', text: 'Hello world' });
    store.getState().appendChunk('act-1', { type: 'done', tokenCount: 42 });

    const session = store.getState().sessions.get('act-1');
    expect(session!.streamingText).toBe('');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('assistant');
    expect(session!.messages[0].content).toBe('Hello world');
    expect(session!.tokenCount).toBe(42);
  });

  it('records tool calls', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    const chunk: StreamChunk = {
      type: 'tool_call',
      toolCall: { id: 'tc-1', name: 'readFile', args: { path: '/foo.txt' } },
    };
    store.getState().appendChunk('act-1', chunk);

    const session = store.getState().sessions.get('act-1');
    expect(session!.toolCalls).toHaveLength(1);
    expect(session!.toolCalls[0].name).toBe('readFile');
    expect(session!.toolCalls[0].id).toBe('tc-1');
    expect(session!.toolCalls[0].args).toEqual({ path: '/foo.txt' });
    expect(session!.toolCalls[0].result).toBe('');
    expect(session!.toolCalls[0].timestamp).toBeGreaterThan(0);

    // Also adds a message for the tool call
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('tool');
    expect(session!.messages[0].toolCall).toBeDefined();
    expect(session!.messages[0].toolCall!.name).toBe('readFile');
  });

  it('records error chunks (status -> error, adds error message)', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    const chunk: StreamChunk = { type: 'error', error: 'Something broke' };
    store.getState().appendChunk('act-1', chunk);

    const session = store.getState().sessions.get('act-1');
    expect(session!.status).toBe('error');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('assistant');
    expect(session!.messages[0].content).toBe('Something broke');
  });

  it('adds a user message', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    store.getState().addUserMessage('act-1', 'What is the meaning of life?');

    const session = store.getState().sessions.get('act-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('user');
    expect(session!.messages[0].content).toBe('What is the meaning of life?');
    expect(session!.messages[0].timestamp).toBeGreaterThan(0);
  });

  it('adds a tool result message', () => {
    store.getState().openSession('agents/writer.md', 'act-1');

    store.getState().addToolResult('act-1', 'tc-1', 'readFile', 'file contents here');

    const session = store.getState().sessions.get('act-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('tool');
    expect(session!.messages[0].content).toBe('file contents here');
    expect(session!.messages[0].toolCall).toBeDefined();
    expect(session!.messages[0].toolCall!.id).toBe('tc-1');
    expect(session!.messages[0].toolCall!.name).toBe('readFile');
    expect(session!.messages[0].toolCall!.result).toBe('file contents here');
  });

  it('closes a session (sets status and completedAt)', () => {
    store.getState().openSession('agents/writer.md', 'act-1');
    store.getState().closeSession('act-1', 'completed');

    const session = store.getState().sessions.get('act-1');
    expect(session!.status).toBe('completed');
    expect(session!.completedAt).toBeGreaterThan(0);
  });

  it('closes a session and flushes remaining streamingText', () => {
    store.getState().openSession('agents/writer.md', 'act-1');
    store.getState().appendChunk('act-1', { type: 'text', text: 'leftover text' });
    store.getState().closeSession('act-1', 'completed');

    const session = store.getState().sessions.get('act-1');
    expect(session!.streamingText).toBe('');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('assistant');
    expect(session!.messages[0].content).toBe('leftover text');
    expect(session!.status).toBe('completed');
  });

  it('clears all sessions', () => {
    store.getState().openSession('agents/writer.md', 'act-1');
    store.getState().openSession('agents/reader.md', 'act-2');
    expect(store.getState().sessions.size).toBe(2);

    store.getState().clearAll();
    expect(store.getState().sessions.size).toBe(0);
  });

  it('getSessionForAgent returns most recent activation', () => {
    store.getState().openSession('agents/writer.md', 'act-old');
    // Slightly later session for same agent
    store.getState().openSession('agents/writer.md', 'act-new');

    const session = store.getState().getSessionForAgent('agents/writer.md');
    expect(session).toBeDefined();
    expect(session!.activationId).toBe('act-new');
  });

  it('ignores chunks for unknown sessions (no throw)', () => {
    expect(() => {
      store.getState().appendChunk('nonexistent', { type: 'text', text: 'hello' });
    }).not.toThrow();

    expect(() => {
      store.getState().appendChunk('nonexistent', { type: 'done', tokenCount: 10 });
    }).not.toThrow();

    expect(() => {
      store.getState().appendChunk('nonexistent', { type: 'error', error: 'oops' });
    }).not.toThrow();

    // Store should still be empty
    expect(store.getState().sessions.size).toBe(0);
  });
});
