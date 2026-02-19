import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphAgentNodeData } from '../../hooks/useGraphData';

const statusColors: Record<string, string> = {
  running: '#a6e3a1',
  idle: '#6c7086',
  error: '#f38ba8',
  aborted: '#fab387',
  completed: '#89dceb',
  paused: '#f9e2af',
};

function compactTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function AgentNode({ data }: NodeProps) {
  const d = data as GraphAgentNodeData;
  const isSleeping = d.status === 'idle' || d.status === 'completed';
  const color = isSleeping ? '#7f849c' : (statusColors[d.status] ?? '#6c7086');
  const isRunning = d.status === 'running';
  const statusLabel = isSleeping ? 'sleeping' : d.status;
  const animation = [
    d.justSpawned ? 'nodeSpawnPop 380ms cubic-bezier(0.15, 0.95, 0.2, 1)' : '',
    isRunning ? 'agentPulse 1.4s ease-in-out infinite' : '',
  ].filter(Boolean).join(', ');

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(24,24,37,0.96) 0%, rgba(17,17,27,0.96) 100%)',
        border: `2px solid ${d.selected ? '#74c7ec' : color}`,
        borderRadius: 12,
        padding: '10px 12px',
        minWidth: 190,
        color: '#cdd6f4',
        fontSize: 12,
        transition: 'border-color 180ms ease, transform 180ms ease',
        boxShadow: d.selected
          ? '0 0 0 1px rgba(116,199,236,0.25), 0 10px 22px rgba(0,0,0,0.35)'
          : '0 8px 18px rgba(0,0,0,0.35)',
        animation: animation || 'none',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#6c7086', width: 7, height: 7 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: color,
              boxShadow: isRunning ? `0 0 10px ${color}` : 'none',
            }}
          />
          <span style={{ fontSize: 10, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          fontSize: 10,
          opacity: 0.62,
          marginBottom: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {d.path}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatPill label="tokens" value={compactTokens(d.tokenCount)} />
        <StatPill label="children" value={`${d.spawnCount}`} />
        {d.isStreaming && <StatPill label="thinking" value="..." glow />}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#6c7086', width: 7, height: 7 }} />
    </div>
  );
}

function StatPill({ label, value, glow = false }: { label: string; value: string; glow?: boolean }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        lineHeight: 1.2,
        padding: '3px 6px',
        borderRadius: 999,
        border: `1px solid ${glow ? '#a6e3a1' : '#45475a'}`,
        color: glow ? '#a6e3a1' : '#bac2de',
        background: glow ? 'rgba(166,227,161,0.08)' : 'rgba(49,50,68,0.55)',
        fontWeight: 600,
      }}
    >
      {label}: {value}
    </span>
  );
}
