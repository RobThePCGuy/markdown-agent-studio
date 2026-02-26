import { describe, it, expect, vi } from 'vitest';
import { delegatePlugin } from './delegate-plugin';
import type { ToolContext } from '../tool-plugin';

describe('delegatePlugin', () => {
  it('has correct name and required params', () => {
    expect(delegatePlugin.name).toBe('delegate');
    expect(delegatePlugin.parameters.agent.required).toBe(true);
    expect(delegatePlugin.parameters.task.required).toBe(true);
  });

  it('calls onSpawnActivation with the target agent', async () => {
    const onSpawnActivation = vi.fn();
    const ctx = {
      currentAgentId: 'agents/lead.md',
      currentActivationId: 'act-1',
      spawnDepth: 0,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation,
      incrementSpawnCount: vi.fn(),
      vfs: { getState: () => ({}) } as unknown as ToolContext['vfs'],
      registry: { getState: () => ({ agents: new Map([['agents/worker.md', {}]]) }) } as unknown as ToolContext['registry'],
      eventLog: { getState: () => ({ push: vi.fn() }) } as unknown as ToolContext['eventLog'],
    };

    const result = await delegatePlugin.handler(
      { agent: 'agents/worker.md', task: 'do the thing', priority: '1' },
      ctx as unknown as ToolContext
    );

    expect(onSpawnActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agents/worker.md',
        input: expect.stringContaining('do the thing'),
        parentId: 'agents/lead.md',
      })
    );
    expect(result).toContain('Delegated');
  });
});
