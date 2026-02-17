import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types/session';

interface Props {
  agentId: string;
  messages: ChatMessage[];
  streamingText?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function ToolCallRow({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const tc = msg.toolCall;
  if (!tc) return null;

  const argsStr = JSON.stringify(tc.args);
  const resultLen = tc.result.length;

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={styles.timestamp}>[{formatTime(msg.timestamp)}]</span>
        <span style={{ color: '#cba6f7' }}>
          {'> '}tool_call: {tc.name}({argsStr})
        </span>
      </div>
      <div
        style={{
          paddingLeft: 80,
          color: '#cba6f7',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {'> '}result:{' '}
        {expanded ? (
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'text', userSelect: 'text' }}>
            {tc.result}
          </span>
        ) : (
          <span>({resultLen.toLocaleString()} chars) [click to expand]</span>
        )}
      </div>
    </div>
  );
}

export function ChatLog({ agentId: _agentId, messages, streamingText = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStickToBottom(atBottom);
  }, []);

  useEffect(() => {
    if (stickToBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingText, stickToBottom]);

  const isEmpty = messages.length === 0 && !streamingText;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 12,
        background: '#1e1e2e',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 12,
        lineHeight: '1.6',
        color: '#cdd6f4',
      }}
    >
      {isEmpty && (
        <div style={{ color: '#585b70', fontSize: 12 }}>
          Run an agent to see output here
        </div>
      )}

      {messages.map((msg, i) => {
        if (msg.role === 'tool') {
          return <ToolCallRow key={i} msg={msg} />;
        }

        const roleColor = msg.role === 'user' ? '#74c7ec' : '#a6e3a1';

        return (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={styles.timestamp}>[{formatTime(msg.timestamp)}]</span>{' '}
            <span style={{ color: roleColor }}>{msg.role}</span>{' '}
            <span style={{ color: roleColor }}>{'> '}</span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.content}
            </span>
          </div>
        );
      })}

      {streamingText && (
        <div style={{ marginBottom: 4 }}>
          <span style={styles.timestamp}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>{' '}
          <span style={{ color: '#a6e3a1' }}>assistant</span>{' '}
          <span style={{ color: '#a6e3a1' }}>{'> '}</span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {streamingText}
          </span>
          <span
            style={{
              animation: 'blink 1s step-end infinite',
              color: '#a6e3a1',
              fontWeight: 'bold',
            }}
          >
            |
          </span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  timestamp: {
    color: '#585b70',
    userSelect: 'none',
  },
};
