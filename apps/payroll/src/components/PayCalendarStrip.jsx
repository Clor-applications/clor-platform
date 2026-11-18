import React from 'react';
import { payCalendar } from '@ui/picks/round44';
import { todayIst } from '@ui/utils/dates';

const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const STATE_WORD = { done: 'Done', now: 'Now', next: 'Next' };

/** Round 44 "payrollcalendar" A: the month's payroll dates as a strip, with the days left to pay. */
export default function PayCalendarStrip({ period, run, today = todayIst() }) {
  const cal = payCalendar(period, run, today);
  if (!cal) return null;
  return (
    <section className="ui-paycal" aria-label={`Payroll dates for ${period.name || 'this month'}`}>
      <ol className="ui-paycal-steps">
        {cal.steps.map((s) => (
          <li key={s.key} className={`ui-paycal-step is-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
            <span className="ui-paycal-label">{s.label}</span>
            <span className="ui-paycal-date tabular-nums">{s.date ? shortDate(s.date) : STATE_WORD[s.state]}</span>
          </li>
        ))}
      </ol>
      {cal.left ? <p className={`ui-paycal-left ui-caption tabular-nums${cal.late ? ' ui-text-warn' : ''}`}>{cal.left}</p> : null}
    </section>
  );
}
