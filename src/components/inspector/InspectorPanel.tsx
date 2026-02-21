import { useState } from 'react';
import type { AgentProfile } from '../../types';
import { useAgentRegistry, useUI, useSessionStore } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';
import { MemoryPanel } from './MemoryPanel';
import styles from './InspectorPanel.module.css';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);
  const agents = useAgentRegistry((s) => s.agents);
  const [viewMode, setViewMode] = useState<'chat' | 'events' | 'memory'>('chat');

  const agentSessions = selectedAgentId
    ? [...sessions.values()]
        .filter((s) => s.agentId === selectedAgentId)
        .sort((a, b) => b.startedAt - a.startedAt)
    : [];

  const [selectedSessionIdx, setSelectedSessionIdx] = useState(0);

  // Reset to latest session when agent changes (render-time state adjustment)
  const [prevAgentId, setPrevAgentId] = useState(selectedAgentId);
  if (selectedAgentId !== prevAgentId) {
    setPrevAgentId(selectedAgentId);
    setSelectedSessionIdx(0);
  }

  const activeSession = agentSessions[selectedSessionIdx];

  const profile = selectedAgentId ? agents.get(selectedAgentId) : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.tabBar}>
        <button
          onClick={() => setViewMode('chat')}
          className={`${styles.tab}${viewMode === 'chat' ? ` ${styles.active}` : ''}`}
        >
          Chat
        </button>
        <button
          onClick={() => setViewMode('events')}
          className={`${styles.tab}${viewMode === 'events' ? ` ${styles.active}` : ''}`}
        >
          Events
        </button>
        <button
          onClick={() => setViewMode('memory')}
          className={`${styles.tab}${viewMode === 'memory' ? ` ${styles.active}` : ''}`}
        >
          Memory
        </button>
      </div>

      {profile && <PolicyBanner profile={profile} />}

      {viewMode === 'chat' && agentSessions.length > 1 && (
        <div className={styles.sessionPicker}>
          <select
            value={selectedSessionIdx}
            onChange={(e) => setSelectedSessionIdx(Number(e.target.value))}
            className={styles.sessionSelect}
          >
            {agentSessions.map((s, i) => (
              <option key={s.activationId} value={i}>
                {new Date(s.startedAt).toLocaleTimeString()} - {s.status}
                {s.tokenCount > 0 ? ` (${Math.round(s.tokenCount / 1000)}K tok)` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.chatArea}>
        {viewMode === 'chat' && (
          <ChatLog
            agentId={selectedAgentId ?? ''}
            messages={activeSession?.messages ?? []}
            streamingText={activeSession?.streamingText ?? ''}
          />
        )}
        {viewMode === 'events' && <EventLogView />}
        {viewMode === 'memory' && <MemoryPanel />}
      </div>
    </div>
  );
}

const modeColors: Record<string, string> = {
  gloves_off: 'var(--status-red)',
  safe: 'var(--status-green)',
  balanced: 'var(--status-yellow)',
};

function PolicyBanner({ profile }: { profile: AgentProfile }) {
  const { policy } = profile;
  const modeColor = modeColors[policy.mode] ?? 'var(--text-primary)';

  const perms: { label: string; enabled: boolean }[] = [
    { label: 'spawn', enabled: policy.permissions.spawnAgents },
    { label: 'web', enabled: policy.permissions.webAccess },
    { label: 'edit_agents', enabled: policy.permissions.editAgents },
    { label: `reads:${policy.reads.length}`, enabled: policy.reads.length > 0 },
    { label: `writes:${policy.writes.length}`, enabled: policy.writes.length > 0 },
  ];

  return (
    <div className={styles.policyBanner}>
      <span className={styles.modeDot} style={{ background: modeColor }} />
      <span className={styles.modeLabel} style={{ color: modeColor }}>
        {policy.mode}
      </span>
      {perms.map((p) => (
        <span key={p.label} className={styles.permPill}>
          <span className={styles.permIcon}>{p.enabled ? '\u2713' : '\u2715'}</span>{' '}
          {p.label}
        </span>
      ))}
    </div>
  );
}
