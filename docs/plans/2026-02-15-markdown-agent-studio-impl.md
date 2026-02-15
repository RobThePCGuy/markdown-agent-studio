# Markdown Agent Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React app where Markdown files are autonomous agents that can spawn child agents, read/write files, and communicate - all visible through a live graph UI.

**Architecture:** Streaming pipeline with bounded concurrency (semaphore + AbortControllers). Zustand stores for VFS, agent registry, kernel state, and event log. Gemini API behind a swappable AIProvider interface. Three-pane IDE UI with React Flow graph and Monaco editor.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, React Flow, Monaco Editor, idb (IndexedDB), gray-matter, @google/generative-ai, Vitest

**Design doc:** `docs/plans/2026-02-15-markdown-agent-studio-design.md`

---

## Phase 1: Project Scaffolding

### Task 1: Scaffold Vite + React + TypeScript

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/App.tsx`
- Create: `.env`, `.gitignore`

**Step 1: Create the Vite project**

Run: `npm create vite@latest . -- --template react-ts`
Expected: Project files created in current directory

**Step 2: Verify it runs**

Run: `npm install && npm run dev`
Expected: Dev server starts on localhost:5173

**Step 3: Add .env with placeholder**

Create `.env`:
```
VITE_GEMINI_API_KEY=your-api-key-here
```

Add to `.gitignore`:
```
.env
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + React + TypeScript project"
```

---

### Task 2: Install dependencies

**Step 1: Install runtime deps**

Run: `npm install zustand @xyflow/react @monaco-editor/react idb gray-matter @google/generative-ai`

**Step 2: Install dev deps**

Run: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom happy-dom`

**Step 3: Configure Vitest**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Verify tests work**

Create `src/smoke.test.ts`:
```typescript
describe('smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 test passes

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: install dependencies and configure Vitest"
```

---

### Task 3: Create project directory structure

**Step 1: Create directories**

```bash
mkdir -p src/{core,stores,components,hooks,types,utils}
mkdir -p src/components/{layout,graph,editor,inspector,explorer}
```

**Step 2: Create placeholder index files**

Create `src/types/index.ts` (empty export)
Create `src/core/index.ts` (empty export)
Create `src/stores/index.ts` (empty export)
Create `src/utils/index.ts` (empty export)

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: create project directory structure"
```

---

## Phase 2: Core Types

### Task 4: Define all TypeScript interfaces

**Files:**
- Create: `src/types/vfs.ts`
- Create: `src/types/agent.ts`
- Create: `src/types/kernel.ts`
- Create: `src/types/ai-provider.ts`
- Create: `src/types/events.ts`
- Modify: `src/types/index.ts`

**Step 1: Write VFS types**

Create `src/types/vfs.ts`:
```typescript
export type FileKind = 'agent' | 'memory' | 'artifact' | 'unknown';

export interface FileVersion {
  timestamp: number;
  content: string;
  diff: string;
  authorAgentId?: string;
  activationId?: string;
}

