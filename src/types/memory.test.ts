import { describe, it, expect } from 'vitest';
import type { WorkingMemoryEntry, LongTermMemory, MemoryType } from './memory';

describe('Memory types', () => {
  it('WorkingMemoryEntry has required shape', () => {
    const entry: WorkingMemoryEntry = {
      id: 'wm-1',
      key: 'search:climate',
      value: 'Climate is changing',
      tags: ['research'],
      authorAgentId: 'agents/researcher.md',
      timestamp: Date.now(),
      runId: 'run-1',
    };
    expect(entry.key).toBe('search:climate');
    expect(entry.tags).toContain('research');
  });

  it('LongTermMemory has required shape', () => {
    const mem: LongTermMemory = {
      id: 'ltm-1',
      agentId: 'agents/researcher.md',
      type: 'fact',
      content: 'The API endpoint is /v2/data',
      tags: ['api', 'data'],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      runId: 'run-1',
    };
    expect(mem.type).toBe('fact');
    expect(mem.accessCount).toBe(0);
  });

  it('MemoryType covers all valid types', () => {
    const types: MemoryType[] = ['fact', 'procedure', 'observation', 'mistake', 'preference'];
    expect(types).toHaveLength(5);
  });
});
