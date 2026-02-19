import type { AgentProfile } from '../../types';
import { useAgentRegistry, useUI, useSessionStore } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';
import styles from './InspectorPanel.module.css';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);
  const agents = useAgentRegistry((s) => s.agents);

  if (!selectedAgentId) {
    return <EventLogView />;
  }

  // Find most recent session for this agent
  let latestSession;
  for (const session of sessions.values()) {
    if (session.agentId === selectedAgentId) {
      if (!latestSession || session.startedAt > latestSession.startedAt) {
        latestSession = session;
      }
    }
  }

  const profile = agents.get(selectedAgentId);

  return (
    <div className={styles.container}>
      {profile && <PolicyBanner profile={profile} />}
      <div className={styles.chatArea}>
        <ChatLog
          agentId={selectedAgentId}
          messages={latestSession?.messages ?? []}
          streamingText={latestSession?.streamingText ?? ''}
        />
      </div>
    </div>
  );
}

const modeColors: Record<string, string> = {
  gloves_off: '#f38ba8',
  safe: '#a6e3a1',
  balanced: '#f9e2af',
};

function PolicyBanner({ profile }: { profile: AgentProfile }) {
  const { policy } = profile;
  const modeColor = modeColors[policy.mode] ?? '#cdd6f4';

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
