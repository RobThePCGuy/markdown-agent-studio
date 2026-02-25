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
}

export function parseWorkflow(path: string, markdown: string): WorkflowDefinition {
  const { data: fm, content } = matter(markdown);

  const name = String(fm.name || path);
  const description = String(fm.description || '');
  const trigger = fm.trigger === 'auto' ? 'auto' : 'manual';

  const rawSteps = Array.isArray(fm.steps) ? fm.steps : [];
  const steps: WorkflowStep[] = rawSteps.map((s: any) => ({
    id: String(s.id || ''),
    agent: String(s.agent || ''),
    prompt: String(s.prompt || ''),
    dependsOn: Array.isArray(s.depends_on) ? s.depends_on.map(String) : [],
    outputs: Array.isArray(s.outputs) ? s.outputs.map(String) : [],
  }));

  const executionOrder = topoSort(steps);

  return { path, name, description, trigger, steps, executionOrder, body: content };
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
