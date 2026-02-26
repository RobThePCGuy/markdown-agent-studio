import { useState, useEffect, useCallback, useRef } from 'react';
import { useUI, uiStore } from '../../stores/use-stores';
import styles from './WorkflowVariableModal.module.css';

export default function WorkflowVariableModal() {
  const modal = useUI((s) => s.workflowVariableModal);
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Reset local values whenever the modal opens with new variables
  const [prevModal, setPrevModal] = useState(modal);
  if (modal !== prevModal) {
    setPrevModal(modal);
    if (modal) {
      const initial: Record<string, string> = {};
      for (const v of modal.variables) initial[v] = '';
      setValues(initial);
    }
  }

  // Auto-focus first input when modal opens
  useEffect(() => {
    if (modal) {
      // Slight delay to allow DOM to render
      const id = requestAnimationFrame(() => {
        firstInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [modal]);

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      uiStore.getState().setWorkflowVariableModal(null);
    }
  }, []);

  useEffect(() => {
    if (modal) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [modal, handleKeyDown]);

  if (!modal) return null;

  const close = () => uiStore.getState().setWorkflowVariableModal(null);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  const allFilled = modal.variables.every((v) => (values[v] ?? '').trim() !== '');

  const handleSubmit = () => {
    if (!allFilled) return;
    modal.onSubmit(values);
    uiStore.getState().setWorkflowVariableModal(null);
  };

  // Derive a display name from the workflow path
  const workflowName = (() => {
    const segments = modal.workflowPath.split('/');
    const last = segments[segments.length - 1] || modal.workflowPath;
    return last.replace(/\.\w+$/, '');
  })();

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Run: {workflowName}</h2>
          <button
            onClick={close}
            className={styles.closeBtn}
            aria-label="Close workflow variable modal"
          >
            x
          </button>
        </div>

        {/* Variable inputs */}
        {modal.variables.map((varName, i) => (
          <label key={varName} className={styles.label}>
            <span className={styles.labelText}>{varName}</span>
            <input
              ref={i === 0 ? firstInputRef : undefined}
              type="text"
              value={values[varName] ?? ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [varName]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && allFilled) handleSubmit();
              }}
              placeholder={`Enter value for ${varName}`}
              className={styles.variableInput}
            />
          </label>
        ))}

        {/* Buttons */}
        <div className={styles.buttonRow}>
          <button onClick={close} className={styles.cancelBtn}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allFilled}
            className={styles.primaryBtn}
          >
            Run Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
