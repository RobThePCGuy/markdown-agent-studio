import { useUI } from '../../stores/use-stores';
import { ChatLog } from './ChatLog';
import { EventLogView } from './EventLogView';

export function InspectorPanel() {
  const selectedAgentId = useUI((s) => s.selectedAgentId);

  if (!selectedAgentId) {
    return <EventLogView />;
  }

  return (
    <ChatLog
      agentId={selectedAgentId}
      messages={[]}
    />
  );
}
