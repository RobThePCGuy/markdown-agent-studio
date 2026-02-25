import { describe, it, expect } from 'vitest';
import { publishPlugin, subscribePlugin } from './pub-sub-plugin';

describe('publishPlugin', () => {
  it('has correct name', () => {
    expect(publishPlugin.name).toBe('publish');
  });

  it('requires channel and message parameters', () => {
    expect(publishPlugin.parameters.channel.required).toBe(true);
    expect(publishPlugin.parameters.message.required).toBe(true);
  });
});

describe('subscribePlugin', () => {
  it('has correct name', () => {
    expect(subscribePlugin.name).toBe('subscribe');
  });

  it('requires channel parameter', () => {
    expect(subscribePlugin.parameters.channel.required).toBe(true);
  });
});
