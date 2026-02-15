# Agent Template Editor - Design Document

**Date:** 2026-02-15
**Status:** Approved

## Overview

A Monaco-based agent editor in the center pane (Tab 2) with smart scaffold templates and inline validation. Users create agents from built-in or custom templates, edit the full markdown file directly, and get real-time warnings for missing mandatory fields. Templates are stored as regular VFS files, consistent with the "markdown files are everything" philosophy.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template UX | Smart scaffold | Monaco editor with template picker toolbar, skeleton insertion, inline placeholders |
| Template storage | Built-in + user-saved | Hardcoded starters + `templates/` directory in VFS for user templates |
| Editor placement | Center pane Tab 2 | Matches original design doc (Graph | Editor tabs) |
| Validation style | Inline Monaco markers | Yellow squiggly underlines, non-blocking, like a linter |
| Architecture | Template Registry + Monaco Markers | Templates as VFS files, validation via Monaco's marker API |

---

## 1. Template System

### Built-in Templates

Five hardcoded templates in a `BUILT_IN_TEMPLATES` array:

| Template | Purpose |
|----------|---------|
| **Blank Agent** | Minimal skeleton: `name` field + empty MISSION/INSTRUCTIONS/OUTPUT FORMAT sections |
| **Researcher** | Reads files, writes findings to artifacts, spawns specialists for subtopics |
| **Writer** | Takes research inputs, produces polished output to artifacts |
| **Orchestrator** | Spawns child agents, coordinates via signal_parent, writes final output |
| **Critic** | Reviews artifacts, writes feedback to memory, signals parent with verdict |

### User-Saved Templates

Any `.md` file in the `templates/` directory in the VFS is treated as a reusable template. Users can "Save as Template" from the editor toolbar.

### Data Shape

```typescript
interface AgentTemplate {
  id: string;           // 'builtin:researcher' or 'templates/my-custom.md'
  name: string;         // Display name in picker
  description: string;  // One-line summary
  content: string;      // Full .md file content
  builtIn: boolean;
}
```

---

## 2. Editor Component

The center pane has a tab switcher: **Graph | Editor**.

### Toolbar

Horizontal bar above Monaco:

- **Template picker** - Dropdown: "New from template..." listing built-in and user-saved templates. Confirm dialog if editor content is dirty.
- **Save** button - Writes content to VFS at the active file path. Auto-re-registers in agent registry if under `agents/`.
- **Save as Template** button - Prompts for a name, writes to `templates/<name>.md` in VFS.
- **File path** display - Shows current file (e.g. `agents/researcher.md`). Editable to rename/move.
- **Active agent warning** - Yellow banner if file belongs to a running agent: "This agent is running. Changes apply on next activation."

### Monaco Configuration

- Language: `markdown` with YAML frontmatter recognition
- Theme: Dark theme matching Catppuccin palette (VS Dark base with custom token colors)
- Content: Raw `.md` file content - frontmatter and all, no form abstractions
- User edits the full file directly

### File Opening

- Click file in WorkspaceExplorer -> switches to Editor tab, loads that file
- Click "New Agent" -> switches to Editor tab with blank template, assigns `agents/untitled.md` path
- Template selection -> replaces editor content (confirm if dirty)

---

## 3. Inline Validation

Monaco markers validate agent files in real-time. Validation runs on content change, debounced ~300ms.

### Validation Rules (agent files only)

| Rule | Severity | Message |
|------|----------|---------|
| Missing frontmatter delimiters (`---`) | Warning | "Agent files should have YAML frontmatter (---)" |
| Missing `name` field in frontmatter | Warning | "Missing required field: name" |
| Empty system prompt (no body after frontmatter) | Warning | "Agent has no system prompt instructions" |
| Malformed YAML in frontmatter | Error | "Invalid YAML: {parse error details}" |
| `model` field with unknown value | Info | "Unknown model '{value}'. Known: gemini-1.5-pro, gemini-1.5-flash" |

### Implementation

1. On content change (debounced), parse content with `gray-matter`
2. Check for missing frontmatter, missing `name`, empty body
3. Map issues to Monaco marker objects with line numbers, severity, and message
4. Set markers via `monaco.editor.setModelMarkers()`

### Non-blocking

Validation warns but never prevents saving. Files save with warnings - the system handles missing frontmatter gracefully (parse-agent defaults). Warnings guide users toward well-formed agents.

Files outside `agents/` (artifacts, memory, templates) get no validation.

---

## 4. Integration & Data Flow

### State Additions

```typescript
// Add to UIState:
editingFilePath: string | null;   // Which file is open in editor
editorDirty: boolean;             // Unsaved changes?
```

`activeTab` already exists in UIState.

### Editing Flow

1. User clicks file in WorkspaceExplorer
2. UI store sets `editingFilePath`, switches `activeTab` to `'editor'`
3. Editor reads content from VFS store via the path
4. User edits -> `editorDirty` = true
5. User clicks Save -> content written to VFS, `editorDirty` = false
6. If under `agents/`, agent registry auto-updates (existing tool-handler behavior)

### Template Creation Flow

1. User clicks "New from template..." in toolbar
2. If editor dirty, confirm dialog
3. Template content loaded into editor with new path (`agents/untitled.md`, counter for uniqueness)
4. User customizes, changes filename, saves

### Save as Template Flow

1. User clicks "Save as Template"
2. Prompt for template name
3. Current content written to `templates/<name>.md` in VFS
4. Template picker refreshes to include new template

### External Change Handling

If an agent modifies a file currently open in the editor (via `vfs_write`), show a notification bar: "File changed externally. Reload?" Prevents silent overwrites of user edits.

---

## 5. Component Structure

```
src/components/editor/
  AgentEditor.tsx          # Main editor component (toolbar + Monaco + validation)
  EditorToolbar.tsx        # Template picker, save buttons, file path, warnings
  TemplatePicker.tsx       # Dropdown with built-in + user templates

src/utils/
  agent-templates.ts       # BUILT_IN_TEMPLATES array, getTemplates() helper
  agent-validator.ts       # Validate agent content, return Monaco marker objects
```
