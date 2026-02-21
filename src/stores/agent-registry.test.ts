import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentRegistry } from './agent-registry';

describe('Agent Registry', () => {
  let registry: ReturnType<typeof createAgentRegistry>;

  beforeEach(() => {
    registry = createAgentRegistry();
  });

  it('registers an agent from file content', () => {
    registry.getState().registerFromFile('agents/writer.md', '---\nname: "Writer"\n---\n# Prompt');
    const agent = registry.getState().get('agents/writer.md');
    expect(agent).toBeTruthy();
    expect(agent!.name).toBe('Writer');
  });

  it('unregisters an agent', () => {
    registry.getState().registerFromFile('agents/writer.md', 'prompt');
    registry.getState().unregister('agents/writer.md');
    expect(registry.getState().get('agents/writer.md')).toBeUndefined();
  });

  it('lists all agents', () => {
    registry.getState().registerFromFile('agents/a.md', 'a');
    registry.getState().registerFromFile('agents/b.md', 'b');
    expect(registry.getState().listAll()).toHaveLength(2);
  });

  it('updates agent on re-register', () => {
    registry.getState().registerFromFile('agents/writer.md', 'v1');
    registry.getState().registerFromFile('agents/writer.md', 'v2');
    expect(registry.getState().get('agents/writer.md')!.systemPrompt).toBe('v2');
  });
});
