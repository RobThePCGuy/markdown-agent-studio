# Tool Plugin Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace MAS's hardcoded tool system with a plugin architecture. Add web_fetch, web_search, and custom tool definitions.

**Architecture:** ToolPlugin interface + ToolPluginRegistry. Each built-in tool extracted to its own file. ToolHandler delegates to registry. Custom tools from frontmatter spawn sub-agents. web_search uses Gemini Search Grounding.

**Tech Stack:** TypeScript, Zustand, Vitest, Google Generative AI SDK

---

### Task 1: ToolPlugin types and ToolPluginRegistry

**Files:**
- Create: `src/core/tool-plugin.ts`
- Test: `src/core/tool-plugin.test.ts`

**Context:** This is the foundation - the ToolPlugin interface and ToolPluginRegistry class that everything else depends on. The registry manages tool plugins and converts them to ToolDeclaration format for the AI provider.

**Step 1: Write the failing tests**

```typescript
// src/core/tool-plugin.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolPluginRegistry, type ToolPlugin, type ToolContext } from './tool-plugin';

describe('ToolPluginRegistry', () => {
  let registry: ToolPluginRegistry;

  const mockPlugin: ToolPlugin = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {
      input: { type: 'string', description: 'Test input', required: true },
    },
    handler: async () => 'test result',
  };

  beforeEach(() => {
    registry = new ToolPluginRegistry();
  });

  it('registers and retrieves a plugin', () => {
    registry.register(mockPlugin);
    expect(registry.get('test_tool')).toBe(mockPlugin);
  });

  it('returns undefined for unknown plugin', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('unregisters a plugin', () => {
    registry.register(mockPlugin);
    registry.unregister('test_tool');
    expect(registry.get('test_tool')).toBeUndefined();
  });

  it('lists all plugins', () => {
    registry.register(mockPlugin);
    registry.register({ ...mockPlugin, name: 'another_tool' });
    expect(registry.getAll()).toHaveLength(2);
  });

  it('converts to ToolDeclarations', () => {
    registry.register(mockPlugin);
    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('test_tool');
    expect(defs[0].description).toBe('A test tool');
    expect(defs[0].parameters.type).toBe('object');
    expect(defs[0].parameters.properties.input.type).toBe('string');
    expect(defs[0].parameters.required).toEqual(['input']);
  });

  it('does not include non-required params in required array', () => {
    registry.register({
      ...mockPlugin,
      parameters: {
        input: { type: 'string', description: 'required', required: true },
        optional: { type: 'number', description: 'optional' },
      },
    });
    const defs = registry.toToolDefinitions();
    expect(defs[0].parameters.required).toEqual(['input']);
  });

  it('creates a clone with additional plugins', () => {
    registry.register(mockPlugin);
    const extra: ToolPlugin = { ...mockPlugin, name: 'extra' };
    const cloned = registry.cloneWith([extra]);
    expect(cloned.getAll()).toHaveLength(2);
    // Original unchanged
    expect(registry.getAll()).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/tool-plugin.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/core/tool-plugin.ts
import type { ToolDeclaration } from '../types/ai-provider';
import type { Activation } from '../types/kernel';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';

type Store<T> = { getState(): T };

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
}

export interface ToolContext {
  vfs: Store<VFSState>;
  registry: Store<AgentRegistryState>;
  eventLog: Store<EventLogState>;
  currentAgentId: string;
  currentActivationId: string;
  parentAgentId?: string;
  spawnDepth: number;
  maxDepth: number;
  maxFanout: number;
  childCount: number;
  spawnCount: number;
  onSpawnActivation: (act: Omit<Activation, 'id' | 'createdAt'>) => void;
  incrementSpawnCount: () => void;
}

export interface ToolPlugin {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export class ToolPluginRegistry {
  private plugins = new Map<string, ToolPlugin>();

  register(plugin: ToolPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  get(name: string): ToolPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): ToolPlugin[] {
    return [...this.plugins.values()];
  }

  toToolDefinitions(): ToolDeclaration[] {
    return this.getAll().map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(plugin.parameters).map(([key, param]) => [
            key,
            { type: param.type, description: param.description },
          ])
        ),
        required: Object.entries(plugin.parameters)
          .filter(([, param]) => param.required)
          .map(([key]) => key),
      },
    }));
  }

  cloneWith(extras: ToolPlugin[]): ToolPluginRegistry {
    const cloned = new ToolPluginRegistry();
    for (const plugin of this.plugins.values()) {
      cloned.register(plugin);
    }
    for (const plugin of extras) {
      cloned.register(plugin);
    }
    return cloned;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/tool-plugin.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/tool-plugin.ts src/core/tool-plugin.test.ts
git commit -m "feat: add ToolPlugin interface and ToolPluginRegistry"
```

---

### Task 2: Extract existing tools to plugin files

**Files:**
- Create: `src/core/plugins/vfs-read.ts`
- Create: `src/core/plugins/vfs-write.ts`
- Create: `src/core/plugins/vfs-list.ts`
- Create: `src/core/plugins/vfs-delete.ts`
- Create: `src/core/plugins/spawn-agent.ts`
- Create: `src/core/plugins/signal-parent.ts`
- Create: `src/core/plugins/index.ts`
- Test: `src/core/plugins/builtin-plugins.test.ts`

**Context:** Extract each case from the current `ToolHandler.handle()` switch statement into a standalone ToolPlugin. Each plugin is a single file exporting a function that creates a ToolPlugin object. The `plugins/index.ts` file exports a `createBuiltinRegistry()` function that creates a ToolPluginRegistry with all 6 built-in plugins registered.

The existing `ToolHandler` tests in `src/core/tool-handler.test.ts` validate behavior. We write new tests for the plugin format and a sanity check, then the existing tool-handler tests will validate behavior after Task 3 wires things up.

**Step 1: Write the test for builtin plugins**

