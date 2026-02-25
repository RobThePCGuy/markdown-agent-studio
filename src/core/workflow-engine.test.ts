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
});
