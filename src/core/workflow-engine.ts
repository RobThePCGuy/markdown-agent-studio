import type { WorkflowDefinition } from './workflow-parser';

type StepRunner = (
  stepId: string,
  prompt: string,
  agentPath: string,
  context: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export interface WorkflowEngineConfig {
  runStep: StepRunner;
  maxParallelSteps?: number;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export class WorkflowEngine {
  private config: WorkflowEngineConfig;
  private stepStatuses = new Map<string, StepStatus>();
  private stepOutputs = new Map<string, Record<string, unknown>>();
  private stepOrderIndex = new Map<string, number>();

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

  getOutputs(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [id, output] of this.stepOutputs) {
      result[id] = output;
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
    this.seedStepOrder(workflow);
    await this.executePending(workflow, variables, signal);
    return this.getOutputs();
  }

  async resumeFrom(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown>,
    completedOutputs: Record<string, Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<Record<string, Record<string, unknown>>> {
    this.stepStatuses.clear();
    this.stepOutputs.clear();
    this.seedStepOrder(workflow);

    // Pre-populate from completed outputs
    for (const [stepId, output] of Object.entries(completedOutputs)) {
      this.stepOutputs.set(stepId, output);
      this.stepStatuses.set(stepId, 'completed');
    }
    await this.executePending(workflow, variables, signal);
    return this.getOutputs();
  }

  private seedStepOrder(workflow: WorkflowDefinition): void {
    this.stepOrderIndex.clear();
    workflow.executionOrder.forEach((id, i) => this.stepOrderIndex.set(id, i));
  }

  private maxParallelSteps(): number {
    const raw = this.config.maxParallelSteps ?? 1;
    return Math.max(1, Math.floor(raw));
  }

  private async executePending(
    workflow: WorkflowDefinition,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    const pending = new Set(
      workflow.executionOrder.filter((stepId) => this.stepStatuses.get(stepId) !== 'completed'),
    );
    const maxParallel = this.maxParallelSteps();

    while (pending.size > 0) {
      if (signal?.aborted) {
        throw new Error('Workflow aborted');
      }
      const ready = [...pending]
        .filter((stepId) => {
          const step = stepMap.get(stepId);
          if (!step) return false;
          return step.dependsOn.every((depId) => this.stepStatuses.get(depId) === 'completed');
        })
        .sort(
          (a, b) =>
            (this.stepOrderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (this.stepOrderIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
        );

      if (ready.length === 0) {
        throw new Error('Workflow deadlock: pending steps have unsatisfied dependencies');
      }

      const batch = ready.slice(0, maxParallel);
      const results = await Promise.allSettled(
        batch.map(async (stepId) => {
          const step = stepMap.get(stepId);
          if (!step) return null;

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
            return { stepId, output };
          } catch (err) {
            this.stepStatuses.set(stepId, 'failed');
            throw err;
          }
        }),
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        if (!result.value) continue;
        this.stepOutputs.set(result.value.stepId, result.value.output);
        this.stepStatuses.set(result.value.stepId, 'completed');
        pending.delete(result.value.stepId);
      }

      const firstRejected = results.find((r) => r.status === 'rejected');
      if (firstRejected && firstRejected.status === 'rejected') {
        throw firstRejected.reason;
      }
    }
  }
}

function resolveTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\.(\w+)\}/g, (match, stepId, key) => {
    const stepOutput = context[stepId];
    if (stepOutput && typeof stepOutput === 'object' && key in (stepOutput as Record<string, unknown>)) {
      return String((stepOutput as Record<string, unknown>)[key]);
    }
    return match;
  }).replace(/\{(\w+)\}/g, (match, key) => {
    if (key in context && typeof context[key] !== 'object') {
      return String(context[key]);
    }
    return match;
  });
}
