# Tool Plugin Architecture Design

**Goal:** Replace the hardcoded tool system with an extensible plugin architecture. Add web_fetch, web_search (via Gemini Search Grounding), and custom tool definitions in agent frontmatter.

**Architecture:** Every tool (built-in or custom) implements a ToolPlugin interface and registers with a central ToolPluginRegistry. The existing ToolHandler becomes a thin dispatcher. Custom tools defined in agent YAML frontmatter spawn sub-agents to execute, with optional model override and result schema validation.

**Decisions Made:**
- Plugin Architecture (Approach B) over Thin Shell or Registry Store
- Global allow-all permissions (no per-agent restrictions)
- Gemini Search Grounding for web_search (reuses existing API key)
- Custom tools execute as sub-agent spawns with mustache-template prompts
- Custom tools support optional model override and result_schema

---

## ToolPlugin Interface

```typescript
interface ToolPlugin {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
}

interface ToolContext {
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
  onSpawnActivation: (act: Omit<Activation, 'id' | 'createdAt'>) => void;
}
```

## ToolPluginRegistry

```typescript
class ToolPluginRegistry {
  private plugins: Map<string, ToolPlugin>;

  register(plugin: ToolPlugin): void;
  unregister(name: string): void;
  get(name: string): ToolPlugin | undefined;
  getAll(): ToolPlugin[];
  toToolDefinitions(): ToolDefinition[];  // For AI provider
}
```

- Built-in plugins registered at startup (8 total)
- Custom plugins registered per-session from agent frontmatter
- `toToolDefinitions()` converts to the format GeminiProvider expects

## Built-in Plugins (8)

### Existing (6) - extracted from current ToolHandler switch cases
1. `vfs_read` - Read a workspace file
2. `vfs_write` - Write/update a workspace file
3. `vfs_list` - List files by prefix
4. `vfs_delete` - Delete a workspace file
5. `spawn_agent` - Create and activate a child agent
6. `signal_parent` - Send message to parent agent

### New (2)
7. `web_fetch` - Fetch content from a URL
   - Parameters: `url` (string, required), `maxLength` (number, optional, default 50000)
   - Implementation: Browser `fetch()`, strip HTML tags for HTML responses, truncate to maxLength
   - CORS limitations documented; Vite proxy available for dev

8. `web_search` - Search the web via Gemini Search Grounding
   - Parameters: `query` (string, required), `maxResults` (number, optional, default 5)
   - Implementation: One-shot Gemini request with Google Search grounding enabled
   - Returns: JSON array of `{ title, url, snippet }`
   - Requires: AIProvider reference in ToolContext (or separate Gemini client)

## Custom Tool Definitions

Agents define custom tools in YAML frontmatter:

```yaml
---
name: research-agent
tools:
  - name: summarize
    description: Summarize a document into key points
    model: gemini-2.0-flash-lite          # Optional model override
    parameters:
      text:
        type: string
        description: The text to summarize
    result_schema:                         # Optional output schema
      type: object
      properties:
        bullets:
          type: array
          items: { type: string }
    prompt: "Return JSON {bullets:[...]}. Summarize:\n\n{{text}}"
---
```

### Execution Model
1. Parse `tools` array from frontmatter during `registerFromFile()`
2. For each custom tool, create a `ToolPlugin` via `createCustomToolPlugin()` factory
3. Plugin handler:
   a. Substitute `{{param}}` placeholders in prompt template with actual args
   b. Spawn a child agent (uses `onSpawnActivation` callback)
   c. Wait for child completion, collect output
   d. If `result_schema` defined, validate output against schema
   e. Return child's text output as tool result
4. Custom tools count toward depth/fanout limits (they are spawns)

### Template Substitution
Simple mustache-style: `{{paramName}}` replaced with `args[paramName]`. No logic blocks, no partials. Unmatched placeholders left as-is.

## Integration Points

### Files Modified
1. `src/core/tools.ts` - Replace `AGENT_TOOLS` constant with registry-based generation
2. `src/core/tool-handler.ts` - Refactor from switch to registry lookup
3. `src/utils/parse-agent.ts` - Parse `tools` array from frontmatter
4. `src/stores/agent-registry.ts` - Store custom tool defs on AgentProfile
5. `src/core/kernel.ts` - Build per-agent tool list (built-in + custom), pass to AI provider
6. `src/utils/agent-validator.ts` - Validate custom tool definitions
7. `src/core/gemini-provider.ts` - Support Google Search grounding option

### New Files
- `src/core/tool-plugin.ts` - ToolPlugin interface, ToolContext, ToolPluginRegistry class
- `src/core/plugins/vfs-read.ts` - VFS read plugin
- `src/core/plugins/vfs-write.ts` - VFS write plugin
- `src/core/plugins/vfs-list.ts` - VFS list plugin
- `src/core/plugins/vfs-delete.ts` - VFS delete plugin
- `src/core/plugins/spawn-agent.ts` - Spawn agent plugin
- `src/core/plugins/signal-parent.ts` - Signal parent plugin
- `src/core/plugins/web-fetch.ts` - Web fetch plugin
- `src/core/plugins/web-search.ts` - Web search plugin
- `src/core/plugins/custom-tool-plugin.ts` - Factory for frontmatter-defined tools

## Data Flow

```
Agent Frontmatter (tools: [...])
        |
        v
  AgentRegistry.registerFromFile()
        |  parses custom tool defs, stores on AgentProfile
        v
  Kernel.runSession(activation)
        |  builds tool list: built-in + agent's custom tools
        v
  ToolPluginRegistry
  +-------------------------------+
  | Built-in plugins (8):         |
  |   vfs_read, vfs_write,        |
  |   vfs_list, vfs_delete,       |
  |   spawn_agent, signal_parent, |
  |   web_fetch, web_search       |
  |                               |
  | Custom plugins (per-agent):   |
  |   summarize, translate, etc.  |
  +-------------------------------+
        |
        v  toToolDefinitions()
  AIProvider.chat(tools=[...])
        |
        v  tool_call chunk
  ToolHandler.handle(name, args)
        |  looks up plugin in registry
        v
  Plugin.handler(args, context)
        |
        v  result string
  Back to AI conversation
```

## Testing Strategy

- Unit tests for each built-in plugin (extracted from existing tool-handler tests)
- Unit tests for ToolPluginRegistry (register, unregister, lookup, toToolDefinitions)
- Unit tests for custom tool parsing from frontmatter
- Unit tests for template substitution
- Unit tests for web_fetch (mock fetch) and web_search (mock Gemini)
- Integration test: agent with custom tools runs end-to-end
- Validator tests for custom tool frontmatter validation

## Not In Scope
- Per-agent tool permissions (using global allow-all)
- Tool palette UI component
- Tool execution sandbox/isolation
- Rate limiting for web tools
- Caching for web_fetch/web_search results
