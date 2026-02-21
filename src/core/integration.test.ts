import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import { MockAIProvider } from './mock-provider';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { DEFAULT_KERNEL_CONFIG } from '../types';
import type { AIProvider } from '../types';

describe('Integration: full agent loop', () => {
  it('runs an agent that spawns a child, child writes an artifact', async () => {
    const vfs = createVFSStore();
    const registry = createAgentRegistry();
    const eventLog = createEventLog();

    // Parent agent will spawn a child
    let callCount = 0;
    const provider = new MockAIProvider([]);

    // Override chat to return different responses per call
    (provider as unknown as { chat: AIProvider['chat'] }).chat = async function* () {
      callCount++;
      if (callCount === 1) {
        // First agent: spawn a child
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc-1',
            name: 'spawn_agent',
            args: {
              filename: 'child.md',
              content: '---\nname: "Child"\n---\nYou are a helper.',
              task: 'Write a summary to artifacts/summary.md',
            },
          },
        };
        yield { type: 'text', text: 'Spawned the child.' };
        yield { type: 'done', tokenCount: 100 };
      } else if (callCount === 2) {
        // Child agent: write an artifact
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc-2',
            name: 'vfs_write',
            args: {
              path: 'artifacts/summary.md',
              content: '# Summary\nThis is the summary.',
            },
          },
        };
        yield { type: 'text', text: 'Done writing.' };
        yield { type: 'done', tokenCount: 80 };
      }
    };

    const kernel = new Kernel({
      aiProvider: provider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: DEFAULT_KERNEL_CONFIG,
    });

    // Set up the parent agent
    vfs.getState().write('agents/parent.md', '---\nname: "Parent"\n---\nYou orchestrate.', {});
    registry.getState().registerFromFile('agents/parent.md', vfs.getState().read('agents/parent.md')!);

    kernel.enqueue({
      agentId: 'agents/parent.md',
      input: 'Start the project',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    // Verify: child was created
    expect(vfs.getState().exists('agents/child.md')).toBe(true);
    // Verify: artifact was written
    expect(vfs.getState().read('artifacts/summary.md')).toContain('# Summary');
    // Verify: both agents completed
    expect(kernel.completedSessions).toHaveLength(2);
    // Verify: events logged
    expect(eventLog.getState().entries.length).toBeGreaterThan(0);
    expect(kernel.totalTokens).toBe(180);
  });
});
