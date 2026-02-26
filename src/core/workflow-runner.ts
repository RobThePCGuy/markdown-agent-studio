import type { Kernel } from './kernel';
import type { EventLogState } from '../stores/event-log';

type Store<T> = { getState(): T };

export interface WorkflowRunnerDeps {
  kernel: Kernel;
  eventLog: Store<EventLogState>;
  workflowPath: string;
}

/**
 * Creates a StepRunner function compatible with WorkflowEngine.
 * Each step is executed by calling kernel.runSessionAndReturn() with the
 * resolved prompt, and workflow_step events are emitted before/after.
 */
export function createStepRunner(deps: WorkflowRunnerDeps) {
  return async (
    stepId: string,
    resolvedPrompt: string,
    agentPath: string,
    _context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const activationId = `wf-${deps.workflowPath}-${stepId}`;

    // Emit step-running event
    deps.eventLog.getState().append({
      type: 'workflow_step',
      agentId: agentPath,
      activationId,
      data: { workflowPath: deps.workflowPath, stepId, status: 'running' },
    });

    // Execute the agent via kernel
    const resultText = await deps.kernel.runSessionAndReturn({
      agentId: agentPath,
      input: resolvedPrompt,
      spawnDepth: 0,
      priority: 0,
    });

    // Emit step-completed event
    deps.eventLog.getState().append({
      type: 'workflow_step',
      agentId: agentPath,
      activationId,
      data: {
        workflowPath: deps.workflowPath,
        stepId,
        status: 'completed',
        resultPreview: resultText.slice(0, 500),
      },
    });

    return { result: resultText, text: resultText };
  };
}