```typescript
// src/core/plugins/builtin-plugins.test.ts
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/plugins/builtin-plugins.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the plugin files**

Each plugin exports a `ToolPlugin` object. Extract the handler logic directly from the existing `ToolHandler` private methods. Keep the exact same logic and return strings.

`src/core/plugins/vfs-read.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';
import { findSimilarPaths } from '../../utils/vfs-helpers';

export const vfsReadPlugin: ToolPlugin = {
  name: 'vfs_read',
  description: 'Read a file from the workspace. Returns file content or an error with suggestions.',
  parameters: {
    path: { type: 'string', description: 'File path relative to workspace root, e.g. "artifacts/plan.md"', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const content = ctx.vfs.getState().read(path);
    if (content !== null) return content;

    const allPaths = ctx.vfs.getState().getAllPaths();
    const similar = findSimilarPaths(path, allPaths);
    const suggestion = similar.length > 0
      ? `Similar: ${similar.map((p) => `'${p}'`).join(', ')}. `
      : '';
    return `Error: '${path}' not found. ${suggestion}Available files: [${allPaths.join(', ')}]`;
  },
};
```

`src/core/plugins/vfs-write.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';

export const vfsWritePlugin: ToolPlugin = {
  name: 'vfs_write',
  description: 'Write or overwrite a file in the workspace. Use for artifacts, memory, or agent files.',
  parameters: {
    path: { type: 'string', description: 'File path relative to workspace root', required: true },
    content: { type: 'string', description: 'Full file content to write', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    const content = args.content as string;
    const meta = {
      authorAgentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
    };

    ctx.vfs.getState().write(path, content, meta);

    if (path.startsWith('agents/')) {
      ctx.registry.getState().registerFromFile(path, content);
    }

    ctx.eventLog.getState().append({
      type: 'file_change',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { path, size: content.length },
    });

    return `Written to '${path}' (${content.length} chars)`;
  },
};
```

`src/core/plugins/vfs-list.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';

export const vfsListPlugin: ToolPlugin = {
  name: 'vfs_list',
  description: 'List files matching a path prefix. Returns an array of file paths.',
  parameters: {
    prefix: { type: 'string', description: 'Path prefix, e.g. "agents/" or "artifacts/"', required: true },
  },
  async handler(args, ctx) {
    const prefix = args.prefix as string;
    const files = ctx.vfs.getState().list(prefix);
    if (files.length > 0) {
      return JSON.stringify(files);
    }
    const prefixes = ctx.vfs.getState().getExistingPrefixes();
    return `No files match prefix '${prefix}'. Existing prefixes: [${prefixes.join(', ')}]`;
  },
};
```

`src/core/plugins/vfs-delete.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';

export const vfsDeletePlugin: ToolPlugin = {
  name: 'vfs_delete',
  description: 'Delete a file from the workspace.',
  parameters: {
    path: { type: 'string', description: 'File path to delete', required: true },
  },
  async handler(args, ctx) {
    const path = args.path as string;
    if (!ctx.vfs.getState().exists(path)) {
      return `Error: '${path}' not found.`;
    }
    ctx.vfs.getState().deleteFile(path);
    if (path.startsWith('agents/')) {
      ctx.registry.getState().unregister(path);
    }
    return `Deleted '${path}'`;
  },
};
```

`src/core/plugins/spawn-agent.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';

export const spawnAgentPlugin: ToolPlugin = {
  name: 'spawn_agent',
  description:
    'Create a new agent by writing a markdown file to agents/. ' +
    'The content should start with YAML frontmatter between --- delimiters ' +
    '(with at least a "name" field), followed by markdown instructions. ' +
    'Example frontmatter: ---\\nname: "Researcher"\\nmodel: "gemini"\\n---\\n\\n# MISSION\\n...',
  parameters: {
    filename: { type: 'string', description: 'Filename for the new agent, e.g. "researcher.md"', required: true },
    content: { type: 'string', description: 'Full markdown content with optional YAML frontmatter', required: true },
    task: { type: 'string', description: 'The initial task/prompt to give the new agent', required: true },
  },
  async handler(args, ctx) {
    const filename = args.filename as string;
    const content = args.content as string;
    const task = args.task as string;
    const path = filename.startsWith('agents/') ? filename : `agents/${filename}`;

    if (ctx.spawnDepth >= ctx.maxDepth) {
      return `Error: depth limit reached (${ctx.spawnDepth}/${ctx.maxDepth}). Cannot spawn more agents.`;
    }

    const totalChildren = ctx.childCount + ctx.spawnCount;
    if (totalChildren >= ctx.maxFanout) {
      return `Error: fanout limit reached (${totalChildren}/${ctx.maxFanout}). This agent cannot spawn more children.`;
    }

    const meta = {
      authorAgentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
    };
    ctx.vfs.getState().write(path, content, meta);
    const profile = ctx.registry.getState().registerFromFile(path, content);

    ctx.incrementSpawnCount();
    const newDepth = ctx.spawnDepth + 1;

    ctx.onSpawnActivation({
      agentId: path,
      input: task,
      parentId: ctx.currentAgentId,
      spawnDepth: newDepth,
      priority: newDepth,
    });

    ctx.eventLog.getState().append({
      type: 'spawn',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { spawned: path, depth: newDepth, task },
    });

    return `Created and activated '${profile.name}' at '${path}' (depth ${newDepth}/${ctx.maxDepth})`;
  },
};
```

`src/core/plugins/signal-parent.ts`:
```typescript
import type { ToolPlugin } from '../tool-plugin';

export const signalParentPlugin: ToolPlugin = {
  name: 'signal_parent',
  description: 'Send a message to the agent that spawned you. The parent will be re-activated with your message.',
  parameters: {
    message: { type: 'string', description: 'Message to send to parent agent', required: true },
  },
  async handler(args, ctx) {
    const message = args.message as string;

    if (!ctx.parentAgentId) {
      return `Error: this agent has no parent. You are a root agent.`;
    }

    ctx.onSpawnActivation({
      agentId: ctx.parentAgentId,
      input: `[Signal from ${ctx.currentAgentId}]: ${message}`,
      parentId: undefined,
      spawnDepth: Math.max(0, ctx.spawnDepth - 1),
      priority: 0,
    });

    ctx.eventLog.getState().append({
      type: 'signal',
      agentId: ctx.currentAgentId,
      activationId: ctx.currentActivationId,
      data: { parent: ctx.parentAgentId, message },
    });

    return `Message sent to parent '${ctx.parentAgentId}'. Parent will be re-activated.`;
  },
};
```

`src/core/plugins/index.ts`:
```typescript
import { ToolPluginRegistry } from '../tool-plugin';
import { vfsReadPlugin } from './vfs-read';
import { vfsWritePlugin } from './vfs-write';
import { vfsListPlugin } from './vfs-list';
import { vfsDeletePlugin } from './vfs-delete';
import { spawnAgentPlugin } from './spawn-agent';
import { signalParentPlugin } from './signal-parent';

export function createBuiltinRegistry(): ToolPluginRegistry {
  const registry = new ToolPluginRegistry();
  registry.register(vfsReadPlugin);
  registry.register(vfsWritePlugin);
  registry.register(vfsListPlugin);
  registry.register(vfsDeletePlugin);
  registry.register(spawnAgentPlugin);
  registry.register(signalParentPlugin);
  return registry;
}

export { vfsReadPlugin, vfsWritePlugin, vfsListPlugin, vfsDeletePlugin, spawnAgentPlugin, signalParentPlugin };
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/plugins/builtin-plugins.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/plugins/
git commit -m "feat: extract built-in tools to plugin files"
```

---

### Task 3: Refactor ToolHandler to use ToolPluginRegistry

**Files:**
- Modify: `src/core/tool-handler.ts`
- Modify: `src/core/tool-handler.test.ts` (update imports/setup)

**Context:** The current `ToolHandler` has a switch statement with inline handler methods. Refactor it to accept a `ToolPluginRegistry` and delegate to plugins. The test setup needs to create a registry with built-in plugins and pass it in. All existing tests must continue to pass with identical behavior.

**Step 1: Refactor ToolHandler**

Replace `ToolHandler` class to use registry delegation. The constructor now accepts a `ToolPluginRegistry` plus context config. The `handle()` method looks up the plugin and calls its handler.

```typescript
// src/core/tool-handler.ts
import type { Activation } from '../types';
import type { VFSState } from '../stores/vfs-store';
import type { AgentRegistryState } from '../stores/agent-registry';
import type { EventLogState } from '../stores/event-log';
import type { ToolPluginRegistry, ToolContext } from './tool-plugin';

type Store<T> = { getState(): T };

export interface ToolHandlerConfig {
  registry: ToolPluginRegistry;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;
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
    const { eventLog } = this.config;

    eventLog.getState().append({
      type: 'tool_call',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, args },
    });

    const plugin = this.config.registry.get(toolName);
    let result: string;

    if (plugin) {
      const ctx: ToolContext = {
        vfs: this.config.vfs,
        registry: this.config.agentRegistry,
        eventLog: this.config.eventLog,
        currentAgentId: this.config.currentAgentId,
        currentActivationId: this.config.currentActivationId,
        parentAgentId: this.config.parentAgentId,
        spawnDepth: this.config.spawnDepth,
        maxDepth: this.config.maxDepth,
        maxFanout: this.config.maxFanout,
        childCount: this.config.childCount,
        spawnCount: this.spawnCount,
        onSpawnActivation: this.config.onSpawnActivation,
        incrementSpawnCount: () => { this.spawnCount++; },
      };
      result = await plugin.handler(args, ctx);
    } else {
      const available = this.config.registry.getAll().map((p) => p.name).join(', ');
      result = `Error: Unknown tool '${toolName}'. Available tools: ${available}`;
    }

    eventLog.getState().append({
      type: 'tool_result',
      agentId: this.config.currentAgentId,
      activationId: this.config.currentActivationId,
      data: { tool: toolName, result: result.slice(0, 500) },
    });

    return result;
  }
}
```

**Step 2: Update tests**

The tests in `src/core/tool-handler.test.ts` need to import `createBuiltinRegistry` and pass it in the ToolHandlerConfig. Change:
- `registry` field renamed to `agentRegistry` (to avoid collision with plugin registry)
- Add `registry: createBuiltinRegistry()` for the plugin registry

```typescript
// In beforeEach, update the handler construction:
import { createBuiltinRegistry } from './plugins';

