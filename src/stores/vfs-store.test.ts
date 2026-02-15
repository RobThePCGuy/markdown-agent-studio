import { describe, it, expect, beforeEach } from 'vitest';
import { createVFSStore } from './vfs-store';

describe('VFS Store', () => {
  let store: ReturnType<typeof createVFSStore>;

  beforeEach(() => {
    store = createVFSStore();
  });

  describe('write and read', () => {
    it('writes and reads a file', () => {
      store.getState().write('artifacts/plan.md', '# Plan', {});
      expect(store.getState().read('artifacts/plan.md')).toBe('# Plan');
    });

    it('returns null for nonexistent file', () => {
      expect(store.getState().read('nope.md')).toBeNull();
    });

    it('derives kind from path', () => {
      store.getState().write('agents/writer.md', '# Writer', {});
      const file = store.getState().files.get('agents/writer.md');
      expect(file?.kind).toBe('agent');
    });
  });

  describe('versioning', () => {
    it('creates version on first write', () => {
      store.getState().write('artifacts/plan.md', 'v1', {});
      const versions = store.getState().getVersions('artifacts/plan.md');
      expect(versions).toHaveLength(1);
      expect(versions[0].content).toBe('v1');
    });

    it('appends version on overwrite', () => {
      store.getState().write('artifacts/plan.md', 'v1', {});
      store.getState().write('artifacts/plan.md', 'v2', {});
      const versions = store.getState().getVersions('artifacts/plan.md');
      expect(versions).toHaveLength(2);
      expect(versions[1].diff).toContain('+v2');
    });

    it('stores author metadata in version', () => {
      store.getState().write('artifacts/plan.md', 'v1', {
        authorAgentId: 'writer',
        activationId: 'act-1',
      });
      const versions = store.getState().getVersions('artifacts/plan.md');
      expect(versions[0].authorAgentId).toBe('writer');
    });
  });

  describe('list', () => {
    it('lists files by prefix', () => {
      store.getState().write('agents/a.md', 'a', {});
      store.getState().write('agents/b.md', 'b', {});
      store.getState().write('artifacts/c.md', 'c', {});
      expect(store.getState().list('agents/')).toEqual(['agents/a.md', 'agents/b.md']);
    });

    it('returns empty array for no matches', () => {
      expect(store.getState().list('nope/')).toEqual([]);
    });
  });

  describe('delete', () => {
    it('removes a file', () => {
      store.getState().write('artifacts/plan.md', 'v1', {});
      store.getState().deleteFile('artifacts/plan.md');
      expect(store.getState().read('artifacts/plan.md')).toBeNull();
    });

    it('does nothing for nonexistent file', () => {
      expect(() => store.getState().deleteFile('nope.md')).not.toThrow();
    });
  });

  describe('exists', () => {
    it('returns true for existing file', () => {
      store.getState().write('artifacts/plan.md', 'v1', {});
      expect(store.getState().exists('artifacts/plan.md')).toBe(true);
    });

    it('returns false for nonexistent file', () => {
      expect(store.getState().exists('nope.md')).toBe(false);
    });
  });

  describe('getExistingPrefixes', () => {
    it('returns unique prefixes', () => {
      store.getState().write('agents/a.md', 'a', {});
      store.getState().write('artifacts/b.md', 'b', {});
      const prefixes = store.getState().getExistingPrefixes();
      expect(prefixes).toContain('agents/');
      expect(prefixes).toContain('artifacts/');
    });
  });

  describe('getAllPaths', () => {
    it('returns all file paths', () => {
      store.getState().write('agents/a.md', 'a', {});
      store.getState().write('artifacts/b.md', 'b', {});
      const paths = store.getState().getAllPaths();
      expect(paths).toHaveLength(2);
      expect(paths).toContain('agents/a.md');
      expect(paths).toContain('artifacts/b.md');
    });

    it('returns empty array when no files exist', () => {
      expect(store.getState().getAllPaths()).toEqual([]);
    });
  });
});
