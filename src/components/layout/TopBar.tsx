import { useState, useMemo } from 'react';
import { useKernel } from '../../hooks/useKernel';
import { useAgentRegistry, useProjectStore, useUI, diskSync, uiStore } from '../../stores/use-stores';
import { audioEngine } from '../../core/audio-engine';
import { useAudioEvents } from '../../hooks/useAudioEvents';
import styles from './TopBar.module.css';

export function TopBar() {
  useAudioEvents();
  const agentsMap = useAgentRegistry((s) => s.agents);
  const agents = useMemo(() => [...agentsMap.values()], [agentsMap]);
  const { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount } = useKernel();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [kickoffPrompt, setKickoffPrompt] = useState('');
  const soundEnabled = useUI((s) => s.soundEnabled);

  const projectName = useProjectStore((s) => s.projectName);
  const syncStatus = useProjectStore((s) => s.syncStatus);

  const handleOpenProject = async () => {
    if (projectName) {
      diskSync.stop();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await diskSync.start(handle);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to open project:', err);
      }
    }
  };

  const handleRun = () => {
    const agentPath = selectedAgent || agents[0]?.path;
    if (!agentPath || !kickoffPrompt.trim()) return;
    run(agentPath, kickoffPrompt.trim());
  };

  return (
    <div className={styles.topbar}>
      <span className={styles.logo}>MAS</span>

      <div className={styles.divider} />

      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        className={styles.select}
      >
        <option value="">Select agent...</option>
        {agents.map((a) => (
          <option key={a.path} value={a.path}>{a.name} ({a.path})</option>
        ))}
      </select>

      <input
        type="text"
        placeholder="What should the agent do?"
        value={kickoffPrompt}
        onChange={(e) => setKickoffPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleRun()}
        className={styles.promptInput}
      />

      <div className={styles.divider} />

      {!isRunning ? (
        <button onClick={handleRun} className={styles.btnRun}>Run</button>
      ) : (
        <>
          {isPaused ? (
            <button onClick={resume} className={`${styles.btnOutline} ${styles.blue}`}>Resume</button>
          ) : (
            <button onClick={pause} className={`${styles.btnOutline} ${styles.orange}`}>Pause</button>
          )}
          <button onClick={killAll} className={`${styles.btnOutline} ${styles.red}`}>Kill All</button>
        </>
      )}

      <span className={styles.stats}>
        {isRunning ? `${activeCount} active, ${queueCount} queued, ` : ''}
        {Math.round(totalTokens / 1000)}K tokens
      </span>

      <button
        onClick={() => {
          if (!soundEnabled) {
            audioEngine.enable();
            uiStore.getState().setSoundEnabled(true);
          } else {
            audioEngine.disable();
            uiStore.getState().setSoundEnabled(false);
          }
        }}
        className={styles.soundBtn}
        title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
      >
        {soundEnabled ? 'SND' : 'MUTE'}
      </button>

      <div className={styles.divider} />

      <button
        onClick={handleOpenProject}
        className={styles.projectBtn}
        style={{ color: projectName ? 'var(--status-green)' : 'var(--text-dim)' }}
        title={projectName ? `Project: ${projectName} (click to disconnect)` : 'Open project folder'}
      >
        {syncStatus === 'syncing' && (
          <span className={styles.statusDot} style={{ background: 'var(--status-blue)' }} />
        )}
        {syncStatus === 'connected' && (
          <span className={styles.statusDot} style={{ background: 'var(--status-green)' }} />
        )}
        {syncStatus === 'error' && (
          <span className={styles.statusDot} style={{ background: 'var(--status-red)' }} />
        )}
        {projectName ? projectName : 'Open'}
      </button>

      <button
        onClick={() => uiStore.getState().setSettingsOpen(true)}
        className={styles.settingsBtn}
        title="Settings"
      >
        &#9881;
      </button>
    </div>
  );
}
