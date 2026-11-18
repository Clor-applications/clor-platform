import React from 'react';
import { Check, X } from '@ui/components/ui/lineIcons';
import { bulkOutcomeLine } from '../../picks/round57';

/**
 * Round 57 bulkresult A: after acting on many rows, what went through and,
 * for each one that did not, whose it was and why — nothing silently skipped.
 * Stays until closed; a plain success is a toast instead.
 */
export default function BulkOutcome({ outcome, verb = 'approved', onClose }) {
  if (!outcome || !outcome.failed?.length) return null;
  return (
    <section className="ui-bulk-outcome" role="status" aria-label="What happened to the chosen requests">
      <div className="ui-bulk-outcome-head">
        <span className="ui-bulk-outcome-line">
          {outcome.done ? <Check size={16} aria-hidden="true" /> : null}
          {bulkOutcomeLine(outcome, verb)}
        </span>
        {onClose ? <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button> : null}
      </div>
      <ul className="ui-bulk-outcome-list">
        {outcome.failed.map((f, i) => (
          <li key={`${f.id || i}`}><span className="font-medium">{f.name}</span><span className="ui-muted"> — {f.reason}</span></li>
        ))}
      </ul>
    </section>
  );
}
