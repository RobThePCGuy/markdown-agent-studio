import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphActivityKind, GraphActivityNodeData } from '../../hooks/useGraphData';

const activityPalette: Record<GraphActivityKind, { border: string; bg: string; dot: string }> = {
  thinking: { border: '#a6e3a1', bg: 'rgba(166,227,161,0.1)', dot: '#a6e3a1' },
  web_search: { border: '#89b4fa', bg: 'rgba(137,180,250,0.12)', dot: '#89b4fa' },
  web_fetch: { border: '#74c7ec', bg: 'rgba(116,199,236,0.12)', dot: '#74c7ec' },
  signal: { border: '#fab387', bg: 'rgba(250,179,135,0.12)', dot: '#fab387' },
  spawn: { border: '#f9e2af', bg: 'rgba(249,226,175,0.1)', dot: '#f9e2af' },
  filesystem: { border: '#cba6f7', bg: 'rgba(203,166,247,0.12)', dot: '#cba6f7' },
  tool: { border: '#94e2d5', bg: 'rgba(148,226,213,0.12)', dot: '#94e2d5' },
};

export function ActivityNode({ data }: NodeProps) {
  const d = data as GraphActivityNodeData;
  const palette = activityPalette[d.activityKind] ?? activityPalette.tool;

  return (
    <div
      style={{
        minWidth: 145,
        maxWidth: 180,
        padding: '8px 10px',
        borderRadius: 10,
        border: `1px dashed ${palette.border}`,
        background: `linear-gradient(180deg, ${palette.bg}, rgba(24,24,37,0.8))`,
        color: '#cdd6f4',
        boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
        animation: 'activityFloat 2.2s ease-in-out infinite',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 6, height: 6, background: palette.dot, border: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: palette.dot,
            boxShadow: `0 0 10px ${palette.dot}`,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 700 }}>
          {d.label}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: '#bac2de',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {d.detail}
      </div>
    </div>
  );
}