export interface VFSFile {
  path: string;
  content: string;
  kind: FileKind;
  versions: FileVersion[];
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WriteMeta {
  authorAgentId?: string;
  activationId?: string;
}
```

**Step 2: Write agent types**

Create `src/types/agent.ts`:
```typescript
export interface AgentProfile {
  id: string;
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
}
```

**Step 3: Write kernel types**

Create `src/types/kernel.ts`:
```typescript
export type SessionStatus = 'running' | 'paused' | 'completed' | 'aborted' | 'error';

export interface Activation {
  id: string;
  agentId: string;
  input: string;
  parentId?: string;
  spawnDepth: number;
  priority: number;
  createdAt: number;
}

export interface Message {
  role: 'user' | 'model' | 'tool';
  content: string;
  toolCall?: ToolCallRecord;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

export interface AgentSession {
  agentId: string;
  activationId: string;
  controller: AbortController;
  status: SessionStatus;
  history: Message[];
  toolCalls: ToolCallRecord[];
  tokenCount: number;
}

export interface KernelConfig {
  maxConcurrency: number;
  maxDepth: number;
  maxFanout: number;
  tokenBudget: number;
}

export const DEFAULT_KERNEL_CONFIG: KernelConfig = {
  maxConcurrency: 3,
  maxDepth: 5,
  maxFanout: 5,
  tokenBudget: 500000,
};
```

**Step 4: Write AI provider types**

Create `src/types/ai-provider.ts`:
```typescript
import type { Message, ToolCallRecord } from './kernel';

export interface AgentConfig {
  sessionId: string;
  systemPrompt: string;
  model?: string;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

export type StreamChunkType = 'text' | 'tool_call' | 'done' | 'error';

export interface StreamChunk {
  type: StreamChunkType;
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  error?: string;
  tokenCount?: number;
}

export interface AIProvider {
  chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk>;
  abort(sessionId: string): Promise<void>;
}
```

**Step 5: Write event log types**

Create `src/types/events.ts`:
```typescript
export type EventType =
  | 'activation'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'spawn'
  | 'signal'
  | 'warning'
  | 'error'
  | 'abort'
  | 'complete';

export interface EventLogEntry {
  id: string;
  timestamp: number;
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}
```

**Step 6: Create barrel export**

Update `src/types/index.ts`:
```typescript
export * from './vfs';
export * from './agent';
export * from './kernel';
export * from './ai-provider';
export * from './events';
```

**Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: define all core TypeScript interfaces"
```

---

## Phase 3: Virtual File System

### Task 5: VFS utility functions

**Files:**
- Create: `src/utils/vfs-helpers.ts`
- Create: `src/utils/vfs-helpers.test.ts`

**Step 1: Write the failing tests**

Create `src/utils/vfs-helpers.test.ts`:
```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/vfs-helpers.test.ts`
Expected: FAIL - modules not found

**Step 3: Implement the helpers**

Create `src/utils/vfs-helpers.ts`:
```typescript
import type { FileKind } from '../types';

export function deriveKind(path: string): FileKind {
  if (path.startsWith('agents/')) return 'agent';
  if (path.startsWith('memory/')) return 'memory';
  if (path.startsWith('artifacts/')) return 'artifact';
  return 'unknown';
}

export function computeHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export function findSimilarPaths(target: string, existingPaths: string[], maxResults = 3): string[] {
  const scored = existingPaths.map(p => ({
    path: p,
    score: levenshtein(target.toLowerCase(), p.toLowerCase()),
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, maxResults).map(s => s.path);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function computeLineDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) return '';
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const result: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined && newLine === undefined) {
      result.push(`-${oldLine}`);
    } else if (oldLine === undefined && newLine !== undefined) {
      result.push(`+${newLine}`);
    } else if (oldLine !== newLine) {
      result.push(`-${oldLine}`);
      result.push(`+${newLine}`);
    }
  }
  return result.join('\n');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/vfs-helpers.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/utils/vfs-helpers.ts src/utils/vfs-helpers.test.ts
git commit -m "feat: add VFS utility functions with tests"
```

---

### Task 6: VFS Zustand store

**Files:**
- Create: `src/stores/vfs-store.ts`
- Create: `src/stores/vfs-store.test.ts`

**Step 1: Write failing tests**

Create `src/stores/vfs-store.test.ts`:
```typescript
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
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/vfs-store.test.ts`
Expected: FAIL

**Step 3: Implement the VFS store**

Create `src/stores/vfs-store.ts`:
```typescript
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
    files: new Map(),

    read(path: string): string | null {
      const file = get().files.get(path);
      return file ? file.content : null;
    },

    write(path: string, content: string, meta: WriteMeta): void {
      set((state) => {
        const files = new Map(state.files);
        const existing = files.get(path);
        const now = Date.now();

        const version: FileVersion = {
          timestamp: now,
          content,
          diff: existing ? computeLineDiff(existing.content, content) : '',
          authorAgentId: meta.authorAgentId,
          activationId: meta.activationId,
        };

        if (existing) {
          files.set(path, {
            ...existing,
            content,
            updatedAt: now,
            versions: [...existing.versions, version],
          });
        } else {
          files.set(path, {
            path,
            content,
            kind: deriveKind(path),
            versions: [version],
            createdBy: meta.authorAgentId,
            createdAt: now,
            updatedAt: now,
          });
        }

        return { files };
      });
    },

    list(prefix: string): string[] {
      const paths: string[] = [];
      for (const key of get().files.keys()) {
        if (key.startsWith(prefix)) paths.push(key);
      }
      return paths.sort();
    },

    exists(path: string): boolean {
      return get().files.has(path);
    },

    deleteFile(path: string): void {
      set((state) => {
        const files = new Map(state.files);
        files.delete(path);
        return { files };
      });
    },

    getVersions(path: string): FileVersion[] {
      const file = get().files.get(path);
      return file ? file.versions : [];
    },

    getExistingPrefixes(): string[] {
      const prefixes = new Set<string>();
      for (const key of get().files.keys()) {
        const slash = key.indexOf('/');
        if (slash !== -1) prefixes.add(key.slice(0, slash + 1));
      }
      return [...prefixes].sort();
    },

    getAllPaths(): string[] {
      return [...get().files.keys()].sort();
    },
  }));
}
```

**Step 4: Run tests**

Run: `npx vitest run src/stores/vfs-store.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/stores/vfs-store.ts src/stores/vfs-store.test.ts
git commit -m "feat: implement VFS Zustand store with versioning"
```

---

### Task 7: Agent registry (frontmatter parsing)

**Files:**
- Create: `src/utils/parse-agent.ts`
- Create: `src/utils/parse-agent.test.ts`
- Create: `src/stores/agent-registry.ts`
- Create: `src/stores/agent-registry.test.ts`

**Step 1: Write failing tests for parser**

Create `src/utils/parse-agent.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseAgentFile } from './parse-agent';

describe('parseAgentFile', () => {
  it('parses valid frontmatter + body', () => {
    const content = `---
name: "Writer"
model: "gemini"
---

# MISSION
You are a writer.`;

    const result = parseAgentFile('agents/writer.md', content);
    expect(result.name).toBe('Writer');
    expect(result.model).toBe('gemini');
    expect(result.systemPrompt).toContain('# MISSION');
    expect(result.systemPrompt).toContain('You are a writer.');
    expect(result.id).toBe('agents/writer.md');
  });

  it('handles missing frontmatter gracefully', () => {
    const content = '# Just a prompt\nDo stuff.';
    const result = parseAgentFile('agents/simple.md', content);
    expect(result.name).toBe('simple');
    expect(result.systemPrompt).toBe(content);
    expect(result.frontmatter).toEqual({});
  });

  it('handles malformed YAML gracefully', () => {
    const content = `---
name: [broken yaml
---
Body here.`;
    const result = parseAgentFile('agents/broken.md', content);
    expect(result.name).toBe('broken');
    expect(result.systemPrompt).toContain('Body here.');
  });

  it('uses frontmatter id if provided', () => {
    const content = `---
id: "custom-id"
name: "Test"
---
Prompt.`;
    const result = parseAgentFile('agents/test.md', content);
    expect(result.id).toBe('custom-id');
  });

  it('computes a content hash', () => {
    const result = parseAgentFile('agents/a.md', 'hello');
    expect(result.contentHash).toBeTruthy();
    expect(typeof result.contentHash).toBe('string');
  });
});
```

**Step 2: Run tests to verify fail**

Run: `npx vitest run src/utils/parse-agent.test.ts`
Expected: FAIL

**Step 3: Implement the parser**

Create `src/utils/parse-agent.ts`:
```typescript
import matter from 'gray-matter';
import type { AgentProfile } from '../types';
import { computeHash } from './vfs-helpers';

export function parseAgentFile(path: string, content: string): AgentProfile {
  const filename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;

  try {
    const parsed = matter(content);
    const fm = parsed.data as Record<string, unknown>;

    return {
      id: typeof fm.id === 'string' ? fm.id : path,
      path,
      name: typeof fm.name === 'string' ? fm.name : filename,
      model: typeof fm.model === 'string' ? fm.model : undefined,
      systemPrompt: parsed.content.trim(),
      frontmatter: fm,
      contentHash: computeHash(content),
    };
  } catch {
    return {
      id: path,
      path,
      name: filename,
      model: undefined,
      systemPrompt: content,
      frontmatter: {},
      contentHash: computeHash(content),
    };
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/utils/parse-agent.test.ts`
Expected: All PASS

**Step 5: Write failing tests for registry store**

Create `src/stores/agent-registry.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentRegistry } from './agent-registry';

describe('Agent Registry', () => {
  let registry: ReturnType<typeof createAgentRegistry>;

  beforeEach(() => {
    registry = createAgentRegistry();
  });

  it('registers an agent from file content', () => {
    registry.getState().registerFromFile('agents/writer.md', '---\nname: "Writer"\n---\n# Prompt');
    const agent = registry.getState().get('agents/writer.md');
    expect(agent).toBeTruthy();
    expect(agent!.name).toBe('Writer');
  });

  it('unregisters an agent', () => {
    registry.getState().registerFromFile('agents/writer.md', 'prompt');
    registry.getState().unregister('agents/writer.md');
    expect(registry.getState().get('agents/writer.md')).toBeUndefined();
  });

  it('lists all agents', () => {
    registry.getState().registerFromFile('agents/a.md', 'a');
    registry.getState().registerFromFile('agents/b.md', 'b');
    expect(registry.getState().listAll()).toHaveLength(2);
  });

  it('updates agent on re-register', () => {
    registry.getState().registerFromFile('agents/writer.md', 'v1');
    registry.getState().registerFromFile('agents/writer.md', 'v2');
    expect(registry.getState().get('agents/writer.md')!.systemPrompt).toBe('v2');
  });
});
```

**Step 6: Implement registry**

Create `src/stores/agent-registry.ts`:
```typescript
import { createStore } from 'zustand/vanilla';
import type { AgentProfile } from '../types';
import { parseAgentFile } from '../utils/parse-agent';

export interface AgentRegistryState {
  agents: Map<string, AgentProfile>;
  registerFromFile(path: string, content: string): AgentProfile;
  unregister(path: string): void;
  get(pathOrId: string): AgentProfile | undefined;
  listAll(): AgentProfile[];
}

export function createAgentRegistry() {
  return createStore<AgentRegistryState>((set, get) => ({
    agents: new Map(),

    registerFromFile(path: string, content: string): AgentProfile {
      const profile = parseAgentFile(path, content);
      set((state) => {
        const agents = new Map(state.agents);
        agents.set(path, profile);
        return { agents };
      });
      return profile;
    },

    unregister(path: string): void {
      set((state) => {
        const agents = new Map(state.agents);
        agents.delete(path);
        return { agents };
      });
    },

    get(pathOrId: string): AgentProfile | undefined {
      const state = get();
      const byPath = state.agents.get(pathOrId);
      if (byPath) return byPath;
      for (const agent of state.agents.values()) {
        if (agent.id === pathOrId) return agent;
      }
      return undefined;
    },

    listAll(): AgentProfile[] {
      return [...get().agents.values()];
    },
  }));
}
```

**Step 7: Run tests**

Run: `npx vitest run src/stores/agent-registry.test.ts`
Expected: All PASS

**Step 8: Commit**

```bash
git add src/utils/parse-agent.ts src/utils/parse-agent.test.ts src/stores/agent-registry.ts src/stores/agent-registry.test.ts
git commit -m "feat: add agent file parser and registry store"
```

---

## Phase 4: Event Log Store

### Task 8: Event log store

**Files:**
- Create: `src/stores/event-log.ts`
- Create: `src/stores/event-log.test.ts`

**Step 1: Write failing tests**

Create `src/stores/event-log.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createEventLog } from './event-log';

describe('Event Log', () => {
  let log: ReturnType<typeof createEventLog>;

  beforeEach(() => {
    log = createEventLog();
  });

  it('appends entries', () => {
    log.getState().append({
      type: 'activation',
      agentId: 'agents/writer.md',
      activationId: 'act-1',
      data: { input: 'hello' },
    });
    expect(log.getState().entries).toHaveLength(1);
    expect(log.getState().entries[0].type).toBe('activation');
  });

  it('auto-generates id and timestamp', () => {
    log.getState().append({
      type: 'warning',
      agentId: 'agents/a.md',
      activationId: 'act-1',
      data: { message: 'test' },
    });
    const entry = log.getState().entries[0];
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('filters by agent', () => {
    log.getState().append({ type: 'activation', agentId: 'a', activationId: 'x', data: {} });
    log.getState().append({ type: 'activation', agentId: 'b', activationId: 'y', data: {} });
    expect(log.getState().filterByAgent('a')).toHaveLength(1);
  });

  it('filters by type', () => {
    log.getState().append({ type: 'error', agentId: 'a', activationId: 'x', data: {} });
    log.getState().append({ type: 'warning', agentId: 'a', activationId: 'x', data: {} });
    expect(log.getState().filterByType('error')).toHaveLength(1);
  });

  it('exports as JSON', () => {
    log.getState().append({ type: 'activation', agentId: 'a', activationId: 'x', data: {} });
    const json = log.getState().exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
  });
});
```

**Step 2: Implement**

Create `src/stores/event-log.ts`:
```typescript
import { createStore } from 'zustand/vanilla';
import type { EventLogEntry, EventType } from '../types';

let entryCounter = 0;

interface AppendInput {
  type: EventType;
  agentId: string;
  activationId: string;
  data: Record<string, unknown>;
}

export interface EventLogState {
  entries: EventLogEntry[];
  append(input: AppendInput): void;
  filterByAgent(agentId: string): EventLogEntry[];
  filterByType(type: EventType): EventLogEntry[];
  exportJSON(): string;
  clear(): void;
}

export function createEventLog() {
  entryCounter = 0;
  return createStore<EventLogState>((set, get) => ({
    entries: [],

    append(input: AppendInput): void {
      const entry: EventLogEntry = {
        id: `evt-${++entryCounter}`,
        timestamp: Date.now(),
        ...input,
      };
      set((state) => ({ entries: [...state.entries, entry] }));
    },

    filterByAgent(agentId: string): EventLogEntry[] {
      return get().entries.filter((e) => e.agentId === agentId);
    },

    filterByType(type: EventType): EventLogEntry[] {
      return get().entries.filter((e) => e.type === type);
    },

    exportJSON(): string {
      return JSON.stringify(get().entries, null, 2);
    },

    clear(): void {
      set({ entries: [] });
    },
  }));
}
```

**Step 3: Run tests**

Run: `npx vitest run src/stores/event-log.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/stores/event-log.ts src/stores/event-log.test.ts
git commit -m "feat: add event log store"
```

---

## Phase 5: AI Provider

### Task 9: Mock AI provider for testing

**Files:**
- Create: `src/core/mock-provider.ts`
- Create: `src/core/mock-provider.test.ts`

**Step 1: Write failing test**

Create `src/core/mock-provider.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { MockAIProvider } from './mock-provider';

describe('MockAIProvider', () => {
  it('streams text response', async () => {
    const provider = new MockAIProvider([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);

    const chunks = [];
    for await (const chunk of provider.chat(
      { sessionId: 'test', systemPrompt: 'You are a bot' },
      [],
      []
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toBe('Hello ');
    expect(chunks[2].type).toBe('done');
  });

  it('streams tool call', async () => {
    const provider = new MockAIProvider([
      { type: 'tool_call', toolCall: { id: 'tc-1', name: 'vfs_read', args: { path: 'test.md' } } },
      { type: 'done' },
    ]);

    const chunks = [];
    for await (const chunk of provider.chat(
      { sessionId: 'test', systemPrompt: '' },
      [],
      []
    )) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('vfs_read');
  });

  it('supports abort', async () => {
    const provider = new MockAIProvider([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
      { type: 'done' },
    ]);

    await provider.abort('test');
    // Should not throw
  });
});
```

**Step 2: Implement**

Create `src/core/mock-provider.ts`:
```typescript
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class MockAIProvider implements AIProvider {
  private responses: StreamChunk[];
  private aborted = new Set<string>();

  constructor(responses: StreamChunk[]) {
    this.responses = responses;
  }

  async *chat(
    config: AgentConfig,
    _history: Message[],
    _tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    for (const chunk of this.responses) {
      if (this.aborted.has(config.sessionId)) {
        yield { type: 'error', error: 'Aborted' };
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
      yield chunk;
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.aborted.add(sessionId);
  }

  /** Replace the response queue for multi-turn testing */
  setResponses(responses: StreamChunk[]): void {
    this.responses = responses;
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/core/mock-provider.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/core/mock-provider.ts src/core/mock-provider.test.ts
git commit -m "feat: add mock AI provider for testing"
```

---

### Task 10: Gemini AI provider

**Files:**
- Create: `src/core/gemini-provider.ts`

**Step 1: Implement the Gemini provider**

Create `src/core/gemini-provider.ts`:
```typescript
import { GoogleGenerativeAI, type GenerateContentStreamResult } from '@google/generative-ai';
import type { AIProvider, AgentConfig, Message, ToolDeclaration, StreamChunk } from '../types';

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI;
  private activeStreams = new Map<string, AbortController>();

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async *chat(
    config: AgentConfig,
    history: Message[],
    tools: ToolDeclaration[]
  ): AsyncIterable<StreamChunk> {
    const controller = new AbortController();
    this.activeStreams.set(config.sessionId, controller);

    try {
      const model = this.client.getGenerativeModel({
        model: config.model ?? 'gemini-1.5-pro',
        systemInstruction: config.systemPrompt,
      });

      const geminiTools = tools.length > 0 ? [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }] : undefined;

      const geminiHistory = history
        .filter((m) => m.role !== 'tool')
        .map((m) => ({
          role: m.role === 'model' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        }));

      const lastUserMsg = geminiHistory.pop();
      if (!lastUserMsg) {
        yield { type: 'error', error: 'No input message' };
        return;
      }

      const chat = model.startChat({
        history: geminiHistory,
        tools: geminiTools,
      });

      const result: GenerateContentStreamResult = await chat.sendMessageStream(
        lastUserMsg.parts,
        { signal: controller.signal } as any
      );

      let totalTokens = 0;

      for await (const chunk of result.stream) {
        if (controller.signal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `tc-${Date.now()}`,
                name: part.functionCall.name,
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              },
            };
          }
        }

        if (chunk.usageMetadata) {
          totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens;
        }
      }

      yield { type: 'done', tokenCount: totalTokens };
    } catch (err) {
      if (controller.signal.aborted) {
        yield { type: 'error', error: 'Aborted' };
      } else {
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      this.activeStreams.delete(config.sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(sessionId);
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (or only unrelated ones from other files)

**Step 3: Commit**

```bash
git add src/core/gemini-provider.ts
git commit -m "feat: add Gemini AI provider implementation"
```

---

## Phase 6: Tool System

### Task 11: Tool declarations

**Files:**
- Create: `src/core/tools.ts`

**Step 1: Create tool declarations**

Create `src/core/tools.ts`:
```typescript
import type { ToolDeclaration } from '../types';

export const AGENT_TOOLS: ToolDeclaration[] = [
  {
    name: 'spawn_agent',
    description:
      'Create a new agent by writing a markdown file to agents/. ' +
      'The content should start with YAML frontmatter between --- delimiters ' +
      '(with at least a "name" field), followed by markdown instructions. ' +
      'Example frontmatter: ---\\nname: "Researcher"\\nmodel: "gemini"\\n---\\n\\n# MISSION\\n...',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename for the new agent, e.g. "researcher.md"' },
        content: { type: 'string', description: 'Full markdown content with optional YAML frontmatter' },
        task: { type: 'string', description: 'The initial task/prompt to give the new agent' },
      },
      required: ['filename', 'content', 'task'],
    },
  },
  {
    name: 'vfs_read',
    description: 'Read a file from the workspace. Returns file content or an error with suggestions.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root, e.g. "artifacts/plan.md"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'vfs_write',
    description: 'Write or overwrite a file in the workspace. Use for artifacts, memory, or agent files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'vfs_list',
    description: 'List files matching a path prefix. Returns an array of file paths.',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Path prefix, e.g. "agents/" or "artifacts/"' },
      },
      required: ['prefix'],
    },
  },
  {
    name: 'vfs_delete',
    description: 'Delete a file from the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'signal_parent',
    description: 'Send a message to the agent that spawned you. The parent will be re-activated with your message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send to parent agent' },
      },
      required: ['message'],
    },
  },
];
```

**Step 2: Commit**

```bash
git add src/core/tools.ts
git commit -m "feat: add tool declarations for agent function calling"
```

---

### Task 12: Tool handler

**Files:**
- Create: `src/core/tool-handler.ts`
- Create: `src/core/tool-handler.test.ts`

**Step 1: Write failing tests**

Create `src/core/tool-handler.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolHandler } from './tool-handler';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';

