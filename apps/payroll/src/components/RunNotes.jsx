import React, { useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { NEXT_NOTE_HINT, NEXT_NOTE_LABEL, earlierNoteTitle } from '@ui/picks/payLines';
import { saveNoteForNext } from '../api/payrollRuns';

/** The note last month's payroll left for this one, at the top of the run (picks round 32). */
export function EarlierNote({ note }) {
  if (!note?.text) return null;
  return (
    <section className="space-y-1" role="note" aria-label="Note from last month's payroll" style={{ borderBottom: '1px solid rgb(var(--border))', paddingBottom: '0.75rem' }}>
      <div className="ui-sec-head">{earlierNoteTitle(note)}</div>
      <p className="text-sm whitespace-pre-line">{note.text}</p>
    </section>
  );
}

/** A note this payroll leaves for next month's: saved on its own, at any stage but cancelled. */
export function NextMonthNote({ run, onSaved }) {
  const [text, setText] = useState(run.noteForNext || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(run.noteForNext || ''), [run.id, run.noteForNext]);
  if (run.status === 'CANCELLED') return null;
  const changed = text.trim() !== (run.noteForNext || '').trim();
  const save = async () => {
    setBusy(true);
    try {
      await saveNoteForNext(run.id, text.trim());
      notify.success(text.trim() ? 'Saved for next month.' : 'Note cleared.');
      onSaved?.();
    } catch (e) {
      notify.error(String(e?.message || 'Could not save the note.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-1.5">
      <label className="block">
        <span className="ui-label">{NEXT_NOTE_LABEL}</span>
        <textarea className="ui-input w-full" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Ravi's arrears are due in May" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="ui-caption">{NEXT_NOTE_HINT}</span>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !changed} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
      </div>
    </section>
  );
}
