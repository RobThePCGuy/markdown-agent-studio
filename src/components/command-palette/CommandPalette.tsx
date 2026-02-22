import { useState, useEffect, useRef, useMemo } from 'react';
import { useAgentRegistry, useVFS, useUI, uiStore, vfsStore, agentRegistry } from '../../stores/use-stores';
import { runController } from '../../core/run-controller';
import { filterCommands, type SearchableCommand } from '../../utils/command-palette';
import { nextSequentialPath } from '../../utils/path-naming';
import {
  dispatchRunControlEvent,
  FOCUS_PROMPT_EVENT,
  KILL_ALL_EVENT,
  RUN_AUTONOMOUS_EVENT,
  RUN_ONCE_EVENT,
  TOGGLE_PAUSE_EVENT,
} from '../../core/run-control-events';
import styles from './CommandPalette.module.css';

interface CommandItem extends SearchableCommand {
  action: () => void;
}

function useCommands(
  onClose: () => void,
  runState: ReturnType<typeof runController.getState>,
): CommandItem[] {
  const agents = useAgentRegistry((s) => s.agents);
  const files = useVFS((s) => s.files);
  const selectedAgentId = useUI((s) => s.selectedAgentId);

  return useMemo(() => {
    const cmds: CommandItem[] = [];
    const dispatch = (eventName: string) => {
      dispatchRunControlEvent(eventName);
      onClose();
    };
    const selectedAgentName = selectedAgentId
      ? agents.get(selectedAgentId)?.name ?? selectedAgentId
      : 'selected agent';

    cmds.push({
      id: 'focus-prompt',
      label: 'Focus Run Prompt',
      category: 'Actions',
      hint: 'Ctrl/Cmd+Shift+L',
      keywords: ['prompt', 'focus', 'kickoff', 'input'],
      action: () => dispatch(FOCUS_PROMPT_EVENT),
    });

    cmds.push({
      id: 'run-once',
      label: `Run ${selectedAgentName} (Once)`,
      category: 'Actions',
      hint: 'Ctrl/Cmd+Enter',
      keywords: ['run', 'start', 'once', 'execute'],
      action: () => dispatch(RUN_ONCE_EVENT),
    });

    cmds.push({
      id: 'run-autonomous',
      label: `Run ${selectedAgentName} (Autonomous)`,
      category: 'Actions',
      hint: 'Ctrl/Cmd+Shift+Enter',
      keywords: ['run', 'autonomous', 'cycle', 'execute'],
      action: () => dispatch(RUN_AUTONOMOUS_EVENT),
    });

    cmds.push({
      id: 'new-agent',
      label: 'Create New Agent',
      category: 'Actions',
      hint: 'agents/untitled-*.md',
      keywords: ['create', 'new', 'agent', 'file'],
      action: () => {
        const path = nextSequentialPath('agents/untitled', '.md', files.keys());
        const content = '---\nname: "Untitled Agent"\n---\n\nDescribe this agent\'s behavior here.';
        vfsStore.getState().write(path, content, {});
        agentRegistry.getState().registerFromFile(path, content);
        uiStore.getState().setSelectedAgent(path);
        uiStore.getState().openFileInEditor(path);
        onClose();
      },
    });

    cmds.push({
      id: 'new-note',
      label: 'Create New Note',
      category: 'Actions',
      hint: 'artifacts/note-*.md',
      keywords: ['create', 'new', 'note', 'artifact'],
      action: () => {
        const path = nextSequentialPath('artifacts/note', '.md', files.keys());
        vfsStore.getState().write(path, '# Notes\n\n', {});
        uiStore.getState().setSelectedFile(path);
        uiStore.getState().openFileInEditor(path);
        onClose();
      },
    });

    for (const agent of agents.values()) {
      cmds.push({
        id: `select-${agent.path}`,
        label: `Select ${agent.name}`,
        category: 'Agents',
        hint: agent.path,
        keywords: [agent.name, agent.path, 'select'],
        action: () => { uiStore.getState().setSelectedAgent(agent.path); onClose(); },
      });
      cmds.push({
        id: `edit-${agent.path}`,
        label: `Edit ${agent.name}`,
        category: 'Agents',
        hint: agent.path,
        keywords: [agent.name, agent.path, 'edit', 'open'],
        action: () => { uiStore.getState().openFileInEditor(agent.path); onClose(); },
      });
    }

    cmds.push({
      id: 'toggle-pause',
      label: runState.isPaused ? 'Resume Run' : 'Pause Run',
      category: 'Actions',
      hint: 'Ctrl/Cmd+Shift+P',
      keywords: ['run', 'pause', 'resume', 'toggle'],
      action: () => dispatch(TOGGLE_PAUSE_EVENT),
    });
    cmds.push({
      id: 'kill',
      label: 'Kill All',
      category: 'Actions',
      hint: 'Ctrl/Cmd+Shift+K',
      keywords: ['run', 'abort', 'stop'],
      action: () => dispatch(KILL_ALL_EVENT),
    });

    cmds.push({ id: 'nav-graph', label: 'Switch to Graph', category: 'Navigation', keywords: ['tab', 'graph'], action: () => { uiStore.getState().setActiveTab('graph'); onClose(); } });
    cmds.push({ id: 'nav-editor', label: 'Switch to Editor', category: 'Navigation', keywords: ['tab', 'editor'], action: () => { uiStore.getState().setActiveTab('editor'); onClose(); } });
    cmds.push({ id: 'nav-settings', label: 'Open Settings', category: 'Navigation', keywords: ['preferences', 'config'], action: () => { uiStore.getState().setSettingsOpen(true); onClose(); } });

    for (const path of files.keys()) {
      cmds.push({
        id: `open-${path}`,
        label: `Open ${path}`,
        category: 'Files',
        hint: path,
        keywords: [path, 'file', 'open'],
        action: () => { uiStore.getState().openFileInEditor(path); onClose(); },
      });
    }

    return cmds;
  }, [agents, files, onClose, runState.isPaused, selectedAgentId]);
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runState, setRunState] = useState(runController.getState());
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useCommands(onClose, runState);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
  const visibleCommands = filtered.slice(0, 20);
  const activeIndex = Math.min(selectedIndex, Math.max(visibleCommands.length - 1, 0));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => runController.subscribe(setRunState), []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, visibleCommands.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && visibleCommands[activeIndex]) {
      visibleCommands[activeIndex].action();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command (agent:, file:, action:, nav:)"
          className={styles.searchInput}
        />
        <div className={styles.list}>
          {visibleCommands.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`${styles.item}${i === activeIndex ? ` ${styles.selected}` : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className={styles.itemCategory}>{cmd.category}</span>
              <div className={styles.itemMeta}>
                <span className={styles.itemLabel}>{cmd.label}</span>
                {cmd.hint && <span className={styles.itemHint}>{cmd.hint}</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={styles.empty}>No matching commands</div>
          )}
        </div>
        <div className={styles.footer}>
          <span>Scopes: agent: file: action: nav: | Run: Ctrl/Cmd+Enter</span>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