handler = new ToolHandler({
  registry: createBuiltinRegistry(),
  vfs,
  agentRegistry: registry,
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
```

Do the same for `deepHandler`, `fullHandler`, and `rootHandler` in the tests.

**Step 3: Run all tests**

Run: `npx vitest run src/core/tool-handler.test.ts`
Expected: ALL PASS (identical behavior)

**Step 4: Commit**

```bash
git add src/core/tool-handler.ts src/core/tool-handler.test.ts
git commit -m "refactor: ToolHandler delegates to ToolPluginRegistry"
```

---

### Task 4: Wire Kernel to use ToolPluginRegistry

**Files:**
- Modify: `src/core/kernel.ts`
- Modify: `src/core/kernel.test.ts`
- Delete or deprecate: `src/core/tools.ts` (no longer needed)

**Context:** The Kernel currently imports `AGENT_TOOLS` from `tools.ts` and passes it directly to the AI provider. It also creates a `ToolHandler` with inline config. Refactor to:
1. Accept a `ToolPluginRegistry` in KernelDeps (or create one from built-ins)
2. Pass the registry to ToolHandler
3. Use `registry.toToolDefinitions()` instead of `AGENT_TOOLS`
4. Rename the `registry` field in existing KernelDeps to `agentRegistry` to avoid collision

**Step 1: Modify kernel.ts**

In `KernelDeps`, add `toolRegistry?: ToolPluginRegistry`. If not provided, create from built-ins. Rename the existing `registry` field to `agentRegistry`. Update `runSession()`:
- Pass `this.deps.toolRegistry` (or the default builtin registry) to the ToolHandler
- Replace `AGENT_TOOLS` with `toolRegistry.toToolDefinitions()`
- Rename `registry` references to `agentRegistry`

Key changes in `kernel.ts`:
```typescript
import { ToolPluginRegistry } from './tool-plugin';
import { createBuiltinRegistry } from './plugins';
// Remove: import { AGENT_TOOLS } from './tools';

interface KernelDeps {
  aiProvider: AIProvider;
  vfs: Store<VFSState>;
  agentRegistry: Store<AgentRegistryState>;  // renamed from 'registry'
  eventLog: Store<EventLogState>;
  config: KernelConfig;
  sessionStore?: Store<SessionStoreState>;
  toolRegistry?: ToolPluginRegistry;
  onSessionUpdate?: (session: AgentSession) => void;
  onStreamChunk?: (agentId: string, chunk: StreamChunk) => void;
}

// In constructor:
constructor(deps: KernelDeps) {
  this.deps = deps;
  this.semaphore = new Semaphore(deps.config.maxConcurrency);
  this.globalController = new AbortController();
  if (!this.deps.toolRegistry) {
    this.deps.toolRegistry = createBuiltinRegistry();
  }
}

// In runSession():
const profile = this.deps.agentRegistry.getState().get(activation.agentId);
// ...
const toolHandler = new ToolHandler({
  registry: this.deps.toolRegistry!,
  vfs: this.deps.vfs,
  agentRegistry: this.deps.agentRegistry,
  eventLog: this.deps.eventLog,
  // ... rest same
});

const stream = this.deps.aiProvider.chat(
  { sessionId: activation.id, systemPrompt: profile.systemPrompt, model: profile.model },
  session.history,
  this.deps.toolRegistry!.toToolDefinitions()
);
```

**Step 2: Update kernel.test.ts**

Replace `registry` with `agentRegistry` in test setup.

**Step 3: Update useKernel.ts**

Replace `registry: agentRegistry` with `agentRegistry: agentRegistry` in the Kernel constructor call.

**Step 4: Run all tests**

Run: `npx vitest run src/core/kernel.test.ts src/core/tool-handler.test.ts`
Expected: ALL PASS

**Step 5: Delete tools.ts**

Remove `src/core/tools.ts` since `AGENT_TOOLS` is no longer used. Search for any remaining imports of it and remove them.

**Step 6: Commit**

```bash
git add src/core/kernel.ts src/core/kernel.test.ts src/hooks/useKernel.ts
git rm src/core/tools.ts
git commit -m "refactor: wire Kernel to ToolPluginRegistry, remove AGENT_TOOLS"
```

---

### Task 5: Add web_fetch plugin

**Files:**
- Create: `src/core/plugins/web-fetch.ts`
- Test: `src/core/plugins/web-fetch.test.ts`

**Context:** The web_fetch plugin uses the browser's fetch API to retrieve content from a URL. For HTML responses, it strips tags to return readable text. It truncates output to a configurable maxLength (default 50000 chars). Tests use vi.fn() to mock global fetch.

**Step 1: Write the failing tests**

```typescript
// src/core/plugins/web-fetch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetchPlugin } from './web-fetch';
import type { ToolContext } from '../tool-plugin';

describe('web_fetch plugin', () => {
  const mockCtx = {} as ToolContext;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches plain text content', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => 'Hello world',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com/data.txt' }, mockCtx);
    expect(result).toBe('Hello world');
    expect(fetch).toHaveBeenCalledWith('https://example.com/data.txt', expect.any(Object));
  });

  it('strips HTML tags from HTML responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><h1>Title</h1><p>Content here</p></body></html>',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com' }, mockCtx);
    expect(result).toContain('Title');
    expect(result).toContain('Content here');
    expect(result).not.toContain('<h1>');
  });

  it('truncates to maxLength', async () => {
    const longText = 'x'.repeat(200);
    (fetch as any).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => longText,
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com', maxLength: 50 }, mockCtx);
    expect(result.length).toBeLessThanOrEqual(70); // 50 + truncation notice
    expect(result).toContain('[truncated]');
  });

  it('returns error for non-ok responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await webFetchPlugin.handler({ url: 'https://example.com/nope' }, mockCtx);
    expect(result).toContain('Error');
    expect(result).toContain('404');
  });

  it('returns error for network failures', async () => {
    (fetch as any).mockRejectedValue(new Error('Network error'));

    const result = await webFetchPlugin.handler({ url: 'https://example.com' }, mockCtx);
    expect(result).toContain('Error');
    expect(result).toContain('Network error');
  });

  it('has correct plugin metadata', () => {
    expect(webFetchPlugin.name).toBe('web_fetch');
    expect(webFetchPlugin.parameters.url.required).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/plugins/web-fetch.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/core/plugins/web-fetch.ts
import type { ToolPlugin } from '../tool-plugin';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const webFetchPlugin: ToolPlugin = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the page content as text. HTML is automatically converted to readable text.',
  parameters: {
    url: { type: 'string', description: 'The URL to fetch', required: true },
    maxLength: { type: 'number', description: 'Maximum characters to return (default: 50000)' },
  },
  async handler(args) {
    const url = args.url as string;
    const maxLength = (args.maxLength as number) ?? 50000;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'text/html,text/plain,application/json' },
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') ?? '';
      let text = await response.text();

      if (contentType.includes('text/html')) {
        text = stripHtml(text);
      }

      if (text.length > maxLength) {
        return text.slice(0, maxLength) + '\n[truncated]';
      }

      return text;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```

**Step 4: Register in builtin registry**

Add to `src/core/plugins/index.ts`:
```typescript
import { webFetchPlugin } from './web-fetch';
// In createBuiltinRegistry():
registry.register(webFetchPlugin);
// In exports:
export { webFetchPlugin };
```

**Step 5: Run tests**

Run: `npx vitest run src/core/plugins/web-fetch.test.ts src/core/plugins/builtin-plugins.test.ts`
Expected: ALL PASS (update builtin test count from 6 to 7)

**Step 6: Commit**

```bash
git add src/core/plugins/web-fetch.ts src/core/plugins/web-fetch.test.ts src/core/plugins/index.ts
git commit -m "feat: add web_fetch plugin"
```

---

### Task 6: Add web_search plugin (Gemini Search Grounding)

**Files:**
- Create: `src/core/plugins/web-search.ts`
- Test: `src/core/plugins/web-search.test.ts`
- Modify: `src/core/tool-plugin.ts` (add aiProvider to ToolContext)
- Modify: `src/core/tool-handler.ts` (pass aiProvider to context)

**Context:** The web_search plugin uses Gemini's built-in Google Search grounding. It makes a one-shot request to Gemini with search grounding enabled, asking it to return search results as structured JSON. This requires the ToolContext to have access to the AIProvider (or at minimum, the Gemini API key to create a one-off client).

To keep it simple: add an optional `aiProvider` field to ToolContext. The ToolHandler passes the AI provider from KernelDeps. The web_search plugin creates a fresh Gemini model instance with `googleSearch` tool enabled.

**Step 1: Update ToolContext**

In `src/core/tool-plugin.ts`, add to ToolContext:
```typescript
aiProvider?: AIProvider;
apiKey?: string;
```

**Step 2: Update ToolHandler**

In `src/core/tool-handler.ts`, the ToolHandlerConfig needs `aiProvider` and `apiKey`:
```typescript
export interface ToolHandlerConfig {
  // ... existing fields
  aiProvider?: AIProvider;
  apiKey?: string;
}
```

Pass these through to the ToolContext in `handle()`.

**Step 3: Update Kernel**

In `kernel.ts`, pass `aiProvider` and `apiKey` (from deps or config) to ToolHandler constructor.

**Step 4: Write the failing tests**

```typescript
// src/core/plugins/web-search.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearchPlugin } from './web-search';
import type { ToolContext } from '../tool-plugin';

// Mock the Google Generative AI module
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify([
            { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
            { title: 'Result 2', url: 'https://example.com/2', snippet: 'Second result' },
          ]),
        },
      }),
    }),
  })),
}));

