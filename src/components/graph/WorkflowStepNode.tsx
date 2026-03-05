import { Handle, Position } from '@xyflow/react';
import type { GraphWorkflowStepNodeData } from '../../hooks/useGraphData';
import styles from './WorkflowStepNode.module.css';

type WorkflowStepStatus = GraphWorkflowStepNodeData['status'];

const statusColors: Record<WorkflowStepStatus, { border: string; dot: string }> = {
  pending: { border: '#585b70', dot: '#585b70' },
  running: { border: '#a6e3a1', dot: 'var(--status-green)' },
  completed: { border: '#89dceb', dot: 'var(--status-cyan)' },
  failed: { border: '#f38ba8', dot: 'var(--status-red)' },
};

export function WorkflowStepNode({ data }: { data: Record<string, unknown> }) {
  const d = data as GraphWorkflowStepNodeData;
  const palette = statusColors[d.status] ?? statusColors.pending;

  return (
    <div
      className={`${styles.node} ${d.status === 'running' ? styles.running : ''}`}
      style={{
        borderColor: palette.border,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={styles.handle}
        style={{ width: 6, height: 6, background: palette.dot }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={styles.handle}
        style={{ width: 6, height: 6, background: palette.dot }}
      />
      <div className={styles.header}>
        <span className={styles.dotWrapper}>
          <span className={styles.dot} style={{ background: palette.dot }} />
          {d.status === 'running' && (
            <span className={styles.dotRing} style={{ background: palette.dot }} />
          )}
        </span>
        <span className={styles.label}>{d.stepId}</span>
      </div>
      <div className={styles.agent}>{d.agent}</div>
    </div>
  );
}
