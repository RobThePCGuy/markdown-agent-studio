# MAS Frontend Design Overhaul - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform MAS from prototype-quality UI to a refined developer tool aesthetic (Linear/Raycast caliber) with evolved Catppuccin Mocha palette, distinctive typography, and polished interactions.

**Architecture:** Create a CSS custom properties design system (`design-tokens.css`), migrate complex components to CSS modules, enhance animations, and polish every surface. Google Fonts loaded in index.html. Simple leaf components keep inline styles but reference CSS variables.

**Tech Stack:** React 19, CSS Modules (`.module.css`), CSS Custom Properties, Google Fonts (Plus Jakarta Sans, IBM Plex Sans, JetBrains Mono), Vite 7 (CSS modules supported out of the box).

---

### Task 1: Design Tokens Foundation

**Files:**
- Create: `src/styles/design-tokens.css`
- Modify: `src/index.css`
- Modify: `index.html`
- Modify: `src/main.tsx`
- Delete content from: `src/App.css` (redundant)

**Step 1: Add Google Fonts to index.html**

Add font preconnect and stylesheet links in `<head>` of `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

Also update `<title>` from "vite-scaffold" to "Markdown Agent Studio".

**Step 2: Create design-tokens.css**

Create `src/styles/design-tokens.css` with all CSS custom properties:

```css
:root {
  /* Depth layers */
  --depth-0: #0a0a14;
  --depth-1: #11111b;
  --depth-2: #1e1e2e;
  --depth-3: #313244;
  --depth-4: #45475a;

  /* MAS accent */
  --accent-primary: #e0a650;
  --accent-primary-dim: rgba(224,166,80,0.15);
  --accent-secondary: #89b4fa;

  /* Status */
  --status-green: #a6e3a1;
  --status-blue: #89b4fa;
  --status-cyan: #74c7ec;
  --status-orange: #fab387;
  --status-red: #f38ba8;
  --status-yellow: #f9e2af;
  --status-purple: #cba6f7;
  --status-teal: #94e2d5;

  /* Status glows */
  --glow-green: 0 0 12px rgba(166,227,161,0.4);
  --glow-blue: 0 0 12px rgba(137,180,250,0.4);
  --glow-cyan: 0 0 12px rgba(116,199,236,0.4);
  --glow-orange: 0 0 12px rgba(250,179,135,0.4);
  --glow-red: 0 0 12px rgba(243,139,168,0.4);
  --glow-yellow: 0 0 12px rgba(249,226,175,0.4);
  --glow-purple: 0 0 12px rgba(203,166,247,0.4);
  --glow-teal: 0 0 12px rgba(148,226,213,0.4);

  /* Text */
  --text-primary: #cdd6f4;
  --text-secondary: #bac2de;
  --text-dim: #6c7086;
  --text-very-dim: #585b70;
  --text-subtle: #a6adc8;

  /* Typography */
  --font-heading: 'Plus Jakarta Sans', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;

  --text-xs: 10px;
  --text-sm: 12px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.5);

  /* Transitions */
  --transition-fast: 150ms ease-out;
  --transition-normal: 250ms ease-out;
  --transition-slow: 400ms cubic-bezier(0.16, 1, 0.3, 1);

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 999px;
}
```

**Step 3: Update index.css**

Replace `src/index.css` to use design tokens:

```css
@import './styles/design-tokens.css';

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-body);
  background: var(--depth-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Global scrollbar styling */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: var(--depth-1);
}
::-webkit-scrollbar-thumb {
  background: var(--depth-3);
  border-radius: var(--radius-full);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--depth-4);
}

/* Focus visible for keyboard navigation */
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

**Step 4: Import design-tokens in main.tsx**

The `@import` in index.css handles it. Remove the redundant `App.css` import if present in `App.tsx`. Empty out `src/App.css`.

**Step 5: Verify dev server starts**

Run: `npm run dev`
Expected: App loads with new fonts visible, scrollbars styled, no errors in console.

**Step 6: Commit**

```bash
git add src/styles/design-tokens.css src/index.css index.html src/App.css src/main.tsx
git commit -m "feat: add design tokens, typography, and global styles foundation"
```

---

### Task 2: Enhanced Animations

**Files:**
- Modify: `src/styles/animations.css`

**Step 1: Rewrite animations.css**

Replace the full file with enhanced keyframes:

