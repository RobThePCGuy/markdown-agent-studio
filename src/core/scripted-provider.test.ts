import { describe, it, expect } from 'vitest';
import { ScriptedAIProvider } from './scripted-provider';
import type { ScriptMap } from './scripted-provider';
import type { StreamChunk } from '../types';

/** Helper: collect all chunks from an async iterable into an array. */
async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = [];
  for await (const chunk of iter) {
    result.push(chunk);
  }
  return result;
}

const agentPath = 'agents/project-lead.md';

const makeConfig = (sessionId: string) => ({
  sessionId,
  systemPrompt: 'You are a test agent',
});

describe('ScriptedAIProvider', () => {
  it('yields chunks from the correct agent script', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'Hello from script' },
          { type: 'done', tokenCount: 5 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const chunks = await collect(provider.chat(makeConfig('s1'), [], []));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello from script' });
    expect(chunks[1]).toEqual({ type: 'done', tokenCount: 5 });
  });

  it('advances turn index on subsequent calls', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'Turn 0' },
          { type: 'done', tokenCount: 2 },
        ],
        [
          { type: 'text', text: 'Turn 1' },
          { type: 'done', tokenCount: 2 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const turn0 = await collect(provider.chat(makeConfig('s1'), [], []));
    expect(turn0[0].text).toBe('Turn 0');

    const turn1 = await collect(provider.chat(makeConfig('s1'), [], []));
    expect(turn1[0].text).toBe('Turn 1');
  });

  it('yields fallback when agent has no script', async () => {
    const scripts: ScriptMap = {};

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', 'agents/unknown.md');

    const chunks = await collect(provider.chat(makeConfig('s1'), [], []));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].text).toContain('No script available');
    expect(chunks[1].type).toBe('done');
  });

  it('yields fallback when session is not registered', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [{ type: 'text', text: 'Will not be seen' }, { type: 'done' }],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    // Do NOT call registerSession

    const chunks = await collect(provider.chat(makeConfig('unregistered'), [], []));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain('No script available');
    expect(chunks[1].type).toBe('done');
  });

  it('yields fallback when turns are exhausted', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'Only turn' },
          { type: 'done', tokenCount: 2 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    // Consume the only available turn
    await collect(provider.chat(makeConfig('s1'), [], []));

    // Next call should get fallback
    const fallback = await collect(provider.chat(makeConfig('s1'), [], []));
    expect(fallback).toHaveLength(2);
    expect(fallback[0].text).toContain('No script available');
    expect(fallback[1].type).toBe('done');
  });

  it('yields error chunk when aborted before chat starts', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'Should not appear' },
          { type: 'done' },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);
    await provider.abort('s1');

    const chunks = await collect(provider.chat(makeConfig('s1'), [], []));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'error', error: 'Aborted' });
  });

  it('yields error chunk when aborted mid-stream', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'Chunk 1' },
          { type: 'text', text: 'Chunk 2' },
          { type: 'text', text: 'Chunk 3' },
          { type: 'done' },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.chat(makeConfig('s1'), [], [])) {
      chunks.push(chunk);
      // Abort after receiving the first chunk
      if (chunks.length === 1) {
        await provider.abort('s1');
      }
    }

    // Should have the first real chunk, then an error chunk
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toBe('Chunk 1');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'error', error: 'Aborted' });
  });

  it('endSession cleans up state', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [{ type: 'text', text: 'Turn 0' }, { type: 'done' }],
        [{ type: 'text', text: 'Turn 1' }, { type: 'done' }],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    // Advance to turn 1
    await collect(provider.chat(makeConfig('s1'), [], []));

    // End and re-register: turn counter should reset
    provider.endSession('s1');
    provider.registerSession('s1', agentPath);

    const chunks = await collect(provider.chat(makeConfig('s1'), [], []));
    expect(chunks[0].text).toBe('Turn 0');
  });

  it('isolates sessions for the same agent', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [{ type: 'text', text: 'Turn 0' }, { type: 'done' }],
        [{ type: 'text', text: 'Turn 1' }, { type: 'done' }],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);
    provider.registerSession('s2', agentPath);

    // Advance s1 to turn 1
    await collect(provider.chat(makeConfig('s1'), [], []));

    // s2 should still be on turn 0
    const s2chunks = await collect(provider.chat(makeConfig('s2'), [], []));
    expect(s2chunks[0].text).toBe('Turn 0');
  });

  it('applies longer delays for tool_call and done chunks than text chunks', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          { type: 'text', text: 'fast text' },
          { type: 'tool_call', toolCall: { id: 'tc-1', name: 'test', args: {} } },
          { type: 'done', tokenCount: 1 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const timestamps: number[] = [];
    for await (const _chunk of provider.chat(makeConfig('s1'), [], [])) {
      timestamps.push(Date.now());
    }

    // 3 chunks = 3 timestamps
    expect(timestamps).toHaveLength(3);

    const textToToolGap = timestamps[1] - timestamps[0];
    const toolToDoneGap = timestamps[2] - timestamps[1];

    // tool_call delay should be noticeably longer than text delay
    // text ~120ms, tool_call ~600ms, done ~1200ms
    // Allow generous margins for CI timing variance
    expect(textToToolGap).toBeGreaterThan(200);
    expect(toolToDoneGap).toBeGreaterThan(500);
  });

  it('supports tool_call chunks in scripts', async () => {
    const scripts: ScriptMap = {
      [agentPath]: [
        [
          {
            type: 'tool_call',
            toolCall: { id: 'tc-1', name: 'vfs_read', args: { path: 'test.md' } },
          },
          { type: 'done', tokenCount: 3 },
        ],
      ],
    };

    const provider = new ScriptedAIProvider(scripts);
    provider.registerSession('s1', agentPath);

    const chunks = await collect(provider.chat(makeConfig('s1'), [], []));

    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('vfs_read');
    expect(chunks[1].type).toBe('done');
  });
});
