import { describe, it, expect, beforeEach } from 'vitest';
import { ToolHandler } from './tool-handler';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { createBuiltinRegistry } from './plugins';
import type { AgentPolicy, Activation } from '../types';

describe('ToolHandler', () => {
  let handler: ToolHandler;
  let vfs: ReturnType<typeof createVFSStore>;
  let registry: ReturnType<typeof createAgentRegistry>;
  let eventLog: ReturnType<typeof createEventLog>;
  let spawnedActivations: Omit<Activation, 'id' | 'createdAt'>[];

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
      expect(result.value).toBe('# Plan');
    });

    it('returns error with suggestions when file missing', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plans.md' });
      expect(result.value).toContain('not found');
      expect(result.value).toContain('artifacts/plan.md');
    });
  });

  describe('vfs_write', () => {
    it('writes file and returns confirmation', async () => {
      const result = await handler.handle('vfs_write', { path: 'artifacts/spec.md', content: '# Spec' });
      expect(result.value).toContain('Written to');
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
      expect(result.value).toContain('agents/a.md');
      expect(result.value).toContain('agents/b.md');
    });

    it('returns helpful message when no matches', async () => {
      vfs.getState().write('agents/a.md', 'a', {});
      const result = await handler.handle('vfs_list', { prefix: 'tests/' });
      expect(result.value).toContain('No files match');
      expect(result.value).toContain('agents/');
    });
  });

  describe('vfs_delete', () => {
    it('deletes existing file', async () => {
      vfs.getState().write('memory/notes.md', 'notes', {});
      const result = await handler.handle('vfs_delete', { path: 'memory/notes.md' });
      expect(result.value).toContain('Deleted');
      expect(vfs.getState().exists('memory/notes.md')).toBe(false);
    });

    it('returns error for nonexistent file', async () => {
      const result = await handler.handle('vfs_delete', { path: 'nope.md' });
      expect(result.value).toContain('not found');
    });
  });

  describe('spawn_agent', () => {
    it('creates file, registers agent, queues activation', async () => {
      const result = await handler.handle('spawn_agent', {
        filename: 'researcher.md',
        content: '---\nname: "Researcher"\n---\nDo research.',
        task: 'Find info about topic X',
      });
      expect(result.value).toContain('Created and activated');
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
      expect(result.value).toContain('depth limit');
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
      expect(result.value).toContain('fanout limit');
    });

    it('normalizes legacy model and defaults safety mode for spawned agents', async () => {
      const modelAwareHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/writer.md',
        currentActivationId: 'act-legacy-spawn',
        parentAgentId: 'agents/orchestrator.md',
        spawnDepth: 1,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        preferredModel: 'gemini-2.5-flash',
      });

      await modelAwareHandler.handle('spawn_agent', {
        filename: 'legacy-helper.md',
        content: '---\nname: "Legacy Helper"\nmodel: "gemini-1.5-pro"\n---\nHelp out.',
        task: 'Assist',
      });

      const content = vfs.getState().read('agents/legacy-helper.md') ?? '';
      expect(content).toContain('model: gemini-2.5-flash');
      expect(content).toContain('safety_mode: gloves_off');
      expect(content).not.toContain('gemini-1.5-pro');
    });
  });

  describe('signal_parent', () => {
    it('queues parent re-activation', async () => {
      const result = await handler.handle('signal_parent', { message: 'Done with research' });
      expect(result.value).toContain('Message sent');
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
      expect(result.value).toContain('no parent');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handler.handle('unknown_tool', {});
      expect(result.value).toContain('Unknown tool');
    });
  });

  describe('frontmatter policy enforcement', () => {
    const restrictedPolicy: AgentPolicy = {
      mode: 'safe',
      reads: ['memory/**'],
      writes: ['artifacts/**'],
      allowedTools: [],
      blockedTools: [],
      glovesOffTriggers: [],
      permissions: {
        spawnAgents: false,
        editAgents: false,
        deleteFiles: false,
        webAccess: false,
        signalParent: true,
        customTools: false,
      },
    };

    it('blocks web tools when web access is disabled', async () => {
      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-1',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      const result = await restricted.handle('web_search', { query: 'latest AI' });
      expect(result.value).toContain('Policy blocked');
      expect(result.value).toContain('web_access');
    });

    it('blocks write outside allowed write scopes', async () => {
      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-2',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      const result = await restricted.handle('vfs_write', {
        path: 'memory/notes.md',
        content: 'x',
      });
      expect(result.value).toContain('Policy blocked write');
      expect(vfs.getState().exists('memory/notes.md')).toBe(false);
    });

    it('blocks ../ traversal that escapes write scope', async () => {
      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-traversal',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      // artifacts/../agents/evil.md should normalize to agents/evil.md and be blocked
      const result = await restricted.handle('vfs_write', {
        path: 'artifacts/../agents/evil.md',
        content: 'malicious',
      });
      expect(result.value).toContain('Policy blocked');
      expect(vfs.getState().exists('agents/evil.md')).toBe(false);
    });

    it('blocks leading ../ that resolves above root', async () => {
      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-above-root',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      // ../../agents/evil.md should normalize to agents/evil.md and be blocked
      const above = await restricted.handle('vfs_write', {
        path: '../../agents/evil.md',
        content: 'malicious',
      });
      expect(above.value).toContain('Policy blocked');
      expect(vfs.getState().exists('agents/evil.md')).toBe(false);
    });

    it('blocks vfs_read and vfs_list when args are empty or invalid', async () => {
      vfs.getState().write('artifacts/secret.md', 'secret', {});

      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-args',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      const readResult = await restricted.handle('vfs_read', { path: 123 });
      expect(readResult.value).toContain("Policy blocked 'vfs_read'");
      expect(readResult.value).toContain("non-empty string 'path'");
      expect(readResult.value).not.toContain('artifacts/secret.md');

      const listResult = await restricted.handle('vfs_list', { prefix: '' });
      expect(listResult.value).toContain("Policy blocked 'vfs_list'");
      expect(listResult.value).toContain("non-empty string 'prefix'");
      expect(listResult.value).not.toContain('artifacts/secret.md');
    });

    it('requires list prefixes to stay within allowed read roots', async () => {
      const agentsOnlyReadPolicy: AgentPolicy = {
        ...restrictedPolicy,
        reads: ['agents/**'],
      };

      vfs.getState().write('agents/a.md', 'a', {});
      vfs.getState().write('artifacts/secret.md', 'secret', {});

      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-prefix',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: agentsOnlyReadPolicy,
      });

      const blocked = await restricted.handle('vfs_list', { prefix: 'a' });
      expect(blocked.value).toContain("Policy blocked list prefix 'a'");
      expect(blocked.value).not.toContain('artifacts/secret.md');

      const allowed = await restricted.handle('vfs_list', { prefix: 'agents/' });
      expect(allowed.value).toContain('agents/a.md');
      expect(allowed.value).not.toContain('artifacts/secret.md');
    });

    it('bypasses restrictions in gloves_off mode', async () => {
      const glovesOffPolicy: AgentPolicy = {
        ...restrictedPolicy,
        mode: 'gloves_off',
      };

      const unrestricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/unrestricted.md',
        currentActivationId: 'act-policy-3',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: glovesOffPolicy,
      });

      const result = await unrestricted.handle('vfs_write', {
        path: 'memory/notes.md',
        content: 'ok',
      });
      expect(result.value).toContain('Written to');
      expect(vfs.getState().read('memory/notes.md')).toBe('ok');
    });
  });

  describe('blackboard tools (integration)', () => {
    it('blackboard_write stores value and blackboard_read retrieves it', async () => {
      const { createBlackboardStore } = await import('../stores/blackboard-store');
      const bbStore = createBlackboardStore();
      const bbHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/test.md',
        currentActivationId: 'act-bb',
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        blackboardStore: bbStore,
      });

      const writeResult = await bbHandler.handle('blackboard_write', { key: 'goal', value: 'finish task' });
      expect(writeResult.value).toContain('Wrote "goal"');

      const readResult = await bbHandler.handle('blackboard_read', { key: 'goal' });
      expect(readResult.value).toContain('finish task');
    });
  });

  describe('pub/sub tools (integration)', () => {
    it('publish and subscribe round-trip', async () => {
      const { createPubSubStore } = await import('../stores/pub-sub-store');
      const psStore = createPubSubStore();
      const psHandler = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/sender.md',
        currentActivationId: 'act-ps',
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        pubSubStore: psStore,
      });

      // Subscribe first
      const subResult = await psHandler.handle('subscribe', { channel: 'updates' });
      expect(subResult.value).toContain('Subscribed');

      // Publish a message
      const pubResult = await psHandler.handle('publish', { channel: 'updates', message: 'hello world' });
      expect(pubResult.value).toContain('Published');

      // Check pending messages
      const checkResult = await psHandler.handle('subscribe', { channel: 'updates', check: true });
      expect(checkResult.value).toContain('hello world');
    });
  });

  describe('structured ToolResult', () => {
    it('returns ok: true for successful tool calls', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plan.md' });
      expect(result.ok).toBe(true);
      expect(result.value).toBe('# Plan');
      expect(result.errorType).toBeUndefined();
    });

    it('returns ok: false with permanent errorType for Error: prefixed results', async () => {
      const result = await handler.handle('vfs_read', { path: 'nonexistent.md' });
      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('permanent');
      expect(result.value).toContain('not found');
    });

    it('returns ok: false with policy errorType for policy blocks', async () => {
      const restrictedPolicy: AgentPolicy = {
        mode: 'safe',
        reads: ['memory/**'],
        writes: ['artifacts/**'],
        allowedTools: [],
        blockedTools: [],
        glovesOffTriggers: [],
        permissions: {
          spawnAgents: false,
          editAgents: false,
          deleteFiles: false,
          webAccess: false,
          signalParent: true,
          customTools: false,
        },
      };

      const restricted = new ToolHandler({
        pluginRegistry: createBuiltinRegistry(),
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/restricted.md',
        currentActivationId: 'act-policy-typed',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
        policy: restrictedPolicy,
      });

      const result = await restricted.handle('web_search', { query: 'test' });
      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('policy');
      expect(result.value).toContain('Policy blocked');
    });

    it('returns ok: false with permanent errorType for unknown tools', async () => {
      const result = await handler.handle('no_such_tool', {});
      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('permanent');
      expect(result.value).toContain('Unknown tool');
    });

    it('returns ok: false with transient errorType when plugin throws', async () => {
      const { ToolPluginRegistry: TPR } = await import('./tool-plugin');
      const customRegistry = createBuiltinRegistry();
      customRegistry.register({
        name: 'throw_tool',
        description: 'A tool that throws',
        parameters: {},
        handler: async () => { throw new Error('boom'); },
      });

      const throwHandler = new ToolHandler({
        pluginRegistry: customRegistry,
        vfs,
        agentRegistry: registry,
        eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/test.md',
        currentActivationId: 'act-throw',
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
      });

      const result = await throwHandler.handle('throw_tool', {});
      expect(result.ok).toBe(false);
      expect(result.errorType).toBe('transient');
      expect(result.value).toContain('boom');
    });
  });
});
