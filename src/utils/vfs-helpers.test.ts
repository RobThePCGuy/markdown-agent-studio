import { describe, it, expect } from 'vitest';
import { deriveKind, computeHash, findSimilarPaths, computeLineDiff } from './vfs-helpers';

describe('deriveKind', () => {
  it('returns agent for agents/ prefix', () => {
    expect(deriveKind('agents/writer.md')).toBe('agent');
  });
  it('returns memory for memory/ prefix', () => {
    expect(deriveKind('memory/decisions.md')).toBe('memory');
  });
  it('returns artifact for artifacts/ prefix', () => {
    expect(deriveKind('artifacts/spec.md')).toBe('artifact');
  });
  it('returns unknown for other paths', () => {
    expect(deriveKind('readme.md')).toBe('unknown');
  });
});

describe('computeHash', () => {
  it('returns consistent hash for same input', () => {
    const a = computeHash('hello world');
    const b = computeHash('hello world');
    expect(a).toBe(b);
  });
  it('returns different hash for different input', () => {
    const a = computeHash('hello');
    const b = computeHash('world');
    expect(a).not.toBe(b);
  });
});

describe('findSimilarPaths', () => {
  const paths = ['agents/writer.md', 'agents/researcher.md', 'artifacts/plan.md', 'memory/notes.md'];
  it('finds exact prefix matches', () => {
    const result = findSimilarPaths('artifacts/plans.md', paths);
    expect(result).toContain('artifacts/plan.md');
  });
  it('returns empty for completely unrelated', () => {
    const result = findSimilarPaths('zzzzzzz.md', paths);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('computeLineDiff', () => {
  it('returns empty string for identical content', () => {
    expect(computeLineDiff('hello', 'hello')).toBe('');
  });
  it('shows added lines', () => {
    const diff = computeLineDiff('line1', 'line1\nline2');
    expect(diff).toContain('+line2');
  });
  it('shows removed lines', () => {
    const diff = computeLineDiff('line1\nline2', 'line1');
    expect(diff).toContain('-line2');
  });
});
