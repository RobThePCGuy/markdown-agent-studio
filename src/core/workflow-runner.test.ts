import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStepRunner } from './workflow-runner';
import { WorkflowEngine } from './workflow-engine';
import type { WorkflowDefinition } from './workflow-parser';

function createMockDeps() {
  const appendFn = vi.fn();
  return {
    kernel: {
      runSessionAndReturn: vi.fn().mockResolvedValue('mock result text'),
    },
    eventLog: {
      getState: () => ({ append: appendFn }),
    },
    workflowPath: 'workflows/test.md',
    _appendFn: appendFn,
  };
}

describe('createStepRunner', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('calls kernel.runSessionAndReturn with correct activation shape', async () => {
    const runner = createStepRunner(deps as any);
    await runner('step-1', 'Do something', 'agents/writer.md', {});

    expect(deps.kernel.runSessionAndReturn).toHaveBeenCalledWith({
      agentId: 'agents/writer.md',
      input: 'Do something',
      spawnDepth: 0,
      priority: 0,
    });
  });

  it('emits workflow_step events (running + completed)', async () => {
    const runner = createStepRunner(deps as any);
    await runner('step-1', 'Do something', 'agents/writer.md', {});

    expect(deps._appendFn).toHaveBeenCalledTimes(2);

    const runningCall = deps._appendFn.mock.calls[0][0];
    expect(runningCall.type).toBe('workflow_step');
    expect(runningCall.data.stepId).toBe('step-1');
    expect(runningCall.data.status).toBe('running');

    const completedCall = deps._appendFn.mock.calls[1][0];
    expect(completedCall.type).toBe('workflow_step');
    expect(completedCall.data.stepId).toBe('step-1');
    expect(completedCall.data.status).toBe('completed');
    expect(completedCall.data.resultPreview).toBe('mock result text');
  });

  it('propagates kernel errors', async () => {
    deps.kernel.runSessionAndReturn.mockRejectedValue(new Error('kernel boom'));

    const runner = createStepRunner(deps as any);
    await expect(
      runner('step-1', 'Do something', 'agents/writer.md', {}),
    ).rejects.toThrow('kernel boom');
  });

  it('returns result and text in output', async () => {
    deps.kernel.runSessionAndReturn.mockResolvedValue('analysis output');
    const runner = createStepRunner(deps as any);
    const output = await runner('step-1', 'Analyze', 'agents/analyst.md', {});

    expect(output).toEqual({
      result: 'analysis output',
      text: 'analysis output',
    });
  });
});

describe('WorkflowEngine + StepRunner integration', () => {
  it('executes a 2-step chain with outputs propagating', async () => {
    const appendFn = vi.fn();
    const mockKernel = {
      runSessionAndReturn: vi
        .fn()
        .mockResolvedValueOnce('first result')
        .mockResolvedValueOnce('second result'),
    };

    const stepRunner = createStepRunner({
      kernel: mockKernel as any,
      eventLog: { getState: () => ({ append: appendFn }) },
      workflowPath: 'workflows/chain.md',
    } as any);

    const engine = new WorkflowEngine({ runStep: stepRunner });

    const workflow: WorkflowDefinition = {
      path: 'workflows/chain.md',
      name: 'Chain Test',
      description: 'A 2-step chain',
      trigger: 'manual',
      steps: [
        { id: 'research', agent: 'agents/researcher.md', prompt: 'Research {topic}', dependsOn: [], outputs: ['result'] },
        { id: 'write', agent: 'agents/writer.md', prompt: 'Write about {research.result}', dependsOn: ['research'], outputs: ['result'] },
      ],
      executionOrder: ['research', 'write'],
      body: '',
    };

    const outputs = await engine.execute(workflow, { topic: 'AI safety' });

    expect(mockKernel.runSessionAndReturn).toHaveBeenCalledTimes(2);
    expect(outputs.research).toEqual({ result: 'first result', text: 'first result' });
    expect(outputs.write).toEqual({ result: 'second result', text: 'second result' });

    // 2 steps * 2 events each = 4 events
    expect(appendFn).toHaveBeenCalledTimes(4);
  });

  it('abort signal stops execution between steps', async () => {
    const abort = new AbortController();
    const mockKernel = {
      runSessionAndReturn: vi.fn().mockImplementation(async () => {
        // Abort after first call so second step never runs
        abort.abort();
        return 'first result';
      }),
    };

    const stepRunner = createStepRunner({
      kernel: mockKernel as any,
      eventLog: { getState: () => ({ append: vi.fn() }) },
      workflowPath: 'workflows/abort.md',
    } as any);

    const engine = new WorkflowEngine({ runStep: stepRunner });

    const workflow: WorkflowDefinition = {
      path: 'workflows/abort.md',
      name: 'Abort Test',
      description: '',
      trigger: 'manual',
      steps: [
        { id: 'step1', agent: 'agents/a.md', prompt: 'Do step 1', dependsOn: [], outputs: ['result'] },
        { id: 'step2', agent: 'agents/b.md', prompt: 'Do step 2', dependsOn: ['step1'], outputs: ['result'] },
      ],
      executionOrder: ['step1', 'step2'],
      body: '',
    };

    await expect(engine.execute(workflow, {}, abort.signal)).rejects.toThrow('Workflow aborted');
    // Only step1 ran; step2 was aborted before starting
    expect(mockKernel.runSessionAndReturn).toHaveBeenCalledTimes(1);
  });

  it('step outputs propagate via template variables', async () => {
    const mockKernel = {
      runSessionAndReturn: vi
        .fn()
        .mockResolvedValueOnce('outline of the topic')
        .mockResolvedValueOnce('draft based on outline'),
    };

    const stepRunner = createStepRunner({
      kernel: mockKernel as any,
      eventLog: { getState: () => ({ append: vi.fn() }) },
      workflowPath: 'workflows/template.md',
    } as any);

    const engine = new WorkflowEngine({ runStep: stepRunner });

    const workflow: WorkflowDefinition = {
      path: 'workflows/template.md',
      name: 'Template Test',
      description: '',
      trigger: 'manual',
      steps: [
        { id: 'outline', agent: 'agents/a.md', prompt: 'Create outline', dependsOn: [], outputs: ['result'] },
        { id: 'draft', agent: 'agents/b.md', prompt: 'Expand this: {outline.result}', dependsOn: ['outline'], outputs: ['result'] },
      ],
      executionOrder: ['outline', 'draft'],
      body: '',
    };

    await engine.execute(workflow, {});

    // The second call should have the resolved template with the first step's output
    const secondCallPrompt = mockKernel.runSessionAndReturn.mock.calls[1][0].input;
    expect(secondCallPrompt).toBe('Expand this: outline of the topic');
  });
});