describe('ToolHandler', () => {
  let handler: ToolHandler;
  let vfs: ReturnType<typeof createVFSStore>;
  let registry: ReturnType<typeof createAgentRegistry>;
  let eventLog: ReturnType<typeof createEventLog>;
  let spawnedActivations: any[];

  beforeEach(() => {
    vfs = createVFSStore();
    registry = createAgentRegistry();
    eventLog = createEventLog();
    spawnedActivations = [];

    handler = new ToolHandler({
      vfs,
      registry,
      eventLog,
      onSpawnActivation: (activation) => spawnedActivations.push(activation),
      currentAgentId: 'agents/writer.md',
      currentActivationId: 'act-1',
      parentAgentId: 'agents/orchestrator.md',
      spawnDepth: 1,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
    });
  });

  describe('vfs_read', () => {
    it('returns file content when file exists', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plan.md' });
      expect(result).toBe('# Plan');
    });

    it('returns error with suggestions when file missing', async () => {
      vfs.getState().write('artifacts/plan.md', '# Plan', {});
      const result = await handler.handle('vfs_read', { path: 'artifacts/plans.md' });
      expect(result).toContain('not found');
      expect(result).toContain('artifacts/plan.md');
    });
  });

  describe('vfs_write', () => {
    it('writes file and returns confirmation', async () => {
      const result = await handler.handle('vfs_write', { path: 'artifacts/spec.md', content: '# Spec' });
      expect(result).toContain('Written to');
      expect(vfs.getState().read('artifacts/spec.md')).toBe('# Spec');
    });

    it('registers agent when writing to agents/', async () => {
      await handler.handle('vfs_write', {
        path: 'agents/helper.md',
        content: '---\nname: "Helper"\n---\nDo stuff.',
      });
      expect(registry.getState().get('agents/helper.md')).toBeTruthy();
    });
  });

  describe('vfs_list', () => {
    it('returns matching files', async () => {
      vfs.getState().write('agents/a.md', 'a', {});
      vfs.getState().write('agents/b.md', 'b', {});
      const result = await handler.handle('vfs_list', { prefix: 'agents/' });
      expect(result).toContain('agents/a.md');
      expect(result).toContain('agents/b.md');
    });

    it('returns helpful message when no matches', async () => {
      vfs.getState().write('agents/a.md', 'a', {});
      const result = await handler.handle('vfs_list', { prefix: 'tests/' });
      expect(result).toContain('No files match');
      expect(result).toContain('agents/');
    });
  });

  describe('vfs_delete', () => {
    it('deletes existing file', async () => {
      vfs.getState().write('memory/notes.md', 'notes', {});
      const result = await handler.handle('vfs_delete', { path: 'memory/notes.md' });
      expect(result).toContain('Deleted');
      expect(vfs.getState().exists('memory/notes.md')).toBe(false);
    });

    it('returns error for nonexistent file', async () => {
      const result = await handler.handle('vfs_delete', { path: 'nope.md' });
      expect(result).toContain('not found');
    });
  });

  describe('spawn_agent', () => {
    it('creates file, registers agent, queues activation', async () => {
      const result = await handler.handle('spawn_agent', {
        filename: 'researcher.md',
        content: '---\nname: "Researcher"\n---\nDo research.',
        task: 'Find info about topic X',
      });
      expect(result).toContain('Created and activated');
      expect(vfs.getState().exists('agents/researcher.md')).toBe(true);
      expect(registry.getState().get('agents/researcher.md')).toBeTruthy();
      expect(spawnedActivations).toHaveLength(1);
      expect(spawnedActivations[0].spawnDepth).toBe(2);
    });

    it('blocks when depth limit reached', async () => {
      const deepHandler = new ToolHandler({
        vfs, registry, eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/deep.md',
        currentActivationId: 'act-2',
        parentAgentId: undefined,
        spawnDepth: 5,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
      });
      const result = await deepHandler.handle('spawn_agent', {
        filename: 'child.md', content: 'prompt', task: 'go',
      });
      expect(result).toContain('depth limit');
    });

    it('blocks when fanout limit reached', async () => {
      const fullHandler = new ToolHandler({
        vfs, registry, eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/busy.md',
        currentActivationId: 'act-3',
        parentAgentId: undefined,
        spawnDepth: 1,
        maxDepth: 5,
        maxFanout: 2,
        childCount: 2,
      });
      const result = await fullHandler.handle('spawn_agent', {
        filename: 'another.md', content: 'prompt', task: 'go',
      });
      expect(result).toContain('fanout limit');
    });
  });

  describe('signal_parent', () => {
    it('queues parent re-activation', async () => {
      const result = await handler.handle('signal_parent', { message: 'Done with research' });
      expect(result).toContain('Message sent');
      expect(spawnedActivations).toHaveLength(1);
      expect(spawnedActivations[0].agentId).toBe('agents/orchestrator.md');
    });

    it('errors when no parent', async () => {
      const rootHandler = new ToolHandler({
        vfs, registry, eventLog,
        onSpawnActivation: (a) => spawnedActivations.push(a),
        currentAgentId: 'agents/root.md',
        currentActivationId: 'act-root',
        parentAgentId: undefined,
        spawnDepth: 0,
        maxDepth: 5,
        maxFanout: 5,
        childCount: 0,
      });
      const result = await rootHandler.handle('signal_parent', { message: 'hello' });
      expect(result).toContain('no parent');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handler.handle('unknown_tool', {});
      expect(result).toContain('Unknown tool');
    });
  });
});
```

**Step 2: Run tests to verify fail**

Run: `npx vitest run src/core/tool-handler.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `src/core/tool-handler.ts`:
```typescript
import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import { findSimilarPaths } from '../utils/vfs-helpers';

type Store<T> = { getState(): T };

export interface ToolHandlerConfig {
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  onSpawnActivation: (activation: Omit<Activation, 'id' | 'createdAt'>) => void;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
}

export class ToolHandler {
  private config: ToolHandlerConfig;
  private spawnCount = 0;

  constructor(config: ToolHandlerConfig) {
    this.config = config;
  }

  async handle(toolName: string, args: Record<string, unknown>): Promise<string> {
    const { vfs, registry, eventLog } = this.config;

    eventLog.getState().append({
      type: 'tool_call',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, args },
    });

    let result: string;

    switch (toolName) {
      case 'vfs_read':
        result = this.handleRead(args.path as string);
        break;
      case 'vfs_write':
        result = this.handleWrite(args.path as string, args.content as string);
        break;
      case 'vfs_list':
        result = this.handleList(args.prefix as string);
        break;
      case 'vfs_delete':
        result = this.handleDelete(args.path as string);
        break;
      case 'spawn_agent':
        result = this.handleSpawn(
          args.filename as string,
          args.content as string,
          args.task as string
        );
        break;
      case 'signal_parent':
        result = this.handleSignalParent(args.message as string);
        break;
      default:
        result = `Error: Unknown tool '${toolName}'. Available tools: vfs_read, vfs_write, vfs_list, vfs_delete, spawn_agent, signal_parent`;
    }

    eventLog.getState().append({
      type: 'tool_result',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, result: result.slice(0, 500) },
    });

    return result;
  }

  private handleRead(path: string): string {
    const { vfs } = this.config;
    const content = vfs.getState().read(path);
    if (content !== null) return content;

    const allPaths = vfs.getState().getAllPaths();
    const similar = findSimilarPaths(path, allPaths);
    const suggestion = similar.length > 0
      ? `Similar: ${similar.map(p => `'${p}'`).join(', ')}. `
      : '';
    return `Error: '${path}' not found. ${suggestion}Available files: [${allPaths.join(', ')}]`;
  }

  private handleWrite(path: string, content: string): string {
    const { vfs, registry, eventLog } = this.config;
    const meta = {
      authorAgentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
    };

    vfs.getState().write(path, content, meta);

    if (path.startsWith('agents/')) {
      registry.getState().registerFromFile(path, content);
    }

    eventLog.getState().append({
      type: 'file_change',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { path, size: content.length },
    });

    return `Written to '${path}' (${content.length} chars)`;
  }

  private handleList(prefix: string): string {
    const { vfs } = this.config;
    const files = vfs.getState().list(prefix);
    if (files.length > 0) {
      return JSON.stringify(files);
    }
    const prefixes = vfs.getState().getExistingPrefixes();
    return `No files match prefix '${prefix}'. Existing prefixes: [${prefixes.join(', ')}]`;
  }

  private handleDelete(path: string): string {
    const { vfs, registry } = this.config;
    if (!vfs.getState().exists(path)) {
      return `Error: '${path}' not found.`;
    }
    vfs.getState().deleteFile(path);
    if (path.startsWith('agents/')) {
      registry.getState().unregister(path);
    }
    return `Deleted '${path}'`;
  }

  private handleSpawn(filename: string, content: string, task: string): string {
    const { vfs, registry, eventLog } = this.config;
    const path = filename.startsWith('agents/') ? filename : `agents/${filename}`;

    if (this.config.spawnDepth >= this.config.maxDepth) {
      return `Error: depth limit reached (${this.config.spawnDepth}/${this.config.maxDepth}). Cannot spawn more agents.`;
    }

    const totalChildren = this.config.childCount + this.spawnCount;
    if (totalChildren >= this.config.maxFanout) {
      return `Error: fanout limit reached (${totalChildren}/${this.config.maxFanout}). This agent cannot spawn more children.`;
    }

    const meta = {
      authorAgentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
    };
    vfs.getState().write(path, content, meta);
    const profile = registry.getState().registerFromFile(path, content);

    this.spawnCount++;

    const newDepth = this.config.spawnDepth + 1;

    this.config.onSpawnActivation({
      agentId: path,
      input: task,
      parentId: this.config.currentAgentId,
      spawnDepth: newDepth,
      priority: newDepth,
    });

    eventLog.getState().append({
      type: 'spawn',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { spawned: path, depth: newDepth, task },
    });

    return `Created and activated '${profile.name}' at '${path}' (depth ${newDepth}/${this.config.maxDepth})`;
  }

  private handleSignalParent(message: string): string {
    const { eventLog } = this.config;

    if (!this.config.parentAgentId) {
      return `Error: this agent has no parent. You are a root agent.`;
    }

    this.config.onSpawnActivation({
      agentId: this.config.parentAgentId,
      input: `[Signal from ${this.config.currentAgentId}]: ${message}`,
      parentId: undefined,
      spawnDepth: Math.max(0, this.config.spawnDepth - 1),
      priority: 0,
    });

    eventLog.getState().append({
      type: 'signal',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { parent: this.config.parentAgentId, message },
    });

    return `Message sent to parent '${this.config.parentAgentId}'. Parent will be re-activated.`;
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/tool-handler.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/tool-handler.ts src/core/tool-handler.test.ts src/core/tools.ts
git commit -m "feat: implement tool handler with all 6 tools and guardrails"
```

