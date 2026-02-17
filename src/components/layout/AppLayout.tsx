import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './TopBar';
import { WorkspaceExplorer } from '../explorer/WorkspaceExplorer';
import { GraphView } from '../graph/GraphView';
import { AgentEditor } from '../editor/AgentEditor';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { useUI } from '../../stores/use-stores';
import SettingsModal from '../settings/SettingsModal';

export function AppLayout() {
  const activeTab = useUI((s) => s.activeTab);
  const setActiveTab = useUI((s) => s.setActiveTab);

  return (
    <>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Allotment>
            <Allotment.Pane preferredSize={250} minSize={180}>
              <WorkspaceExplorer />
            </Allotment.Pane>
            <Allotment.Pane>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{
                  display: 'flex',
                  gap: 0,
                  borderBottom: '1px solid #313244',
                  background: '#181825',
                }}>
                  <button
                    onClick={() => setActiveTab('graph')}
                    style={tabStyle(activeTab === 'graph')}
                  >
                    Graph
                  </button>
                  <button
                    onClick={() => setActiveTab('editor')}
                    style={tabStyle(activeTab === 'editor')}
                  >
                    Editor
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
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
    </>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#1e1e2e' : 'transparent',
    color: active ? '#cdd6f4' : '#6c7086',
    border: 'none',
    borderBottom: active ? '2px solid #89b4fa' : '2px solid transparent',
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
