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
import { CommandPalette } from '../command-palette/CommandPalette';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const activeTab = useUI((s) => s.activeTab);
  const setActiveTab = useUI((s) => s.setActiveTab);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}
