# Remove Duplicate Floating Particle Dots from Graph Animation

## Context

The graph view has two overlapping visual systems for showing active connections:

1. **Colored dashed lines** - ReactFlow edges with `animated: true` and `strokeDasharray` styling, animated via the CSS `edgeFlow` keyframe (`stroke-dashoffset: -20`). These already clearly show connections between nodes with color-coded dashed lines (orange for signals, green for thinking, purple/blue for tools, yellow for spawns).

2. **Floating particle dots** - A separate canvas overlay (`ParticleOverlay`) that draws glowing dots traveling along those same edges. These particles duplicate the visual information already conveyed by the dashed lines.

The user considers the floating dots redundant since the dashed lines already communicate the connections.

## Changes

### 1. Remove ParticleOverlay from GraphView
**File:** `src/components/graph/GraphView.tsx`
- Remove the import of `ParticleOverlay` (line 21)
- Remove the `<ParticleOverlay edges={edges} />` usage (line 131)

### 2. Delete the ParticleOverlay component file
**File:** `src/components/graph/ParticleOverlay.tsx`
- Delete this file entirely - it will have no remaining consumers

## Verification
- Run `npm run build` (or equivalent) to confirm no import errors
- Launch the app and observe the graph view - dashed lines should still animate along edges, but the floating glowing dots should be gone
