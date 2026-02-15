import { useEventLog } from '../../stores/use-stores';

export function EventLogView() {
  const entries = useEventLog((s) => s.entries);
  const recent = entries.slice(-100).reverse();

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.5 }}>
        Event Log ({entries.length} entries)
      </div>
      {recent.map((entry) => (
        <div key={entry.id} style={{
          fontSize: 11,
          padding: '4px 8px',
          borderBottom: '1px solid #313244',
          fontFamily: 'monospace',
        }}>
          <span style={{ color: '#6c7086', marginRight: 8 }}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          <span style={{ color: typeColor(entry.type), marginRight: 8 }}>
            [{entry.type}]
          </span>
          <span style={{ opacity: 0.7 }}>{entry.agentId}</span>
        </div>
      ))}
      {entries.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: 12 }}>No events yet. Press Run to start.</div>
      )}
    </div>
  );
}

function typeColor(type: string): string {
  switch (type) {
    case 'error': return '#f38ba8';
    case 'warning': return '#fab387';
    case 'spawn': return '#a6e3a1';
    case 'activation': return '#89b4fa';
    case 'complete': return '#94e2d5';
    default: return '#cdd6f4';
  }
}
