import type { WorkflowDefinition } from './workflow-parser';

type StepRunner = (
  stepId: string,
  prompt: string,
  agentPath: string,
  context: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export interface WorkflowEngineConfig {
  runStep: StepRunner;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export class WorkflowEngine {
  private config: WorkflowEngineConfig;
  private stepStatuses = new Map<string, StepStatus>();
  private stepOutputs = new Map<string, Record<string, unknown>>();

  constructor(config: WorkflowEngineConfig) {
    this.config = config;
  }

  getStatus(): Record<string, StepStatus> {
    const result: Record<string, StepStatus> = {};
    for (const [id, status] of this.stepStatuses) {
      result[id] = status;
    }
    return result;
  }

  async execute(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, Record<string, unknown>>> {
    this.stepStatuses.clear();
    this.stepOutputs.clear();

    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

    for (const stepId of workflow.executionOrder) {
      if (signal?.aborted) {
        throw new Error('Workflow aborted');
      }

      const step = stepMap.get(stepId);
      if (!step) continue;

      this.stepStatuses.set(stepId, 'running');

      const context: Record<string, unknown> = { ...variables };
      for (const depId of step.dependsOn) {
        const depOutput = this.stepOutputs.get(depId);
        if (depOutput) {
          context[depId] = depOutput;
        }
      }

      const resolvedPrompt = resolveTemplate(step.prompt, context);

      try {
        const output = await this.config.runStep(stepId, resolvedPrompt, step.agent, context);
        this.stepOutputs.set(stepId, output);
        this.stepStatuses.set(stepId, 'completed');
      } catch (err) {
        this.stepStatuses.set(stepId, 'failed');
        throw err;
      }
    }

    const allOutputs: Record<string, Record<string, unknown>> = {};
    for (const [id, output] of this.stepOutputs) {
      allOutputs[id] = output;
    }
    return allOutputs;
  }

  async resumeFrom(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown>,
    completedOutputs: Record<string, Record<string, unknown>>
  ): Promise<Record<string, Record<string, unknown>>> {
    this.stepStatuses.clear();
    this.stepOutputs.clear();

    // Pre-populate from completed outputs
    for (const [stepId, output] of Object.entries(completedOutputs)) {
      this.stepOutputs.set(stepId, output);
      this.stepStatuses.set(stepId, 'completed');
    }

    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

    for (const stepId of workflow.executionOrder) {
      // Skip already-completed steps
      if (this.stepStatuses.get(stepId) === 'completed') continue;

      const step = stepMap.get(stepId);
      if (!step) continue;

      this.stepStatuses.set(stepId, 'running');

      const context: Record<string, unknown> = { ...variables };
      for (const depId of step.dependsOn) {
        const depOutput = this.stepOutputs.get(depId);
        if (depOutput) {
          context[depId] = depOutput;
        }
      }

      const resolvedPrompt = resolveTemplate(step.prompt, context);

      try {
        const output = await this.config.runStep(stepId, resolvedPrompt, step.agent, context);
        this.stepOutputs.set(stepId, output);
        this.stepStatuses.set(stepId, 'completed');
      } catch (err) {
        this.stepStatuses.set(stepId, 'failed');
        throw err;
      }
    }

    const allOutputs: Record<string, Record<string, unknown>> = {};
    for (const [id, output] of this.stepOutputs) {
      allOutputs[id] = output;
    }
    return allOutputs;
  }
}

function resolveTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\.(\w+)\}/g, (match, stepId, key) => {
    const stepOutput = context[stepId];
    if (stepOutput && typeof stepOutput === 'object' && key in (stepOutput as any)) {
      return String((stepOutput as any)[key]);
    }
    return match;
  }).replace(/\{(\w+)\}/g, (match, key) => {
    if (key in context && typeof context[key] !== 'object') {
      return String(context[key]);
    }
    return match;
  });
}
