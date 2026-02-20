import { useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import type { GraphEdgeData } from '../../hooks/useGraphData';

/**
 * Color palette for particle trails based on edge kind.
 * Only spawn, signal, and activity edges receive particles.
 */
const EDGE_COLORS: Record<string, string> = {
  spawn: '#e0a650',
  signal: '#fab387',
  activity: '#cba6f7',
};

/** How many particles to spawn per edge. */
const PARTICLES_PER_EDGE = 4;

/** Speed: fraction of path traveled per frame at 60fps. */
const BASE_SPEED = 0.006;

/** Particle radius in flow-space pixels. */
const PARTICLE_RADIUS = 2.5;

interface Particle {
  edgeId: string;
  progress: number; // 0..1 along the path
  speed: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color: string;
}

interface ParticleOverlayProps {
  edges: Edge<GraphEdgeData>[];
}

/**
 * Canvas overlay that draws glowing particles traveling along edge paths
 * between connected nodes. Only "recent" edges (animated + data.recent)
 * receive particles.
 */
export function ParticleOverlay({ edges }: ParticleOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const { getViewport, getNodes } = useReactFlow();

  /**
   * Determines which edges qualify for particles and syncs the particle pool.
   * Called on every edge change to add/remove particles.
   */
  const syncParticles = useCallback(() => {
    const nodes = getNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Collect edges that are actively flowing
    const activeEdges = edges.filter(
      (e) => e.animated && e.data?.recent,
    );

    // Build a set of currently active edge IDs
    const activeIds = new Set(activeEdges.map((e) => e.id));

    // Remove particles for edges that are no longer active
    particlesRef.current = particlesRef.current.filter((p) =>
      activeIds.has(p.edgeId),
    );

    // Determine which active edges already have particles
    const existingEdgeIds = new Set(
      particlesRef.current.map((p) => p.edgeId),
    );

    // Spawn particles for newly active edges
    for (const edge of activeEdges) {
      if (existingEdgeIds.has(edge.id)) {
        // Update positions in case nodes moved
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (sourceNode && targetNode) {
          const sWidth = sourceNode.measured?.width ?? 220;
          const sHeight = sourceNode.measured?.height ?? 120;
          const tWidth = targetNode.measured?.width ?? 220;

          const sx = sourceNode.position.x + sWidth / 2;
          const sy = sourceNode.position.y + sHeight;
          const tx = targetNode.position.x + tWidth / 2;
          const ty = targetNode.position.y;

          for (const p of particlesRef.current) {
            if (p.edgeId === edge.id) {
              p.sourceX = sx;
              p.sourceY = sy;
              p.targetX = tx;
              p.targetY = ty;
            }
          }
        }
        continue;
      }

      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      // Compute center-bottom of source and center-top of target
      const sWidth = sourceNode.measured?.width ?? 220;
      const sHeight = sourceNode.measured?.height ?? 120;
      const tWidth = targetNode.measured?.width ?? 220;

      const sx = sourceNode.position.x + sWidth / 2;
      const sy = sourceNode.position.y + sHeight;
      const tx = targetNode.position.x + tWidth / 2;
      const ty = targetNode.position.y;

      const color = EDGE_COLORS[edge.data?.kind ?? ''] ?? EDGE_COLORS.activity;

      for (let i = 0; i < PARTICLES_PER_EDGE; i++) {
        particlesRef.current.push({
          edgeId: edge.id,
          progress: i / PARTICLES_PER_EDGE, // stagger initial positions
          speed: BASE_SPEED + Math.random() * 0.002,
          sourceX: sx,
          sourceY: sy,
          targetX: tx,
          targetY: ty,
          color,
        });
      }
    }
  }, [edges, getNodes]);

  /** Stable ref for getViewport so the animation loop always uses the latest. */
  const getViewportRef = useRef(getViewport);
  useEffect(() => { getViewportRef.current = getViewport; }, [getViewport]);

  // Sync particles whenever edges change
  useEffect(() => {
    syncParticles();
  }, [syncParticles]);

  // Start and stop the animation loop
  useEffect(() => {
    const animate = createAnimationLoop(canvasRef, particlesRef, getViewportRef, rafRef);
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}

type Viewport = { x: number; y: number; zoom: number };

/**
 * Creates a self-referencing animation loop function.
 * Extracted outside the component to avoid ref access during render.
 */
function createAnimationLoop(
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  particlesRef: MutableRefObject<Particle[]>,
  getViewportRef: MutableRefObject<() => Viewport>,
  rafRef: MutableRefObject<number>,
): () => void {
  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, w, h);

    const { x: panX, y: panY, zoom } = getViewportRef.current();
    const particles = particlesRef.current;

    if (particles.length === 0) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    const updated: Particle[] = [];
    for (const p of particles) {
      const next = { ...p, progress: p.progress + p.speed };
      if (next.progress > 1) next.progress -= 1;
      updated.push(next);

      const fx = next.sourceX + (next.targetX - next.sourceX) * next.progress;
      const fy = next.sourceY + (next.targetY - next.sourceY) * next.progress;
      const sx = fx * zoom + panX;
      const sy = fy * zoom + panY;
      const alpha = 1 - next.progress * 0.6;

      ctx.beginPath();
      ctx.arc(sx, sy, PARTICLE_RADIUS * 2.5 * zoom, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(next.color, alpha * 0.25);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sx, sy, PARTICLE_RADIUS * zoom, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(next.color, alpha);
      ctx.fill();
    }
    particlesRef.current = updated;

    rafRef.current = requestAnimationFrame(animate);
  };
  return animate;
}

/**
 * Converts a hex color string to an rgba() with the given alpha.
 * Handles both #RGB and #RRGGBB formats.
 */
function colorWithAlpha(hex: string, alpha: number): string {
  let r = 0,
    g = 0,
    b = 0;

  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
