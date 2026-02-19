import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
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

  // Sync derived data into React Flow state, preserving user-dragged positions
  useEffect(() => {
    setNodes((prev) =>
      derivedNodes.map((dn) => {
        const existing = prev.find((n) => n.id === dn.id);
        if (!existing) return dn;
        if (dn.type === 'activityNode') return dn;
        return { ...existing, data: dn.data };
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
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
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
            'radial-gradient(1200px 420px at 25% 8%, rgba(137,180,250,0.11), transparent 50%),' +
            'radial-gradient(900px 320px at 82% 88%, rgba(249,226,175,0.09), transparent 50%),' +
            '#11111b',
        }}
      >
        <Background color="#313244" gap={22} />
        <Controls style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: 8 }} />
        <MiniMap
          nodeColor="#45475a"
          maskColor="rgba(0,0,0,0.5)"
          style={{ background: '#1e1e2e', border: '1px solid #313244' }}
        />
      </ReactFlow>

      <GraphHud
        totalAgents={agentNodeCount}
        thinkingCount={thinkingCount}
        webCount={webCount}
        runningCount={runningCount}
        spawnCount={spawnCount}
        signalCount={signalCount}
        errorsCount={errorsCount}
      />
      <GraphLegend />
    </div>
  );
}

function GraphHud(props: {
  totalAgents: number;
  thinkingCount: number;
  webCount: number;
  runningCount: number;
  spawnCount: number;
  signalCount: number;
  errorsCount: number;
}) {
  const { totalAgents, thinkingCount, webCount, runningCount, spawnCount, signalCount, errorsCount } = props;
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 8px',
        borderRadius: 10,
        border: '1px solid #313244',
        background: 'rgba(24,24,37,0.85)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
      }}
    >
      <HudPill label="agents" value={totalAgents} color="#89b4fa" />
      <HudPill label="running" value={runningCount} color="#a6e3a1" />
      <HudPill label="thinking" value={thinkingCount} color="#a6e3a1" />
      <HudPill label="web" value={webCount} color="#74c7ec" />
      <HudPill label="spawns" value={spawnCount} color="#f9e2af" />
      <HudPill label="signals" value={signalCount} color="#cba6f7" />
      <HudPill label="errors" value={errorsCount} color="#f38ba8" />
    </div>
  );
}

function HudPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        lineHeight: 1.2,
        color: '#cdd6f4',
        background: 'rgba(30,30,46,0.92)',
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '3px 7px',
      }}
    >
      {label}: {value}
    </span>
  );
}

function GraphLegend() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 10,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 8px',
        borderRadius: 10,
        border: '1px solid #313244',
        background: 'rgba(24,24,37,0.82)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
      }}
    >
      <LegendLine color="#a6e3a1" label="thinking" dashed />
      <LegendLine color="#74c7ec" label="web" dashed />
      <LegendLine color="#fab387" label="signal" dashed />
      <LegendLine color="#89b4fa" label="spawn" />
    </div>
  );
}

function LegendLine({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#cdd6f4' }}>
      <span
        style={{
          width: 16,
          height: 0,
          borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}
