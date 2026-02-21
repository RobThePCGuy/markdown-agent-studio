import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kernel } from './kernel';
import { MockAIProvider } from './mock-provider';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { runController } from './run-controller';
import { Summarizer } from './summarizer';
import { SAMPLE_AGENTS } from './sample-project';
import { agentRegistry, eventLogStore, memoryStore, sessionStore, uiStore, vfsStore } from '../stores/use-stores';

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
      agentRegistry: registry,
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
      vfs, agentRegistry: registry, eventLog,
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

  it('normalizes legacy gemini-1.5 model to configured kernel model', async () => {
    vfs.getState().write(
      'agents/legacy.md',
      '---\nname: "Legacy"\nmodel: "gemini-1.5-pro"\n---\nLegacy agent.',
      {},
    );
    registry.getState().registerFromFile('agents/legacy.md', vfs.getState().read('agents/legacy.md')!);

    const modelProvider = new MockAIProvider([
      { type: 'text', text: 'ok' },
      { type: 'done', tokenCount: 10 },
    ]);
    kernel = new Kernel({
      aiProvider: modelProvider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: {
        maxConcurrency: 1,
        maxDepth: 5,
        maxFanout: 5,
        tokenBudget: 500000,
        model: 'gemini-2.5-flash',
      },
    });

    kernel.enqueue({
      agentId: 'agents/legacy.md',
      input: 'Run',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();
    expect(modelProvider.seenConfigs[0]?.model).toBe('gemini-2.5-flash');
  });

  it('pauses queue and returns when quota/rate-limit error is hit', async () => {
    const quotaProvider = new MockAIProvider([
      { type: 'error', error: '429 RESOURCE_EXHAUSTED: quota exceeded' },
    ]);
    kernel = new Kernel({
      aiProvider: quotaProvider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: { maxConcurrency: 1, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    kernel.enqueue({ agentId: 'agents/writer.md', input: 'first', spawnDepth: 0, priority: 0 });
    kernel.enqueue({ agentId: 'agents/writer.md', input: 'second', spawnDepth: 0, priority: 1 });

    await kernel.runUntilEmpty();

    expect(kernel.isPaused).toBe(true);
    expect(kernel.queueLength).toBe(1);
    expect(kernel.completedSessions).toHaveLength(1);
    expect(kernel.completedSessions[0].status).toBe('error');
  });

  it('runSessionAndReturn resolves with the final text from the provider', async () => {
    const resultProvider = new MockAIProvider([
      { type: 'text', text: 'Sub-agent response text' },
      { type: 'done', tokenCount: 42 },
    ]);
    const testKernel = new Kernel({
      aiProvider: resultProvider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: { maxConcurrency: 1, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    const result = await testKernel.runSessionAndReturn({
      agentId: 'agents/writer.md',
      input: 'Do something',
      spawnDepth: 1,
      priority: 1,
    });

    expect(result).toBe('Sub-agent response text');
    expect(testKernel.completedSessions).toHaveLength(1);
    expect(testKernel.completedSessions[0].status).toBe('completed');
  });

  it('runSessionAndReturn detects loops and returns error', async () => {
    const resultProvider = new MockAIProvider([
      { type: 'text', text: 'first call' },
      { type: 'done', tokenCount: 10 },
    ]);
    const testKernel = new Kernel({
      aiProvider: resultProvider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: { maxConcurrency: 1, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    // First call should work fine
    const result1 = await testKernel.runSessionAndReturn({
      agentId: 'agents/writer.md',
      input: 'Same input',
      spawnDepth: 1,
      priority: 1,
    });
    expect(result1).toBe('first call');

    // Second call with same agent+input should detect loop
    const result2 = await testKernel.runSessionAndReturn({
      agentId: 'agents/writer.md',
      input: 'Same input',
      spawnDepth: 1,
      priority: 1,
    });
    expect(result2).toContain('Loop detected');
  });

  it('loops back to AI after tool calls with results', async () => {
    // Turn 1: model reads a file via vfs_read
    // Turn 2: model emits final text response
    vfs.getState().write('notes.md', '# My Notes', {});

    provider.setResponseQueue([
      [
        { type: 'tool_call', toolCall: { id: 'tc-1', name: 'vfs_read', args: { path: 'notes.md' } } },
        { type: 'done', tokenCount: 50 },
      ],
      [
        { type: 'text', text: 'I read the file, it says My Notes' },
        { type: 'done', tokenCount: 80 },
      ],
    ]);

    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Read notes.md and summarize',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    const session = kernel.completedSessions[0];
    expect(session.status).toBe('completed');
    // Should have: user message, tool result, model response
    expect(session.history).toHaveLength(3);
    expect(session.history[0].role).toBe('user');
    expect(session.history[1].role).toBe('tool');
    expect(session.history[2].role).toBe('model');
    expect(session.history[2].content).toContain('My Notes');
    // Tokens should accumulate across turns
    expect(session.tokenCount).toBe(130);
  });
});

describe('RunController memory handoff regression', () => {
  const projectLead = SAMPLE_AGENTS.find((agent) => agent.path === 'agents/project-lead.md');
  if (!projectLead) {
    throw new Error('Missing sample project lead agent');
  }

  let previousApiKey = '';
  let previousKernelConfig = { ...uiStore.getState().kernelConfig };

  const resetGlobalStores = (): void => {
    runController.killAll();
    vfsStore.setState({ files: new Map() });
    agentRegistry.setState({ agents: new Map() });
    eventLogStore.getState().clear();
    sessionStore.getState().clearAll();
    memoryStore.setState({ entries: [], runId: null });
  };

  beforeEach(() => {
    previousApiKey = uiStore.getState().apiKey;
    previousKernelConfig = { ...uiStore.getState().kernelConfig };

    resetGlobalStores();
    vfsStore.getState().write(projectLead.path, projectLead.content, {});
    agentRegistry.getState().registerFromFile(projectLead.path, projectLead.content);
  });

  afterEach(() => {
    uiStore.getState().setApiKey(previousApiKey);
    uiStore.getState().setKernelConfig(previousKernelConfig);
    resetGlobalStores();
    vi.restoreAllMocks();
  });

  it('passes kernel working-memory snapshot to summarizer', async () => {
    const summarizeSpy = vi.spyOn(Summarizer.prototype, 'summarize').mockResolvedValue();

    uiStore.getState().setApiKey('your-api-key-here');
    uiStore.getState().setKernelConfig({
      maxConcurrency: 1,
      maxDepth: 0,
      maxFanout: 1,
      tokenBudget: 10000,
      memoryEnabled: true,
    });

    await runController.run('agents/project-lead.md', 'Build me a portfolio website');

    for (let i = 0; i < 50 && summarizeSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(summarizeSpy).toHaveBeenCalledTimes(1);
    const workingMemory = summarizeSpy.mock.calls[0][1] as Array<{ key: string }>;
    expect(workingMemory.length).toBeGreaterThan(0);
    expect(workingMemory.some((entry) => entry.key === 'project-plan')).toBe(true);
  });

  it('keeps summarization disabled when memory is off', async () => {
    const summarizeSpy = vi.spyOn(Summarizer.prototype, 'summarize').mockResolvedValue();

    uiStore.getState().setApiKey('your-api-key-here');
    uiStore.getState().setKernelConfig({
      maxConcurrency: 1,
      maxDepth: 0,
      maxFanout: 1,
      tokenBudget: 10000,
      memoryEnabled: false,
    });

    await runController.run('agents/project-lead.md', 'Build me a portfolio website');

    expect(summarizeSpy).not.toHaveBeenCalled();
    expect(memoryStore.getState().entries).toHaveLength(0);
    expect(memoryStore.getState().runId).toBeNull();
  });
});