```css
/* Agent node pulse - status bar glow */
@keyframes agentPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(166, 227, 161, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(166, 227, 161, 0.3); }
}

/* Node spawn - overshoot bounce */
@keyframes nodeSpawnPop {
  0% {
    transform: scale(0.78);
    opacity: 0;
  }
  70% {
    transform: scale(1.04);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Activity node subtle float */
@keyframes activityFloat {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-2px); }
}

/* Streaming dots */
@keyframes streamingDot {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* Broadcasting ring pulse for activity dots */
@keyframes broadcastPulse {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}

/* HUD slide down entrance */
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Modal entrance */
@keyframes modalSlideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes backdropFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Edge flow animation */
@keyframes edgeFlow {
  to { stroke-dashoffset: -20; }
}

/* Cursor blink */
@keyframes blink {
  50% { opacity: 0; }
}
```

**Step 2: Verify animations load**

Run: `npm run dev`
Expected: No console errors. Existing animations still work.

**Step 3: Commit**

```bash
git add src/styles/animations.css
git commit -m "feat: enhance CSS animations with streaming dots, broadcast pulse, modal entrance"
```

---

### Task 3: AgentNode CSS Module + Redesign

**Files:**
- Create: `src/components/graph/AgentNode.module.css`
- Modify: `src/components/graph/AgentNode.tsx`

**Step 1: Create AgentNode.module.css**

```css
.node {
  min-width: 200px;
  border-radius: 14px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  transition: border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
  background:
    url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E"),
    linear-gradient(180deg, rgba(24,24,37,0.96) 0%, rgba(17,17,27,0.96) 100%);
  position: relative;
  cursor: pointer;
}

.node:hover {
  transform: translateY(-1px);
}

.node.selected::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 18px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(116,199,236,0.25), 0 0 16px rgba(116,199,236,0.12);
  pointer-events: none;
}

.accentBar {
  position: absolute;
  top: 0;
  left: 12px;
  right: 12px;
  height: 3px;
  border-radius: 0 0 2px 2px;
  transition: background var(--transition-fast), box-shadow var(--transition-fast);
}

.accentBar.running {
  animation: agentPulse 1.4s ease-in-out infinite;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  margin-top: 4px;
}

.agentName {
  font-family: var(--font-heading);
  font-weight: var(--weight-semibold);
  font-size: 13px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusLabel {
  font-size: var(--text-xs);
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-body);
}

.pathRow {
  font-size: var(--text-xs);
  color: var(--text-dim);
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.statsRow {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 6px;
  border-top: 1px solid rgba(69,71,90,0.4);
  font-size: 10px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.statItem {
  display: flex;
  align-items: center;
  gap: 4px;
}

.statDot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.handle {
  background: var(--depth-4) !important;
  width: 7px !important;
  height: 7px !important;
}
```

**Step 2: Rewrite AgentNode.tsx**

Replace the component to use CSS modules. Keep the same props/data interface. Import `styles from './AgentNode.module.css'`. Replace all inline style objects with className references. The `statusColors` map and `compactTokens` helper stay as-is. Dynamic values (border-color based on status) use inline `style` only for the truly dynamic parts.

Key changes:
- Outer div: `className={[styles.node, d.selected && styles.selected].filter(Boolean).join(' ')}` plus `style={{ borderColor, boxShadow, animation }}`
- Add `.accentBar` div inside the node, before the header
- Replace StatPill with `.statsRow` containing `.statItem` elements
- Use `var(--font-heading)` for agent name, `var(--font-mono)` for path

**Step 3: Verify graph nodes render**

Run: `npm run dev`
Expected: Agent nodes show with new styling, accent bar at top, refined typography.

**Step 4: Commit**

```bash
git add src/components/graph/AgentNode.module.css src/components/graph/AgentNode.tsx
git commit -m "feat: redesign AgentNode with CSS module, accent bar, noise texture"
```

---

### Task 4: ActivityNode CSS Module + Redesign

**Files:**
- Create: `src/components/graph/ActivityNode.module.css`
- Modify: `src/components/graph/ActivityNode.tsx`

**Step 1: Create ActivityNode.module.css**

