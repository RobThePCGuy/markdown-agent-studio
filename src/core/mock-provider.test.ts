import { describe, it, expect } from 'vitest';
import { MockAIProvider } from './mock-provider';

describe('MockAIProvider', () => {
  it('streams text response', async () => {
    const provider = new MockAIProvider([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);

    const chunks = [];
    for await (const chunk of provider.chat(
      { sessionId: 'test', systemPrompt: 'You are a bot' },
      [],
      []
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toBe('Hello ');
    expect(chunks[2].type).toBe('done');
  });

  it('streams tool call', async () => {
    const provider = new MockAIProvider([
      { type: 'tool_call', toolCall: { id: 'tc-1', name: 'vfs_read', args: { path: 'test.md' } } },
      { type: 'done' },
    ]);

    const chunks = [];
    for await (const chunk of provider.chat(
      { sessionId: 'test', systemPrompt: '' },
      [],
      []
    )) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('vfs_read');
  });

  it('supports abort', async () => {
    const provider = new MockAIProvider([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);

    await provider.abort('test');
    // Should not throw
  });
});
