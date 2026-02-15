import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Kernel } from './kernel';
import { MockAIProvider } from './mock-provider';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';

describe('Kernel', () => {
  let kernel: Kernel;
  let vfs: ReturnType<typeof createVFSStore>;
  let registry: ReturnType<typeof createAgentRegistry>;
  let eventLog: ReturnType<typeof createEventLog>;
  let provider: MockAIProvider;

  beforeEach(() => {
    vfs = createVFSStore();
    registry = createAgentRegistry();
    eventLog = createEventLog();
    provider = new MockAIProvider([
      { type: 'text', text: 'Hello from agent' },
      { type: 'done', tokenCount: 100 },
    ]);

    kernel = new Kernel({
      aiProvider: provider,
      vfs,
      registry,
      eventLog,
      config: { maxConcurrency: 2, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    // Set up a basic agent
    vfs.getState().write('agents/writer.md', '---\nname: "Writer"\n---\nYou are a writer.', {});
    registry.getState().registerFromFile('agents/writer.md', vfs.getState().read('agents/writer.md')!);
  });

  it('processes a single activation', async () => {
    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write something',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    expect(kernel.completedSessions).toHaveLength(1);
    expect(kernel.completedSessions[0].status).toBe('completed');
  });

  it('respects concurrency limit', async () => {
    const slowProvider = new MockAIProvider([
      { type: 'text', text: 'thinking...' },
      { type: 'done', tokenCount: 50 },
    ]);
    kernel = new Kernel({
      aiProvider: slowProvider,
      vfs, registry, eventLog,
      config: { maxConcurrency: 1, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    vfs.getState().write('agents/a.md', '---\nname: "Agent A"\n---\nAgent A', {});
    vfs.getState().write('agents/b.md', '---\nname: "Agent B"\n---\nAgent B', {});
    registry.getState().registerFromFile('agents/a.md', vfs.getState().read('agents/a.md')!);
    registry.getState().registerFromFile('agents/b.md', vfs.getState().read('agents/b.md')!);

    kernel.enqueue({ agentId: 'agents/a.md', input: 'task a', spawnDepth: 0, priority: 0 });
    kernel.enqueue({ agentId: 'agents/b.md', input: 'task b', spawnDepth: 0, priority: 1 });

    await kernel.runUntilEmpty();

    expect(kernel.completedSessions).toHaveLength(2);
  });

  it('handles tool calls that spawn agents', async () => {
    provider.setResponses([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tc-1',
          name: 'spawn_agent',
          args: { filename: 'helper.md', content: '---\nname: "Helper"\n---\nHelp me', task: 'do stuff' },
        },
      },
      { type: 'done', tokenCount: 150 },
    ]);

    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write with help',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    expect(vfs.getState().exists('agents/helper.md')).toBe(true);
  });

  it('can be paused and resumed', () => {
    kernel.pause();
    expect(kernel.isPaused).toBe(true);
    kernel.resume();
    expect(kernel.isPaused).toBe(false);
  });

  it('can kill all sessions', async () => {
    kernel.killAll();
    expect(kernel.isPaused).toBe(true);
  });

  it('tracks total token count', async () => {
    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write',
      spawnDepth: 0,
      priority: 0,
    });
    await kernel.runUntilEmpty();
    expect(kernel.totalTokens).toBeGreaterThan(0);
  });
});