describe('web_search plugin', () => {
  const mockCtx = {
    apiKey: 'test-api-key',
  } as unknown as ToolContext;

  it('returns search results as JSON', async () => {
    const result = await webSearchPlugin.handler({ query: 'test query' }, mockCtx);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Result 1');
  });

  it('returns error when no API key', async () => {
    const noKeyCtx = {} as ToolContext;
    const result = await webSearchPlugin.handler({ query: 'test' }, noKeyCtx);
    expect(result).toContain('Error');
  });

  it('has correct plugin metadata', () => {
    expect(webSearchPlugin.name).toBe('web_search');
    expect(webSearchPlugin.parameters.query.required).toBe(true);
  });
});
```

**Step 5: Write the implementation**

```typescript
// src/core/plugins/web-search.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ToolPlugin } from '../tool-plugin';

export const webSearchPlugin: ToolPlugin = {
  name: 'web_search',
  description: 'Search the web using Google Search. Returns an array of results with title, url, and snippet.',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
    maxResults: { type: 'number', description: 'Maximum number of results to return (default: 5)' },
  },
  async handler(args, ctx) {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) ?? 5;

    if (!ctx.apiKey) {
      return 'Error: No API key available for web search.';
    }

    try {
      const client = new GoogleGenerativeAI(ctx.apiKey);
      const model = client.getGenerativeModel({
        model: 'gemini-2.0-flash',
        tools: [{ googleSearch: {} } as any],
      });

      const result = await model.generateContent(
        `Search the web for: "${query}". Return ONLY a JSON array of the top ${maxResults} results, each with "title", "url", and "snippet" fields. No other text.`
      );

      const text = result.response.text();

      // Try to parse as JSON, if it fails return raw text
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(Array.isArray(parsed) ? parsed.slice(0, maxResults) : parsed);
      } catch {
        return text;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```

**Step 6: Register in builtin registry**

Add to `src/core/plugins/index.ts`:
```typescript
import { webSearchPlugin } from './web-search';
registry.register(webSearchPlugin);
export { webSearchPlugin };
```

**Step 7: Run tests**

Run: `npx vitest run src/core/plugins/web-search.test.ts src/core/plugins/builtin-plugins.test.ts`
Expected: ALL PASS (update builtin count to 8)

**Step 8: Commit**

```bash
git add src/core/plugins/web-search.ts src/core/plugins/web-search.test.ts src/core/plugins/index.ts src/core/tool-plugin.ts src/core/tool-handler.ts src/core/kernel.ts
git commit -m "feat: add web_search plugin with Gemini Search Grounding"
```

---

### Task 7: Parse custom tool definitions from frontmatter

**Files:**
- Modify: `src/types/agent.ts` (add customTools to AgentProfile)
- Modify: `src/utils/parse-agent.ts` (parse tools array from frontmatter)
- Test: `src/utils/parse-agent.test.ts` (add custom tools tests)

**Context:** When an agent's YAML frontmatter includes a `tools:` array, parse each entry into a `CustomToolDef` and store it on the AgentProfile. The CustomToolDef includes name, description, parameters, prompt template, optional model, and optional result_schema.

**Step 1: Add CustomToolDef type**

In `src/types/agent.ts`:
```typescript
export interface CustomToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  prompt: string;
  model?: string;
  resultSchema?: Record<string, unknown>;
}

