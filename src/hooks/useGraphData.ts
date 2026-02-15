import { useMemo } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { useAgentRegistry, useEventLog } from '../stores/use-stores';

export function useGraphData() {
  const agents = useAgentRegistry((s) => [...s.agents.values()]);
  const entries = useEventLog((s) => s.entries);

  return useMemo(() => {
    const nodes: Node[] = agents.map((agent, i) => ({
      id: agent.path,
      type: 'agentNode',
      position: { x: i * 200, y: 100 },
      data: {
        label: agent.name,
        path: agent.path,
        status: 'idle',
      },
    }));

    const edges: Edge[] = [];
    const spawnEvents = entries.filter((e) => e.type === 'spawn');
    for (const evt of spawnEvents) {
      const spawned = evt.data.spawned as string;
      if (spawned && nodes.some((n) => n.id === spawned)) {
        edges.push({
          id: `edge-${evt.agentId}-${spawned}`,
          source: evt.agentId,
          target: spawned,
          animated: true,
          style: { stroke: '#89b4fa' },
        });
      }
    }

    return { nodes, edges };
  }, [agents, entries]);
}
