import { describe, it, expect } from 'vitest';
import { BUILT_IN_TEMPLATES, getTemplates } from './agent-templates';

describe('agent-templates', () => {
  it('exports 6 built-in templates', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(6);
  });

  it('every built-in has required fields', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.id).toMatch(/^builtin:/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.content).toContain('---');
      expect(t.content).toContain('name:');
      expect(t.builtIn).toBe(true);
    }
  });

  it('built-in content is valid frontmatter + body', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const lines = t.content.split('\n');
      expect(lines[0]).toBe('---');
      const closingIdx = lines.indexOf('---', 1);
      expect(closingIdx).toBeGreaterThan(1);
      const body = lines.slice(closingIdx + 1).join('\n').trim();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it('getTemplates returns built-ins when VFS has no templates', () => {
    const files = new Map();
    const result = getTemplates(files);
    expect(result).toHaveLength(6);
    expect(result.every((t) => t.builtIn)).toBe(true);
  });

  it('getTemplates merges user templates from VFS', () => {
    const files = new Map();
    files.set('templates/my-agent.md', {
      path: 'templates/my-agent.md',
      content: '---\nname: "Custom"\n---\nDo stuff.',
    });
    const result = getTemplates(files);
    expect(result).toHaveLength(7);
    const custom = result.find((t) => t.id === 'templates/my-agent.md');
    expect(custom).toBeDefined();
    expect(custom!.builtIn).toBe(false);
    expect(custom!.name).toBe('Custom');
    expect(custom!.content).toContain('Do stuff.');
  });

  it('getTemplates extracts name from frontmatter for user templates', () => {
    const files = new Map();
    files.set('templates/no-name.md', {
      path: 'templates/no-name.md',
      content: '---\nmodel: "gemini"\n---\nInstructions.',
    });
    const result = getTemplates(files);
    const t = result.find((t) => t.id === 'templates/no-name.md');
    expect(t!.name).toBe('no-name');
  });
});
