import { useMemo } from 'react';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { useAgentRegistry, useEventLog, useSessionStore, useUI, useMemoryStore } from '../stores/use-stores';

type AgentNodeStatus = 'running' | 'idle' | 'error' | 'aborted' | 'completed' | 'paused';
export type GraphActivityKind =
  | 'thinking'
  | 'web_search'
  | 'web_fetch'
  | 'signal'
  | 'spawn'
  | 'filesystem'
  | 'tool';

export type GraphAgentNodeData = Record<string, unknown> & {
  kind: 'agent';
  label: string;
  path: string;
  status: AgentNodeStatus;
  tokenCount: number;
  spawnCount: number;
  memoryCount: number;
  isStreaming: boolean;
  selected: boolean;
  justSpawned: boolean;
};

export type GraphActivityNodeData = Record<string, unknown> & {
  kind: 'activity';
  activityKind: GraphActivityKind;
  label: string;
  detail: string;
  ownerAgentId: string;
  recent: boolean;
};

type GraphNodeData = GraphAgentNodeData | GraphActivityNodeData;
type GraphEdgeKind = 'spawn' | 'signal' | 'activity';

export type GraphEdgeData = Record<string, unknown> & {
  kind: GraphEdgeKind;
  recent: boolean;
  activityKind?: GraphActivityKind;
};

interface LatestSession {
  activationId: string;
  status: AgentNodeStatus;
  tokenCount: number;
  startedAt: number;
  isStreaming: boolean;
}

