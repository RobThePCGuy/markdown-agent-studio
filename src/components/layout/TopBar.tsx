import { useState, useMemo, useTransition, useCallback, useEffect, useRef } from 'react';
import { useKernel } from '../../hooks/useKernel';
import { useAgentRegistry, useProjectStore, useUI, diskSync, uiStore } from '../../stores/use-stores';
import { audioEngine } from '../../core/audio-engine';
import { useAudioEvents } from '../../hooks/useAudioEvents';
import { DEMO_PROMPT, DEMO_AGENT } from '../../hooks/useOnboarding';
import {
  FOCUS_PROMPT_EVENT,
  KILL_ALL_EVENT,
  RUN_AUTONOMOUS_EVENT,
  RUN_ONCE_EVENT,
  TOGGLE_PAUSE_EVENT,
} from '../../core/run-control-events';
import styles from './TopBar.module.css';

export function TopBar() {
  useAudioEvents();
  const agentsMap = useAgentRegistry((s) => s.agents);
  const agents = useMemo(() => [...agentsMap.values()], [agentsMap]);
  const { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount, isAutonomous, currentCycle, maxCycles } = useKernel();
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const setSelectedAgent = useUI((s) => s.setSelectedAgent);
  const [kickoffPromptDraft, setKickoffPromptDraft] = useState<string | null>(null);
  const selectedAgent = selectedAgentId ?? (agentsMap.has(DEMO_AGENT) ? DEMO_AGENT : '');
  const kickoffPrompt = kickoffPromptDraft ?? (agentsMap.has(DEMO_AGENT) ? DEMO_PROMPT : '');
  const soundEnabled = useUI((s) => s.soundEnabled);
  const [runMode, setRunMode] = useState<'once' | 'autonomous'>('once');
  const [runModeAgent, setRunModeAgent] = useState<string>(selectedAgent);
  const [isOpeningProject, startProjectTransition] = useTransition();
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  if (runModeAgent !== selectedAgent) {
    setRunModeAgent(selectedAgent);
    const profile = selectedAgent ? agentsMap.get(selectedAgent) : null;
    setRunMode(profile?.autonomousConfig ? 'autonomous' : 'once');
  }

  const projectName = useProjectStore((s) => s.projectName);
  const syncStatus = useProjectStore((s) => s.syncStatus);

  const handleOpenProject = () => {
    startProjectTransition(async () => {
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
    });
  };

  const handleRun = useCallback((forcedMode?: 'once' | 'autonomous') => {
    const agentPath = selectedAgent || agents[0]?.path;
    const prompt = kickoffPrompt.trim();
    if (!agentPath || !prompt) return;
    const mode = forcedMode ?? runMode;
    run(agentPath, prompt, mode === 'autonomous' ? { autonomous: true } : undefined);
  }, [selectedAgent, agents, kickoffPrompt, runMode, run]);

  useEffect(() => {
    const onRunOnce = () => handleRun('once');
    const onRunAutonomous = () => handleRun('autonomous');
    const onTogglePause = () => {
      if (!isRunning) return;
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    };
    const onKillAll = () => {
      if (!isRunning) return;
      killAll();
    };
    const onFocusPrompt = () => {
      promptInputRef.current?.focus();
      promptInputRef.current?.select();
    };

    window.addEventListener(RUN_ONCE_EVENT, onRunOnce);
    window.addEventListener(RUN_AUTONOMOUS_EVENT, onRunAutonomous);
    window.addEventListener(TOGGLE_PAUSE_EVENT, onTogglePause);
    window.addEventListener(KILL_ALL_EVENT, onKillAll);
    window.addEventListener(FOCUS_PROMPT_EVENT, onFocusPrompt);

    return () => {
      window.removeEventListener(RUN_ONCE_EVENT, onRunOnce);
      window.removeEventListener(RUN_AUTONOMOUS_EVENT, onRunAutonomous);
      window.removeEventListener(TOGGLE_PAUSE_EVENT, onTogglePause);
      window.removeEventListener(KILL_ALL_EVENT, onKillAll);
      window.removeEventListener(FOCUS_PROMPT_EVENT, onFocusPrompt);
    };
  }, [handleRun, isRunning, isPaused, pause, resume, killAll]);

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
        ref={promptInputRef}
        type="text"
        placeholder="What should the agent do?"
        value={kickoffPrompt}
        onChange={(e) => setKickoffPromptDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleRun()}
        className={styles.promptInput}
        title="Focus with Ctrl/Cmd+Shift+L"
      />

      <select
        value={runMode}
        onChange={(e) => setRunMode(e.target.value as 'once' | 'autonomous')}
        className={styles.select}
        disabled={isRunning}
      >
        <option value="once">Run Once</option>
        <option value="autonomous">Autonomous</option>
      </select>

      <div className={styles.divider} />

      {!isRunning ? (
        <button
          onClick={() => handleRun()}
          className={styles.btnRun}
          title="Run once (Ctrl/Cmd+Enter), autonomous (Ctrl/Cmd+Shift+Enter)"
        >
          Run
        </button>
      ) : (
        <>
          {isPaused ? (
            <button
              onClick={resume}
              className={`${styles.btnOutline} ${styles.blue}`}
              title="Resume (Ctrl/Cmd+Shift+P)"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={pause}
              className={`${styles.btnOutline} ${styles.orange}`}
              title="Pause (Ctrl/Cmd+Shift+P)"
            >
              Pause
            </button>
          )}
          <button
            onClick={killAll}
            className={`${styles.btnOutline} ${styles.red}`}
            title="Kill all sessions (Ctrl/Cmd+Shift+K)"
          >
            Kill All
          </button>
        </>
      )}

      <span className={styles.stats}>
        {isRunning && isAutonomous && `Cycle ${currentCycle}/${maxCycles} | `}
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
        disabled={isOpeningProject}
        className={styles.projectBtn}
        style={{
          color: projectName ? 'var(--status-green)' : 'var(--text-dim)',
          opacity: isOpeningProject ? 0.6 : 1,
        }}
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
