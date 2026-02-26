import type { WorkflowDefinition } from './workflow-parser';

/**
 * Extract user-supplied variable names from a workflow definition.
 *
 * The workflow engine's `resolveTemplate` does two-pass replacement:
 *   1. `{stepId.key}` -- step output references (dot notation)
 *   2. `{varName}`     -- input variables (single word, no dot)
 *
 * This function finds all `{word}` tokens in step prompts that are
 * NOT step-output references and NOT step IDs themselves.
 */
export function extractWorkflowVariables(workflow: WorkflowDefinition): string[] {
  const stepIds = new Set(workflow.steps.map((s) => s.id));
  const variables = new Set<string>();

  const dotRefPattern = /\{\w+\.\w+\}/g;
  const varPattern = /\{(\w+)\}/g;

  for (const step of workflow.steps) {
    // Strip dot-references first so they don't partially match the var pattern
    const cleaned = step.prompt.replace(dotRefPattern, '');

    let match: RegExpExecArray | null;
    varPattern.lastIndex = 0;
    while ((match = varPattern.exec(cleaned)) !== null) {
      const name = match[1];
      if (!stepIds.has(name)) {
        variables.add(name);
      }
    }
  }

  return [...variables].sort();
}
