import { describe, it, expect } from 'vitest';
import { createVFSStore } from '../stores/vfs-store';
import {
  createMissionState,
  loadMissionState,
  prepareMissionState,
  saveMissionState,
} from './autonomous-state';

describe('autonomous-state', () => {
  it('creates and persists mission state for an agent', () => {
    const vfs = createVFSStore();
    const state = createMissionState('agents/learner.md', 'Learn better testing patterns');
    const prepared = prepareMissionState(vfs, 'agents/learner.md', 'Learn better testing patterns', false);

    saveMissionState(vfs, prepared.statePath, state);
    const loaded = loadMissionState(vfs, 'agents/learner.md');

    expect(loaded).not.toBeNull();
    expect(loaded!.state.agentPath).toBe('agents/learner.md');
    expect(loaded!.state.missionPrompt).toContain('testing patterns');
  });

  it('resumes mission when prompt matches and resumeMission=true', () => {
    const vfs = createVFSStore();
    const first = prepareMissionState(vfs, 'agents/learner.md', 'Learn better ways of X', false);
    saveMissionState(vfs, first.statePath, {
      ...first.state,
      totalCycles: 3,
      totalTokens: 1200,
    });

    const resumed = prepareMissionState(vfs, 'agents/learner.md', 'learn better ways of x', true);
    expect(resumed.resumed).toBe(true);
    expect(resumed.state.totalCycles).toBe(3);
    expect(resumed.state.totalTokens).toBe(1200);
  });

  it('starts a new mission when prompt changes', () => {
    const vfs = createVFSStore();
    const first = prepareMissionState(vfs, 'agents/learner.md', 'Learn better ways of X', false);
    saveMissionState(vfs, first.statePath, first.state);

    const second = prepareMissionState(vfs, 'agents/learner.md', 'Learn better ways of Y', true);
    expect(second.resumed).toBe(false);
    expect(second.state.missionPrompt).toBe('Learn better ways of Y');
  });

  it('falls back to fresh mission state when saved JSON is invalid', () => {
    const vfs = createVFSStore();
    const initial = prepareMissionState(vfs, 'agents/learner.md', 'Learn better ways of X', false);
    vfs.getState().write(initial.statePath, '{ bad json', {});

    const prepared = prepareMissionState(vfs, 'agents/learner.md', 'Learn better ways of X', true);
    expect(prepared.resumed).toBe(false);
    expect(prepared.state.totalCycles).toBe(0);
  });
});
