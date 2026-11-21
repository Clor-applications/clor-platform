import React, { useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { Button } from '@ui/components/ui/Primitives';
import { markDay, setExceptionState } from '../api/attendance';
import { errorWords } from '@ui/utils/errorWords';

/*
 * Round 59 picks (18 Nov 2026), Attendance side.
 *
 * attexceptions A: a working day with no attendance is decided on the spot,
 * from the list of days that need a decision: Present or Unpaid. The day is
 * marked the way Records marks one by hand, then the item is settled.
 */

export const QUICK_FIXES = [
  { status: 'PRESENT', label: 'Present', done: 'Marked present.' },
  { status: 'ABSENT', label: 'Unpaid', done: 'Marked as an unpaid day.' },
];

/** Only a day with nothing on it can be decided from here; a missing check-out needs its time on Records. */
export const canQuickFix = (x) => x?.kind === 'NO_RECORD' && Boolean(x.employeeId && x.date) && (x.status === 'OPEN' || x.status === 'IN_PROGRESS');

export function DayQuickFix({ item, onDone, small = false }) {
  const [busy, setBusy] = useState('');
  if (!canQuickFix(item)) return null;
  const decide = async (f) => {
    if (busy) return;
    setBusy(f.status);
    try {
      await markDay({ employeeId: item.employeeId, date: item.date, checkIn: null, checkOut: null, status: f.status, note: 'Decided from Days that need a decision' });
      await setExceptionState({ key: item.key, status: 'RESOLVED', note: f.label }).catch(() => undefined);
      notify.success(f.done);
      onDone?.();
    } catch (e) {
      notify.error(errorWords(e, 'save the changes'));
    } finally {
      setBusy('');
    }
  };
  const who = [item.employeeName, item.date].filter(Boolean).join(', ');
  return (
    <span className="ui-quickfix" role="group" aria-label={`Decide ${who}`}>
      {QUICK_FIXES.map((f) => (
        <Button key={f.status} variant="secondary" size={small ? 'sm' : undefined} className={small ? '' : 'min-h-[44px]'} loading={busy === f.status} disabled={Boolean(busy) && busy !== f.status} aria-label={`${f.label}: ${who}`} onClick={() => decide(f)}>
          {f.label}
        </Button>
      ))}
    </span>
  );
}
