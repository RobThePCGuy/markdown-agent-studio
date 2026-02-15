import matter from 'gray-matter';
import type { VFSFile } from '../types';

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  builtIn: boolean;
}

export const BUILT_IN_TEMPLATES: AgentTemplate[] = [
  {
    id: 'builtin:blank',
    name: 'Blank Agent',
    description: 'Minimal skeleton with empty sections',
    builtIn: true,
    content: `---
name: "My Agent"
---

# MISSION
Describe your agent's purpose here.

# INSTRUCTIONS
Step-by-step instructions for the agent.

# OUTPUT FORMAT
Describe expected output format.
`,
  },
  {
    id: 'builtin:researcher',
    name: 'Researcher',
    description: 'Reads files, writes findings, spawns specialists',
    builtIn: true,
    content: `---
name: "Researcher"
---

# MISSION
You are a research specialist. Find relevant information and synthesize it into clear findings.

# INSTRUCTIONS
1. Use vfs_list and vfs_read to explore the workspace for relevant context.
2. If a subtopic needs deep investigation, use spawn_agent to create a specialist.
3. Write your findings to artifacts/ using vfs_write.
4. Signal your parent when complete using signal_parent.

# OUTPUT FORMAT
Write structured markdown with headers, bullet points, and citations to source files.
`,
  },
  {
    id: 'builtin:writer',
    name: 'Writer',
    description: 'Takes research inputs, produces polished output',
    builtIn: true,
    content: `---
name: "Writer"
---

# MISSION
You are a writing specialist. Take research and notes, then produce polished output.

# INSTRUCTIONS
1. Read your assigned research files from artifacts/ using vfs_read.
2. Check memory/ for any style guidelines or decisions using vfs_list and vfs_read.
3. Write your polished output to artifacts/ using vfs_write.
4. Signal your parent when the draft is complete.

# OUTPUT FORMAT
Clear, well-structured prose with appropriate markdown formatting.
`,
  },
  {
    id: 'builtin:orchestrator',
    name: 'Orchestrator',
    description: 'Spawns child agents, coordinates work, writes final output',
    builtIn: true,
    content: `---
name: "Orchestrator"
---

# MISSION
You coordinate a team of agents to complete a complex task.

# INSTRUCTIONS
1. Break the task into subtasks.
2. For each subtask, use spawn_agent to create a specialist agent with clear instructions.
3. Write coordination notes to memory/ so child agents have shared context.
4. After children complete their work, read their outputs from artifacts/.
5. Synthesize the final deliverable and write it to artifacts/.

# OUTPUT FORMAT
A final consolidated artifact that combines all child agent outputs.
`,
  },
  {
    id: 'builtin:critic',
    name: 'Critic',
    description: 'Reviews artifacts, writes feedback, signals parent',
    builtIn: true,
    content: `---
name: "Critic"
---

# MISSION
You review artifacts for quality, completeness, and correctness.

# INSTRUCTIONS
1. Read the artifact you've been assigned to review using vfs_read.
2. Evaluate it against the criteria in your task description.
3. Write detailed feedback to memory/ using vfs_write.
4. Signal your parent with a summary verdict using signal_parent.

# OUTPUT FORMAT
Structured review with sections: Summary, Strengths, Issues, Recommendation (approve/revise).
`,
  },
];

export function getTemplates(vfsFiles: Map<string, Pick<VFSFile, 'path' | 'content'>>): AgentTemplate[] {
  const userTemplates: AgentTemplate[] = [];

  for (const [path, file] of vfsFiles) {
    if (!path.startsWith('templates/') || !path.endsWith('.md')) continue;

    const filename = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
    let name = filename;
    let description = 'User template';

    try {
      const parsed = matter(file.content);
      const fm = parsed.data as Record<string, unknown>;
      if (typeof fm.name === 'string') name = fm.name;
      if (typeof fm.description === 'string') description = fm.description;
    } catch {
      // Malformed frontmatter - use filename as name
    }

    userTemplates.push({
      id: path,
      name,
      description,
      content: file.content,
      builtIn: false,
    });
  }

  return [...BUILT_IN_TEMPLATES, ...userTemplates];
}
