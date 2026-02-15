import { useCallback } from 'react';
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

const nodeTypes: NodeTypes = {
  agentNode: AgentNode as any,
};

export function GraphView() {
  const { nodes: initialNodes, edges: initialEdges } = useGraphData();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback((_: any, node: any) => {
    uiStore.getState().setSelectedAgent(node.id);
  }, []);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        style={{ background: '#11111b' }}
      >
        <Background color="#313244" gap={20} />
        <Controls />
        <MiniMap
          nodeColor="#45475a"
          maskColor="rgba(0,0,0,0.5)"
          style={{ background: '#1e1e2e' }}
        />
      </ReactFlow>
    </div>
  );
}
