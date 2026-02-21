import { createStore } from 'zustand/vanilla';
import type { VFSFile, FileVersion, WriteMeta } from '../types';
import { deriveKind, computeLineDiff } from '../utils/vfs-helpers';

export interface VFSState {
  files: Map<string, VFSFile>;
  read(path: string): string | null;
  write(path: string, content: string, meta: WriteMeta): void;
  list(prefix: string): string[];
  exists(path: string): boolean;
  deleteFile(path: string): void;
  getVersions(path: string): FileVersion[];
  getExistingPrefixes(): string[];
  getAllPaths(): string[];
}

export function createVFSStore() {
  return createStore<VFSState>((set, get) => ({
    files: new Map<string, VFSFile>(),

    read(path: string): string | null {
      const file = get().files.get(path);
      return file ? file.content : null;
    },

    write(path: string, content: string, meta: WriteMeta): void {
      const now = Date.now();
      const existing = get().files.get(path);

      const version: FileVersion = {
        timestamp: now,
        content,
        diff: existing ? computeLineDiff(existing.content, content) : '',
        authorAgentId: meta.authorAgentId,
        activationId: meta.activationId,
      };

      if (existing) {
        const updated: VFSFile = {
          ...existing,
          content,
          versions: [...existing.versions, version],
          updatedAt: now,
        };
        set((state) => {
          const next = new Map(state.files);
          next.set(path, updated);
          return { files: next };
        });
      } else {
        const file: VFSFile = {
          path,
          content,
          kind: deriveKind(path),
          versions: [version],
          createdBy: meta.authorAgentId,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => {
          const next = new Map(state.files);
          next.set(path, file);
          return { files: next };
        });
      }
    },

    list(prefix: string): string[] {
      const paths: string[] = [];
      for (const key of get().files.keys()) {
        if (key.startsWith(prefix)) {
          paths.push(key);
        }
      }
      return paths.sort();
    },

    exists(path: string): boolean {
      return get().files.has(path);
    },

    deleteFile(path: string): void {
      set((state) => {
        const next = new Map(state.files);
        next.delete(path);
        return { files: next };
      });
    },

    getVersions(path: string): FileVersion[] {
      const file = get().files.get(path);
      return file ? file.versions : [];
    },

    getExistingPrefixes(): string[] {
      const prefixes = new Set<string>();
      for (const key of get().files.keys()) {
        const slashIndex = key.indexOf('/');
        if (slashIndex !== -1) {
          prefixes.add(key.substring(0, slashIndex + 1));
        }
      }
      return [...prefixes].sort();
    },

    getAllPaths(): string[] {
      return [...get().files.keys()];
    },
  }));
}
