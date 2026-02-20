import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphAgentNodeData } from '../../hooks/useGraphData';
import styles from './AgentNode.module.css';

const statusColors: Record<string, string> = {
  running: 'var(--status-green)',
  idle: 'var(--text-dim)',
  error: 'var(--status-red)',
  aborted: 'var(--status-orange)',
  completed: 'var(--status-cyan)',
  paused: 'var(--status-yellow)',
};

function compactTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function AgentNode({ data }: NodeProps) {
  const d = data as GraphAgentNodeData;
  const isSleeping = d.status === 'idle' || d.status === 'completed';
  const color = isSleeping ? '#7f849c' : (statusColors[d.status] ?? 'var(--text-dim)');
  const isRunning = d.status === 'running';
  const statusLabel = isSleeping ? 'sleeping' : d.status;
  const animation = [
    d.justSpawned ? 'nodeSpawnPop 380ms cubic-bezier(0.15, 0.95, 0.2, 1)' : '',
    isRunning ? 'agentPulse 1.4s ease-in-out infinite' : '',
  ].filter(Boolean).join(', ');

  const [prevStatus, setPrevStatus] = useState(d.status);
  const [pulseColor, setPulseColor] = useState<string | null>(null);

  useEffect(() => {
    if (d.status !== prevStatus) {
      setPulseColor(statusColors[d.status] ?? '#7f849c');
      setPrevStatus(d.status);
      const timer = setTimeout(() => setPulseColor(null), 600);
      return () => clearTimeout(timer);
    }
  }, [d.status, prevStatus]);

  return (
    <div
      className={[styles.node, d.selected && styles.selected].filter(Boolean).join(' ')}
      style={{
        borderColor: d.selected ? 'var(--status-cyan)' : color,
        boxShadow: pulseColor
          ? `0 0 20px ${pulseColor}, 0 8px 18px rgba(0,0,0,0.35)`
          : d.selected
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
        {(d.memoryCount as number) > 0 && (
          <span className={styles.statItem}>
            <span className={styles.statDot} style={{ background: 'var(--status-purple)' }} />
            <span>{d.memoryCount as number} mem</span>
          </span>
        )}
      </div>

      {pulseColor && (d.status === 'completed' || d.status === 'error') && (
        <div
          className={styles.sonarRing}
          style={{
            borderColor: d.status === 'completed' ? 'var(--status-green)' : 'var(--status-red)',
          }}
        />
      )}

      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}
