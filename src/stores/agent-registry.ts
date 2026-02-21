import { createStore } from 'zustand/vanilla';
import type { AgentProfile } from '../types';
import { parseAgentFile } from '../utils/parse-agent';

export interface AgentRegistryState {
  agents: Map<string, AgentProfile>;
  registerFromFile(path: string, content: string): AgentProfile;
  unregister(path: string): void;
  get(pathOrId: string): AgentProfile | undefined;
  listAll(): AgentProfile[];
}

export function createAgentRegistry() {
  return createStore<AgentRegistryState>((set, get) => ({
    agents: new Map(),

    registerFromFile(path: string, content: string): AgentProfile {
      const profile = parseAgentFile(path, content);
      set((state) => {
        const agents = new Map(state.agents);
        agents.set(path, profile);
        return { agents };
      });
      return profile;
    },

    unregister(path: string): void {
      set((state) => {
        const agents = new Map(state.agents);
        agents.delete(path);
        return { agents };
      });
    },

    get(pathOrId: string): AgentProfile | undefined {
      const state = get();
      const byPath = state.agents.get(pathOrId);
      if (byPath) return byPath;
      for (const agent of state.agents.values()) {
        if (agent.id === pathOrId) return agent;
      }
      return undefined;
    },

    listAll(): AgentProfile[] {
      return [...get().agents.values()];
    },
  }));
}