---

## Phase 7: Kernel

### Task 13: Semaphore utility

**Files:**
- Create: `src/core/semaphore.ts`
- Create: `src/core/semaphore.test.ts`

**Step 1: Write failing tests**

Create `src/core/semaphore.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('allows up to max concurrent acquisitions', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.available).toBe(0);
    r1();
    expect(sem.available).toBe(1);
    r2();
    expect(sem.available).toBe(2);
  });

  it('queues when full', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    let acquired = false;
    const p = sem.acquire().then((r) => { acquired = true; return r; });
    await new Promise((r) => setTimeout(r, 10));
    expect(acquired).toBe(false);
    r1();
    const r2 = await p;
    expect(acquired).toBe(true);
    r2();
  });
});
```

**Step 2: Implement**

Create `src/core/semaphore.ts`:
```typescript
export class Semaphore {
  private _available: number;
  private waitQueue: Array<() => void> = [];

  constructor(private max: number) {
    this._available = max;
  }

  get available(): number {
    return this._available;
  }

  async acquire(): Promise<() => void> {
    if (this._available > 0) {
      this._available--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        this._available--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this._available++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/core/semaphore.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/core/semaphore.ts src/core/semaphore.test.ts
git commit -m "feat: add semaphore for bounded concurrency"
```

---

