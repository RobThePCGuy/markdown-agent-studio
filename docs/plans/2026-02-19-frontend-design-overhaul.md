# MAS Frontend Design Overhaul

**Date:** 2026-02-19
**Approach:** CSS Design System + Component Polish (Approach 1)
**Aesthetic:** Refined developer tool (Linear/Raycast/Arc caliber)
**Animation:** CSS-only (no runtime animation libraries)

## Design Tokens

### Color System (Evolved Catppuccin Mocha)

**Depth layers:**
- `--depth-0`: `#0a0a14` (graph canvas)
- `--depth-1`: `#11111b` (panel backgrounds)
- `--depth-2`: `#1e1e2e` (card/surface)
- `--depth-3`: `#313244` (elevated surfaces)
- `--depth-4`: `#45475a` (tooltips, popovers)

**MAS signature accent:**
- `--accent-primary`: `#e0a650` (warm gold)
- `--accent-primary-dim`: `rgba(224,166,80,0.15)`
- `--accent-secondary`: `#89b4fa` (Catppuccin blue)

**Status colors (from Catppuccin):**
- Green `#a6e3a1`, Blue `#89b4fa`, Cyan `#74c7ec`
- Orange `#fab387`, Red `#f38ba8`, Yellow `#f9e2af`
- Purple `#cba6f7`, Teal `#94e2d5`

Each status color gets `--glow-*` variant: `0 0 12px rgba(color, 0.4)`.

**Text:**
- `--text-primary`: `#cdd6f4`
- `--text-secondary`: `#bac2de`
- `--text-dim`: `#6c7086`
- `--text-very-dim`: `#585b70`

### Typography

**Font families:**
- Headings/UI: `"Plus Jakarta Sans"` (Google Fonts, display: swap)
- Body: `"IBM Plex Sans"` (Google Fonts, display: swap)
- Code: `"JetBrains Mono"` (Google Fonts, display: swap)

**Scale (1.2 ratio):**
- `--text-xs`: 10px
- `--text-sm`: 12px
- `--text-md`: 14px
- `--text-lg`: 16px
- `--text-xl`: 20px

**Weights:** 400 (body), 500 (labels), 600 (headings), 700 (emphasis)

### Spacing

4px base: `--space-1` through `--space-8`: 4, 8, 12, 16, 20, 24, 32, 48px

### Shadows

- `--shadow-sm`: `0 1px 3px rgba(0,0,0,0.3)`
- `--shadow-md`: `0 4px 12px rgba(0,0,0,0.4)`
- `--shadow-lg`: `0 8px 32px rgba(0,0,0,0.5)`

### Transitions

- `--transition-fast`: `150ms ease-out`
- `--transition-normal`: `250ms ease-out`
- `--transition-slow`: `400ms cubic-bezier(0.16, 1, 0.3, 1)`

## Graph Visualization

### Agent Nodes

