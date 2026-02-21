import { describe, it, expect } from 'vitest';
import { parseAgentFile, resolvePolicyForInput } from './parse-agent';

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
    expect(result.policy.mode).toBe('gloves_off');
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

  it('parses custom tool definitions from frontmatter', () => {
    const content = `---
name: "Research Agent"
tools:
  - name: summarize
    description: Summarize text
    parameters:
      text:
        type: string
        description: The text to summarize
    prompt: "Summarize: {{text}}"
  - name: translate
    description: Translate text
    model: gemini-3-flash-preview
    parameters:
      text:
        type: string
        description: Text to translate
      language:
        type: string
        description: Target language
    prompt: "Translate to {{language}}: {{text}}"
    result_schema:
      type: object
      properties:
        translated:
          type: string
---

You are a research agent.`;

    const profile = parseAgentFile('agents/research.md', content);
    expect(profile.customTools).toHaveLength(2);

    expect(profile.customTools![0].name).toBe('summarize');
    expect(profile.customTools![0].parameters.text.type).toBe('string');
    expect(profile.customTools![0].prompt).toBe('Summarize: {{text}}');
    expect(profile.customTools![0].model).toBeUndefined();

    expect(profile.customTools![1].name).toBe('translate');
    expect(profile.customTools![1].model).toBe('gemini-3-flash-preview');
    expect(profile.customTools![1].resultSchema).toBeDefined();
  });

  it('returns undefined customTools when no tools in frontmatter', () => {
    const content = `---
name: "Simple Agent"
---

Just do stuff.`;

    const profile = parseAgentFile('agents/simple.md', content);
    expect(profile.customTools).toBeUndefined();
  });

  it('skips invalid tool definitions gracefully', () => {
    const content = `---
name: "Agent"
tools:
  - name: valid_tool
    description: A valid tool
    parameters:
      input:
        type: string
        description: Input
    prompt: "Do: {{input}}"
  - bad_entry: true
---

Instructions.`;

    const profile = parseAgentFile('agents/agent.md', content);
    expect(profile.customTools).toHaveLength(1);
    expect(profile.customTools![0].name).toBe('valid_tool');
  });

  it('parses policy controls from frontmatter', () => {
    const content = `---
name: "Controlled"
safety_mode: safe
reads:
  - memory/**
writes:
  - artifacts/**
permissions:
  spawn_agents: false
  web_access: false
gloves_off_triggers:
  - emergency
  - hotfix
---

Do work.`;

    const profile = parseAgentFile('agents/controlled.md', content);
    expect(profile.policy.mode).toBe('safe');
    expect(profile.policy.reads).toEqual(['memory/**']);
    expect(profile.policy.writes).toEqual(['artifacts/**']);
    expect(profile.policy.permissions.spawnAgents).toBe(false);
    expect(profile.policy.permissions.webAccess).toBe(false);
    expect(profile.policy.glovesOffTriggers).toEqual(['emergency', 'hotfix']);
  });

  it('supports permissions array as an explicit allowlist', () => {
    const content = `---
name: "Allowlist"
safety_mode: safe
permissions:
  - spawn_agent
  - signal_parent
---

Do work.`;

    const profile = parseAgentFile('agents/allowlist.md', content);
    expect(profile.policy.permissions.spawnAgents).toBe(true);
    expect(profile.policy.permissions.signalParent).toBe(true);
    expect(profile.policy.permissions.webAccess).toBe(false);
    expect(profile.policy.permissions.deleteFiles).toBe(false);
  });

  it('escalates to gloves_off when task input matches trigger phrase', () => {
    const content = `---
name: "Adaptive"
safety_mode: safe
gloves_off_triggers:
  - incident
---

Do work.`;
    const profile = parseAgentFile('agents/adaptive.md', content);

    const resolved = resolvePolicyForInput(profile.policy, 'urgent incident response, ship now');
    expect(resolved.escalated).toBe(true);
    expect(resolved.policy.mode).toBe('gloves_off');
    expect(resolved.trigger).toBe('incident');
    expect(resolved.policy.permissions.webAccess).toBe(true);
  });
});