```css
.node {
  max-width: 160px;
  min-width: 130px;
  padding: 7px 10px;
  border-radius: 10px;
  backdrop-filter: blur(8px);
  color: var(--text-primary);
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  animation: activityFloat 2.2s ease-in-out infinite;
  font-family: var(--font-body);
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dotWrapper {
  position: relative;
  width: 6px;
  height: 6px;
  flex-shrink: 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  position: absolute;
  inset: 0;
}

.dotRing {
  position: absolute;
  inset: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: broadcastPulse 1.8s ease-out infinite;
}

.label {
  font-size: 11px;
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
}

.detail {
  margin-top: 3px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.handle {
  border: none !important;
}
```

**Step 2: Rewrite ActivityNode.tsx to use CSS module**

Replace inline styles with module classes. Dynamic values (border color, background rgba) remain inline. Add the `.dotRing` broadcast pulse element around the indicator dot.

**Step 3: Verify, commit**

```bash
git add src/components/graph/ActivityNode.module.css src/components/graph/ActivityNode.tsx
git commit -m "feat: redesign ActivityNode with frosted glass, broadcast pulse"
```

---

### Task 5: GraphView Redesign (Background, HUD, Legend)

**Files:**
- Create: `src/components/graph/GraphView.module.css`
- Modify: `src/components/graph/GraphView.tsx`

**Step 1: Create GraphView.module.css**

```css
.container {
  height: 100%;
  width: 100%;
  position: relative;
}

.hud {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(69,71,90,0.6);
  background: rgba(17,17,27,0.8);
  backdrop-filter: blur(12px);
  pointer-events: none;
  animation: slideDown 300ms ease-out;
  font-family: var(--font-body);
}

.hudGroup {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  font-size: 10.5px;
  color: var(--text-primary);
}

.hudGroup + .hudGroup {
  border-left: 1px solid rgba(69,71,90,0.5);
}

.hudDot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.hudLabel {
  color: var(--text-dim);
  font-size: 10px;
}

.hudValue {
  font-family: var(--font-mono);
  font-weight: var(--weight-medium);
  font-size: 10.5px;
}

.legend {
  position: absolute;
  bottom: 12px;
  left: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(69,71,90,0.6);
  background: rgba(17,17,27,0.8);
  backdrop-filter: blur(12px);
  pointer-events: none;
  font-family: var(--font-body);
}

.legendItem {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.legendLine {
  width: 16px;
  height: 0;
  display: inline-block;
}

.controls {
  background: var(--depth-2) !important;
  border: 1px solid var(--depth-3) !important;
  border-radius: var(--radius-md) !important;
}

.minimap {
  background: var(--depth-2) !important;
  border: 1px solid var(--depth-3) !important;
}
```

**Step 2: Update GraphView.tsx**

- Import CSS module
- Change graph background to warm gold gradient + vignette:
  ```
  radial-gradient(ellipse at 50% 50%, rgba(224,166,80,0.06), transparent 70%),
  radial-gradient(ellipse at 50% 50%, var(--depth-0), transparent),
  var(--depth-0)
  ```
- Change `<Background>` to dot variant: `variant="dots"`, `color="#313244"`, `gap={24}`, `size={1}`
- Replace HudPill components with `.hudGroup` elements containing `.hudDot` + `.hudLabel` + `.hudValue`
- Replace Legend with `.legend` using `.legendItem` elements
- Apply `.controls` and `.minimap` classes

**Step 3: Verify, commit**

```bash
git add src/components/graph/GraphView.module.css src/components/graph/GraphView.tsx
git commit -m "feat: redesign GraphView with dot grid, gold gradient, glass HUD"
```

---

### Task 6: TopBar Redesign

**Files:**
- Create: `src/components/layout/TopBar.module.css`
- Modify: `src/components/layout/TopBar.tsx`

**Step 1: Create TopBar.module.css**

