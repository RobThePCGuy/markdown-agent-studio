import type { ToolDeclaration } from '../types';

export const AGENT_TOOLS: ToolDeclaration[] = [
  {
    name: 'spawn_agent',
    description:
      'Create a new agent by writing a markdown file to agents/. ' +
      'The content should start with YAML frontmatter between --- delimiters ' +
      '(with at least a "name" field), followed by markdown instructions. ' +
      'Example frontmatter: ---\\nname: "Researcher"\\nmodel: "gemini"\\n---\\n\\n# MISSION\\n...',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename for the new agent, e.g. "researcher.md"' },
        content: { type: 'string', description: 'Full markdown content with optional YAML frontmatter' },
        task: { type: 'string', description: 'The initial task/prompt to give the new agent' },
      },
      required: ['filename', 'content', 'task'],
    },
  },
  {
    name: 'vfs_read',
    description: 'Read a file from the workspace. Returns file content or an error with suggestions.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root, e.g. "artifacts/plan.md"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'vfs_write',
    description: 'Write or overwrite a file in the workspace. Use for artifacts, memory, or agent files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'vfs_list',
    description: 'List files matching a path prefix. Returns an array of file paths.',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Path prefix, e.g. "agents/" or "artifacts/"' },
      },
      required: ['prefix'],
    },
  },
  {
    name: 'vfs_delete',
    description: 'Delete a file from the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'signal_parent',
    description: 'Send a message to the agent that spawned you. The parent will be re-activated with your message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send to parent agent' },
      },
      required: ['message'],
    },
  },
];
