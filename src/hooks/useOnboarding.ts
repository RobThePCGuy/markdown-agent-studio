import { useEffect, useState } from 'react';
import { vfsStore, agentRegistry } from '../stores/use-stores';
import { loadSampleProject } from '../core/sample-project';

export function useOnboarding(): { showWelcome: boolean; dismissWelcome: () => void } {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem('mas-onboarded');
    const agentCount = agentRegistry.getState().agents.size;
    if (!hasSeenOnboarding && agentCount === 0) {
      loadSampleProject(vfsStore, agentRegistry);
      localStorage.setItem('mas-onboarded', '1');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time initialization side effect
      setShowWelcome(true);
    }
  }, []);

  return { showWelcome, dismissWelcome: () => setShowWelcome(false) };
}
