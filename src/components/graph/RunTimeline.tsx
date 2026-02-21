import { useMemo, useRef } from 'react';
import { useSessionStore, useEventLog } from '../../stores/use-stores';
import styles from './RunTimeline.module.css';

const STATUS_COLORS: Record<string, string> = {
  running: '#a6e3a1',
  completed: '#89dceb',
  error: '#f38ba8',
  aborted: '#fab387',
  paused: '#f9e2af',
};

const EVENT_MARKERS: Record<string, string> = {
  spawn: '#f9e2af',
  signal: '#fab387',
  error: '#f38ba8',
  complete: '#a6e3a1',
};

export function RunTimeline() {
  const sessions = useSessionStore((s) => s.sessions);
  const events = useEventLog((s) => s.entries);
  const containerRef = useRef<HTMLDivElement>(null);

  const sessionList = useMemo(
    () => [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt),
    [sessions],
  );

  if (sessionList.length === 0) return null;

  const runStart = sessionList[0].startedAt;
  // eslint-disable-next-line react-hooks/purity -- intentional: time-based recency for live timeline UI
  const nowMs = Date.now();
  const runEnd = Math.max(
    ...sessionList.map((s) => s.completedAt ?? nowMs),
    nowMs,
  );
  const duration = Math.max(runEnd - runStart, 1);

  const toPercent = (ts: number) => ((ts - runStart) / duration) * 100;

  const relevantEvents = events.filter(
    (e) => e.timestamp >= runStart && EVENT_MARKERS[e.type],
  );

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.tracks}>
        {sessionList.map((session) => {
          const left = toPercent(session.startedAt);
          const right = toPercent(session.completedAt ?? nowMs);
          const width = Math.max(right - left, 0.5);
          const agentName = session.agentId.split('/').pop()?.replace('.md', '') ?? session.agentId;

          return (
            <div key={session.activationId} className={styles.track}>
              <span className={styles.trackLabel}>{agentName}</span>
              <div className={styles.trackBar}>
                <div
                  className={styles.sessionBar}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: STATUS_COLORS[session.status] ?? '#585b70',
                  }}
                  title={`${agentName}: ${session.status}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.markerTrack}>
        {relevantEvents.map((evt) => (
          <div
            key={evt.id}
            className={styles.marker}
            style={{
              left: `${toPercent(evt.timestamp)}%`,
              background: EVENT_MARKERS[evt.type] ?? '#585b70',
            }}
            title={`${evt.type}: ${evt.agentId}`}
          />
        ))}
      </div>
    </div>
  );
}
