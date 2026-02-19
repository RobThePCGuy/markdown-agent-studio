import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphAgentNodeData } from '../../hooks/useGraphData';
import styles from './AgentNode.module.css';

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
      className={[styles.node, d.selected && styles.selected].filter(Boolean).join(' ')}
      style={{
        borderColor: d.selected ? '#74c7ec' : color,
        boxShadow: d.selected
          ? '0 0 0 1px rgba(116,199,236,0.25), 0 10px 22px rgba(0,0,0,0.35)'
          : '0 8px 18px rgba(0,0,0,0.35)',
        animation: animation || 'none',
      }}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} />

      <div
        className={[styles.accentBar, isRunning && styles.running].filter(Boolean).join(' ')}
        style={{
          background: color,
          boxShadow: isRunning ? `0 0 10px ${color}` : 'none',
        }}
      />

      <div className={styles.header}>
        <div className={styles.agentName}>{d.label}</div>
        <span className={styles.statusLabel}>{statusLabel}</span>
      </div>

      <div className={styles.pathRow}>{d.path}</div>

      <div className={styles.statsRow}>
        <span className={styles.statItem}>
          <span className={styles.statDot} style={{ background: 'var(--text-dim)' }} />
          <span>{compactTokens(d.tokenCount)} tok</span>
        </span>
        <span className={styles.statItem}>
          <span className={styles.statDot} style={{ background: 'var(--text-dim)' }} />
          <span>{d.spawnCount} children</span>
        </span>
        {d.isStreaming && (
          <span className={styles.statItem}>
            <span className={styles.statDot} style={{ background: 'var(--status-green)' }} />
            <span>thinking</span>
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}
