import React, { useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';

import { amountFigure, isHourly } from '@ui/timeOff/partOfDay';
import { useCanActForSelf } from '@ui/timeOff/shared';
import { getMyLeave } from '../../../attendance/src/api/attendance';

/*
 * People → Home, the reader's own leave (24 Nov 2026, from the reference products in
 * DESIGN.md: a home page shows your own days left and lets you ask for leave from it).
 * Shown only to someone with an employee file and at least one leave type; it sits beside
 * the check-in, and Home's one primary stays Add an employee.
 */

const MAX_TYPES = 3;
const shortName = (name) => String(name || 'Leave').replace(/ leave$/i, '');

/** "Earned 12 · Sick 6 · Casual 4", the paid types with a balance, biggest first, at most three. */
export function balanceWords(types) {
  /* Biggest balance first: the server lists types by name, which put a three-day Bereavement ahead of Earned. */
  const paid = (types || []).filter((t) => t.isPaid && t.available != null).sort((a, b) => Number(b.available) - Number(a.available));
  if (!paid.length) return '';
  const head = paid.slice(0, MAX_TYPES).map((t) => `${shortName(t.name)} ${amountFigure(t.available, t)}${isHourly(t) ? ' hours' : ''}`);
  const more = paid.length - head.length;
  return `${head.join(' · ')}${more > 0 ? ` and ${more} more` : ''}`;
}

export default function HomeMyLeave({ openScreen }) {
  const [me, setMe] = useState(null);
  const canAct = useCanActForSelf();
  useEffect(() => {
    let live = true;
    /* No employee file (404) or no permission: Home simply has no such line. */
    getMyLeave().then((d) => { if (live) setMe(d); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!me?.types?.length) return null;
  const left = balanceWords(me.types);
  const waiting = (me.requests || []).filter((r) => r.status === 'PENDING').length;
  const ask = canAct;
  return (
    <section className="ui-card p-4 flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap" aria-labelledby="home-my-leave-h">
      <div className="min-w-0 sm:flex-1">
        <h2 id="home-my-leave-h" className="ui-t-sec">Your leave</h2>
        <p className="ui-caption tabular-nums">
          {left ? `Days left: ${left}` : 'Every day you take is unpaid'}
          {waiting ? ` · ${waiting} ${waiting === 1 ? 'request waits' : 'requests wait'} for approval` : ''}
        </p>
      </div>
      <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => openScreen?.('myLeave', ask ? { ask: '1' } : undefined)}>
        <CalendarPlus size={16} aria-hidden="true" /> {ask ? 'Ask for leave' : 'My leave'}
      </button>
    </section>
  );
}
