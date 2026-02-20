import { useState, useEffect, useRef, useMemo } from 'react';
import { useAgentRegistry, useVFS, uiStore } from '../../stores/use-stores';
import { runController } from '../../core/run-controller';
import styles from './CommandPalette.module.css';

interface CommandItem {
  id: string;
  label: string;
  category: string;
  action: () => void;
}

function useCommands(onClose: () => void): CommandItem[] {
  const agents = useAgentRegistry((s) => s.agents);
  const files = useVFS((s) => s.files);

  return useMemo(() => {
    const cmds: CommandItem[] = [];

    for (const agent of agents.values()) {
      cmds.push({
        id: `select-${agent.path}`,
        label: `Select ${agent.name}`,
        category: 'Agents',
        action: () => { uiStore.getState().setSelectedAgent(agent.path); onClose(); },
      });
      cmds.push({
        id: `edit-${agent.path}`,
        label: `Edit ${agent.name}`,
        category: 'Agents',
        action: () => { uiStore.getState().openFileInEditor(agent.path); onClose(); },
      });
    }

    cmds.push({ id: 'pause', label: 'Pause All', category: 'Actions', action: () => { runController.pause(); onClose(); } });
    cmds.push({ id: 'resume', label: 'Resume All', category: 'Actions', action: () => { runController.resume(); onClose(); } });
    cmds.push({ id: 'kill', label: 'Kill All', category: 'Actions', action: () => { runController.killAll(); onClose(); } });

    cmds.push({ id: 'nav-graph', label: 'Switch to Graph', category: 'Navigation', action: () => { uiStore.getState().setActiveTab('graph'); onClose(); } });
    cmds.push({ id: 'nav-editor', label: 'Switch to Editor', category: 'Navigation', action: () => { uiStore.getState().setActiveTab('editor'); onClose(); } });
    cmds.push({ id: 'nav-settings', label: 'Open Settings', category: 'Navigation', action: () => { uiStore.getState().setSettingsOpen(true); onClose(); } });

    for (const path of files.keys()) {
      cmds.push({
        id: `open-${path}`,
        label: `Open ${path}`,
        category: 'Files',
        action: () => { uiStore.getState().openFileInEditor(path); onClose(); },
      });
    }

    return cmds;
  }, [agents, files, onClose]);
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useCommands(onClose);

  const filtered = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selection when query changes (tracked via previous-value state)
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action();
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
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          className={styles.searchInput}
        />
        <div className={styles.list}>
          {filtered.slice(0, 20).map((cmd, i) => (
            <div
              key={cmd.id}
              className={`${styles.item}${i === selectedIndex ? ` ${styles.selected}` : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className={styles.itemCategory}>{cmd.category}</span>
              <span className={styles.itemLabel}>{cmd.label}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={styles.empty}>No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
