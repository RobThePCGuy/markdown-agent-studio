import { describe, it, expect } from 'vitest';
import { validateAgentContent } from './agent-validator';

describe('validateAgentContent', () => {
  it('returns no diagnostics for a well-formed agent', () => {
    const content = '---\nname: "Test"\n---\n\n# MISSION\nDo stuff.';
    const diags = validateAgentContent(content);
    expect(diags).toHaveLength(0);
  });

  it('warns when frontmatter delimiters are missing', () => {
    const content = '# Just a markdown file\nNo frontmatter here.';
    const diags = validateAgentContent(content);
    const fmDiag = diags.find((d) => d.message.includes('frontmatter'));
    expect(fmDiag).toBeDefined();
    expect(fmDiag!.severity).toBe('warning');
    expect(fmDiag!.startLine).toBe(1);
  });

  it('warns when name field is missing', () => {
    const content = '---\nmodel: "gemini"\n---\n\nSome prompt.';
    const diags = validateAgentContent(content);
    const nameDiag = diags.find((d) => d.message.includes('name'));
    expect(nameDiag).toBeDefined();
    expect(nameDiag!.severity).toBe('warning');
  });

  it('warns when system prompt body is empty', () => {
    const content = '---\nname: "Test"\n---\n';
    const diags = validateAgentContent(content);
    const bodyDiag = diags.find((d) => d.message.includes('system prompt'));
    expect(bodyDiag).toBeDefined();
    expect(bodyDiag!.severity).toBe('warning');
  });

  it('returns error for malformed YAML', () => {
    const content = '---\nname: [invalid yaml\n---\n\nBody.';
    const diags = validateAgentContent(content);
    const yamlDiag = diags.find((d) => d.message.includes('Invalid YAML'));
    expect(yamlDiag).toBeDefined();
    expect(yamlDiag!.severity).toBe('error');
  });

  it('returns info for unknown model', () => {
    const content = '---\nname: "Test"\nmodel: "gpt-999"\n---\n\nBody.';
    const diags = validateAgentContent(content);
    const modelDiag = diags.find((d) => d.message.includes('Unknown model'));
    expect(modelDiag).toBeDefined();
    expect(modelDiag!.severity).toBe('info');
    expect(modelDiag!.message).toContain('gpt-999');
  });

  it('accepts known models without info diagnostic', () => {
    const content = '---\nname: "Test"\nmodel: "gemini-1.5-pro"\n---\n\nBody.';
    const diags = validateAgentContent(content);
    expect(diags.find((d) => d.message.includes('Unknown model'))).toBeUndefined();
  });

  it('returns empty array for non-agent files (no validation)', () => {
    const diags = validateAgentContent('', false);
    expect(diags).toHaveLength(0);
  });
});