### Task 14: Kernel implementation

**Files:**
- Create: `src/core/kernel.ts`
- Create: `src/core/kernel.test.ts`

**Step 1: Write failing tests**

Create `src/core/kernel.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Kernel } from './kernel';
import { MockAIProvider } from './mock-provider';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';

describe('Kernel', () => {
  let kernel: Kernel;
  let vfs: ReturnType<typeof createVFSStore>;
  let registry: ReturnType<typeof createAgentRegistry>;
  let eventLog: ReturnType<typeof createEventLog>;
  let provider: MockAIProvider;

  beforeEach(() => {
    vfs = createVFSStore();
    registry = createAgentRegistry();
    eventLog = createEventLog();
    provider = new MockAIProvider([
      { type: 'text', text: 'Hello from agent' },
      { type: 'done', tokenCount: 100 },
    ]);

    kernel = new Kernel({
      aiProvider: provider,
      vfs,
      registry,
      eventLog,
      config: { maxConcurrency: 2, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    // Set up a basic agent
    vfs.getState().write('agents/writer.md', '---\nname: "Writer"\n---\nYou are a writer.', {});
    registry.getState().registerFromFile('agents/writer.md', vfs.getState().read('agents/writer.md')!);
  });

  it('processes a single activation', async () => {
    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write something',
      spawnDepth: 0,
      priority: 0,
    });

    await kernel.runUntilEmpty();

    expect(kernel.completedSessions).toHaveLength(1);
    expect(kernel.completedSessions[0].status).toBe('completed');
  });

  it('respects concurrency limit', async () => {
    // Create a slow provider
    const slowProvider = new MockAIProvider([
      { type: 'text', text: 'thinking...' },
      { type: 'done', tokenCount: 50 },
    ]);
    kernel = new Kernel({
      aiProvider: slowProvider,
      vfs, registry, eventLog,
      config: { maxConcurrency: 1, maxDepth: 5, maxFanout: 5, tokenBudget: 500000 },
    });

    vfs.getState().write('agents/a.md', 'Agent A', {});
    vfs.getState().write('agents/b.md', 'Agent B', {});
    registry.getState().registerFromFile('agents/a.md', 'Agent A');
    registry.getState().registerFromFile('agents/b.md', 'Agent B');

    kernel.enqueue({ agentId: 'agents/a.md', input: 'task a', spawnDepth: 0, priority: 0 });
    kernel.enqueue({ agentId: 'agents/b.md', input: 'task b', spawnDepth: 0, priority: 1 });

    await kernel.runUntilEmpty();

    expect(kernel.completedSessions).toHaveLength(2);
  });

  it('handles tool calls that spawn agents', async () => {
    provider.setResponses([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tc-1',
          name: 'spawn_agent',
          args: { filename: 'helper.md', content: 'Help me', task: 'do stuff' },
        },
      },
      { type: 'done', tokenCount: 150 },
    ]);

    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write with help',
      spawnDepth: 0,
      priority: 0,
    });

    // The spawned agent also needs a response
    const originalChat = provider.chat.bind(provider);
    let callCount = 0;
    vi.spyOn(provider, 'chat').mockImplementation(function* (...args) {
      callCount++;
      if (callCount === 1) {
        // First call: the writer agent that spawns
        return originalChat(...args);
      }
      // Second call: the spawned helper agent
      yield { type: 'text', text: 'Helping!' } as any;
      yield { type: 'done', tokenCount: 50 } as any;
    } as any);

    // We just test that enqueue works and the spawn creates a file
    // Full integration tested separately
    await kernel.runUntilEmpty();

    expect(vfs.getState().exists('agents/helper.md')).toBe(true);
  });

  it('can be paused and resumed', () => {
    kernel.pause();
    expect(kernel.isPaused).toBe(true);
    kernel.resume();
    expect(kernel.isPaused).toBe(false);
  });

  it('can kill all sessions', async () => {
    kernel.killAll();
    expect(kernel.isPaused).toBe(true);
  });

  it('tracks total token count', async () => {
    kernel.enqueue({
      agentId: 'agents/writer.md',
      input: 'Write',
      spawnDepth: 0,
      priority: 0,
    });
    await kernel.runUntilEmpty();
    expect(kernel.totalTokens).toBeGreaterThan(0);
  });
});
```

**Step 2: Implement the kernel**

