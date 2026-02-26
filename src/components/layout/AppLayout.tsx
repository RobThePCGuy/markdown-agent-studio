import { useState, useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './TopBar';
import { WorkspaceExplorer } from '../explorer/WorkspaceExplorer';
import { GraphView } from '../graph/GraphView';
import { AgentEditor } from '../editor/AgentEditor';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { useUI } from '../../stores/use-stores';
import SettingsModal from '../settings/SettingsModal';
import WorkflowVariableModal from '../workflow/WorkflowVariableModal';
import { CommandPalette } from '../command-palette/CommandPalette';
import {
  dispatchRunControlEvent,
  FOCUS_PROMPT_EVENT,
  KILL_ALL_EVENT,
  RUN_AUTONOMOUS_EVENT,
  RUN_ONCE_EVENT,
  TOGGLE_PAUSE_EVENT,
} from '../../core/run-control-events';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const activeTab = useUI((s) => s.activeTab);
  const setActiveTab = useUI((s) => s.setActiveTab);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hasMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (!hasMod) return;

      if (e.shiftKey && key === 'k') {
        e.preventDefault();
        dispatchRunControlEvent(KILL_ALL_EVENT);
        return;
      }

      if (key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        dispatchRunControlEvent(RUN_AUTONOMOUS_EVENT);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        dispatchRunControlEvent(RUN_ONCE_EVENT);
        return;
      }

      if (e.shiftKey && key === 'p') {
        e.preventDefault();
        dispatchRunControlEvent(TOGGLE_PAUSE_EVENT);
        return;
      }

      if (e.shiftKey && key === 'l') {
        e.preventDefault();
        dispatchRunControlEvent(FOCUS_PROMPT_EVENT);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <div className={styles.root}>
        <TopBar />
        <div className={styles.content}>
          <Allotment>
            <Allotment.Pane preferredSize={250} minSize={180}>
              <WorkspaceExplorer />
            </Allotment.Pane>
            <Allotment.Pane>
              <div className={styles.centerPane}>
                <div className={styles.tabBar}>
                  <button
                    onClick={() => setActiveTab('graph')}
                    className={`${styles.tab}${activeTab === 'graph' ? ` ${styles.active}` : ''}`}
                  >
                    Graph
                  </button>
                  <button
                    onClick={() => setActiveTab('editor')}
                    className={`${styles.tab}${activeTab === 'editor' ? ` ${styles.active}` : ''}`}
                  >
                    Editor
                  </button>
                </div>
                <div className={styles.paneContent}>
                  {activeTab === 'graph' ? <GraphView /> : <AgentEditor />}
                </div>
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={350} minSize={250}>
              <InspectorPanel />
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
      <SettingsModal />
      <WorkflowVariableModal />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