export interface AgentProfile {
  id: string;
  path: string;
  name: string;
  model?: string;
  systemPrompt: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
  customTools?: CustomToolDef[];
}
```

**Step 2: Write the failing tests**

Add to `src/utils/parse-agent.test.ts`:
```typescript
it('parses custom tool definitions from frontmatter', () => {
  const content = `---
name: "Research Agent"
tools:
  - name: summarize
    description: Summarize text
    parameters:
      text:
        type: string
        description: The text to summarize
    prompt: "Summarize: {{text}}"
  - name: translate
    description: Translate text
    model: gemini-2.0-flash-lite
    parameters:
      text:
        type: string
        description: Text to translate
      language:
        type: string
        description: Target language
    prompt: "Translate to {{language}}: {{text}}"
    result_schema:
      type: object
      properties:
        translated:
          type: string
---

You are a research agent.`;

  const profile = parseAgentFile('agents/research.md', content);
  expect(profile.customTools).toHaveLength(2);

  expect(profile.customTools![0].name).toBe('summarize');
  expect(profile.customTools![0].parameters.text.type).toBe('string');
  expect(profile.customTools![0].prompt).toBe('Summarize: {{text}}');
  expect(profile.customTools![0].model).toBeUndefined();

  expect(profile.customTools![1].name).toBe('translate');
  expect(profile.customTools![1].model).toBe('gemini-2.0-flash-lite');
  expect(profile.customTools![1].resultSchema).toBeDefined();
});

