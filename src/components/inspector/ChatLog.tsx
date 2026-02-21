import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage } from '../../types/session';
import styles from './ChatLog.module.css';

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

const oneDarkStyles = oneDark as Record<string, React.CSSProperties>;

const codeStyle: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDarkStyles['pre[class*="language-"]'] ?? {}),
    background: '#11111b',
    margin: '8px 0',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '12px',
  },
  'code[class*="language-"]': {
    ...(oneDarkStyles['code[class*="language-"]'] ?? {}),
    background: 'transparent',
  },
};

// Extend the default GitHub schema to allow className on code elements (needed for syntax highlighting)
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

const markdownComponents: Partial<Components> = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match) {
      return (
        <SyntaxHighlighter
          language={match[1]}
          style={codeStyle}
          customStyle={{
            margin: '8px 0',
            padding: '12px',
            borderRadius: '6px',
            fontSize: '12px',
            background: '#11111b',
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      );
    }
    return <code className={className} {...props}>{children}</code>;
  },
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }) {
    return <img src={src} alt={alt ?? ''} loading="lazy" {...props} />;
  },
};

function ToolCallRow({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const tc = msg.toolCall;
  if (!tc) return null;

  const resultLen = tc.result.length;

  return (
    <div className={styles.toolBlock}>
      <div
        className={styles.toolHeader}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <span className={styles.toolName}>{tc.name}</span>
        {!expanded && (
          <span className={styles.toolSummary}>
            ({resultLen.toLocaleString()} chars)
          </span>
        )}
        <span className={`${styles.toolChevron}${expanded ? ` ${styles.expanded}` : ''}`}>
          {'>'}
        </span>
      </div>
      {expanded && (
        <div className={styles.toolResult}>{tc.result}</div>
      )}
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
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, streamingText, stickToBottom]);

  const isEmpty = messages.length === 0 && !streamingText;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={styles.container}
    >
      {isEmpty && (
        <div className={styles.empty}>
          Run an agent to see output here
        </div>
      )}

      {streamingText && (
        <div className={styles.tokenCounter}>
          ~{Math.round((streamingText.length) / 4).toLocaleString()} tokens
        </div>
      )}

      {messages.map((msg, i) => {
        const prevMsg = i > 0 ? messages[i - 1] : null;
        const showDivider =
          prevMsg && msg.timestamp - prevMsg.timestamp > 60_000;

        return (
          <div key={i}>
            {showDivider && (
              <div className={styles.timeDivider}>
                <span>{formatTime(msg.timestamp)}</span>
              </div>
            )}

            {msg.role === 'tool' && <ToolCallRow msg={msg} />}

            {msg.role === 'user' && (
              <div className={styles.userBubble}>{msg.content}</div>
            )}

            {msg.role === 'assistant' && (
              <div className={styles.assistantBubble}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}

      {streamingText && (
        <div className={styles.assistantBubble}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
            {streamingText}
          </ReactMarkdown>
          <span className={styles.streamCursor}>|</span>
          <span className={styles.thinkingRing} />
        </div>
      )}

      {!stickToBottom && (
        <div className={styles.jumpToBottom}>
          <button
            className={styles.jumpBtn}
            onClick={() => {
              containerRef.current?.scrollTo({
                top: containerRef.current.scrollHeight,
                behavior: 'smooth',
              });
            }}
          >
            Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}
