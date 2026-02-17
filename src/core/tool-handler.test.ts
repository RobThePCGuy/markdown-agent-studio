import { describe, it, expect, beforeEach } from 'vitest';
import { ToolHandler } from './tool-handler';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { createBuiltinRegistry } from './plugins';

describe('ToolHandler', () => {
  let handler: ToolHandler;
  let vfs: ReturnType<typeof createVFSStore>;
  let registry: ReturnType<typeof createAgentRegistry>;
  let eventLog: ReturnType<typeof createEventLog>;
  let spawnedActivations: any[];

  beforeEach(() => {
    vfs = createVFSStore();
    registry = createAgentRegistry();
    eventLog = createEventLog();
    spawnedActivations = [];

    handler = new ToolHandler({
      pluginRegistry: createBuiltinRegistry(),
      vfs,
      agentRegistry: registry,
      eventLog,
      onSpawnActivation: (activation) => spawnedActivations.push(activation),
      currentAgentId: 'agents/writer.md',
      currentActivationId: 'act-1',
      parentAgentId: 'agents/orchestrator.md',
      spawnDepth: 1,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
    });
  });

  describe('vfs_read', () => {
    it('returns file content when file exists', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plan.md' });
      expect(result).toBe('# Plan');
    });

    it('returns error with suggestions when file missing', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plans.md' });
      expect(result).toContain('not found');
      expect(result).toContain('artifacts/plan.md');
    });
  });

  describe('vfs_write', () => {
    it('writes file and returns confirmation', async () => {
      const result = await handler.handle('vfs_write', { path: 'artifacts/spec.md', content: '# Spec' });
      expect(result).toContain('Written to');
      expect(vfs.getState().read('artifacts/spec.md')).toBe('# Spec');
    });

    it('registers agent when writing to agents/', async () => {
      await handler.handle('vfs_write', {
        path: 'agents/helper.md',
        content: '---\nname: "Helper"\n---\nDo stuff.',
      });
      expect(registry.getState().get('agents/helper.md')).toBeTruthy();
    });
  });

  describe('vfs_list', () => {
    it('returns matching files', async () => {
      vfs.getState().write('agents/a.md', 'a', {});
      vfs.getState().write('agents/b.md', 'b', {});
      const result = await handler.handle('vfs_list', { prefix: 'agents/' });
      expect(result).toContain('agents/a.md');
      expect(result).toContain('agents/b.md');
    });

    it('returns helpful message when no matches', async () => {
      vfs.getState().write('agents/a.md', 'a', {});
      const result = await handler.handle('vfs_list', { prefix: 'tests/' });
      expect(result).toContain('No files match');
      expect(result).toContain('agents/');
    });
  });

  describe('vfs_delete', () => {
    it('deletes existing file', async () => {
      vfs.getState().write('memory/notes.md', 'notes', {});
      const result = await handler.handle('vfs_delete', { path: 'memory/notes.md' });
      expect(result).toContain('Deleted');
      expect(vfs.getState().exists('memory/notes.md')).toBe(false);
    });

    it('returns error for nonexistent file', async () => {
      const result = await handler.handle('vfs_delete', { path: 'nope.md' });
      expect(result).toContain('not found');
    });
  });

  describe('spawn_agent', () => {
    it('creates file, registers agent, queues activation', async () => {
      const result = await handler.handle('spawn_agent', {
        filename: 'researcher.md',
        content: '---\nname: "Researcher"\n---\nDo research.',
        task: 'Find info about topic X',
      });
      expect(result).toContain('Created and activated');
      expect(vfs.getState().exists('agents/researcher.md')).toBe(true);
      expect(registry.getState().get('agents/researcher.md')).toBeTruthy();
      expect(spawnedActivations).toHaveLength(1);
      expect(spawnedActivations[0].spawnDepth).toBe(2);
    });

    it('blocks when depth limit reached', async () => {
      const deepHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/deep.md',
        currentActivationId: 'act-2',
        parentAgentId: undefined,
        spawnDepth: 5,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
      });
      const result = await deepHandler.handle('spawn_agent', {
        filename: 'child.md', content: 'prompt', task: 'go',
      });
      expect(result).toContain('depth limit');
    });

    it('blocks when fanout limit reached', async () => {
      const fullHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/busy.md',
        currentActivationId: 'act-3',
        parentAgentId: undefined,
        spawnDepth: 1,
        maxDepth: 5,
        maxFanout: 2,
        childCount: 2,
      });
      const result = await fullHandler.handle('spawn_agent', {
        filename: 'another.md', content: 'prompt', task: 'go',
      });
      expect(result).toContain('fanout limit');
    });
  });

  describe('signal_parent', () => {
    it('queues parent re-activation', async () => {
      const result = await handler.handle('signal_parent', { message: 'Done with research' });
      expect(result).toContain('Message sent');
      expect(spawnedActivations).toHaveLength(1);
      expect(spawnedActivations[0].agentId).toBe('agents/orchestrator.md');
    });

    it('errors when no parent', async () => {
      const rootHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/root.md',
        currentActivationId: 'act-root',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
      });
      const result = await rootHandler.handle('signal_parent', { message: 'hello' });
      expect(result).toContain('no parent');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handler.handle('unknown_tool', {});
      expect(result).toContain('Unknown tool');
    });
  });
});
