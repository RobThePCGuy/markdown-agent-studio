import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import { ScriptedAIProvider } from './scripted-provider';
import { DEMO_SCRIPT } from './demo-script';
import { SAMPLE_AGENTS, loadSampleProject } from './sample-project';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { createSessionStore } from '../stores/session-store';
import { createMemoryStore } from '../stores/memory-store';

describe('Demo integration: full project run through kernel', () => {
  it('runs all 6 sample agents to completion and produces expected artifacts', async () => {
    // --- Set up fresh stores ---
    const vfs = createVFSStore();
    const registry = createAgentRegistry();
    const eventLog = createEventLog(vfs);
    const sessionStore = createSessionStore();
    const memoryStore = createMemoryStore();

    // --- Load all 6 sample agents into VFS and registry ---
    loadSampleProject(vfs, registry);

    // Verify all 6 agents are registered
    expect(registry.getState().listAll()).toHaveLength(SAMPLE_AGENTS.length);

    // --- Create ScriptedAIProvider with DEMO_SCRIPT ---
    const provider = new ScriptedAIProvider(DEMO_SCRIPT);

    // --- Create Kernel ---
    const kernel = new Kernel({
      aiProvider: provider,
      vfs,
      agentRegistry: registry,
      eventLog,
      config: {
        maxConcurrency: 3,
        maxDepth: 5,
        maxFanout: 10,
        tokenBudget: 500000,
        memoryEnabled: true,
      },
      sessionStore,
      memoryStore,
    });

    // --- Enqueue the project-lead agent ---
    kernel.enqueue({
      agentId: 'agents/project-lead.md',
      input: 'Build me a portfolio website',
      spawnDepth: 0,
      priority: 0,
    });

    // --- Run until empty ---
    await kernel.runUntilEmpty();

    // =====================================================================
    // ASSERTIONS
    // =====================================================================

    // 1. VFS artifacts exist with expected content
    const designSpec = vfs.getState().read('artifacts/design-spec.md');
    expect(designSpec).not.toBeNull();
    expect(designSpec!.length).toBeGreaterThan(0);

    const indexHtml = vfs.getState().read('site/index.html');
    expect(indexHtml).not.toBeNull();
    expect(indexHtml).toContain('<!DOCTYPE html>');

    const stylesCss = vfs.getState().read('site/styles.css');
    expect(stylesCss).not.toBeNull();
    expect(stylesCss).toContain(':root');

    const qaReport = vfs.getState().read('artifacts/qa-report.md');
    expect(qaReport).not.toBeNull();

    const summary = vfs.getState().read('artifacts/summary.md');
    expect(summary).not.toBeNull();

    // 2. Events
    const entries = eventLog.getState().entries;

    const spawnEvents = entries.filter((e) => e.type === 'spawn');
    expect(spawnEvents.length).toBeGreaterThanOrEqual(5);

    const signalEvents = entries.filter((e) => e.type === 'signal');
    expect(signalEvents.length).toBeGreaterThanOrEqual(5);

    const completeEvents = entries.filter((e) => e.type === 'complete');
    expect(completeEvents.length).toBeGreaterThanOrEqual(6);

    const errorEvents = entries.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(0);

    // 3. All sessions should be completed
    expect(kernel.completedSessions.length).toBeGreaterThanOrEqual(6);
    for (const session of kernel.completedSessions) {
      expect(session.status).toBe('completed');
    }
  }, 30_000);
});
