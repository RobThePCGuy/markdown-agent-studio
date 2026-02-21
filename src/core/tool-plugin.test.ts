import { describe, it, expect, beforeEach } from 'vitest';
import { ToolPluginRegistry, type ToolPlugin } from './tool-plugin';

describe('ToolPluginRegistry', () => {
  let registry: ToolPluginRegistry;

  const mockPlugin: ToolPlugin = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {
      input: { type: 'string', description: 'Test input', required: true },
    },
    handler: async () => 'test result',
  };

  beforeEach(() => {
    registry = new ToolPluginRegistry();
  });

  it('registers and retrieves a plugin', () => {
    registry.register(mockPlugin);
    expect(registry.get('test_tool')).toBe(mockPlugin);
  });

  it('returns undefined for unknown plugin', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('unregisters a plugin', () => {
    registry.register(mockPlugin);
    registry.unregister('test_tool');
    expect(registry.get('test_tool')).toBeUndefined();
  });

  it('lists all plugins', () => {
    registry.register(mockPlugin);
    registry.register({ ...mockPlugin, name: 'another_tool' });
    expect(registry.getAll()).toHaveLength(2);
  });

  it('converts to ToolDeclarations', () => {
    registry.register(mockPlugin);
    const defs = registry.toToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('test_tool');
    expect(defs[0].description).toBe('A test tool');
    expect(defs[0].parameters.type).toBe('object');
    expect(defs[0].parameters.properties.input.type).toBe('string');
    expect(defs[0].parameters.required).toEqual(['input']);
  });

  it('does not include non-required params in required array', () => {
    registry.register({
      ...mockPlugin,
      parameters: {
        input: { type: 'string', description: 'required', required: true },
        optional: { type: 'number', description: 'optional' },
      },
    });
    const defs = registry.toToolDefinitions();
    expect(defs[0].parameters.required).toEqual(['input']);
  });

  it('creates a clone with additional plugins', () => {
    registry.register(mockPlugin);
    const extra: ToolPlugin = { ...mockPlugin, name: 'extra' };
    const cloned = registry.cloneWith([extra]);
    expect(cloned.getAll()).toHaveLength(2);
    expect(registry.getAll()).toHaveLength(1);
  });
});
