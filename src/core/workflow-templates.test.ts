import { describe, it, expect } from 'vitest';
import { WORKFLOW_TEMPLATES } from './workflow-templates';
import { parseWorkflow } from './workflow-parser';

describe('Workflow Templates', () => {
  it('all templates parse without error', () => {
    for (const [name, md] of Object.entries(WORKFLOW_TEMPLATES)) {
      const wf = parseWorkflow(`workflows/${name}.md`, md);
      expect(wf.name).toBeTruthy();
      expect(wf.steps.length).toBeGreaterThan(0);
      expect(wf.executionOrder.length).toBe(wf.steps.length);
    }
  });

  it('chain template has sequential dependencies', () => {
    const wf = parseWorkflow('w.md', WORKFLOW_TEMPLATES.chain);
    for (let i = 1; i < wf.steps.length; i++) {
      expect(wf.steps[i].dependsOn).toContain(wf.steps[i - 1].id);
    }
  });

  it('fan-out template has parallel workers', () => {
    const wf = parseWorkflow('w.md', WORKFLOW_TEMPLATES['fan-out']);
    const workerSteps = wf.steps.filter((s) => s.dependsOn.length === 1 && s.dependsOn[0] === wf.steps[0].id);
    expect(workerSteps.length).toBeGreaterThanOrEqual(2);
  });
});
