import { describe, it, expect, vi } from 'vitest';
import { createCustomToolPlugin } from './custom-tool-plugin';
import type { CustomToolDef } from '../../types/agent';
import type { ToolContext } from '../tool-plugin';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';

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
    const spawnedActivations: any[] = [];
    const ctx = makeCtx({
      onSpawnActivation: (act) => spawnedActivations.push(act),
    });

    await plugin.handler({ text: 'Hello world' }, ctx);

    expect(spawnedActivations).toHaveLength(1);
    expect(spawnedActivations[0].input).toBe('Summarize the following:\n\nHello world');
  });

  it('includes model override in spawned agent', async () => {
    const withModel: CustomToolDef = { ...toolDef, model: 'gemini-2.0-flash-lite' };
    const plugin = createCustomToolPlugin(withModel);
    const vfs = createVFSStore();
    const spawnedActivations: any[] = [];
    const ctx = makeCtx({
      vfs,
      onSpawnActivation: (act) => spawnedActivations.push(act),
    });

    await plugin.handler({ text: 'test' }, ctx);

    const content = vfs.getState().read(spawnedActivations[0].agentId);
    expect(content).toContain('model: "gemini-2.0-flash-lite"');
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

  it('includes result schema in system prompt when defined', async () => {
    const withSchema: CustomToolDef = {
      ...toolDef,
      resultSchema: { type: 'object', properties: { summary: { type: 'string' } } },
    };
    const plugin = createCustomToolPlugin(withSchema);
    const vfs = createVFSStore();
    const spawnedActivations: any[] = [];
    const ctx = makeCtx({
      vfs,
      onSpawnActivation: (act) => spawnedActivations.push(act),
    });

    await plugin.handler({ text: 'test' }, ctx);

    const content = vfs.getState().read(spawnedActivations[0].agentId);
    expect(content).toContain('JSON matching this schema');
    expect(content).toContain('"summary"');
  });
});
