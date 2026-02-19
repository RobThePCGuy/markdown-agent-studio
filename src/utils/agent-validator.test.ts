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
    const content = '---\nname: "Test"\nmodel: "gemini-2.5-pro"\n---\n\nBody.';
    const diags = validateAgentContent(content);
    expect(diags.find((d) => d.message.includes('Unknown model'))).toBeUndefined();
  });

  it('returns empty array for non-agent files (no validation)', () => {
    const diags = validateAgentContent('', false);
    expect(diags).toHaveLength(0);
  });

  it('validates well-formed custom tools produce no additional diagnostics', () => {
    const content = `---
name: "Agent"
tools:
  - name: summarize
    description: Summarize text
    parameters:
      text:
        type: string
        description: The text
    prompt: "Summarize: {{text}}"
---

Do stuff.`;

    const diagnostics = validateAgentContent(content);
    expect(diagnostics).toHaveLength(0);
  });

  it('warns when custom tool is missing required fields', () => {
    const content = `---
name: "Agent"
tools:
  - name: bad_tool
---

Do stuff.`;

    const diagnostics = validateAgentContent(content);
    const toolDiags = diagnostics.filter((d) => d.message.toLowerCase().includes('tool'));
    expect(toolDiags.length).toBeGreaterThan(0);
    expect(toolDiags[0].severity).toBe('warning');
  });

  it('warns when custom tool prompt references undefined parameter', () => {
    const content = `---
name: "Agent"
tools:
  - name: my_tool
    description: A tool
    parameters:
      input:
        type: string
        description: Input
    prompt: "Do something with {{unknown_param}}"
---

Do stuff.`;

    const diagnostics = validateAgentContent(content);
    const mismatch = diagnostics.filter((d) => d.message.includes('unknown_param'));
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch[0].severity).toBe('info');
  });

  it('warns on unknown safety mode', () => {
    const content = `---
name: "Agent"
safety_mode: turbo
---

Do work.`;

    const diagnostics = validateAgentContent(content);
    const modeDiag = diagnostics.find((d) => d.message.includes('Unknown safety mode'));
    expect(modeDiag).toBeDefined();
    expect(modeDiag!.severity).toBe('warning');
  });

  it('warns when gloves_off mode is set', () => {
    const content = `---
name: "Agent"
mode: gloves_off
---

Do work.`;

    const diagnostics = validateAgentContent(content);
    const glovesDiag = diagnostics.find((d) => d.message.includes('gloves_off'));
    expect(glovesDiag).toBeDefined();
    expect(glovesDiag!.severity).toBe('warning');
  });

  it('warns on invalid permissions object values', () => {
    const content = `---
name: "Agent"
permissions:
  spawn_agents: yes
---

Do work.`;

    const diagnostics = validateAgentContent(content);
    const permDiag = diagnostics.find((d) => d.message.includes('Permission'));
    expect(permDiag).toBeDefined();
    expect(permDiag!.severity).toBe('warning');
  });

  it('warns on non-string read scope entries', () => {
    const content = `---
name: "Agent"
reads:
  - memory/**
  - 42
---

Do work.`;

    const diagnostics = validateAgentContent(content);
    const readsDiag = diagnostics.find((d) => d.message.includes("'reads'"));
    expect(readsDiag).toBeDefined();
    expect(readsDiag!.severity).toBe('warning');
  });
});
