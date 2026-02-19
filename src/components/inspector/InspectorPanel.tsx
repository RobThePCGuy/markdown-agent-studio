import type { AgentProfile } from '../../types';
import { useAgentRegistry, useUI, useSessionStore } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {profile && <PolicyBanner profile={profile} />}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatLog
          agentId={selectedAgentId}
          messages={latestSession?.messages ?? []}
          streamingText={latestSession?.streamingText ?? ''}
        />
      </div>
    </div>
  );
}

function PolicyBanner({ profile }: { profile: AgentProfile }) {
  const { policy } = profile;
  return (
    <div
      style={{
        padding: '8px 10px',
        borderBottom: '1px solid #313244',
        background: '#181825',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        fontSize: 10.5,
        color: '#bac2de',
      }}
    >
      <Badge label="mode" value={policy.mode} tone={policy.mode === 'gloves_off' ? '#f38ba8' : policy.mode === 'safe' ? '#a6e3a1' : '#f9e2af'} />
      <Badge label="reads" value={`${policy.reads.length}`} />
      <Badge label="writes" value={`${policy.writes.length}`} />
      <Badge label="spawn" value={policy.permissions.spawnAgents ? 'on' : 'off'} tone={policy.permissions.spawnAgents ? '#a6e3a1' : '#6c7086'} />
      <Badge label="web" value={policy.permissions.webAccess ? 'on' : 'off'} tone={policy.permissions.webAccess ? '#89b4fa' : '#6c7086'} />
      <Badge label="edit_agents" value={policy.permissions.editAgents ? 'on' : 'off'} tone={policy.permissions.editAgents ? '#fab387' : '#6c7086'} />
    </div>
  );
}

function Badge({ label, value, tone = '#45475a' }: { label: string; value: string; tone?: string }) {
  return (
    <span
      style={{
        padding: '2px 6px',
        borderRadius: 999,
        border: `1px solid ${tone}`,
        background: 'rgba(30,30,46,0.9)',
      }}
    >
      {label}: {value}
    </span>
  );
}
