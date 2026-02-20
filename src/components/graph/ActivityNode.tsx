import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphActivityKind, GraphActivityNodeData } from '../../hooks/useGraphData';
import styles from './ActivityNode.module.css';

const activityPalette: Record<GraphActivityKind, { border: string; bg: string; dot: string }> = {
  thinking: { border: '#a6e3a1', bg: 'rgba(166,227,161,0.1)', dot: 'var(--status-green)' },
  web_search: { border: '#89b4fa', bg: 'rgba(137,180,250,0.12)', dot: 'var(--status-blue)' },
  web_fetch: { border: '#74c7ec', bg: 'rgba(116,199,236,0.12)', dot: 'var(--status-cyan)' },
  signal: { border: '#fab387', bg: 'rgba(250,179,135,0.12)', dot: 'var(--status-orange)' },
  spawn: { border: '#f9e2af', bg: 'rgba(249,226,175,0.1)', dot: 'var(--status-yellow)' },
  filesystem: { border: '#cba6f7', bg: 'rgba(203,166,247,0.12)', dot: 'var(--status-purple)' },
  tool: { border: '#94e2d5', bg: 'rgba(148,226,213,0.12)', dot: 'var(--status-teal)' },
};

/** Convert a hex color like '#a6e3a1' to 'rgba(166,227,161,alpha)' */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function ActivityNode({ data }: NodeProps) {
  const d = data as GraphActivityNodeData;
  const palette = activityPalette[d.activityKind] ?? activityPalette.tool;

  return (
    <div
      className={styles.node}
      style={{
        border: `1px solid ${hexToRgba(palette.border, 0.3)}`,
        background: hexToRgba(palette.border, 0.08),
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={styles.handle}
        style={{ width: 6, height: 6, background: palette.dot }}
      />
      <div className={styles.header}>
        <span className={styles.dotWrapper}>
          <span className={styles.dot} style={{ background: palette.dot }} />
          <span className={styles.dotRing} style={{ background: palette.dot }} />
        </span>
        <span className={styles.label}>
          {d.label}
        </span>
      </div>
      <div className={styles.detail}>
        {d.detail}
      </div>
    </div>
  );
}
