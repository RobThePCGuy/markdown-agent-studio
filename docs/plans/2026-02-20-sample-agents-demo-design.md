# Sample Agents & Demo Mode Design

**Date:** 2026-02-20
**Goal:** Replace the minimal 3-agent sample with a rich 6-agent website-building team that runs as a zero-cost scripted demo through the real kernel pipeline.

## Core Architecture: ScriptedAIProvider

A `ScriptedAIProvider` implements the existing `AIProvider` interface. It accepts a `ScriptMap` -- a dictionary keyed by agent path where each value is an array of turns. Each turn is a `StreamChunk[]` array (text, tool_call, done).

Chunks are yielded with a small random delay (30-80ms per chunk) to simulate streaming. The provider tracks which turn each session is on via a counter per sessionId.

**Integration point:** `RunController.createKernel()` already branches between `GeminiProvider` and `MockAIProvider` based on API key presence. The `MockAIProvider` path is replaced with `ScriptedAIProvider` loaded with the demo script. This is the only branching point -- everything else runs through real kernel code.

## Agent Team (6 agents)

| Agent | File | Mode | Spawns | Web | Signals | Custom Tools |
|-------|------|------|--------|-----|---------|-------------|
| Project Lead | agents/project-lead.md | balanced | yes | yes | no (root) | yes |
| UX Researcher | agents/ux-researcher.md | safe | no | yes | yes | no |
| Designer | agents/designer.md | balanced | no | no | yes | no |
| HTML Developer | agents/html-dev.md | safe | no | no | yes | no |
| CSS Developer | agents/css-dev.md | safe | no | no | yes | no |
| QA Reviewer | agents/qa-reviewer.md | gloves_off | no | no | yes | yes |

## Demo Flow (10 steps)

1. User types "Build me a portfolio website" and hits Run
2. **Project Lead** writes project plan to memory, spawns UX Researcher
3. **UX Researcher** uses web_search + web_fetch (mocked), writes findings to memory, signals parent
4. **Project Lead** receives signal, spawns Designer + HTML Dev + CSS Dev (parallel)
5. **Designer** reads research from memory, writes component spec to artifacts/design-spec.md, signals parent
6. **HTML Dev** reads design spec, writes site/index.html, signals parent
7. **CSS Dev** reads design spec, writes site/styles.css, signals parent
8. **Project Lead** receives signals, spawns QA Reviewer with custom tool
9. **QA Reviewer** uses custom tool to review site, reads HTML/CSS, writes artifacts/qa-report.md, signals parent
10. **Project Lead** writes final summary to artifacts/summary.md

## What This Showcases

- 6 graph nodes with parent-child edges (dagre layout)
- 8+ signal events (particle animations)
- 10+ memory entries (visible in inspector)
- 5+ artifact files in VFS (viewable in editor, syncable to disk)
- All 3 safety modes (safe, balanced, gloves_off)
- 1 custom tool invocation
- Parallel execution (HTML + CSS running simultaneously, visible in timeline)
- Streaming text in chat log
- Sound effects for spawn/signal/complete events
- Status transitions with sonar ring animations

## Disk Persistence

Add immediate-flush mode to DiskSync: when a project folder is connected, every VFS write triggers an immediate disk write (in addition to the existing debounced sync). This ensures agent-written files survive crashes.

## File Outputs

The demo produces these files in the VFS:

- `artifacts/design-spec.md` -- Component specifications and layout decisions
- `artifacts/qa-report.md` -- QA review findings
- `artifacts/summary.md` -- Project completion summary
- `site/index.html` -- Complete portfolio page
- `site/styles.css` -- Styling for the portfolio

## Script Data Structure

```typescript
type ScriptTurn = StreamChunk[];
type AgentScript = ScriptTurn[];
type ScriptMap = Record<string, AgentScript>;
```

The ScriptedAIProvider matches incoming chat requests to the correct agent script by looking up the agent path from the session's activation data. Turn index increments after each complete response.

## Welcome Banner Update

The welcome banner message updates to reference the portfolio demo. The prompt input pre-fills with "Build me a portfolio website" so the user just hits Run.
