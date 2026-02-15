import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { TopBar } from './TopBar';
import { WorkspaceExplorer } from '../explorer/WorkspaceExplorer';
import { GraphView } from '../graph/GraphView';
import { InspectorPanel } from '../inspector/InspectorPanel';

export function AppLayout() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Allotment>
          <Allotment.Pane preferredSize={250} minSize={180}>
            <WorkspaceExplorer />
          </Allotment.Pane>
          <Allotment.Pane>
            <GraphView />
          </Allotment.Pane>
          <Allotment.Pane preferredSize={350} minSize={250}>
            <InspectorPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}
