import { useState } from 'react';
import { useEventLog } from '../../stores/use-stores';
import { useKernel } from '../../hooks/useKernel';
import styles from './EventLogView.module.css';

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
    <div className={styles.container}>
      <div className={styles.header}>
        Event Log ({entries.length} entries)
      </div>
      <div className={styles.meta}>
        Replay checkpoints: {checkpoints.length}
        {lastReplayEventId ? ` | Last replay: ${lastReplayEventId}` : ''}
      </div>
      {status && (
        <div className={styles.status}>
          {status}
        </div>
      )}
      <div className={styles.timeline}>
        {recent.map((entry) => {
          const color = typeColor(entry.type);
          return (
            <div key={entry.id} className={styles.event}>
              <div
                className={styles.eventDot}
                style={{ background: color }}
              />
              <span className={styles.eventTime}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={styles.eventType}
                style={{ color, background: `${color}26` }}
              >
                {entry.type}
              </span>
              <span className={styles.eventAgent}>{entry.agentId}</span>
              <div className={styles.eventActions}>
                <button
                  className={styles.ghostBtn}
                  onClick={() => handleRestore(entry.id)}
                >
                  Restore
                </button>
                <button
                  className={styles.ghostBtn}
                  onClick={() => void handleReplay(entry.id)}
                  disabled={isRunning}
                >
                  Replay
                </button>
              </div>
              {entry.data?.error != null && (
                <div className={styles.eventError}>
                  {String(entry.data.error) as string}
                </div>
              )}
              {entry.data?.message != null && (
                <div className={styles.eventMessage}>
                  {String(entry.data.message) as string}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {entries.length === 0 && (
        <div className={styles.empty}>No events yet. Press Run to start.</div>
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
