import React, { useState } from 'react';

import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { importBatches, undoImport } from '@ui/personnel/api';

/**
 * Import employees → Past imports (FEATURE-UI-AUDIT gap 14): the company's
 * last imports, what each did, and Undo while the 24 hours last. Undoing
 * removes the people an import added and puts back the people it changed,
 * except anyone already in payroll or changed by hand since (the server
 * counts those as kept). The list is the whole company's, so a team-limited
 * role does not see it.
 */
const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const UNDO_HOURS = 24;

export default function ImportHistory({ canUndo }) {
  const req = useRequest(() => importBatches(), []);
  const [busy, setBusy] = useState(null);
  if (req.loading) return null;
  /* A role limited to its team is refused the company's list: nothing to show, not an error. */
  if (req.error?.status === 403) return null;
  const rows = req.data || [];
  if (!req.error && !rows.length) return null;
  const undo = async (b) => {
    if (!(await confirmDialog({ title: `Undo the import of ${when(b.createdAt)}?`, message: 'The people it added are removed with their history; the people it changed go back to what they were.', confirmLabel: 'Undo' }))) return;
    setBusy(b.id);
    try {
      const r = await undoImport(b.id);
      notify.success(`Undone: ${r.removed} removed, ${r.restored} put back${r.kept ? `, ${r.kept} kept` : ''}.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not undone.'));
    } finally {
      setBusy(null);
      req.reload();
    }
  };
  return (
    <section className="space-y-2 pt-2" aria-label="Past imports">
      <h2 className="ui-t-sec">Past imports</h2>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : (
        <ul className="divide-y border-t text-sm">
          {rows.map((b) => {
            const until = new Date(new Date(b.createdAt).getTime() + UNDO_HOURS * 3_600_000);
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums whitespace-nowrap">{when(b.createdAt)}</span>
                <span className="min-w-0 flex-1">
                  {[b.created ? `${b.created} added` : null, b.updated ? `${b.updated} updated` : null, b.failed ? `${b.failed} not imported` : null].filter(Boolean).join(', ') || 'Nothing changed'}
                  <span className="block ui-caption">{b.undoneAt ? `Undone ${when(b.undoneAt)}` : b.canUndo ? `Can be undone until ${when(until)}` : 'Older than a day: correct people by hand'}</span>
                </span>
                {b.undoneAt ? <span className="ui-pill ui-pill-neutral">Undone</span> : null}
                {canUndo && b.canUndo ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === b.id} onClick={() => undo(b)}>{busy === b.id ? 'Undoing…' : 'Undo'}</button> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