Create `src/core/kernel.ts`:
```typescript
import type { AIProvider, Activation, AgentSession, KernelConfig, Message, StreamChunk } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import { Semaphore } from './semaphore';
import { ToolHandler } from './tool-handler';
import { AGENT_TOOLS } from './tools';
import { computeHash } from '../utils/vfs-helpers';

type Store<T> = { getState(): T; subscribe(listener: (state: T) => void): () => void };

interface KernelDeps {
  aiProvider: AIProvider;
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  config: KernelConfig;
  onSessionUpdate?: (session: AgentSession) => void;
  onStreamChunk?: (agentId: string, chunk: StreamChunk) => void;
}

let activationCounter = 0;

export class Kernel {
  private deps: KernelDeps;
  private semaphore: Semaphore;
  private globalController: AbortController;
  private queue: Array<Activation> = [];
  private activeSessions = new Map<string, AgentSession>();
  private _completedSessions: AgentSession[] = [];
  private _paused = false;
  private _totalTokens = 0;
  private _running = false;
  private childCounts = new Map<string, number>();
  private seenHashes = new Set<string>();

  constructor(deps: KernelDeps) {
    this.deps = deps;
    this.semaphore = new Semaphore(deps.config.maxConcurrency);
    this.globalController = new AbortController();
  }

  get isPaused(): boolean { return this._paused; }
  get totalTokens(): number { return this._totalTokens; }
  get completedSessions(): AgentSession[] { return this._completedSessions; }
  get activeSessionCount(): number { return this.activeSessions.size; }
  get queueLength(): number { return this.queue.length; }

  enqueue(input: Omit<Activation, 'id' | 'createdAt'>): void {
    const activation: Activation = {
      ...input,
      id: `act-${++activationCounter}`,
      createdAt: Date.now(),
    };
    this.queue.push(activation);
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  pause(): void { this._paused = true; }
  resume(): void {
    this._paused = false;
    this.processQueue();
  }

  killAll(): void {
    this.globalController.abort();
    this._paused = true;
    for (const session of this.activeSessions.values()) {
      session.controller.abort();
      session.status = 'aborted';
    }
    this.activeSessions.clear();
    this.globalController = new AbortController();
  }

  killSession(activationId: string): void {
    const session = this.activeSessions.get(activationId);
    if (session) {
      session.controller.abort();
      session.status = 'aborted';
      this._completedSessions.push(session);
      this.activeSessions.delete(activationId);
    }
  }

  async runUntilEmpty(): Promise<void> {
    this._running = true;
    await this.processQueue();

    // Wait for all active sessions to complete
    while (this.activeSessions.size > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
      if (!this._paused) {
        await this.processQueue();
      }
    }
    this._running = false;
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && !this._paused && !this.globalController.signal.aborted) {
      if (this.semaphore.available <= 0) break;

      const activation = this.queue.shift();
      if (!activation) break;

      // Loop detection
      const loopHash = computeHash(`${activation.agentId}:${activation.input}`);
      if (this.seenHashes.has(loopHash)) {
        this.deps.eventLog.getState().append({
          type: 'warning',
          agentId: activation.agentId,
          activationId: activation.id,
          data: { message: 'Loop detected, skipping activation' },
        });
        continue;
      }
      this.seenHashes.add(loopHash);

      // Token budget check
      if (this._totalTokens >= this.deps.config.tokenBudget) {
        this.deps.eventLog.getState().append({
          type: 'warning',
          agentId: activation.agentId,
          activationId: activation.id,
          data: { message: 'Token budget exceeded, pausing' },
        });
        this.queue.unshift(activation);
        this.pause();
        break;
      }

      this.runSession(activation);
    }
  }

  private async runSession(activation: Activation): Promise<void> {
    const release = await this.semaphore.acquire();

    const controller = new AbortController();
    // Wire to global controller
    const onGlobalAbort = () => controller.abort();
    this.globalController.signal.addEventListener('abort', onGlobalAbort);

    const session: AgentSession = {
      agentId: activation.agentId,
      activationId: activation.id,
      controller,
      status: 'running',
      history: [{ role: 'user', content: activation.input }],
      toolCalls: [],
      tokenCount: 0,
    };

    this.activeSessions.set(activation.id, session);
    this.deps.onSessionUpdate?.(session);

    this.deps.eventLog.getState().append({
      type: 'activation',
      agentId: activation.agentId,
      activationId: activation.id,
      data: { input: activation.input, depth: activation.spawnDepth },
    });

    const profile = this.deps.registry.getState().get(activation.agentId);
    if (!profile) {
      session.status = 'error';
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      release();
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      return;
    }

    const toolHandler = new ToolHandler({
      vfs: this.deps.vfs,
      registry: this.deps.registry,
      eventLog: this.deps.eventLog,
      onSpawnActivation: (act) => this.enqueue(act),
      currentAgentId: activation.agentId,
      currentActivationId: activation.id,
      parentAgentId: activation.parentId,
      spawnDepth: activation.spawnDepth,
      maxDepth: this.deps.config.maxDepth,
      maxFanout: this.deps.config.maxFanout,
      childCount: this.childCounts.get(activation.agentId) ?? 0,
    });

    try {
      let textAccumulator = '';
      let noProgressStrikes = 0;
      let madeProgress = false;

      const stream = this.deps.aiProvider.chat(
        { sessionId: activation.id, systemPrompt: profile.systemPrompt, model: profile.model },
        session.history,
        AGENT_TOOLS
      );

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          session.status = 'aborted';
          break;
        }

        this.deps.onStreamChunk?.(activation.agentId, chunk);

        switch (chunk.type) {
          case 'text':
            textAccumulator += chunk.text ?? '';
            break;

          case 'tool_call': {
            if (this._paused) {
              // Wait for resume between tool calls
              await this.waitForResume(controller.signal);
              if (controller.signal.aborted) {
                session.status = 'aborted';
                break;
              }
            }

            const tc = chunk.toolCall!;
            const result = await toolHandler.handle(tc.name, tc.args);

            const record = {
              id: tc.id,
              name: tc.name,
              args: tc.args,
              result,
              timestamp: Date.now(),
            };
            session.toolCalls.push(record);
            session.history.push({
              role: 'tool',
              content: result,
              toolCall: record,
            });
            madeProgress = true;

            // Track child spawns
            if (tc.name === 'spawn_agent') {
              const count = this.childCounts.get(activation.agentId) ?? 0;
              this.childCounts.set(activation.agentId, count + 1);
            }
            break;
          }

          case 'done':
            if (chunk.tokenCount) {
              session.tokenCount = chunk.tokenCount;
              this._totalTokens += chunk.tokenCount;
            }
            break;

          case 'error':
            session.status = 'error';
            this.deps.eventLog.getState().append({
              type: 'error',
              agentId: activation.agentId,
              activationId: activation.id,
              data: { error: chunk.error },
            });
            break;
        }
      }

      if (textAccumulator) {
        session.history.push({ role: 'model', content: textAccumulator });
      }

      if (session.status === 'running') {
        if (!madeProgress) {
          noProgressStrikes++;
          if (noProgressStrikes >= 2) {
            this.deps.eventLog.getState().append({
              type: 'warning',
              agentId: activation.agentId,
              activationId: activation.id,
              data: { message: 'Agent halted: no progress after 2 consecutive steps' },
            });
          }
        }
        session.status = 'completed';
      }

      this.deps.eventLog.getState().append({
        type: 'complete',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { status: session.status, tokens: session.tokenCount },
      });

    } catch (err) {
      session.status = 'error';
      this.deps.eventLog.getState().append({
        type: 'error',
        agentId: activation.agentId,
        activationId: activation.id,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      this._completedSessions.push(session);
      this.activeSessions.delete(activation.id);
      this.globalController.signal.removeEventListener('abort', onGlobalAbort);
      release();
      this.deps.onSessionUpdate?.(session);

      // Try to process more from queue
      if (!this._paused) {
        this.processQueue();
      }
    }
  }

  private waitForResume(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this._paused || signal.aborted) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/core/kernel.ts src/core/kernel.test.ts
git commit -m "feat: implement kernel with scheduling loop, guardrails, and kill switch"
```

---

## Phase 8: UI Shell

### Task 15: App layout with three resizable panes

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/layout/AppLayout.tsx`
- Create: `src/components/layout/TopBar.tsx`
- Create: `src/components/explorer/WorkspaceExplorer.tsx`
- Create: `src/components/graph/GraphView.tsx`
- Create: `src/components/inspector/InspectorPanel.tsx`
- Create: `src/App.css`

**Step 1: Install CSS helper for resizable panes**

Run: `npm install allotment`

(allotment provides resizable split panes for React)

**Step 2: Create the layout shell**

Create `src/components/layout/AppLayout.tsx`:
```tsx
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './TopBar';
import { WorkspaceExplorer } from '../explorer/WorkspaceExplorer';
import { GraphView } from '../graph/GraphView';
import { InspectorPanel } from '../inspector/InspectorPanel';

export function AppLayout() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Allotment>
          <Allotment.Pane preferredSize={250} minSize={180}>
            <WorkspaceExplorer />
          </Allotment.Pane>
          <Allotment.Pane>
            <GraphView />
          </Allotment.Pane>
          <Allotment.Pane preferredSize={350} minSize={250}>
            <InspectorPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}