```css
.topbar {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--depth-3);
  background: var(--depth-1);
  color: var(--text-primary);
  gap: var(--space-2);
  font-family: var(--font-body);
}

.logo {
  font-family: var(--font-heading);
  font-weight: var(--weight-bold);
  font-size: var(--text-md);
  color: var(--accent-primary);
  letter-spacing: 0.5px;
  margin-right: var(--space-2);
  user-select: none;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--depth-3);
  flex-shrink: 0;
}

.select {
  background: var(--depth-2);
  color: var(--text-primary);
  border: 1px solid var(--depth-3);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.select:hover {
  border-color: var(--depth-4);
}
.select:focus {
  border-color: var(--accent-primary);
  outline: none;
}

.promptInput {
  flex: 1;
  background: var(--depth-2);
  color: var(--text-primary);
  border: 1px solid var(--depth-3);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
  transition: border-color var(--transition-fast);
}
.promptInput::placeholder {
  color: var(--text-dim);
}
.promptInput:focus {
  border-color: var(--accent-primary);
  outline: none;
}

.btnRun {
  background: var(--accent-primary);
  color: var(--depth-0);
  border: none;
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btnRun:hover {
  filter: brightness(1.1);
  box-shadow: 0 0 12px rgba(224,166,80,0.3);
}

.btnOutline {
  background: transparent;
  border: 1px solid;
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btnOutline.orange {
  color: var(--status-orange);
  border-color: var(--status-orange);
}
.btnOutline.orange:hover {
  background: var(--status-orange);
  color: var(--depth-0);
}
.btnOutline.blue {
  color: var(--status-blue);
  border-color: var(--status-blue);
}
.btnOutline.blue:hover {
  background: var(--status-blue);
  color: var(--depth-0);
}
.btnOutline.red {
  color: var(--status-red);
  border-color: var(--status-red);
}
.btnOutline.red:hover {
  background: var(--status-red);
  color: var(--depth-0);
}

.stats {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.projectBtn {
  background: none;
  border: none;
  font-size: var(--text-md);
  cursor: pointer;
  padding: var(--space-1) var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  transition: color var(--transition-fast);
}

.statusDot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.settingsBtn {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: var(--space-1) var(--space-2);
  margin-left: var(--space-1);
  transition: color var(--transition-fast);
}
.settingsBtn:hover {
  color: var(--text-primary);
}
```

**Step 2: Rewrite TopBar.tsx to use CSS module**

Import `styles from './TopBar.module.css'`. Replace all inline style objects with classNames. Add `.divider` elements between logical groups (logo | agent+prompt | actions | status | project | settings). Change Run button to gold accent pill. Change Pause/Kill to outlined style.

**Step 3: Verify, commit**

```bash
git add src/components/layout/TopBar.module.css src/components/layout/TopBar.tsx
git commit -m "feat: redesign TopBar with gold accent, pill buttons, dividers"
```

---

### Task 7: AppLayout Tab Chrome + Allotment Styling

**Files:**
- Create: `src/components/layout/AppLayout.module.css`
- Modify: `src/components/layout/AppLayout.tsx`

**Step 1: Create AppLayout.module.css**

```css
.root {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow: hidden;
}

.centerPane {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tabBar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--depth-3);
  background: var(--depth-1);
  height: 36px;
  align-items: stretch;
}

.tab {
  background: transparent;
  color: var(--text-dim);
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0 var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
  display: flex;
  align-items: center;
}
.tab:hover {
  color: var(--text-primary);
}
.tab.active {
  color: var(--accent-secondary);
  border-bottom-color: var(--accent-secondary);
}

.paneContent {
  flex: 1;
  overflow: hidden;
}

/* Allotment splitter handle override */
:global(.sash-container .sash) {
  transition: background var(--transition-fast) !important;
}
:global(.sash-container .sash:hover) {
  background: rgba(224,166,80,0.4) !important;
}
```

**Step 2: Rewrite AppLayout.tsx with CSS module**

Replace the `tabStyle` function with `.tab` and `.tab.active` classes. Use `.tabBar`, `.centerPane`, `.paneContent` classes. Keep Allotment structure unchanged.

**Step 3: Verify, commit**

```bash
git add src/components/layout/AppLayout.module.css src/components/layout/AppLayout.tsx
git commit -m "feat: redesign AppLayout tabs and splitter handles"
```

---

### Task 8: WorkspaceExplorer Redesign

**Files:**
- Create: `src/components/explorer/WorkspaceExplorer.module.css`
- Modify: `src/components/explorer/WorkspaceExplorer.tsx`

**Step 1: Create WorkspaceExplorer.module.css**

