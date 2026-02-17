import { describe, it, expect } from 'vitest';
import { createBuiltinRegistry } from './index';

describe('Built-in Plugins', () => {
  it('registers all 6 built-in plugins', () => {
    const registry = createBuiltinRegistry();
    const all = registry.getAll();
    expect(all).toHaveLength(6);
    const names = all.map((p) => p.name).sort();
    expect(names).toEqual([
      'signal_parent',
      'spawn_agent',
      'vfs_delete',
      'vfs_list',
      'vfs_read',
      'vfs_write',
    ]);
  });

  it('generates valid tool declarations', () => {
    const registry = createBuiltinRegistry();
    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(6);
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters.type).toBe('object');
    }
  });
});