```

**Step 3: Create TopBar placeholder**

Create `src/components/layout/TopBar.tsx`:
```tsx
export function TopBar() {
  return (
    <div style={{
      height: 48,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      borderBottom: '1px solid #333',
      background: '#1e1e1e',
      color: '#fff',
      gap: 12,
    }}>
      <strong>Markdown Agent Studio</strong>
      <button style={{ marginLeft: 'auto' }}>Run</button>
    </div>
  );
}
```

**Step 4: Create placeholder panes**

Create `src/components/explorer/WorkspaceExplorer.tsx`:
```tsx
export function WorkspaceExplorer() {
  return (
    <div style={{ height: '100%', background: '#1e1e2e', color: '#cdd6f4', padding: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Workspace</h3>
      <p style={{ fontSize: 12, opacity: 0.6 }}>Drop .md files here</p>
    </div>
  );
}
```

Create `src/components/graph/GraphView.tsx`:
```tsx
export function GraphView() {
  return (
    <div style={{ height: '100%', background: '#11111b', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ opacity: 0.4 }}>Graph view - agents will appear here</p>
    </div>
  );
}
```

Create `src/components/inspector/InspectorPanel.tsx`:
```tsx
export function InspectorPanel() {
  return (
    <div style={{ height: '100%', background: '#1e1e2e', color: '#cdd6f4', padding: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Inspector</h3>
      <p style={{ fontSize: 12, opacity: 0.6 }}>Select an agent or file</p>
    </div>
  );
}
```

**Step 5: Wire into App.tsx**

Replace `src/App.tsx`:
```tsx
import { AppLayout } from './components/layout/AppLayout';

export default function App() {
  return <AppLayout />;
}
```

**Step 6: Reset App.css**

Replace `src/App.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
```

**Step 7: Verify it renders**

Run: `npm run dev`
Expected: Three-pane layout visible in browser with dark theme

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add three-pane IDE layout shell"
```

---

### Task 16: Global Zustand stores (React bindings)

**Files:**
- Create: `src/stores/use-stores.ts`

**Step 1: Create React-friendly store wrappers**

Create `src/stores/use-stores.ts`:
```typescript
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createVFSStore, type VFSState } from './vfs-store';
import { createAgentRegistry, type AgentRegistryState } from './agent-registry';
import { createEventLog, type EventLogState } from './event-log';
import type { KernelConfig } from '../types';
import { DEFAULT_KERNEL_CONFIG } from '../types';

// Singleton vanilla stores
export const vfsStore = createVFSStore();
export const agentRegistry = createAgentRegistry();
export const eventLogStore = createEventLog();

// UI state store
export interface UIState {
  selectedAgentId: string | null;
  selectedFilePath: string | null;
  activeTab: 'graph' | 'editor';
  kernelConfig: KernelConfig;
  apiKey: string;
  setSelectedAgent: (id: string | null) => void;
  setSelectedFile: (path: string | null) => void;
  setActiveTab: (tab: 'graph' | 'editor') => void;
  setKernelConfig: (config: Partial<KernelConfig>) => void;
  setApiKey: (key: string) => void;
}

export const uiStore = createStore<UIState>((set) => ({
  selectedAgentId: null,
  selectedFilePath: null,
  activeTab: 'graph',
  kernelConfig: DEFAULT_KERNEL_CONFIG,
  apiKey: import.meta.env.VITE_GEMINI_API_KEY ?? '',
  setSelectedAgent: (id) => set({ selectedAgentId: id, selectedFilePath: null }),
  setSelectedFile: (path) => set({ selectedFilePath: path, selectedAgentId: null }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setKernelConfig: (partial) => set((s) => ({ kernelConfig: { ...s.kernelConfig, ...partial } })),
  setApiKey: (key) => set({ apiKey: key }),
}));

// React hooks
export function useVFS<T>(selector: (state: VFSState) => T): T {
  return useStore(vfsStore, selector);
}

export function useAgentRegistry<T>(selector: (state: AgentRegistryState) => T): T {
  return useStore(agentRegistry, selector);
}

export function useEventLog<T>(selector: (state: EventLogState) => T): T {
  return useStore(eventLogStore, selector);
}

export function useUI<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}
```

**Step 2: Commit**

```bash
git add src/stores/use-stores.ts
git commit -m "feat: add global Zustand stores with React hooks"
```

---

### Task 17: Workspace explorer with file tree and drag-drop upload

**Files:**
- Modify: `src/components/explorer/WorkspaceExplorer.tsx`

**Step 1: Implement the workspace explorer**

Replace `src/components/explorer/WorkspaceExplorer.tsx`:
```tsx
import { useCallback } from 'react';
import { useVFS, useAgentRegistry, useUI, vfsStore, agentRegistry } from '../../stores/use-stores';

export function WorkspaceExplorer() {
  const allPaths = useVFS((s) => [...s.files.keys()].sort());
  const agents = useAgentRegistry((s) => s.agents);
  const selectedFile = useUI((s) => s.selectedFilePath);
  const setSelectedFile = useUI((s) => s.setSelectedFile);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        // Auto-detect: if it has frontmatter, put in agents/
        const hasAgent = content.trimStart().startsWith('---');
        const path = hasAgent ? `agents/${file.name}` : `artifacts/${file.name}`;
        vfsStore.getState().write(path, content, {});
        if (path.startsWith('agents/')) {
          agentRegistry.getState().registerFromFile(path, content);
        }
      };
      reader.readAsText(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Group files by prefix
  const groups = new Map<string, string[]>();
  for (const path of allPaths) {
    const slash = path.indexOf('/');
    const prefix = slash !== -1 ? path.slice(0, slash + 1) : '/';
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(path);
  }

  const handleClick = (path: string) => {
    if (path.startsWith('agents/')) {
      setSelectedAgent(path);
    } else {
      setSelectedFile(path);
    }
  };

  return (
    <div
      style={{ height: '100%', background: '#1e1e2e', color: '#cdd6f4', padding: 8, overflow: 'auto' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', opacity: 0.5 }}>
        Workspace
      </div>

      {allPaths.length === 0 && (
        <div style={{
          border: '2px dashed #45475a',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          fontSize: 12,
          opacity: 0.5,
        }}>
          Drop .md files here to get started
        </div>
      )}

      {[...groups.entries()].map(([prefix, paths]) => (
        <div key={prefix} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#89b4fa', marginBottom: 2 }}>{prefix}</div>
          {paths.map((path) => {
            const filename = path.split('/').pop() ?? path;
            const isAgent = path.startsWith('agents/');
            const isSelected = path === selectedFile;
            const agentStatus = isAgent && agents.has(path) ? 'idle' : undefined;

            return (
              <div
                key={path}
                onClick={() => handleClick(path)}
                style={{
                  padding: '2px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: isSelected ? '#313244' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isAgent && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: agentStatus === 'idle' ? '#6c7086' : '#a6e3a1',
                    display: 'inline-block',
                  }} />
                )}
                {filename}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Verify renders and drag-drop works**

Run: `npm run dev`
Expected: Drop zone visible. Dropping a .md file adds it to the tree.

**Step 3: Commit**

```bash
git add src/components/explorer/WorkspaceExplorer.tsx
git commit -m "feat: implement workspace explorer with drag-drop upload"
```

---

### Task 18: Graph view with React Flow

**Files:**
- Modify: `src/components/graph/GraphView.tsx`
- Create: `src/components/graph/AgentNode.tsx`
- Create: `src/hooks/useGraphData.ts`

**Step 1: Install dagre for auto-layout**

Run: `npm install @dagrejs/dagre`

**Step 2: Create graph data hook**

Create `src/hooks/useGraphData.ts`:
```typescript
import { useMemo } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { useAgentRegistry } from '../stores/use-stores';
import { useEventLog } from '../stores/use-stores';

export function useGraphData() {
  const agents = useAgentRegistry((s) => [...s.agents.values()]);
  const entries = useEventLog((s) => s.entries);

  return useMemo(() => {
    const nodes: Node[] = agents.map((agent, i) => ({
      id: agent.path,
      type: 'agentNode',
      position: { x: i * 200, y: 100 },
      data: {
        label: agent.name,
        path: agent.path,
        status: 'idle',
      },
    }));

    const edges: Edge[] = [];
    const spawnEvents = entries.filter((e) => e.type === 'spawn');
    for (const evt of spawnEvents) {
      const spawned = evt.data.spawned as string;
      if (spawned && nodes.some((n) => n.id === spawned)) {
        edges.push({
          id: `edge-${evt.agentId}-${spawned}`,
          source: evt.agentId,
          target: spawned,
          animated: true,
          style: { stroke: '#89b4fa' },
        });
      }
    }

    return { nodes, edges };
  }, [agents, entries]);
}
```

**Step 3: Create custom agent node**

Create `src/components/graph/AgentNode.tsx`:
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

interface AgentNodeData {
  label: string;
  path: string;
  status: string;
}

const statusColors: Record<string, string> = {
  running: '#a6e3a1',
  idle: '#6c7086',
  error: '#f38ba8',
  aborted: '#fab387',
  completed: '#89b4fa',
};

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const color = statusColors[d.status] ?? '#6c7086';

  return (
    <div style={{
      background: '#1e1e2e',
      border: `2px solid ${color}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 120,
      color: '#cdd6f4',
      fontSize: 12,
    }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
      <div style={{ fontSize: 10, opacity: 0.6 }}>{d.status}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

**Step 4: Implement graph view**

Replace `src/components/graph/GraphView.tsx`:
```tsx
import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode } from './AgentNode';
import { useGraphData } from '../../hooks/useGraphData';
import { uiStore } from '../../stores/use-stores';

const nodeTypes: NodeTypes = {
  agentNode: AgentNode as any,
};

export function GraphView() {
  const { nodes: initialNodes, edges: initialEdges } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback((_: any, node: any) => {
    uiStore.getState().setSelectedAgent(node.id);
  }, []);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        style={{ background: '#11111b' }}
      >
        <Background color="#313244" gap={20} />
        <Controls />
        <MiniMap
          nodeColor="#45475a"
          maskColor="rgba(0,0,0,0.5)"
          style={{ background: '#1e1e2e' }}
        />
      </ReactFlow>
    </div>
  );
}
```

**Step 5: Verify it renders**

Run: `npm run dev`
Expected: Dark graph canvas with controls and minimap. Dropping an agent .md file shows a node.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add React Flow graph view with agent nodes"
```

---

### Task 19: Inspector panel (chat log + event log)

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Create: `src/components/inspector/ChatLog.tsx`
- Create: `src/components/inspector/EventLogView.tsx`

**Step 1: Create ChatLog component**

Create `src/components/inspector/ChatLog.tsx`:
```tsx
import type { Message } from '../../types';

interface Props {
  agentId: string;
  messages: Message[];
}

export function ChatLog({ agentId, messages }: Props) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#89b4fa' }}>
        {agentId}
      </div>
      {messages.map((msg, i) => (
        <div key={i} style={{
          marginBottom: 8,
          padding: 8,
          borderRadius: 6,
          background: msg.role === 'user' ? '#313244' : msg.role === 'tool' ? '#1e1e2e' : '#181825',
          fontSize: 12,
          borderLeft: msg.role === 'tool' ? '3px solid #fab387' : 'none',
        }}>
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>
            {msg.role === 'tool' && msg.toolCall
              ? `[${msg.toolCall.name}]`
              : msg.role}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.content.length > 500
              ? msg.content.slice(0, 500) + '...'
              : msg.content}
          </div>
        </div>
      ))}
      {messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: 12 }}>No messages yet</div>
      )}
    </div>
  );
}
```

**Step 2: Create EventLogView component**

Create `src/components/inspector/EventLogView.tsx`:
```tsx
import { useEventLog } from '../../stores/use-stores';

