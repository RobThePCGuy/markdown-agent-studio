import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowDefinition } from './workflow-parser';

function makeWorkflow(): WorkflowDefinition {
  return {
    path: 'workflows/test.md',
    name: 'Test Workflow',
    description: 'test',
    trigger: 'manual',
    steps: [
      { id: 'a', agent: 'agents/a.md', prompt: 'Do A', dependsOn: [], outputs: ['result_a'] },
      { id: 'b', agent: 'agents/b.md', prompt: 'Do B with {a.result_a}', dependsOn: ['a'], outputs: ['result_b'] },
    ],
    executionOrder: ['a', 'b'],
    body: '',
    diagnostics: [],
  };
}

describe('WorkflowEngine', () => {
  it('executes steps in topological order', async () => {
    const executionLog: string[] = [];
    const runStep = vi.fn().mockImplementation(async (stepId: string) => {
      executionLog.push(stepId);
      return { [`result_${stepId}`]: `output of ${stepId}` };
    });

    const engine = new WorkflowEngine({ runStep });
    await engine.execute(makeWorkflow(), {});

    expect(executionLog).toEqual(['a', 'b']);
  });

  it('passes output variables to dependent steps', async () => {
    const prompts: string[] = [];
    const runStep = vi.fn().mockImplementation(async (stepId: string, prompt: string) => {
      prompts.push(prompt);
      return { [`result_${stepId}`]: `data-${stepId}` };
    });

    const engine = new WorkflowEngine({ runStep });
    await engine.execute(makeWorkflow(), {});

    expect(prompts[1]).toContain('data-a');
  });

  it('getStatus returns step statuses', async () => {
    const runStep = vi.fn().mockResolvedValue({});
    const engine = new WorkflowEngine({ runStep });

    const statusBefore = engine.getStatus();
    expect(statusBefore).toEqual({});

    await engine.execute(makeWorkflow(), {});
    const statusAfter = engine.getStatus();
    expect(statusAfter.a).toBe('completed');
    expect(statusAfter.b).toBe('completed');
  });

  it('supports running independent steps in parallel', async () => {
    const runStep = vi.fn().mockImplementation(async (stepId: string) => {
      if (stepId === 'a') {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (stepId === 'b') {
        await new Promise((r) => setTimeout(r, 40));
      }
      return { [`result_${stepId}`]: stepId };
    });

    const workflow = makeWorkflow();
    workflow.steps = [
      { id: 'a', agent: 'agents/a.md', prompt: 'Do A', dependsOn: [], outputs: [] },
      { id: 'b', agent: 'agents/b.md', prompt: 'Do B', dependsOn: [], outputs: [] },
      { id: 'c', agent: 'agents/c.md', prompt: 'Do C with {a.result_a} and {b.result_b}', dependsOn: ['a', 'b'], outputs: [] },
    ];
    workflow.executionOrder = ['a', 'b', 'c'];

    const engine = new WorkflowEngine({ runStep, maxParallelSteps: 2 });
    await engine.execute(workflow, {});

    expect(runStep).toHaveBeenCalledTimes(3);
    expect(engine.getStatus().c).toBe('completed');
  });
});
