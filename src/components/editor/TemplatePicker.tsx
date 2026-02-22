import { useMemo, useState, useRef, useEffect } from 'react';
import { useVFS } from '../../stores/use-stores';
import {
  getTemplates,
  extractFrontmatterBlock,
  type AgentTemplate,
} from '../../utils/agent-templates';
import styles from './TemplatePicker.module.css';

interface TemplatePickerProps {
  onSelect: (template: AgentTemplate) => void;
}

export function TemplatePicker({ onSelect }: TemplatePickerProps) {
  const filesMap = useVFS((s) => s.files);
  const [open, setOpen] = useState(false);
  const [copiedTemplateId, setCopiedTemplateId] = useState<string | null>(null);
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

  const fallbackCopy = (value: string): boolean => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyFrontmatter = async (template: AgentTemplate) => {
    const frontmatter = extractFrontmatterBlock(template.content);
    if (!frontmatter) return;
    const textToCopy = `${frontmatter}\n`;

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = fallbackCopy(textToCopy);
    }

    if (!copied) return;
    setCopiedTemplateId(template.id);
    window.setTimeout(() => {
      setCopiedTemplateId((id) => (id === template.id ? null : id));
    }, 1200);
  };

  const renderTemplateItem = (template: AgentTemplate) => (
    <div key={template.id} className={styles.itemRow}>
      <div
        onClick={() => { onSelect(template); setOpen(false); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(template);
            setOpen(false);
          }
        }}
        className={styles.item}
      >
        <div className={styles.itemName}>{template.name}</div>
        <div className={styles.itemDesc}>{template.description}</div>
      </div>
      <button
        type="button"
        className={styles.copyBtn}
        title="Copy frontmatter"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleCopyFrontmatter(template);
        }}
      >
        {copiedTemplateId === template.id ? 'Copied' : 'Copy FM'}
      </button>
    </div>
  );

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
          {builtIns.map((t) => renderTemplateItem(t))}

          {userTemplates.length > 0 && (
            <>
              <div className={styles.divider} />
              <div className={styles.sectionLabel}>
                My Templates
              </div>
              {userTemplates.map((t) => renderTemplateItem(t))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
