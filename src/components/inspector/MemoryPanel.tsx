import { useState, useEffect } from 'react';
import { useMemoryStore, vfsStore } from '../../stores/use-stores';
import { MemoryManager } from '../../core/memory-manager';
import { createMemoryDB } from '../../core/memory-db';
import type { LongTermMemory } from '../../types/memory';
import styles from './MemoryPanel.module.css';

const typeColors: Record<string, string> = {
  fact: 'var(--status-blue)',
  procedure: 'var(--status-cyan)',
  observation: 'var(--status-green)',
  mistake: 'var(--status-red)',
  preference: 'var(--status-purple)',
  skill: 'var(--status-yellow)',
};

export function MemoryPanel() {
  const workingEntries = useMemoryStore((s) => s.entries);
  const runId = useMemoryStore((s) => s.runId);
  const [longTermMemories, setLongTermMemories] = useState<LongTermMemory[]>([]);
  const [activeView, setActiveView] = useState<'working' | 'longterm'>('working');
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (activeView === 'longterm') {
      const db = createMemoryDB(vfsStore);
      const mgr = new MemoryManager(db);
      mgr.getAll().then(setLongTermMemories).catch(() => {});
    }
  }, [activeView, refreshCounter]);

  return (
    <div className={styles.container}>
      <div className={styles.tabRow}>
        <button
          onClick={() => setActiveView('working')}
          className={`${styles.tab}${activeView === 'working' ? ` ${styles.active}` : ''}`}
        >
          Working{runId ? ` (${workingEntries.length})` : ''}
        </button>
        <button
          onClick={() => setActiveView('longterm')}
          className={`${styles.tab}${activeView === 'longterm' ? ` ${styles.active}` : ''}`}
        >
          Long-Term ({longTermMemories.length})
        </button>
        {activeView === 'longterm' && (
          <button
            onClick={() => setRefreshCounter((c) => c + 1)}
            className={styles.refreshBtn}
            title="Refresh"
          >
            Refresh
          </button>
        )}
      </div>

      <div className={styles.content}>
        {activeView === 'working' && (
          <>
            {!runId && (
              <div className={styles.empty}>No active run. Working memory is created during runs.</div>
            )}
            {runId && workingEntries.length === 0 && (
              <div className={styles.empty}>Working memory is empty. Agents will write here during the run.</div>
            )}
            {workingEntries.map((entry) => (
              <div key={entry.id} className={styles.entry}>
                <div className={styles.entryHeader}>
                  <span className={styles.entryKey}>{entry.key}</span>
                  <span className={styles.entryAuthor}>{entry.authorAgentId.split('/').pop()}</span>
                </div>
                <div className={styles.entryValue}>{entry.value}</div>
                {entry.tags.length > 0 && (
                  <div className={styles.tagRow}>
                    {entry.tags.map((t) => (
                      <span key={t} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {activeView === 'longterm' && (
          <>
            {longTermMemories.length === 0 && (
              <div className={styles.empty}>No long-term memories yet. Complete a run with memory enabled.</div>
            )}
            {longTermMemories.map((mem) => (
              <div key={mem.id} className={styles.entry}>
                <div className={styles.entryHeader}>
                  <span
                    className={styles.typeBadge}
                    style={{ color: typeColors[mem.type] ?? 'var(--text-primary)' }}
                  >
                    {mem.type}
                  </span>
                  <span className={styles.entryAuthor}>
                    {mem.agentId === 'global' ? 'global' : mem.agentId.split('/').pop()}
                  </span>
                  <span className={styles.accessCount}>{mem.accessCount}x</span>
                </div>
                <div className={styles.entryValue}>{mem.content}</div>
                {mem.tags.length > 0 && (
                  <div className={styles.tagRow}>
                    {mem.tags.map((t) => (
                      <span key={t} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
