import { Handle, Position, type NodeProps } from '@xyflow/react';

interface AgentNodeData {
  label: string;
  path: string;
  status: string;
  tokenCount?: number;
}

const statusColors: Record<string, string> = {
  running: '#a6e3a1',
  idle: '#6c7086',
  error: '#f38ba8',
  aborted: '#fab387',
  completed: '#89dceb',
  paused: '#f9e2af',
};

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const color = statusColors[d.status] ?? '#6c7086';
  const isRunning = d.status === 'running';
  const tokens = d.tokenCount ?? 0;

  return (
    <div style={{
      background: '#1e1e2e',
      border: `2px solid ${color}`,
      borderRadius: 8,
      padding: '8px 12px',
      minWidth: 120,
      color: '#cdd6f4',
      fontSize: 12,
      transition: 'border-color 300ms ease',
      animation: isRunning ? 'agentPulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
      <div style={{ fontSize: 10, opacity: 0.6 }}>{d.status}</div>
      {tokens > 0 && (
        <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2 }}>
          {tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : tokens} tokens
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
