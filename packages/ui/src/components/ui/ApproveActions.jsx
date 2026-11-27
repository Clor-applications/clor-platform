import React from 'react';
import { Check, X } from './lineIcons';

/**
 * Tick and cross approval buttons (DESIGN.md "Approvals"; design audit G1).
 *
 * The owner's style for People, Payroll, Attendance and Workspace: a round tick that
 * approves and a round cross that rejects, side by side at the end of a row. Books keeps
 * its secondary Approve and text Reject and does not use this.
 *
 * `what` names the thing being decided ("leave for Rohan Deshpande"), so a screen reader
 * hears "Approve leave for Rohan Deshpande" rather than a bare "Approve". `busy` shows a
 * spinner on the tick and holds both buttons while the request is out. Clicks stop at the
 * buttons, so a row that opens on click does not open as well.
 */
export function ApproveActions({ what = '', onApprove, onReject, busy = false, disabled = false, showLabels = false, approveTitle = 'Approve', rejectTitle = 'Reject', className = '' }) {
  const object = what ? ` ${what}` : '';
  const off = busy || disabled;
  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(e); };
  return (
    <span className={`ui-decide ${className}`.trim()} role="group" aria-label={what ? `Decide${object}` : 'Decide'}>
      {onApprove ? (
        <button type="button" className="ui-decide-btn is-yes" disabled={off} aria-busy={busy || undefined} aria-label={`Approve${object}`} title={approveTitle} onClick={stop(onApprove)}>
          {busy ? <span className="ui-spinner" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          {showLabels && 'Approve'}
        </button>
      ) : null}
      {onReject ? (
        <button type="button" className="ui-decide-btn is-no" disabled={off} aria-label={`Reject${object}`} title={rejectTitle} onClick={stop(onReject)}>
          <X size={16} aria-hidden="true" />
          {showLabels && 'Reject'}
        </button>
      ) : null}
    </span>
  );
}

export default ApproveActions;