```css
.container {
  height: 100%;
  background: var(--depth-2);
  color: var(--text-primary);
  padding: var(--space-2);
  overflow: auto;
  font-family: var(--font-body);
}

.heading {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: var(--space-2);
  font-family: var(--font-heading);
}

.emptyDrop {
  border: 2px dotted var(--depth-4);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-dim);
}

.group {
  margin-bottom: var(--space-2);
}

.groupHeader {
  font-size: 11px;
  font-weight: var(--weight-semibold);
  color: var(--accent-secondary);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-heading);
}

.fileItem {
  padding: 2px var(--space-2);
  height: 28px;
  font-size: var(--text-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background var(--transition-fast);
  border-left: 2px solid transparent;
}
.fileItem:hover {
  background: rgba(49,50,68,0.5);
}
.fileItem.selected {
  background: var(--depth-3);
  border-left-color: var(--accent-primary);
}

.agentDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.fileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
}
```

**Step 2: Rewrite WorkspaceExplorer.tsx with CSS module**

Replace all inline styles with class references. Use `.fileItem.selected` for selected state. Use `.agentDot` with inline background color. Use `.fileName` for text.

**Step 3: Verify, commit**

```bash
git add src/components/explorer/WorkspaceExplorer.module.css src/components/explorer/WorkspaceExplorer.tsx
git commit -m "feat: redesign WorkspaceExplorer with gold selection indicator, refined file items"
```

---

### Task 9: ChatLog Hybrid Redesign

**Files:**
- Create: `src/components/inspector/ChatLog.module.css`
- Modify: `src/components/inspector/ChatLog.tsx`

**Step 1: Create ChatLog.module.css**

```css
.container {
  height: 100%;
  overflow: auto;
  padding: var(--space-3);
  background: var(--depth-2);
  font-family: var(--font-body);
  color: var(--text-primary);
}

.empty {
  color: var(--text-very-dim);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-8) 0;
  font-family: var(--font-heading);
}

/* Timestamp divider between message groups */
.timeDivider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3) 0;
  font-size: var(--text-xs);
  color: var(--text-very-dim);
  font-family: var(--font-mono);
}
.timeDivider::before,
.timeDivider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--depth-3);
}

/* Message bubbles */
.messageBubble {
  max-width: 85%;
  padding: 10px 14px;
  margin-bottom: var(--space-2);
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.userBubble {
  margin-left: auto;
  background: var(--depth-3);
  border-radius: 14px 14px 4px 14px;
  color: var(--text-primary);
}

.assistantBubble {
  margin-right: auto;
  background: var(--depth-1);
  border-radius: 14px 14px 14px 4px;
  color: var(--text-primary);
}

/* Tool call blocks - terminal style */
.toolBlock {
  margin-bottom: var(--space-2);
  border-left: 2px solid var(--status-purple);
  background: var(--depth-1);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow: hidden;
}

.toolHeader {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  color: var(--status-purple);
  transition: background var(--transition-fast);
}
.toolHeader:hover {
  background: rgba(203,166,247,0.06);
}

.toolIcon {
  font-size: 11px;
}

.toolName {
  font-weight: var(--weight-semibold);
  font-size: 11px;
}

.toolChevron {
  margin-left: auto;
  font-size: 10px;
  transition: transform var(--transition-fast);
}
.toolChevron.expanded {
  transform: rotate(90deg);
}

.toolSummary {
  color: var(--text-dim);
  font-size: 10px;
  margin-left: var(--space-1);
}

.toolResult {
  padding: 8px 10px;
  border-top: 1px solid rgba(69,71,90,0.4);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  font-size: 11px;
  max-height: 300px;
  overflow: auto;
}

/* Streaming indicator */
.streaming {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  padding: 4px 0;
}

.streamDot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--status-green);
  animation: streamingDot 1.2s ease-in-out infinite;
}
.streamDot:nth-child(2) { animation-delay: 150ms; }
.streamDot:nth-child(3) { animation-delay: 300ms; }

/* Jump to bottom button */
.jumpToBottom {
  position: sticky;
  bottom: var(--space-2);
  display: flex;
  justify-content: center;
}
.jumpToBottom button {
  background: var(--depth-3);
  color: var(--text-secondary);
  border: 1px solid var(--depth-4);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-md);
}
.jumpToBottom button:hover {
  background: var(--depth-4);
  color: var(--text-primary);
}

/* System messages */
.systemMessage {
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-xs);
  padding: var(--space-2) 0;
  font-family: var(--font-body);
}
```

**Step 2: Rewrite ChatLog.tsx with hybrid style**