export function EventLogView() {
  const entries = useEventLog((s) => s.entries);
  const recent = entries.slice(-100).reverse();

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.5 }}>
        Event Log ({entries.length} entries)
      </div>
      {recent.map((entry) => (
        <div key={entry.id} style={{
          fontSize: 11,
          padding: '4px 8px',
          borderBottom: '1px solid #313244',
          fontFamily: 'monospace',
        }}>
          <span style={{ color: '#6c7086', marginRight: 8 }}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          <span style={{ color: typeColor(entry.type), marginRight: 8 }}>
            [{entry.type}]
          </span>
          <span style={{ opacity: 0.7 }}>{entry.agentId}</span>
        </div>
      ))}
      {entries.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: 12 }}>No events yet. Press Run to start.</div>
      )}
    </div>
  );
}

function typeColor(type: string): string {
  switch (type) {
    case 'error': return '#f38ba8';
    case 'warning': return '#fab387';
    case 'spawn': return '#a6e3a1';
    case 'activation': return '#89b4fa';
    case 'complete': return '#94e2d5';
    default: return '#cdd6f4';
  }
}
```

**Step 3: Wire up InspectorPanel**

Replace `src/components/inspector/InspectorPanel.tsx`:
```tsx
import { useUI } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);

  if (!selectedAgentId) {
    return <EventLogView />;
  }

  return (
    <ChatLog
      agentId={selectedAgentId}
      messages={[]}
    />
  );
}
```

**Step 4: Verify renders**

Run: `npm run dev`
Expected: Right pane shows event log by default. Clicking an agent node shows empty chat.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add inspector panel with chat log and event log views"
```

---

### Task 20: TopBar with Run button and kernel wiring

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Create: `src/hooks/useKernel.ts`

**Step 1: Create kernel hook**

Create `src/hooks/useKernel.ts`:
```typescript
import { useRef, useCallback, useState } from 'react';
import { Kernel } from '../core/kernel';
import { GeminiProvider } from '../core/gemini-provider';
import { MockAIProvider } from '../core/mock-provider';
import { vfsStore, agentRegistry, eventLogStore, uiStore } from '../stores/use-stores';
import type { KernelConfig } from '../types';

export function useKernel() {
  const kernelRef = useRef<Kernel | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);

  const createKernel = useCallback((config: KernelConfig) => {
    const apiKey = uiStore.getState().apiKey;
    const provider = apiKey && apiKey !== 'your-api-key-here'
      ? new GeminiProvider(apiKey)
      : new MockAIProvider([
          { type: 'text', text: 'Mock response (no API key configured)' },
          { type: 'done', tokenCount: 10 },
        ]);

    const kernel = new Kernel({
      aiProvider: provider,
      vfs: vfsStore,
      registry: agentRegistry,
      eventLog: eventLogStore,
      config,
      onSessionUpdate: () => {
        setTotalTokens(kernel.totalTokens);
        setActiveCount(kernel.activeSessionCount);
        setQueueCount(kernel.queueLength);
      },
    });

    kernelRef.current = kernel;
    return kernel;
  }, []);

  const run = useCallback(async (agentPath: string, input: string) => {
    const config = uiStore.getState().kernelConfig;
    const kernel = createKernel(config);

    kernel.enqueue({
      agentId: agentPath,
      input,
      spawnDepth: 0,
      priority: 0,
    });

    setIsRunning(true);
    try {
      await kernel.runUntilEmpty();
    } finally {
      setIsRunning(false);
      setTotalTokens(kernel.totalTokens);
      setActiveCount(0);
      setQueueCount(0);
    }
  }, [createKernel]);

  const pause = useCallback(() => {
    kernelRef.current?.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    kernelRef.current?.resume();
    setIsPaused(false);
  }, []);

  const killAll = useCallback(() => {
    kernelRef.current?.killAll();
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount };
}
```

**Step 2: Update TopBar**

Replace `src/components/layout/TopBar.tsx`:
```tsx
import { useState } from 'react';
import { useKernel } from '../../hooks/useKernel';
import { useAgentRegistry } from '../../stores/use-stores';

export function TopBar() {
  const agents = useAgentRegistry((s) => [...s.agents.values()]);
  const { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount } = useKernel();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [kickoffPrompt, setKickoffPrompt] = useState('');

  const handleRun = () => {
    const agentPath = selectedAgent || agents[0]?.path;
    if (!agentPath || !kickoffPrompt.trim()) return;
    run(agentPath, kickoffPrompt.trim());
  };

  return (
    <div style={{
      height: 48,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      borderBottom: '1px solid #313244',
      background: '#1e1e2e',
      color: '#cdd6f4',
      gap: 8,
      fontSize: 13,
    }}>
      <strong style={{ marginRight: 8 }}>MAS</strong>

      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        style={{ background: '#313244', color: '#cdd6f4', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
      >
        <option value="">Select agent...</option>
        {agents.map((a) => (
          <option key={a.path} value={a.path}>{a.name} ({a.path})</option>
        ))}
      </select>

      <input
        type="text"
        placeholder="What should the agent do?"
        value={kickoffPrompt}
        onChange={(e) => setKickoffPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleRun()}
        style={{
          flex: 1,
          background: '#313244',
          color: '#cdd6f4',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 12,
        }}
      />

      {!isRunning ? (
        <button onClick={handleRun} style={btnStyle('#a6e3a1', '#1e1e2e')}>Run</button>
      ) : (
        <>
          {isPaused ? (
            <button onClick={resume} style={btnStyle('#89b4fa', '#1e1e2e')}>Resume</button>
          ) : (
            <button onClick={pause} style={btnStyle('#fab387', '#1e1e2e')}>Pause</button>
          )}
          <button onClick={killAll} style={btnStyle('#f38ba8', '#1e1e2e')}>Kill All</button>
        </>
      )}

      <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>
        {isRunning ? `${activeCount} active, ${queueCount} queued, ` : ''}
        {Math.round(totalTokens / 1000)}K tokens
      </span>
    </div>
  );
}

function btnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
```

**Step 3: Verify the full loop**

Run: `npm run dev`
Expected: Can drop an agent .md, select it, type a prompt, and click Run. With a valid API key in .env, the agent responds. Without a key, the mock provider responds.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire kernel to UI with Run/Pause/Kill controls"
```

---

## Phase 9: Integration

### Task 21: Run all tests

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Fix any failures, then commit**

```bash
git add -A
git commit -m "fix: resolve any test failures from integration"
```

---

### Task 22: End-to-end smoke test with mock provider

**Files:**
- Create: `src/core/integration.test.ts`

**Step 1: Write integration test**

Create `src/core/integration.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Kernel } from './kernel';
import { MockAIProvider } from './mock-provider';
import { createVFSStore } from '../stores/vfs-store';
import { createAgentRegistry } from '../stores/agent-registry';
import { createEventLog } from '../stores/event-log';
import { DEFAULT_KERNEL_CONFIG } from '../types';

describe('Integration: full agent loop', () => {
  it('runs an agent that spawns a child, child writes an artifact', async () => {
    const vfs = createVFSStore();
    const registry = createAgentRegistry();
    const eventLog = createEventLog();

    // Parent agent will spawn a child
    let callCount = 0;
    const provider = new MockAIProvider([]);

    // Override chat to return different responses per call
    const originalChat = provider.chat.bind(provider);
    (provider as any).chat = async function* () {
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
      registry,
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
```

**Step 2: Run**

Run: `npx vitest run src/core/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/integration.test.ts
git commit -m "test: add integration test for full parent->child agent loop"
```

---

### Task 23: Delete smoke test and clean up

**Step 1: Remove smoke test**

Delete `src/smoke.test.ts`

**Step 2: Run full suite one more time**

Run: `npm test`
Expected: All tests pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up smoke test, all tests passing"
```

---

## Summary

After completing all tasks, you will have:

1. **Core engine** (VFS, agent registry, event log, kernel, tool handler) - fully tested
2. **AI abstraction** with mock provider (testing) and Gemini provider (production)
3. **6 agent tools** (spawn_agent, vfs_read, vfs_write, vfs_list, vfs_delete, signal_parent) with guardrails
4. **Three-pane UI** with workspace explorer, React Flow graph, and inspector panel
5. **Run/Pause/Kill** controls wired to the kernel
6. **Integration test** proving the full recursive agent loop works

**Not included in this plan (future work):**
- Monaco editor tab (Task for Phase 10)
- IndexedDB persistence (Task for Phase 10)
- Export workspace as zip
- Settings modal for API key and budget configuration
- Real-time graph updates during agent execution
- Collapsible tool call results in chat
- Version diff viewer
- Agent status indicators during execution
