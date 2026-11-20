import React, { useEffect, useRef } from 'react';
import { Check, X } from '@ui/components/ui/lineIcons';
import { smoothOrInstant } from '@ui/utils/motion';

/**
 * After a big task (payroll locked, payroll approved) the page says so in a green note at the
 * top, and you stay where you were (owner's pick, 17 Nov 2026). Small saves keep the toast.
 *
 * `title` is the bold first words, `children` what happens next, `action` an optional
 * { label, onClick } link, `onClose` hides it.
 */
export default function SuccessNote({ title, children = null, action = null, onClose }) {
  const ref = useRef(null);
  /* Bring it into view: the button that caused it may be far down the page. */
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: smoothOrInstant() }); }, [title]);
  return (
    <div ref={ref} className="ui-success-note" role="status">
      <span className="ui-success-note-tick" aria-hidden="true"><Check size={14} /></span>
      <p className="min-w-0 flex-1 text-sm"><b>{title}</b>{children ? <> {children}</> : null}</p>
      {action ? <button type="button" className="ui-link text-sm" onClick={action.onClick}>{action.label}</button> : null}
      {onClose ? <button type="button" className="ui-icon-btn" aria-label="Close note" onClick={onClose}><X size={16} aria-hidden="true" /></button> : null}
    </div>
  );
}