it('returns empty customTools when no tools in frontmatter', () => {
  const content = `---
name: "Simple Agent"
---

Just do stuff.`;

  const profile = parseAgentFile('agents/simple.md', content);
  expect(profile.customTools).toBeUndefined();
});

it('skips invalid tool definitions gracefully', () => {
  const content = `---
name: "Agent"
tools:
  - name: valid_tool
    description: A valid tool
    parameters:
      input:
        type: string
        description: Input
    prompt: "Do: {{input}}"
  - bad_entry: true
---

Instructions.`;

  const profile = parseAgentFile('agents/agent.md', content);
  expect(profile.customTools).toHaveLength(1);
  expect(profile.customTools![0].name).toBe('valid_tool');
});
```

**Step 3: Update parseAgentFile**

In `src/utils/parse-agent.ts`, add custom tool parsing after extracting frontmatter:
```typescript
import type { AgentProfile, CustomToolDef } from '../types';

function parseCustomTools(fm: Record<string, unknown>): CustomToolDef[] | undefined {
  if (!Array.isArray(fm.tools)) return undefined;
  const tools: CustomToolDef[] = [];
  for (const entry of fm.tools) {
    if (typeof entry !== 'object' || !entry) continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.name !== 'string' || typeof t.description !== 'string' || typeof t.prompt !== 'string') continue;
    const params: Record<string, { type: string; description: string }> = {};
    if (typeof t.parameters === 'object' && t.parameters) {
      for (const [key, val] of Object.entries(t.parameters as Record<string, unknown>)) {
        if (typeof val === 'object' && val) {
          const v = val as Record<string, unknown>;
          params[key] = {
            type: typeof v.type === 'string' ? v.type : 'string',
            description: typeof v.description === 'string' ? v.description : key,
          };
        }
      }
    }
    tools.push({
      name: t.name,
      description: t.description,
      parameters: params,
      prompt: t.prompt,
      model: typeof t.model === 'string' ? t.model : undefined,
      resultSchema: typeof t.result_schema === 'object' ? (t.result_schema as Record<string, unknown>) : undefined,
    });
  }
  return tools.length > 0 ? tools : undefined;
}
```

Add `customTools: parseCustomTools(fm)` to the returned AgentProfile.

**Step 4: Run tests**

Run: `npx vitest run src/utils/parse-agent.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/types/agent.ts src/utils/parse-agent.ts src/utils/parse-agent.test.ts
git commit -m "feat: parse custom tool definitions from agent frontmatter"
```

---

### Task 8: Custom tool plugin factory

**Files:**
- Create: `src/core/plugins/custom-tool-plugin.ts`
- Test: `src/core/plugins/custom-tool-plugin.test.ts`

**Context:** A factory function that takes a `CustomToolDef` and returns a `ToolPlugin`. The plugin's handler substitutes `{{param}}` placeholders in the prompt template, then spawns a child agent via `onSpawnActivation`. Since spawns are async (the child runs through the kernel queue), the custom tool returns a message indicating the sub-agent was dispatched. The optional model override is included in the spawned agent's frontmatter.

**Step 1: Write the failing tests**

```typescript
// src/core/plugins/custom-tool-plugin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createCustomToolPlugin } from './custom-tool-plugin';
import type { CustomToolDef } from '../../types/agent';
import type { ToolContext } from '../tool-plugin';
import { createVFSStore } from '../../stores/vfs-store';
import { createAgentRegistry } from '../../stores/agent-registry';
import { createEventLog } from '../../stores/event-log';

describe('createCustomToolPlugin', () => {
  const toolDef: CustomToolDef = {
    name: 'summarize',
    description: 'Summarize text',
    parameters: {
      text: { type: 'string', description: 'Text to summarize' },
    },
    prompt: 'Summarize the following:\n\n{{text}}',
  };

  it('creates a plugin with correct metadata', () => {
    const plugin = createCustomToolPlugin(toolDef);
    expect(plugin.name).toBe('summarize');
    expect(plugin.description).toBe('Summarize text');
    expect(plugin.parameters.text).toBeDefined();
    expect(plugin.parameters.text.required).toBe(true);
  });

  it('substitutes template parameters in prompt', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const spawnedActivations: any[] = [];

    const ctx: ToolContext = {
      vfs: createVFSStore(),
      registry: createAgentRegistry(),
      eventLog: createEventLog(),
      currentAgentId: 'agents/parent.md',
      currentActivationId: 'act-1',
      spawnDepth: 1,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation: (act) => spawnedActivations.push(act),
      incrementSpawnCount: vi.fn(),
    };

    await plugin.handler({ text: 'Hello world' }, ctx);

    expect(spawnedActivations).toHaveLength(1);
    expect(spawnedActivations[0].input).toBe('Summarize the following:\n\nHello world');
  });

  it('includes model override in spawned agent', async () => {
    const withModel: CustomToolDef = { ...toolDef, model: 'gemini-2.0-flash-lite' };
    const plugin = createCustomToolPlugin(withModel);
    const spawnedActivations: any[] = [];
    const vfs = createVFSStore();

    const ctx: ToolContext = {
      vfs,
      registry: createAgentRegistry(),
      eventLog: createEventLog(),
      currentAgentId: 'agents/parent.md',
      currentActivationId: 'act-1',
      spawnDepth: 1,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation: (act) => spawnedActivations.push(act),
      incrementSpawnCount: vi.fn(),
    };

    await plugin.handler({ text: 'test' }, ctx);

    // Check the agent file was written with model in frontmatter
    const content = vfs.getState().read(spawnedActivations[0].agentId);
    expect(content).toContain('model: "gemini-2.0-flash-lite"');
  });

  it('respects depth limits', async () => {
    const plugin = createCustomToolPlugin(toolDef);
    const ctx: ToolContext = {
      vfs: createVFSStore(),
      registry: createAgentRegistry(),
      eventLog: createEventLog(),
      currentAgentId: 'agents/parent.md',
      currentActivationId: 'act-1',
      spawnDepth: 5,
      maxDepth: 5,
      maxFanout: 5,
      childCount: 0,
      spawnCount: 0,
      onSpawnActivation: vi.fn(),
      incrementSpawnCount: vi.fn(),
    };

    const result = await plugin.handler({ text: 'test' }, ctx);
    expect(result).toContain('depth limit');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/plugins/custom-tool-plugin.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/core/plugins/custom-tool-plugin.ts
import type { ToolPlugin, ToolParameter } from '../tool-plugin';
import type { CustomToolDef } from '../../types/agent';

function substituteTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return args[key] !== undefined ? String(args[key]) : `{{${key}}}`;
  });
}