- Min-width 200px, border-radius 14px
- Noise texture overlay on gradient background (~3% opacity data-URI)
- 3px top accent bar in status color (replaces status dot as primary indicator)
- Running state: top bar pulses with box-shadow glow
- Agent name: Plus Jakarta Sans 13px/600; details: IBM Plex Sans 11px/400
- Stats row: bottom bar with colored dot indicators (not pill badges)
- Selection: `::before` pseudo-element creates outer glow ring (2px gap, radial shadow)
- Spawn animation: scale + opacity with overshoot bezier `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Hover: `translateY(-1px)` lift with enhanced shadow

### Activity Nodes

- Smaller (max-width 160px), more translucent
- Frosted glass: `backdrop-filter: blur(8px)`, rgba background at ~8% opacity
- Thin solid border at 30% opacity (replaces dashed)
- Broadcasting pulse: concentric ring CSS animation on indicator dot
- Float animation: keep at 2px amplitude (more subtle)

### Edges

- Spawn edges: animated dashed stroke (`stroke-dashoffset` animation), blue
- Signal edges: different dash pattern, orange
- Active edges: subtle glow filter when agent is running

### Graph Background

- Dot grid (1px dots, low opacity, 24px spacing)
- Warm gold radial gradient center: `rgba(224,166,80,0.06)`
- Vignette: darker edges via radial gradient

### HUD

- Single glass panel with `backdrop-filter: blur(12px)`, subtle border
- Horizontal metric groups with colored dots, labels, values
- Thin vertical dividers between groups
- Slide-down entrance animation

## Layout & Chrome

### TopBar (48px)

- Background: `--depth-1`, 1px `--depth-3` bottom border
- Logo: "MAS" in Plus Jakarta Sans 14px/700, gold accent, 0.5px letter-spacing
- Agent selector: `--depth-2` bg, subtle border, brightens on hover
- Prompt input: inner shadow for depth, `--text-dim` placeholder
- Run button: gold accent bg, dark text, pill shape (border-radius: 999px)
- Pause: outlined orange, fills on hover
- Kill: outlined red, fills on hover
- All buttons: `transition: all 150ms ease-out`
- Thin vertical dividers between logical groups

### Panel Chrome

- Tab bar: `--depth-1`, 36px height
- Active tab: `--accent-secondary` text + sliding 2px bottom indicator
- Inactive tab: `--text-dim`, brightens on hover
- Splitter handles: invisible default, thin gold line on hover (4px hit area)

### WorkspaceExplorer

- Section headers: uppercase, `--text-xs`, 1px letter-spacing, `--accent-secondary`
- File items: 28px height, nested indent, 12px icon area
- Selected: `--depth-3` bg + 2px gold left border
- Hover: `--depth-3` at 50% opacity
- Custom scrollbar: 4px wide, `--depth-3` thumb, `--depth-1` track

## Inspector Panel

### Chat Log (Hybrid Style)

**User/Assistant messages:** Bubble style
- User: right-aligned, `--depth-3` bg, asymmetric border-radius (14/14/4/14px)
- Assistant: left-aligned, `--depth-1` bg, inverse corners
- Typography: IBM Plex Sans 13px

**Tool calls/system output:** Terminal style
- JetBrains Mono 12px, full-width, `--depth-1` bg
- Purple left-border accent (2px `--accent-purple`) for tool blocks
- Collapsible: header bar with tool name + chevron; expanded shows monospace result

**System messages:** Full-width, centered, `--text-dim`, horizontal rules

**Other details:**
- Timestamps: centered dividers between message groups (not per-message)
- Streaming indicator: three animated dots (150ms stagger)
- Auto-scroll with "jump to latest" floating button when scrolled up
- Code blocks: syntax-highlighted with copy button on hover

### Event Log

- Timeline style: left-side vertical line (2px, `--depth-3`) with colored dots
- Event cards: timestamp (left, dim), type badge (colored pill), description
- Expandable details on click
- Filter row: toggle pills for event types (each in status color)
- Replay buttons: ghost style, appear on hover

### Policy Banner

- 32px height, `--depth-1` bg
- Mode dot + name (green/amber/red tones)
- Permission tags: tiny pills with lock/check icons
- Expandable for full policy details

## Editor

### Agent Editor

- Toolbar: `--depth-1`, 36px height, ghost-style buttons
- Validation indicator: small status dot + short text
- Monaco cursor: gold accent `#e0a650`
- Line highlight: warm-tinted gray
- Empty state: centered placeholder with muted text in Plus Jakarta Sans

### Settings Modal

- Entrance: backdrop fade (200ms) + modal slide-up with spring (300ms)
- Background: `--depth-2`, 1px `--depth-3` border, 16px border-radius
- Section headers: card-like blocks with `--depth-1` header strip
- Input focus: gold accent border + `0 0 0 2px rgba(224,166,80,0.2)` glow
- Toggle switches for booleans (replaces checkboxes)
- Danger zone: red-tinted background, red border
- Close: Escape key, reverse animation
- Focus trapping within modal

## Implementation Strategy

CSS Modules for complex components (graph nodes, chat log, inspector, settings modal). Inline styles with CSS variable references for simple leaf components. Design tokens in a global `design-tokens.css` file. Fonts loaded via Google Fonts in index.html.
