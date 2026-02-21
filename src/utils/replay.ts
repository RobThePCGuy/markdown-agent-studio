import type { AgentRegistryState } from '../stores/agent-registry';
import type { VFSState } from '../stores/vfs-store';
import type { ReplayCheckpoint } from '../types';

type Store<T> = { getState(): T };

export function restoreCheckpoint(
  checkpoint: ReplayCheckpoint,
  vfsStore: Store<VFSState>,
  agentRegistry: Store<AgentRegistryState>,
): void {
  const vfs = vfsStore.getState();
  const registry = agentRegistry.getState();

  // Clear registry first to avoid stale lookups while files are replaced.
  for (const agent of registry.listAll()) {
    registry.unregister(agent.path);
  }

  // Remove every current file before restoring snapshot files.
  for (const path of vfs.getAllPaths()) {
    vfs.deleteFile(path);
  }

  const paths = Object.keys(checkpoint.files).sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    const content = checkpoint.files[path];
    vfs.write(path, content, { authorAgentId: 'replay' });
    if (path.startsWith('agents/')) {
      registry.registerFromFile(path, content);
    }
  }
}
