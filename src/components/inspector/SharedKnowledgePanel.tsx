import { useState } from 'react';
import styles from './SharedKnowledgePanel.module.css';

interface SharedMemory {
  id: string;
  type: string;
  content: string;
  tags: string[];
  agentId: string;
}

interface Props {
  vectorStore?: {
    semanticSearch: (q: string, agentId: string, limit?: number) => Promise<SharedMemory[]>;
  };
}

const TYPE_COLORS: Record<string, string> = {
  skill: 'var(--status-blue)',
  fact: 'var(--status-green, #4caf50)',
  procedure: 'var(--status-purple, #9c27b0)',
  observation: 'var(--status-cyan, #00bcd4)',
  mistake: 'var(--status-red)',
  preference: 'var(--status-orange, #ff9800)',
};

export default function SharedKnowledgePanel({ vectorStore }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SharedMemory[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!vectorStore || !query.trim()) return;
    setLoading(true);
    try {
      const r = await vectorStore.semanticSearch(query, '', 20);
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  if (!vectorStore) {
    return (
      <div className={styles.empty}>
        Enable Vector Memory in Settings to use shared knowledge.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          placeholder="Search shared knowledge..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className={styles.searchBtn} onClick={search} disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </div>
      <div className={styles.results}>
        {results.length === 0 && (
          <div className={styles.empty}>
            {query ? 'No results found.' : 'Enter a query to search shared knowledge.'}
          </div>
        )}
        {results.map((r) => (
          <div key={r.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span
                className={styles.typeBadge}
                style={{ color: TYPE_COLORS[r.type] || 'var(--text-primary)' }}
              >
                {r.type}
              </span>
              <span className={styles.sourceAgent}>{r.agentId.split('/').pop()}</span>
            </div>
            <div className={styles.cardContent}>{r.content}</div>
            {r.tags.length > 0 && (
              <div className={styles.tagRow}>
                {r.tags.map((t) => (
                  <span key={t} className={styles.tag}>{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
