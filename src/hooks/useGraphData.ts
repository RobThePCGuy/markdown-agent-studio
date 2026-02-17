import { useMemo } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { useAgentRegistry, useEventLog, useSessionStore } from '../stores/use-stores';

export function useGraphData() {
  const agentsMap = useAgentRegistry((s) => s.agents);
  const entries = useEventLog((s) => s.entries);
  const sessions = useSessionStore((s) => s.sessions);

  return useMemo(() => {
    const agents = [...agentsMap.values()];

    // Build a map of agentId -> most recent session
    const latestByAgent = new Map<string, { status: string; tokenCount: number; startedAt: number }>();
    for (const session of sessions.values()) {
      const existing = latestByAgent.get(session.agentId);
      if (!existing || session.startedAt > existing.startedAt) {
        latestByAgent.set(session.agentId, {
          status: session.status,
          tokenCount: session.tokenCount,
          startedAt: session.startedAt,
        });
      }
    }

    const nodes: Node[] = agents.map((agent, i) => {
      const live = latestByAgent.get(agent.path);
      return {
        id: agent.path,
        type: 'agentNode',
        position: { x: i * 200, y: 100 },
        data: {
          label: agent.name,
          path: agent.path,
          status: live?.status ?? 'idle',
          tokenCount: live?.tokenCount ?? 0,
        },
      };
    });

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
  }, [agentsMap, entries, sessions]);
}