interface PendingToolCall {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

interface ActivityDescriptor {
  activityKind: GraphActivityKind;
  label: string;
  detail: string;
}

function compactText(input: string, maxLength = 36): string {
  const clean = input.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function activityFromTool(tool: string, args: Record<string, unknown>): ActivityDescriptor {
  switch (tool) {
    case 'web_search':
      return {
        activityKind: 'web_search',
        label: 'Web Search',
        detail: compactText(typeof args.query === 'string' ? args.query : 'searching'),
      };
    case 'web_fetch':
      return {
        activityKind: 'web_fetch',
        label: 'Fetch URL',
        detail: compactText(typeof args.url === 'string' ? args.url : 'fetching'),
      };
    case 'signal_parent':
      return {
        activityKind: 'signal',
        label: 'Send Signal',
        detail: compactText(typeof args.message === 'string' ? args.message : 'notifying parent'),
      };
    case 'spawn_agent':
      return {
        activityKind: 'spawn',
        label: 'Spawn Agent',
        detail: compactText(typeof args.filename === 'string' ? args.filename : 'creating child'),
      };
    case 'vfs_read':
    case 'vfs_write':
    case 'vfs_list':
    case 'vfs_delete':
      return {
        activityKind: 'filesystem',
        label: 'Workspace IO',
        detail: compactText(
          typeof args.path === 'string'
            ? args.path
            : typeof args.prefix === 'string'
              ? args.prefix
              : tool,
        ),
      };
    default:
      return {
        activityKind: 'tool',
        label: 'Tool Call',
        detail: compactText(tool),
      };
  }
}

export function useGraphData() {
  const agentsMap = useAgentRegistry((s) => s.agents);
  const entries = useEventLog((s) => s.entries);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedAgentId = useUI((s) => s.selectedAgentId);
  const memoryEntries = useMemoryStore((s) => s.entries);

  return useMemo(() => {
    const agents = [...agentsMap.values()];
    // eslint-disable-next-line react-hooks/purity -- intentional: time-based recency for live UI
    const nowMs = Date.now();

    // Build a map of agentId -> most recent session
    const latestByAgent = new Map<string, LatestSession>();
    for (const session of sessions.values()) {
      const existing = latestByAgent.get(session.agentId);
      if (!existing || session.startedAt > existing.startedAt) {
        latestByAgent.set(session.agentId, {
          activationId: session.activationId,
          status: session.status,
          tokenCount: session.tokenCount,
          startedAt: session.startedAt,
          isStreaming: session.streamingText.length > 0,
        });
      }
    }

    const spawnEvents = entries.filter((e) => e.type === 'spawn');
    const signalEvents = entries.filter((e) => e.type === 'signal');

    const firstSpawnByChild = new Map<string, { parent: string; timestamp: number }>();
    for (const evt of spawnEvents) {
      const child = evt.data.spawned as string | undefined;
      if (!child || firstSpawnByChild.has(child)) continue;
      firstSpawnByChild.set(child, { parent: evt.agentId, timestamp: evt.timestamp });
    }

    const childrenByParent = new Map<string, string[]>();
    for (const [child, parent] of firstSpawnByChild.entries()) {
      const arr = childrenByParent.get(parent.parent) ?? [];
      arr.push(child);
      childrenByParent.set(parent.parent, arr);
    }
    for (const childList of childrenByParent.values()) {
      childList.sort((a, b) => a.localeCompare(b));
    }

    // Build dagre graph for hierarchical layout
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      nodesep: 80,
      ranksep: 120,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add agent nodes to dagre
    for (const agent of agents) {
      g.setNode(agent.path, { width: 220, height: 120 });
    }

    // Add spawn edges for layout computation
    for (const [child, info] of firstSpawnByChild.entries()) {
      if (agents.some(a => a.path === child) && agents.some(a => a.path === info.parent)) {
        g.setEdge(info.parent, child);
      }
    }

    dagre.layout(g);

    const agentNodes: Node<GraphNodeData>[] = agents
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((agent) => {
        const live = latestByAgent.get(agent.path);
        const spawnedMeta = firstSpawnByChild.get(agent.path);
        const spawnCount = childrenByParent.get(agent.path)?.length ?? 0;
        const memoryCount = memoryEntries.filter((e) => e.authorAgentId === agent.path).length;
        const justSpawned = spawnedMeta ? (nowMs - spawnedMeta.timestamp) < 10000 : false;
        const dagreNode = g.node(agent.path);
        return {
          id: agent.path,
          type: 'agentNode',
          position: {
            x: dagreNode ? dagreNode.x - 110 : 0,  // center-align (220/2)
            y: dagreNode ? dagreNode.y - 60 : 0,    // center-align (120/2)
          },
          data: {
            kind: 'agent' as const,
            label: agent.name,
            path: agent.path,
            status: live?.status ?? 'idle',
            tokenCount: live?.tokenCount ?? 0,
            spawnCount,
            memoryCount,
            isStreaming: live?.isStreaming ?? false,
            selected: selectedAgentId === agent.path,
            justSpawned,
          },
        };
      });

    const nodeIds = new Set(agentNodes.map((n) => n.id));
    const basePositionByAgent = new Map(
      agentNodes.map((n) => {
        const dagreNode = g.node(n.id);
        return [
          n.id,
          {
            x: dagreNode ? dagreNode.x - 110 : 0,
            y: dagreNode ? dagreNode.y - 60 : 0,
          },
        ];
      }),
    );

    const edges: Edge<GraphEdgeData>[] = [];
    for (const evt of spawnEvents) {
      const spawned = evt.data.spawned as string;
      if (spawned && nodeIds.has(spawned)) {
        const recent = (nowMs - evt.timestamp) < 8000;
        edges.push({
          id: `edge-spawn-${evt.id}`,
          source: evt.agentId,
          target: spawned,
          animated: recent,
          label: recent ? 'spawned' : '',
          style: {
            stroke: recent ? '#f9e2af' : '#89b4fa',
            strokeWidth: recent ? 2.4 : 1.8,
            opacity: recent ? 0.95 : 0.62,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: recent ? '#f9e2af' : '#89b4fa' },
          data: { kind: 'spawn', recent },
        });
      }
    }

    for (const evt of signalEvents.slice(-24)) {
      const parent = evt.data.parent as string | undefined;
      if (!parent) continue;
      if (!nodeIds.has(parent) || !nodeIds.has(evt.agentId)) continue;
      const recent = (nowMs - evt.timestamp) < 10000;
      if (!recent) continue;
      const message = typeof evt.data.message === 'string' ? compactText(evt.data.message, 26) : '';
      edges.push({
        id: `edge-signal-${evt.id}`,
        source: evt.agentId,
        target: parent,
        animated: true,
        label: message ? `signal: ${message}` : 'signal',
        style: {
          stroke: recent ? '#fab387' : '#cba6f7',
          strokeDasharray: '6 4',
          strokeWidth: recent ? 2.2 : 1.4,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#fab387' },
        data: { kind: 'signal', recent },
      });
    }

    const pendingByActivation = new Map<string, PendingToolCall>();
    for (const entry of entries) {
      if (entry.type === 'tool_call') {
        const tool = typeof entry.data.tool === 'string' ? entry.data.tool : '';
        const args =
          entry.data.args && typeof entry.data.args === 'object' && !Array.isArray(entry.data.args)
            ? (entry.data.args as Record<string, unknown>)
            : {};
        pendingByActivation.set(entry.activationId, {
          tool,
          args,
          timestamp: entry.timestamp,
        });
      }
      if (entry.type === 'tool_result') {
        pendingByActivation.delete(entry.activationId);
      }
    }

    const activityNodes: Node<GraphNodeData>[] = [];
    for (const [agentId, session] of latestByAgent.entries()) {
      if (session.status !== 'running') continue;
      const origin = basePositionByAgent.get(agentId);
      if (!origin) continue;

      const pendingTool = pendingByActivation.get(session.activationId);

      if (session.isStreaming || !pendingTool) {
        const thinkingNodeId = `activity-thinking-${session.activationId}`;
        activityNodes.push({
          id: thinkingNodeId,
          type: 'activityNode',
          draggable: false,
          selectable: false,
          position: { x: origin.x + 230, y: origin.y - 72 },
          data: {
            kind: 'activity',
            activityKind: 'thinking',
            label: 'Thinking',
            detail: 'planning next step',
            ownerAgentId: agentId,
            recent: true,
          },
        });
        edges.push({
          id: `edge-activity-thinking-${session.activationId}`,
          source: agentId,
          target: thinkingNodeId,
          animated: true,
          style: {
            stroke: '#a6e3a1',
            strokeWidth: 1.8,
            strokeDasharray: '5 5',
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#a6e3a1' },
          data: {
            kind: 'activity',
            recent: true,
            activityKind: 'thinking',
          },
        });
      }

      if (pendingTool) {
        const activity = activityFromTool(pendingTool.tool, pendingTool.args);
        const toolNodeId = `activity-tool-${session.activationId}`;
        activityNodes.push({
          id: toolNodeId,
          type: 'activityNode',
          draggable: false,
          selectable: false,
          position: { x: origin.x + 230, y: origin.y + 76 },
          data: {
            kind: 'activity',
            activityKind: activity.activityKind,
            label: activity.label,
            detail: activity.detail,
            ownerAgentId: agentId,
            recent: (nowMs - pendingTool.timestamp) < 8000,
          },
        });
        edges.push({
          id: `edge-activity-tool-${session.activationId}`,
          source: agentId,
          target: toolNodeId,
          animated: true,
          style: {
            stroke: activity.activityKind === 'web_search' || activity.activityKind === 'web_fetch'
              ? '#89b4fa'
              : '#cba6f7',
            strokeWidth: 1.8,
            strokeDasharray: '4 6',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: activity.activityKind === 'web_search' || activity.activityKind === 'web_fetch'
              ? '#89b4fa'
              : '#cba6f7',
          },
          data: {
            kind: 'activity',
            recent: true,
            activityKind: activity.activityKind,
          },
        });
      }
    }

    return { nodes: [...agentNodes, ...activityNodes], edges };
  }, [agentsMap, entries, sessions, selectedAgentId, memoryEntries]);
}
