import { ToolPluginRegistry } from '../tool-plugin';
import { vfsReadPlugin } from './vfs-read';
import { vfsWritePlugin } from './vfs-write';
import { vfsListPlugin } from './vfs-list';
import { vfsDeletePlugin } from './vfs-delete';
import { spawnAgentPlugin } from './spawn-agent';
import { signalParentPlugin } from './signal-parent';
import { webFetchPlugin } from './web-fetch';
import { webSearchPlugin } from './web-search';

export function createBuiltinRegistry(): ToolPluginRegistry {
  const registry = new ToolPluginRegistry();
  registry.register(vfsReadPlugin);
  registry.register(vfsWritePlugin);
  registry.register(vfsListPlugin);
  registry.register(vfsDeletePlugin);
  registry.register(spawnAgentPlugin);
  registry.register(signalParentPlugin);
  registry.register(webFetchPlugin);
  registry.register(webSearchPlugin);
  return registry;
}

export {
  vfsReadPlugin,
  vfsWritePlugin,
  vfsListPlugin,
  vfsDeletePlugin,
  spawnAgentPlugin,
  signalParentPlugin,
  webFetchPlugin,
  webSearchPlugin,
};