Major changes:
- User/Assistant messages render as `.messageBubble` + `.userBubble`/`.assistantBubble`
- Tool calls render as `.toolBlock` with collapsible `.toolHeader` + `.toolResult`
- Replace blinking pipe with `.streaming` dots (three `.streamDot` spans)
- Add "Jump to latest" button when `!stickToBottom`
- Group timestamps as `.timeDivider` between message blocks (show when >60s gap)

**Step 3: Verify, commit**

```bash
git add src/components/inspector/ChatLog.module.css src/components/inspector/ChatLog.tsx
git commit -m "feat: redesign ChatLog with hybrid bubbles + terminal tool blocks"
```

---

### Task 10: EventLogView Timeline Redesign

**Files:**
- Create: `src/components/inspector/EventLogView.module.css`
- Modify: `src/components/inspector/EventLogView.tsx`

**Step 1: Create EventLogView.module.css**

```css
.container {
  height: 100%;
  overflow: auto;
  padding: var(--space-2);
  font-family: var(--font-body);
}

.header {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-dim);
  margin-bottom: var(--space-2);
  font-family: var(--font-heading);
}

.meta {
  font-size: var(--text-xs);
  color: var(--text-dim);
  margin-bottom: var(--space-2);
  font-family: var(--font-mono);
}

.status {
  font-size: 11px;
  color: var(--accent-secondary);
  margin-bottom: var(--space-2);
}

.filters {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}

.filterPill {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid;
  cursor: pointer;
  font-family: var(--font-body);
  transition: all var(--transition-fast);
  background: transparent;
}
.filterPill.active {
  background: currentColor;
  color: var(--depth-0);
}

.timeline {
  position: relative;
  padding-left: 20px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--depth-3);
}

.event {
  position: relative;
  padding: var(--space-1) var(--space-2);
  margin-bottom: 2px;
  font-size: 11px;
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}
.event:hover {
  background: rgba(49,50,68,0.3);
}

.eventDot {
  position: absolute;
  left: -17px;
  top: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--depth-2);
}

.eventTime {
  color: var(--text-dim);
  margin-right: var(--space-2);
}

.eventType {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: var(--weight-medium);
  margin-right: var(--space-2);
}

.eventAgent {
  color: var(--text-dim);
}

.eventActions {
  margin-top: var(--space-1);
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.event:hover .eventActions {
  opacity: 1;
}

.ghostBtn {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--depth-3);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  font-size: 10px;
  cursor: pointer;
  font-family: var(--font-body);
  transition: all var(--transition-fast);
}
.ghostBtn:hover {
  background: var(--depth-3);
  color: var(--text-primary);
}
.ghostBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.eventError {
  color: var(--status-red);
  margin-top: 2px;
  word-break: break-word;
}

.eventMessage {
  color: var(--status-orange);
  margin-top: 2px;
}

.empty {
  color: var(--text-dim);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-8) 0;
  font-family: var(--font-heading);
}
```

**Step 2: Rewrite EventLogView.tsx with timeline layout**

Add timeline wrapper with left vertical line. Each event gets a colored `.eventDot` positioned on the line. Action buttons (Restore/Replay) appear on hover via CSS, not always visible. Optional: Add filter pills at top for event types.

**Step 3: Verify, commit**

```bash
git add src/components/inspector/EventLogView.module.css src/components/inspector/EventLogView.tsx
git commit -m "feat: redesign EventLogView as timeline with hover actions"
```

---

### Task 11: InspectorPanel + PolicyBanner Redesign

**Files:**
- Create: `src/components/inspector/InspectorPanel.module.css`
- Modify: `src/components/inspector/InspectorPanel.tsx`

**Step 1: Create InspectorPanel.module.css**

```css
.container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chatArea {
  flex: 1;
  min-height: 0;
}

.policyBanner {
  height: 32px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--depth-3);
  background: var(--depth-1);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-family: var(--font-body);
  overflow: hidden;
}

.modeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.modeLabel {
  font-weight: var(--weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-heading);
}

.permPill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--depth-4);
  background: rgba(30,30,46,0.9);
  font-size: 10px;
  white-space: nowrap;
}

.permIcon {
  font-size: 9px;
}
```

**Step 2: Rewrite InspectorPanel.tsx with CSS module**

Compact PolicyBanner to 32px. Mode shown as colored dot + uppercase name. Permissions as tiny pills with lock/check text icons. Replace Badge component with `.permPill`.

**Step 3: Verify, commit**

