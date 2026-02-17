import { useUI, useSessionStore } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);

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

  return (
    <ChatLog
      agentId={selectedAgentId}
      messages={latestSession?.messages ?? []}
      streamingText={latestSession?.streamingText ?? ''}
    />
  );
}
