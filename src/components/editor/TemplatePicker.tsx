import { useMemo, useState, useRef, useEffect } from 'react';
import { useVFS } from '../../stores/use-stores';
import { getTemplates, type AgentTemplate } from '../../utils/agent-templates';

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
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: '#89b4fa',
          color: '#1e1e2e',
          border: 'none',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        New from template...
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          background: '#313244',
          borderRadius: 6,
          border: '1px solid #45475a',
          minWidth: 260,
          maxHeight: 320,
          overflow: 'auto',
          zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#6c7086', textTransform: 'uppercase' }}>
            Built-in
          </div>
          {builtIns.map((t) => (
            <div
              key={t.id}
              onClick={() => { onSelect(t); setOpen(false); }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: 12,
                color: '#cdd6f4',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#45475a'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
            >
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: '#6c7086' }}>{t.description}</div>
            </div>
          ))}

          {userTemplates.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid #45475a', margin: '4px 0' }} />
              <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#6c7086', textTransform: 'uppercase' }}>
                My Templates
              </div>
              {userTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => { onSelect(t); setOpen(false); }}
                  style={{
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#cdd6f4',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#45475a'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: '#6c7086' }}>{t.description}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
