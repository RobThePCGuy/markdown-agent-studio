import { describe, it, expect } from 'vitest';
import { parseAgentFile } from './parse-agent';

describe('parseAgentFile', () => {
  it('parses valid frontmatter + body', () => {
    const content = `---
name: "Writer"
model: "gemini"
---

# MISSION
You are a writer.`;

    const result = parseAgentFile('agents/writer.md', content);
    expect(result.name).toBe('Writer');
    expect(result.model).toBe('gemini');
    expect(result.systemPrompt).toContain('# MISSION');
    expect(result.systemPrompt).toContain('You are a writer.');
    expect(result.id).toBe('agents/writer.md');
  });

  it('handles missing frontmatter gracefully', () => {
    const content = '# Just a prompt\nDo stuff.';
    const result = parseAgentFile('agents/simple.md', content);
    expect(result.name).toBe('simple');
    expect(result.systemPrompt).toBe(content);
    expect(result.frontmatter).toEqual({});
  });

  it('handles malformed YAML gracefully', () => {
    const content = `---
name: [broken yaml
---
Body here.`;
    const result = parseAgentFile('agents/broken.md', content);
    expect(result.name).toBe('broken');
    expect(result.systemPrompt).toContain('Body here.');
  });

  it('uses frontmatter id if provided', () => {
    const content = `---
id: "custom-id"
name: "Test"
---
Prompt.`;
    const result = parseAgentFile('agents/test.md', content);
    expect(result.id).toBe('custom-id');
  });

  it('computes a content hash', () => {
    const result = parseAgentFile('agents/a.md', 'hello');
    expect(result.contentHash).toBeTruthy();
    expect(typeof result.contentHash).toBe('string');
  });
});
