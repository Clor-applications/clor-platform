import React, { useRef, useState } from 'react';
import Popover from '@ui/components/ui/Popover';
import { ChevronLeft, ChevronRight } from '@ui/components/ui/lineIcons';

/**
 * Choosing a week (owner's round 12 pick): the button names the week, and
 * opens a month where each row is one week, Monday first; pointing at a row
 * lights the whole week and a click takes it. Dates are ISO strings
 * (YYYY-MM-DD) handled in UTC so no time zone shifts a day.
 */
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const mondayOf = (s) => plus(s, -((utc(s).getUTCDay() + 6) % 7));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekLabel(s) {
  const a = utc(mondayOf(s));
  const b = utc(plus(mondayOf(s), 6));
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${a.getUTCDate()}${sameMonth ? '' : ` ${MON[a.getUTCMonth()]}`}${sameYear ? '' : ` ${a.getUTCFullYear()}`}`;
  return `${left} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

function monthWeeks(firstOfMonth) {
  const start = mondayOf(firstOfMonth);
  const month = utc(firstOfMonth).getUTCMonth();
  const weeks = [];
  for (let w = start; weeks.length < 6; w = plus(w, 7)) {
    if (weeks.length >= 4 && utc(w).getUTCMonth() !== month) break;
    weeks.push(w);
  }
  return weeks;
}

export default function WeekPicker({ value, onChange, label = 'Week', className = '' }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => `${value.slice(0, 7)}-01`);
  const chosen = mondayOf(value);
  const today = iso(new Date());
  const shiftMonth = (n) => { const d = utc(month); d.setUTCMonth(d.getUTCMonth() + n); setMonth(iso(d)); };
  const m = utc(month);
  return (
    <>
      <button ref={ref} type="button" className={`ui-input ui-ctl-compact ui-week-trigger !w-auto ${className}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${weekLabel(value)}`} onClick={() => { setMonth(`${value.slice(0, 7)}-01`); setOpen((o) => !o); }}>
        <span className="tabular-nums">{weekLabel(value)}</span>
      </button>
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={260} maxWidth={300}>
          <div className="ui-week-cal" role="dialog" aria-label={`Choose a ${label.toLowerCase()}`}>
            <div className="ui-week-cal-head">
              <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
              <b>{MON[m.getUTCMonth()]} {m.getUTCFullYear()}</b>
              <button type="button" className="ui-icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
            <div className="ui-week-cal-days" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
            {monthWeeks(month).map((w) => (
              <button key={w} type="button" className="ui-week-row" aria-pressed={w === chosen} aria-label={weekLabel(w)} onClick={() => { onChange(w); setOpen(false); }}>
                {Array.from({ length: 7 }, (_, i) => plus(w, i)).map((d) => (
                  <span key={d} className={`${utc(d).getUTCMonth() === m.getUTCMonth() ? '' : 'is-other'} ${d === today ? 'is-today' : ''}`}>{utc(d).getUTCDate()}</span>
                ))}
              </button>
            ))}
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm ui-week-now" onClick={() => { onChange(mondayOf(today)); setOpen(false); }}>This week</button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
