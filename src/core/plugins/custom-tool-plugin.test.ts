import { describe, it, expect, vi } from 'vitest';
import { createCustomToolPlugin } from './custom-tool-plugin';
import type { CustomToolDef, Activation } from '../../types';
import type { ToolContext } from '../tool-plugin';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';

type SpawnedActivation = Omit<Activation, 'id' | 'createdAt'>;

describe('createCustomToolPlugin', () => {
  const toolDef: CustomToolDef = {
    name: 'summarize',
    description: 'Summarize text',
    parameters: {
      text: { type: 'string', description: 'Text to summarize' },
    },
    prompt: 'Summarize the following:\n\n{{text}}',
  };

  function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
      vfs: createVFSStore(),
      registry: createAgentRegistry(),
      eventLog: createEventLog(),
      currentAgentId: 'agents/parent.md',
      currentActivationId: 'act-1',
      spawnDepth: 1,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation: vi.fn(),
      incrementSpawnCount: vi.fn(),
      ...overrides,
    };
  }

  it('creates a plugin with correct metadata', () => {
    const plugin = createCustomToolPlugin(toolDef);
    expect(plugin.name).toBe('summarize');
    expect(plugin.description).toBe('Summarize text');
    expect(plugin.parameters.text).toBeDefined();
    expect(plugin.parameters.text.required).toBe(true);
  });

  it('substitutes template parameters in prompt', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const capturedActivations: SpawnedActivation[] = [];
    const ctx = makeCtx({
      onRunSessionAndReturn: vi.fn(async (act) => {
        capturedActivations.push(act);
        return 'done';
      }),
    });

    await plugin.handler({ text: 'Hello world' }, ctx);

    expect(capturedActivations).toHaveLength(1);
    expect(capturedActivations[0].input).toBe('Summarize the following:\n\nHello world');
  });

  it('does not include model in spawned agent frontmatter', async () => {
    const withModel: CustomToolDef = { ...toolDef, model: 'gemini-3-flash-preview' };
    const plugin = createCustomToolPlugin(withModel);
    const vfs = createVFSStore();
    let capturedContent = '';
    const ctx = makeCtx({
      vfs,
      onRunSessionAndReturn: vi.fn(async (act) => {
        capturedContent = vfs.getState().read(act.agentId) ?? '';
        return 'done';
      }),
    });

    await plugin.handler({ text: 'test' }, ctx);

    expect(capturedContent).not.toContain('model:');
  });

  it('defaults to gloves_off safety mode', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const vfs = createVFSStore();
    let capturedContent = '';
    const ctx = makeCtx({
      vfs,
      onRunSessionAndReturn: vi.fn(async (act) => {
        capturedContent = vfs.getState().read(act.agentId) ?? '';
        return 'done';
      }),
    });

    await plugin.handler({ text: 'test' }, ctx);

    expect(capturedContent).not.toContain('model:');
    expect(capturedContent).toContain('safety_mode: "gloves_off"');
  });

  it('respects depth limits', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const ctx = makeCtx({ spawnDepth: 5, maxDepth: 5 });

    const result = await plugin.handler({ text: 'test' }, ctx);
    expect(result).toContain('depth limit');
  });

  it('respects fanout limits', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const ctx = makeCtx({ childCount: 3, spawnCount: 2, maxFanout: 5 });

    const result = await plugin.handler({ text: 'test' }, ctx);
    expect(result).toContain('fanout limit');
  });

  it('increments spawn count', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const incrementFn = vi.fn();
    const ctx = makeCtx({ incrementSpawnCount: incrementFn });

    await plugin.handler({ text: 'test' }, ctx);
    expect(incrementFn).toHaveBeenCalledOnce();
  });

  it('calls onRunSessionAndReturn and returns its result when available', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const runSessionAndReturn = vi.fn().mockResolvedValue('Sub-agent summary result');
    const onSpawnActivation = vi.fn();
    const ctx = makeCtx({
      onSpawnActivation,
      onRunSessionAndReturn: runSessionAndReturn,
    });

    const result = await plugin.handler({ text: 'Hello world' }, ctx);

    expect(runSessionAndReturn).toHaveBeenCalledOnce();
    expect(runSessionAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Summarize the following:\n\nHello world',
        parentId: 'agents/parent.md',
        spawnDepth: 2,
        priority: 2,
      })
    );
    expect(result).toBe('Sub-agent summary result');
    // onSpawnActivation should NOT be called when onRunSessionAndReturn is used
    expect(onSpawnActivation).not.toHaveBeenCalled();
  });

  it('returns error when onRunSessionAndReturn is not provided', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const vfs = createVFSStore();
    const registry = createAgentRegistry();
    const onSpawnActivation = vi.fn();
    const ctx = makeCtx({
      vfs,
      registry,
      onSpawnActivation,
      onRunSessionAndReturn: undefined,
    });

    const result = await plugin.handler({ text: 'Hello world' }, ctx);

    expect(result).toContain('Error:');
    expect(result).toContain('synchronous execution unavailable');
    // onSpawnActivation should NOT be called
    expect(onSpawnActivation).not.toHaveBeenCalled();
  });

  it('enforces depth limits even when onRunSessionAndReturn is provided', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const runSessionAndReturn = vi.fn().mockResolvedValue('Should not be called');
    const ctx = makeCtx({
      spawnDepth: 5,
      maxDepth: 5,
      onRunSessionAndReturn: runSessionAndReturn,
    });

    const result = await plugin.handler({ text: 'test' }, ctx);
    expect(result).toContain('depth limit');
    expect(runSessionAndReturn).not.toHaveBeenCalled();
  });

  it('enforces fanout limits even when onRunSessionAndReturn is provided', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const runSessionAndReturn = vi.fn().mockResolvedValue('Should not be called');
    const ctx = makeCtx({
      childCount: 3,
      spawnCount: 2,
      maxFanout: 5,
      onRunSessionAndReturn: runSessionAndReturn,
    });

    const result = await plugin.handler({ text: 'test' }, ctx);
    expect(result).toContain('fanout limit');
    expect(runSessionAndReturn).not.toHaveBeenCalled();
  });

  it('includes result schema in system prompt when defined', async () => {
    const withSchema: CustomToolDef = {
      ...toolDef,
      resultSchema: { type: 'object', properties: { summary: { type: 'string' } } },
    };
    const plugin = createCustomToolPlugin(withSchema);
    const vfs = createVFSStore();
    let capturedContent = '';
    const ctx = makeCtx({
      vfs,
      onRunSessionAndReturn: vi.fn(async (act) => {
        capturedContent = vfs.getState().read(act.agentId) ?? '';
        return 'done';
      }),
    });

    await plugin.handler({ text: 'test' }, ctx);

    expect(capturedContent).toContain('JSON matching this schema');
    expect(capturedContent).toContain('"summary"');
  });
});
