import { describe, expect, it } from 'vitest';
import { createAgentRegistry } from '../stores/agent-registry';
import { createVFSStore } from '../stores/vfs-store';
import type { ReplayCheckpoint } from '../types';
import { restoreCheckpoint } from './replay';

describe('restoreCheckpoint', () => {
  it('replaces workspace files and agent registry from checkpoint', () => {
    const vfs = createVFSStore();
    const registry = createAgentRegistry();

    vfs.getState().write('memory/old.md', 'old', {});
    vfs.getState().write('agents/old.md', '---\nname: "Old"\n---\nold', {});
    registry.getState().registerFromFile('agents/old.md', vfs.getState().read('agents/old.md')!);

    const checkpoint: ReplayCheckpoint = {
      id: 'cp-1',
      eventId: 'evt-1',
      timestamp: Date.now(),
      eventType: 'activation',
      agentId: 'agents/new.md',
      activationId: 'act-1',
      files: {
        'agents/new.md': '---\nname: "New"\n---\nDo work.',
        'artifacts/out.md': '# output',
      },
    };

    restoreCheckpoint(checkpoint, vfs, registry);

    expect(vfs.getState().getAllPaths().sort()).toEqual([
      'agents/new.md',
      'artifacts/out.md',
    ]);
    expect(registry.getState().get('agents/new.md')).toBeTruthy();
    expect(registry.getState().get('agents/old.md')).toBeUndefined();
  });
});