```bash
git add src/components/inspector/InspectorPanel.module.css src/components/inspector/InspectorPanel.tsx
git commit -m "feat: redesign InspectorPanel with compact policy banner"
```

---

### Task 12: AgentEditor + EditorToolbar Redesign

**Files:**
- Create: `src/components/editor/AgentEditor.module.css`
- Modify: `src/components/editor/AgentEditor.tsx`
- Create: `src/components/editor/EditorToolbar.module.css`
- Modify: `src/components/editor/EditorToolbar.tsx`

**Step 1: Create CSS modules for both**

`AgentEditor.module.css`:
```css
.container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--depth-2);
}

.editorArea {
  flex: 1;
}

.emptyState {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: var(--text-md);
  font-family: var(--font-heading);
}
```

`EditorToolbar.module.css`:
```css
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--depth-3);
  background: var(--depth-1);
  height: 36px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex-wrap: wrap;
  font-family: var(--font-body);
}

.filePath {
  cursor: pointer;
  color: var(--accent-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  transition: color var(--transition-fast);
}
.filePath:hover {
  color: var(--text-primary);
}

.pathInput {
  background: var(--depth-3);
  color: var(--text-primary);
  border: 1px solid var(--accent-secondary);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  width: 200px;
}

.unsaved {
  color: var(--status-orange);
  font-size: 11px;
  font-family: var(--font-body);
}

.ghostBtn {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: 11px;
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ghostBtn:hover {
  border-color: var(--depth-4);
  background: rgba(49,50,68,0.3);
  color: var(--text-primary);
}

.ghostBtn.primary {
  color: var(--status-green);
}
.ghostBtn.primary:hover {
  border-color: var(--status-green);
  background: rgba(166,227,161,0.08);
}

.hint {
  color: var(--text-dim);
  font-style: italic;
  font-size: 11px;
}

.externalModified {
  width: 100%;
  background: var(--status-orange);
  color: var(--depth-0);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.reloadBtn {
  background: var(--depth-0);
  color: var(--status-orange);
  border: none;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
```

**Step 2: Update AgentEditor.tsx**

- Import CSS module
- Update Monaco theme: change cursor to gold `#e0a650`, line highlight to `#33324a` (warm-tinted)
- Replace inline styles with module classes

**Step 3: Update EditorToolbar.tsx**

- Import CSS module
- Replace `smallBtnStyle` function with `.ghostBtn` and `.ghostBtn.primary` classes
- Replace inline styles throughout

**Step 4: Verify, commit**

```bash
git add src/components/editor/AgentEditor.module.css src/components/editor/AgentEditor.tsx \
  src/components/editor/EditorToolbar.module.css src/components/editor/EditorToolbar.tsx
git commit -m "feat: redesign editor chrome with ghost buttons, gold cursor"
```

---

### Task 13: TemplatePicker Redesign

**Files:**
- Create: `src/components/editor/TemplatePicker.module.css`
- Modify: `src/components/editor/TemplatePicker.tsx`

**Step 1: Create TemplatePicker.module.css**

```css
.wrapper {
  position: relative;
}

.trigger {
  background: var(--accent-secondary);
  color: var(--depth-0);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-1) 10px;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.trigger:hover {
  filter: brightness(1.1);
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: var(--space-1);
  background: var(--depth-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--depth-4);
  min-width: 260px;
  max-height: 320px;
  overflow: auto;
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.sectionLabel {
  padding: 6px 10px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-heading);
}

.item {
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: background var(--transition-fast);
}
.item:hover {
  background: var(--depth-4);
}

.itemName {
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
}

.itemDesc {
  font-size: 11px;
  color: var(--text-dim);
}

.divider {
  border-top: 1px solid var(--depth-4);
  margin: var(--space-1) 0;
}
```

**Step 2: Rewrite TemplatePicker.tsx**

Replace inline styles and `onMouseEnter`/`onMouseLeave` JS handlers with CSS `:hover` via module class.

**Step 3: Verify, commit**

```bash
git add src/components/editor/TemplatePicker.module.css src/components/editor/TemplatePicker.tsx
git commit -m "feat: redesign TemplatePicker dropdown with CSS hover states"
```

---

### Task 14: SettingsModal Redesign

**Files:**
- Create: `src/components/settings/SettingsModal.module.css`
- Modify: `src/components/settings/SettingsModal.tsx`

