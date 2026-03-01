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

  // Pre-validate checkpoint data before any destructive operations.
  const paths = Object.keys(checkpoint.files).sort((a, b) => a.localeCompare(b));
  const agentEntries: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const content = checkpoint.files[path];
    if (typeof content !== 'string') {
      throw new Error(`Checkpoint file "${path}" has invalid content`);
    }
    if (path.startsWith('agents/')) {
      agentEntries.push({ path, content });
    }
  }

  // Clear existing state only after validation passes.
  for (const agent of registry.listAll()) {
    registry.unregister(agent.path);
  }
  for (const path of vfs.getAllPaths()) {
    vfs.deleteFile(path);
  }

  // Restore from checkpoint.
  for (const path of paths) {
    vfs.write(path, checkpoint.files[path], { authorAgentId: 'replay' });
  }
  for (const { path, content } of agentEntries) {
    registry.registerFromFile(path, content);
  }
}
