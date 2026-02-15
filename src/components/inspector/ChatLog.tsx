import type { Message } from '../../types';

interface Props {
  agentId: string;
  messages: Message[];
}

export function ChatLog({ agentId, messages }: Props) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#89b4fa' }}>
        {agentId}
      </div>
      {messages.map((msg, i) => (
        <div key={i} style={{
          marginBottom: 8,
          padding: 8,
          borderRadius: 6,
          background: msg.role === 'user' ? '#313244' : msg.role === 'tool' ? '#1e1e2e' : '#181825',
          fontSize: 12,
          borderLeft: msg.role === 'tool' ? '3px solid #fab387' : 'none',
        }}>
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>
            {msg.role === 'tool' && msg.toolCall
              ? `[${msg.toolCall.name}]`
              : msg.role}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.content.length > 500
              ? msg.content.slice(0, 500) + '...'
              : msg.content}
          </div>
        </div>
      ))}
      {messages.length === 0 && (
        <div style={{ opacity: 0.4, fontSize: 12 }}>No messages yet</div>
      )}
    </div>
  );
}
