import { useMemo, useState, useRef, useEffect } from 'react';
import { useVFS } from '../../stores/use-stores';
import { getTemplates, type AgentTemplate } from '../../utils/agent-templates';
import styles from './TemplatePicker.module.css';

interface TemplatePickerProps {
  onSelect: (template: AgentTemplate) => void;
}

export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  const filesMap = useVFS((s) => s.files);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const templates = useMemo(() => getTemplates(filesMap), [filesMap]);
  const builtIns = templates.filter((t) => t.builtIn);
  const userTemplates = templates.filter((t) => !t.builtIn);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={dropdownRef} className={styles.wrapper}>
      <button
        onClick={() => setOpen(!open)}
        className={styles.trigger}
      >
        New from template...
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.sectionLabel}>
            Built-in
          </div>
          {builtIns.map((t) => (
            <div
              key={t.id}
              onClick={() => { onSelect(t); setOpen(false); }}
              className={styles.item}
            >
              <div className={styles.itemName}>{t.name}</div>
              <div className={styles.itemDesc}>{t.description}</div>
            </div>
          ))}

          {userTemplates.length > 0 && (
            <>
              <div className={styles.divider} />
              <div className={styles.sectionLabel}>
                My Templates
              </div>
              {userTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => { onSelect(t); setOpen(false); }}
                  className={styles.item}
                >
                  <div className={styles.itemName}>{t.name}</div>
                  <div className={styles.itemDesc}>{t.description}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
