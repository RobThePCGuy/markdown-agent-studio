import { useState } from 'react';
import { useEventLog } from '../../stores/use-stores';
import { useKernel } from '../../hooks/useKernel';

export function EventLogView() {
  const entries = useEventLog((s) => s.entries);
  const checkpoints = useEventLog((s) => s.checkpoints);
  const { replayFromEvent, restoreFromEvent, isRunning, lastReplayEventId } = useKernel();
  const [status, setStatus] = useState<string>('');
  const recent = entries.slice(-100).reverse();

  const handleReplay = async (eventId: string) => {
    setStatus(`Replaying from ${eventId}...`);
    const result = await replayFromEvent(eventId);
    setStatus(result.message);
  };

  const handleRestore = (eventId: string) => {
    const result = restoreFromEvent(eventId);
    setStatus(result.message);
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.5 }}>
        Event Log ({entries.length} entries)
      </div>
      <div style={{ fontSize: 10.5, color: '#6c7086', marginBottom: 8 }}>
        Replay checkpoints: {checkpoints.length}
        {lastReplayEventId ? ` | Last replay: ${lastReplayEventId}` : ''}
      </div>
      {status && (
        <div style={{ fontSize: 11, color: '#89b4fa', marginBottom: 8 }}>
          {status}
        </div>
      )}
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
          <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
            <button
              onClick={() => handleRestore(entry.id)}
              style={actionBtn('#313244', '#cdd6f4')}
            >
              Restore
            </button>
            <button
              onClick={() => void handleReplay(entry.id)}
              disabled={isRunning}
              style={actionBtn(isRunning ? '#45475a' : '#89b4fa', isRunning ? '#6c7086' : '#1e1e2e')}
            >
              Replay
            </button>
          </div>
          {entry.data?.error != null && (
            <div style={{ color: '#f38ba8', marginTop: 2, wordBreak: 'break-word' }}>
              {String(entry.data.error) as string}
            </div>
          )}
          {entry.data?.message != null && (
            <div style={{ color: '#fab387', marginTop: 2 }}>
              {String(entry.data.message) as string}
            </div>
          )}
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

function actionBtn(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 10,
    cursor: 'pointer',
  };
}
