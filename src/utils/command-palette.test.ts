import { describe, it, expect } from 'vitest';
import { filterCommands, type SearchableCommand } from './command-palette';

const commands: SearchableCommand[] = [
  { id: 'a1', label: 'Select Researcher', category: 'Agents', keywords: ['agents/researcher.md'] },
  { id: 'a2', label: 'Open artifacts/report.md', category: 'Files', keywords: ['artifacts/report.md'] },
  { id: 'a3', label: 'Kill All', category: 'Actions', keywords: ['stop', 'abort'] },
  { id: 'a4', label: 'Switch to Graph', category: 'Navigation' },
];

describe('filterCommands', () => {
  it('returns all commands when query is empty', () => {
    const result = filterCommands(commands, '   ');
    expect(result).toHaveLength(4);
  });

  it('supports scoped category queries', () => {
    const result = filterCommands(commands, 'file: report');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('matches against keywords', () => {
    const result = filterCommands(commands, 'researcher.md');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('ranks stronger label matches first', () => {
    const ranked = filterCommands(commands, 'kill');
    expect(ranked[0].id).toBe('a3');
  });
});