export function createCustomToolPlugin(def: CustomToolDef): ToolPlugin {
  const parameters: Record<string, ToolParameter> = {};
  for (const [key, param] of Object.entries(def.parameters)) {
    parameters[key] = {
      type: (param.type as ToolParameter['type']) ?? 'string',
      description: param.description,
      required: true,
    };
  }

  return {
    name: def.name,
    description: def.description,
    parameters,
    async handler(args, ctx) {
      if (ctx.spawnDepth >= ctx.maxDepth) {
        return `Error: depth limit reached (${ctx.spawnDepth}/${ctx.maxDepth}). Cannot execute custom tool '${def.name}'.`;
      }

      const totalChildren = ctx.childCount + ctx.spawnCount;
      if (totalChildren >= ctx.maxFanout) {
        return `Error: fanout limit reached (${totalChildren}/${ctx.maxFanout}). Cannot execute custom tool '${def.name}'.`;
      }

      const prompt = substituteTemplate(def.prompt, args);
      const agentName = `${def.name}-worker`;
      const path = `agents/_custom_${def.name}_${Date.now()}.md`;

      // Build frontmatter
      let frontmatter = `---\nname: "${agentName}"`;
      if (def.model) {
        frontmatter += `\nmodel: "${def.model}"`;
      }
      frontmatter += '\n---\n\n';

      let systemPrompt = `You are a tool executor. Complete the following task and return the result.`;
      if (def.resultSchema) {
        systemPrompt += `\n\nReturn your result as JSON matching this schema:\n${JSON.stringify(def.resultSchema, null, 2)}`;
      }

      const content = frontmatter + systemPrompt;
      const meta = {
        authorAgentId: ctx.currentAgentId,
        activationId: ctx.currentActivationId,
      };

      ctx.vfs.getState().write(path, content, meta);
      ctx.registry.getState().registerFromFile(path, content);
      ctx.incrementSpawnCount();

      const newDepth = ctx.spawnDepth + 1;
      ctx.onSpawnActivation({
        agentId: path,
        input: prompt,
        parentId: ctx.currentAgentId,
        spawnDepth: newDepth,
        priority: newDepth,
      });

      return `Custom tool '${def.name}' dispatched as sub-agent at depth ${newDepth}. The sub-agent will execute the task.`;
    },
  };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/plugins/custom-tool-plugin.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/plugins/custom-tool-plugin.ts src/core/plugins/custom-tool-plugin.test.ts
git commit -m "feat: add custom tool plugin factory for frontmatter-defined tools"
```

---

### Task 9: Wire custom tools into Kernel per-agent

**Files:**
- Modify: `src/core/kernel.ts` (build per-agent tool list)

**Context:** When the Kernel runs a session, it needs to check if the agent has custom tool definitions and create ToolPlugins for them. Use `registry.cloneWith()` to create a per-session registry that includes both built-ins and the agent's custom tools.

**Step 1: Modify kernel.ts runSession()**

After retrieving the agent profile, check for `profile.customTools`. If present, create custom tool plugins and clone the registry:

```typescript
import { createCustomToolPlugin } from './plugins/custom-tool-plugin';

// In runSession(), after getting the profile:
let sessionRegistry = this.deps.toolRegistry!;
if (profile.customTools && profile.customTools.length > 0) {
  const customPlugins = profile.customTools.map(createCustomToolPlugin);
  sessionRegistry = this.deps.toolRegistry!.cloneWith(customPlugins);
}

// Use sessionRegistry instead of this.deps.toolRegistry for this session
const toolHandler = new ToolHandler({
  registry: sessionRegistry,
  // ...
});

const stream = this.deps.aiProvider.chat(
  { ... },
  session.history,
  sessionRegistry.toToolDefinitions()
);
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/core/kernel.ts
git commit -m "feat: wire per-agent custom tools into kernel sessions"
```

---

### Task 10: Validate custom tool definitions in agent-validator

**Files:**
- Modify: `src/utils/agent-validator.ts`
- Test: `src/utils/agent-validator.test.ts` (add custom tool validation tests)

**Context:** The agent validator provides Monaco editor diagnostics. Add validation for custom tool definitions: check that each tool has name, description, parameters, and prompt. Warn about missing fields. Info-level for unknown parameter types.

**Step 1: Write failing tests**

Add to `src/utils/agent-validator.test.ts`:
```typescript
it('validates well-formed custom tools produce no diagnostics', () => {
  const content = `---
name: "Agent"
tools:
  - name: summarize
    description: Summarize text
    parameters:
      text:
        type: string
        description: The text
    prompt: "Summarize: {{text}}"
---

Do stuff.`;

  const diagnostics = validateAgentContent(content);
  expect(diagnostics).toHaveLength(0);
});

it('warns when custom tool is missing required fields', () => {
  const content = `---
name: "Agent"
tools:
  - name: bad_tool
---

Do stuff.`;

  const diagnostics = validateAgentContent(content);
  const toolDiags = diagnostics.filter((d) => d.message.includes('tool'));
  expect(toolDiags.length).toBeGreaterThan(0);
  expect(toolDiags[0].severity).toBe('warning');
});

it('warns when custom tool prompt has no matching parameters', () => {
  const content = `---
name: "Agent"
tools:
  - name: my_tool
    description: A tool
    parameters:
      input:
        type: string
        description: Input
    prompt: "Do something with {{unknown_param}}"
---

Do stuff.`;

  const diagnostics = validateAgentContent(content);
  const mismatch = diagnostics.filter((d) => d.message.includes('unknown_param'));
  expect(mismatch.length).toBeGreaterThan(0);
});
```

**Step 2: Add validation logic**

In `validateAgentContent`, after existing checks, add custom tool validation:
```typescript
// Validate custom tools
if (Array.isArray(fm.tools)) {
  for (const entry of fm.tools) {
    if (typeof entry !== 'object' || !entry) continue;
    const t = entry as Record<string, unknown>;

    if (typeof t.name !== 'string') {
      diagnostics.push({ startLine: ..., message: 'Custom tool missing "name"', severity: 'warning' });
    }
    if (typeof t.description !== 'string') {
      diagnostics.push({ startLine: ..., message: `Custom tool '${t.name}' missing "description"`, severity: 'warning' });
    }
    if (typeof t.prompt !== 'string') {
      diagnostics.push({ startLine: ..., message: `Custom tool '${t.name}' missing "prompt"`, severity: 'warning' });
    }

    // Check for template parameter mismatches
    if (typeof t.prompt === 'string' && typeof t.parameters === 'object') {
      const paramNames = new Set(Object.keys(t.parameters as object));
      const templateVars = [...t.prompt.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
      for (const tv of templateVars) {
        if (!paramNames.has(tv)) {
          diagnostics.push({
            startLine: closingDelimiterLine || 2,
            endLine: closingDelimiterLine || 2,
            startCol: 1,
            endCol: 2,
            message: `Custom tool '${t.name}': prompt uses {{${tv}}} but no parameter named '${tv}'`,
            severity: 'info',
          });
        }
      }
    }
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/utils/agent-validator.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/utils/agent-validator.ts src/utils/agent-validator.test.ts
git commit -m "feat: validate custom tool definitions in agent-validator"
```

---

### Task 11: Update agent templates with new tools

**Files:**
- Modify: `src/utils/agent-templates.ts`

**Context:** Update the built-in agent templates to demonstrate the new capabilities. Add web_fetch/web_search usage examples in the Researcher template's system prompt. Add a new "Tool Builder" template that demonstrates custom tool definitions in frontmatter.

**Step 1: Update Researcher template**

In the researcher template's system prompt, add instructions about using web_fetch and web_search tools:
```
You can search the web using web_search and fetch page content using web_fetch.
```

**Step 2: Add Tool Builder template**

Add a new template that demonstrates custom tool definitions:
```typescript
{
  id: 'tool-builder',
  name: 'Tool Builder',
  description: 'Agent with custom tool definitions',
  content: `---
name: "Tool Builder"
tools:
  - name: analyze
    description: Analyze content and extract key insights
    parameters:
      content:
        type: string
        description: Content to analyze
    prompt: "Analyze the following content and extract 3-5 key insights:\\n\\n{{content}}"
---

# MISSION
You are a tool builder agent that uses custom tools to process information.

# INSTRUCTIONS
- Use the analyze tool to break down complex content
- Write results to artifacts/
- Use web_fetch if you need to gather source material
`,
}
```

**Step 3: Run template tests**

Run: `npx vitest run src/utils/agent-templates.test.ts`
Expected: ALL PASS (update count if needed)

**Step 4: Commit**

```bash
git add src/utils/agent-templates.ts
git commit -m "feat: update agent templates with web tools and custom tool example"
```

---

### Task 12: Pass API key through to ToolContext

**Files:**
- Modify: `src/core/kernel.ts` (add apiKey to KernelDeps)
- Modify: `src/core/tool-handler.ts` (pass apiKey to context)
- Modify: `src/hooks/useKernel.ts` (pass apiKey from UI store)

**Context:** The web_search plugin needs the API key. Thread it from the UI store through KernelDeps -> ToolHandler -> ToolContext.

**Step 1: Add apiKey to KernelDeps**

```typescript
interface KernelDeps {
  // ... existing
  apiKey?: string;
}
```

**Step 2: Pass through ToolHandler to ToolContext**

In `tool-handler.ts` ToolHandlerConfig, add `apiKey?: string`. In `handle()`, include `apiKey: this.config.apiKey` in the ToolContext.

**Step 3: Pass from useKernel**

In `useKernel.ts`, read apiKey from uiStore and pass to Kernel constructor:
```typescript
const apiKey = uiStore.getState().apiKey;
const kernel = new Kernel({
  // ...
  apiKey,
});
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/kernel.ts src/core/tool-handler.ts src/hooks/useKernel.ts
git commit -m "feat: thread API key through to tool context for web_search"
```

---

### Task 13: Integration smoke test

**Files:** None (verification only)

**Context:** Run the full test suite and TypeScript type check to verify everything works end-to-end.

**Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass (excluding any pre-existing failures)

**Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Verify tool counts**

Quick manual check:
- `createBuiltinRegistry()` should register 8 plugins
- `toToolDefinitions()` should produce 8 tool declarations
- Agents with `tools:` in frontmatter should get custom tools added

**Step 4: Commit any remaining fixes**

If any issues found, fix and commit as:
```bash
git commit -m "fix: address integration issues from smoke test"
```
