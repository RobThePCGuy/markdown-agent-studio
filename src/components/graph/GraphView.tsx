import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode } from './AgentNode';
import { useGraphData } from '../../hooks/useGraphData';
import { uiStore } from '../../stores/use-stores';
import { useEventLog, useSessionStore } from '../../stores/use-stores';
import { ActivityNode } from './ActivityNode';
import styles from './GraphView.module.css';

const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
  activityNode: ActivityNode,
};

export function GraphView() {
  const { nodes: derivedNodes, edges: derivedEdges } = useGraphData();
  const sessions = useSessionStore((s) => s.sessions);
  const events = useEventLog((s) => s.entries);
  const [nodes, setNodes, onNodesChange] = useNodesState(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(derivedEdges);

  // Sync derived data into React Flow state, applying dagre-computed positions
  useEffect(() => {
    setNodes((prev) =>
      derivedNodes.map((dn) => {
        const existing = prev.find((n) => n.id === dn.id);
        if (!existing) return dn;
        if (dn.type === 'activityNode') return dn;
        return { ...existing, data: dn.data, position: dn.position };
      })
    );
  }, [derivedNodes, setNodes]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  const onNodeClick = useCallback((_: any, node: any) => {
    if (node.type !== 'agentNode') return;
    uiStore.getState().setSelectedAgent(node.id);
  }, []);

  const runningCount = [...sessions.values()].filter((s) => s.status === 'running').length;
  const agentNodeCount = nodes.filter((n) => n.type === 'agentNode').length;
  const activityNodes = nodes.filter((n) => n.type === 'activityNode');
  const thinkingCount = activityNodes.filter((n) => (n.data as Record<string, unknown>).activityKind === 'thinking').length;
  const webCount = activityNodes.filter((n) => {
    const kind = (n.data as Record<string, unknown>).activityKind;
    return kind === 'web_search' || kind === 'web_fetch';
  }).length;
  const spawnCount = events.filter((e) => e.type === 'spawn').length;
  const signalCount = events.filter((e) => e.type === 'signal').length;
  const errorsCount = events.filter((e) => e.type === 'error').length;

  return (
    <div className={styles.container}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, duration: 420 }}
        minZoom={0.2}
        maxZoom={1.6}
        style={{
          background:
            'radial-gradient(ellipse at 50% 50%, rgba(224,166,80,0.06), transparent 70%),' +
            'radial-gradient(ellipse at 50% 50%, rgba(10,10,20,0.8), transparent),' +
            '#0a0a14',
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#313244" gap={24} size={1} />
        <Controls style={{ background: 'var(--depth-2)', border: '1px solid var(--depth-3)', borderRadius: 8 }} />
        <MiniMap
          nodeColor="#45475a"
          maskColor="rgba(0,0,0,0.5)"
          style={{ background: 'var(--depth-2)', border: '1px solid var(--depth-3)' }}
        />
      </ReactFlow>

      {/* HUD overlay */}
      <div className={styles.hud}>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-blue)' }} />
          <span className={styles.hudLabel}>agents</span>
          <span className={styles.hudValue}>{agentNodeCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-green)' }} />
          <span className={styles.hudLabel}>running</span>
          <span className={styles.hudValue}>{runningCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-green)' }} />
          <span className={styles.hudLabel}>thinking</span>
          <span className={styles.hudValue}>{thinkingCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-cyan)' }} />
          <span className={styles.hudLabel}>web</span>
          <span className={styles.hudValue}>{webCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-yellow)' }} />
          <span className={styles.hudLabel}>spawns</span>
          <span className={styles.hudValue}>{spawnCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-purple)' }} />
          <span className={styles.hudLabel}>signals</span>
          <span className={styles.hudValue}>{signalCount}</span>
        </div>
        <div className={styles.hudGroup}>
          <span className={styles.hudDot} style={{ background: 'var(--status-red)' }} />
          <span className={styles.hudLabel}>errors</span>
          <span className={styles.hudValue}>{errorsCount}</span>
        </div>
      </div>

      {/* Legend overlay */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ borderTop: '2px dashed var(--status-green)' }} />
          thinking
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ borderTop: '2px dashed var(--status-cyan)' }} />
          web
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ borderTop: '2px dashed var(--status-orange)' }} />
          signal
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ borderTop: '2px solid var(--status-blue)' }} />
          spawn
        </span>
      </div>
    </div>
  );
}
