import { useState } from 'react';
import { useKernel } from '../../hooks/useKernel';
import { useAgentRegistry } from '../../stores/use-stores';

export function TopBar() {
  const agents = useAgentRegistry((s) => [...s.agents.values()]);
  const { run, pause, resume, killAll, isRunning, isPaused, totalTokens, activeCount, queueCount } = useKernel();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [kickoffPrompt, setKickoffPrompt] = useState('');

  const handleRun = () => {
    const agentPath = selectedAgent || agents[0]?.path;
    if (!agentPath || !kickoffPrompt.trim()) return;
    run(agentPath, kickoffPrompt.trim());
  };

  return (
    <div style={{
      height: 48,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      borderBottom: '1px solid #313244',
      background: '#1e1e2e',
      color: '#cdd6f4',
      gap: 8,
      fontSize: 13,
    }}>
      <strong style={{ marginRight: 8 }}>MAS</strong>

      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        style={{ background: '#313244', color: '#cdd6f4', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
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
        style={{
          flex: 1,
          background: '#313244',
          color: '#cdd6f4',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 12,
        }}
      />

      {!isRunning ? (
        <button onClick={handleRun} style={btnStyle('#a6e3a1', '#1e1e2e')}>Run</button>
      ) : (
        <>
          {isPaused ? (
            <button onClick={resume} style={btnStyle('#89b4fa', '#1e1e2e')}>Resume</button>
          ) : (
            <button onClick={pause} style={btnStyle('#fab387', '#1e1e2e')}>Pause</button>
          )}
          <button onClick={killAll} style={btnStyle('#f38ba8', '#1e1e2e')}>Kill All</button>
        </>
      )}

      <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>
        {isRunning ? `${activeCount} active, ${queueCount} queued, ` : ''}
        {Math.round(totalTokens / 1000)}K tokens
      </span>
    </div>
  );
}

function btnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
