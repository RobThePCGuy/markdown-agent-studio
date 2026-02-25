import { describe, it, expect } from 'vitest';
import { blackboardReadPlugin, blackboardWritePlugin } from './blackboard-plugin';

describe('blackboardWritePlugin', () => {
  it('has correct name', () => {
    expect(blackboardWritePlugin.name).toBe('blackboard_write');
  });

  it('requires key and value', () => {
    expect(blackboardWritePlugin.parameters.key.required).toBe(true);
    expect(blackboardWritePlugin.parameters.value.required).toBe(true);
  });
});

describe('blackboardReadPlugin', () => {
  it('has correct name', () => {
    expect(blackboardReadPlugin.name).toBe('blackboard_read');
  });
});
