import { describe, it, expect } from 'vitest';
import { parseWorkflow } from './workflow-parser';

const SAMPLE_WORKFLOW = `---
name: Research Pipeline
description: Multi-stage research with review
trigger: manual
steps:
  - id: research
    agent: agents/researcher.md
    prompt: "Research {topic} thoroughly"
    outputs: [findings]
  - id: review
    agent: agents/reviewer.md
    depends_on: [research]
    prompt: "Review findings: {research.findings}"
    outputs: [review_report]
  - id: write
    agent: agents/writer.md
    depends_on: [research, review]
    prompt: "Write report from {research.findings} and {review.review_report}"
---
# Research Pipeline
`;

describe('parseWorkflow', () => {
  it('parses workflow name and description', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.name).toBe('Research Pipeline');
    expect(wf.description).toBe('Multi-stage research with review');
  });

  it('parses steps with ids and agents', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps).toHaveLength(3);
    expect(wf.steps[0].id).toBe('research');
    expect(wf.steps[0].agent).toBe('agents/researcher.md');
  });

  it('parses depends_on relationships', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps[1].dependsOn).toEqual(['research']);
    expect(wf.steps[2].dependsOn).toEqual(['research', 'review']);
  });

  it('parses outputs array', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    expect(wf.steps[0].outputs).toEqual(['findings']);
  });

  it('resolves topological order', () => {
    const wf = parseWorkflow('workflows/research.md', SAMPLE_WORKFLOW);
    const order = wf.executionOrder;
    const researchIdx = order.indexOf('research');
    const reviewIdx = order.indexOf('review');
    const writeIdx = order.indexOf('write');
    expect(researchIdx).toBeLessThan(reviewIdx);
    expect(researchIdx).toBeLessThan(writeIdx);
    expect(reviewIdx).toBeLessThan(writeIdx);
  });

  it('detects circular dependencies', () => {
    const circular = `---
name: Circular
steps:
  - id: a
    agent: agents/a.md
    depends_on: [b]
    prompt: test
  - id: b
    agent: agents/b.md
    depends_on: [a]
    prompt: test
---`;
    expect(() => parseWorkflow('w.md', circular)).toThrow(/circular/i);
  });

  it('rejects duplicate step ids', () => {
    const invalid = `---
name: Duplicate IDs
steps:
  - id: a
    agent: agents/a.md
    prompt: test
  - id: a
    agent: agents/b.md
    prompt: test
---`;
    expect(() => parseWorkflow('w.md', invalid)).toThrow(/duplicate step id/i);
  });

  it('rejects steps missing required fields', () => {
    const invalid = `---
name: Missing fields
steps:
  - id: a
    agent: ""
    prompt: ""
---`;
    expect(() => parseWorkflow('w.md', invalid)).toThrow(/missing a non-empty "agent"/i);
  });
});
