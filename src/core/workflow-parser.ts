import matter from 'gray-matter';

export interface WorkflowStep {
  id: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
  outputs: string[];
}

export interface WorkflowDefinition {
  path: string;
  name: string;
  description: string;
  trigger: 'manual' | 'auto';
  steps: WorkflowStep[];
  executionOrder: string[];
  body: string;
  diagnostics: string[];
}

export function parseWorkflow(path: string, markdown: string): WorkflowDefinition {
  const { data: fm, content } = matter(markdown);
  const diagnostics: string[] = [];

  const name = String(fm.name || path);
  const description = String(fm.description || '');
  const trigger = fm.trigger === 'auto' ? 'auto' : 'manual';

  const rawSteps = Array.isArray(fm.steps) ? fm.steps : [];
  const steps: WorkflowStep[] = rawSteps.map((raw, idx) => {
    const s = raw as Record<string, unknown>;
    const id = String(s.id || '').trim();
    const agent = String(s.agent || '').trim();
    const prompt = String(s.prompt || '').trim();
    const dependsOn = Array.isArray(s.depends_on)
      ? s.depends_on.map((dep) => String(dep).trim()).filter(Boolean)
      : [];
    const outputs = Array.isArray(s.outputs)
      ? [...new Set(s.outputs.map((out) => String(out).trim()).filter(Boolean))]
      : [];

    if (!id) diagnostics.push(`Step #${idx + 1} is missing a non-empty "id".`);
    if (!agent) diagnostics.push(`Step "${id || `#${idx + 1}`}" is missing a non-empty "agent".`);
    if (!prompt) diagnostics.push(`Step "${id || `#${idx + 1}`}" is missing a non-empty "prompt".`);

    return { id, agent, prompt, dependsOn, outputs };
  });

  if (steps.length === 0) {
    diagnostics.push('Workflow must define at least one step in frontmatter "steps".');
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const step of steps) {
    if (!step.id) continue;
    if (seen.has(step.id)) {
      duplicates.add(step.id);
    } else {
      seen.add(step.id);
    }
  }
  if (duplicates.size > 0) {
    diagnostics.push(`Duplicate step id(s): ${[...duplicates].join(', ')}`);
  }

  if (diagnostics.length > 0) {
    throw new Error(`Invalid workflow "${path}": ${diagnostics.join(' ')}`);
  }

  const executionOrder = topoSort(steps);

  return { path, name, description, trigger, steps, executionOrder, body: content, diagnostics };
}

function topoSort(steps: WorkflowStep[]): string[] {
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    graph.set(step.id, new Set());
    inDegree.set(step.id, 0);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!graph.has(dep)) throw new Error(`Unknown dependency "${dep}" in step "${step.id}"`);
      graph.get(dep)!.add(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (order.length !== steps.length) {
    throw new Error('Circular dependency detected in workflow steps');
  }

  return order;
}
