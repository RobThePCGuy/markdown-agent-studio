import { describe, it, expect } from 'vitest';
import { ensureUniquePath, nextSequentialPath, duplicatePath } from './path-naming';

describe('ensureUniquePath', () => {
  it('returns original path when no collision exists', () => {
    const result = ensureUniquePath('agents/researcher.md', ['agents/writer.md']);
    expect(result).toBe('agents/researcher.md');
  });

  it('adds numeric suffix when a collision exists', () => {
    const result = ensureUniquePath('agents/writer.md', ['agents/writer.md', 'agents/writer-2.md']);
    expect(result).toBe('agents/writer-3.md');
  });
});

describe('nextSequentialPath', () => {
  it('returns the first missing sequence number', () => {
    const result = nextSequentialPath('agents/untitled', '.md', [
      'agents/untitled-1.md',
      'agents/untitled-3.md',
    ]);
    expect(result).toBe('agents/untitled-2.md');
  });
});

describe('duplicatePath', () => {
  it('creates a copy path with incrementing suffixes', () => {
    const result = duplicatePath('artifacts/plan.md', [
      'artifacts/plan.md',
      'artifacts/plan-copy.md',
      'artifacts/plan-copy-2.md',
    ]);
    expect(result).toBe('artifacts/plan-copy-3.md');
  });
});