**Step 1: Create SettingsModal.module.css**

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: backdropFadeIn 200ms ease-out;
}

.modal {
  background: var(--depth-2);
  border: 1px solid var(--depth-3);
  border-radius: var(--radius-xl);
  width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  padding: var(--space-6) 28px;
  position: relative;
  box-shadow: var(--shadow-lg);
  animation: modalSlideUp 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.headerRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}

.title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  font-family: var(--font-heading);
}

.closeBtn {
  background: none;
  border: none;
  color: var(--text-subtle);
  font-size: var(--text-xl);
  cursor: pointer;
  padding: 0 var(--space-1);
  line-height: 1;
  transition: color var(--transition-fast);
}
.closeBtn:hover {
  color: var(--text-primary);
}

.section {
  margin-bottom: var(--space-6);
}

.sectionTitle {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--accent-secondary);
  font-family: var(--font-heading);
}

.label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.labelText {
  font-size: var(--text-sm);
  color: var(--text-subtle);
  font-family: var(--font-body);
}

.input {
  background: var(--depth-1);
  border: 1px solid var(--depth-4);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  padding: var(--space-2) 10px;
  font-size: 13px;
  font-family: var(--font-body);
  outline: none;
  width: 100%;
  box-sizing: border-box;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(224,166,80,0.2);
}

.select {
  composes: input;
  cursor: pointer;
}

.divider {
  border: none;
  border-top: 1px solid var(--depth-4);
  margin: var(--space-5) 0;
}

.dangerZone {
  border: 1px solid var(--status-red);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: rgba(243,139,168,0.04);
}

.dangerText {
  margin: 0 0 var(--space-3);
  font-size: 13px;
  color: var(--text-subtle);
}

.dangerBtn {
  width: 100%;
  padding: 10px var(--space-4);
  border-radius: var(--radius-md);
  border: none;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  font-family: var(--font-heading);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.dangerBtn:enabled {
  background: var(--status-red);
  color: var(--depth-0);
  cursor: pointer;
}
.dangerBtn:disabled {
  background: var(--depth-4);
  color: var(--text-dim);
  cursor: not-allowed;
}

.showKeyBtn {
  background: var(--depth-1);
  border: 1px solid var(--depth-4);
  border-radius: var(--radius-md);
  color: var(--text-subtle);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}
.showKeyBtn:hover {
  border-color: var(--accent-primary);
  color: var(--text-primary);
}
```

**Step 2: Rewrite SettingsModal.tsx**

Replace all inline styles with module classes. Add `animation` properties via the CSS classes. The modal entrance uses `modalSlideUp` keyframe, backdrop uses `backdropFadeIn`. Use `.input:focus` for gold accent focus glow instead of manual focus handling. Replace the Section/Label/Divider helper components with `.section`/`.label`/`.divider` module classes.

**Step 3: Verify, commit**

```bash
git add src/components/settings/SettingsModal.module.css src/components/settings/SettingsModal.tsx
git commit -m "feat: redesign SettingsModal with entrance animation, gold focus glow"
```

---

### Task 15: Final Cleanup and Verification

**Files:**
- Modify: `src/App.css` (empty or delete)
- Verify all components

**Step 1: Remove redundant App.css content**

Empty out `src/App.css` or remove its import from `App.tsx` if it exists.

**Step 2: Run full dev server check**

Run: `npm run dev`
Verify each area manually:
- [ ] Fonts load (Plus Jakarta Sans visible in TopBar logo, IBM Plex Sans in body text)
- [ ] Gold accent visible on TopBar logo, Run button, input focus
- [ ] Graph background shows dot grid with warm gold gradient
- [ ] Agent nodes have accent bar, noise texture, hover lift
- [ ] Activity nodes have frosted glass, broadcast pulse on dot
- [ ] HUD is single glass panel with slide-down animation
- [ ] Tabs use heading font, active tab has blue indicator
- [ ] Explorer has gold left-border on selected item
- [ ] Chat shows bubbles for user/assistant, terminal blocks for tools
- [ ] Streaming shows three animated dots
- [ ] Event log has timeline style with hover-reveal actions
- [ ] Settings modal slides up, inputs have gold focus glow
- [ ] Scrollbars are styled globally (4px, dark)
- [ ] Splitter handles show gold on hover

**Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All existing unit tests pass (these test stores/core logic, not styling).

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup redundant styles, verify full build"
```
