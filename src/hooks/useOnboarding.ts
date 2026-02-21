import { useEffect } from 'react';
import { vfsStore, agentRegistry, uiStore, useUI } from '../stores/use-stores';
import { loadSampleProject } from '../core/sample-project';

export const DEMO_PROMPT = 'Build me a portfolio website';
export const DEMO_AGENT = 'agents/project-lead.md';

export function useOnboarding(): { showWelcome: boolean; dismissWelcome: () => void } {
  const showWelcome = useUI((s) => s.showWelcome);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem('mas-onboarded');
    const agentCount = agentRegistry.getState().agents.size;
    if (!hasSeenOnboarding && agentCount === 0) {
      loadSampleProject(vfsStore, agentRegistry);
      localStorage.setItem('mas-onboarded', '1');
      uiStore.getState().setShowWelcome(true);
      uiStore.getState().setSelectedAgent(DEMO_AGENT);
    }
  }, []);

  return { showWelcome, dismissWelcome: () => uiStore.getState().setShowWelcome(false) };
}
