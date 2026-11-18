import React from 'react';

/**
 * Maternity leave as one request with the return date worked out (round 22
 * pick "maternity" A). Maternity leave runs on calendar days, so the person is
 * back the day after the last day. A "26 weeks" button fills the last day.
 */
export const MATERNITY = /maternity/i;
export const MATERNITY_WEEKS = 26;

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const at = (d) => Date.parse(`${d}T00:00:00Z`);

/** The last day of `weeks` weeks starting on `from` (both days counted). */
export function lastDayOf(from, weeks = MATERNITY_WEEKS) {
  return iso(at(from) + (weeks * 7 - 1) * DAY);
}

/** The day after `to`. */
export function backOn(to) {
  return iso(at(to) + DAY);
}

/** Whole weeks and leftover days between two dates, both counted. */
export function spanWords(from, to) {
  const days = Math.round((at(to) - at(from)) / DAY) + 1;
  if (days < 1) return '';
  const w = Math.floor(days / 7);
  const d = days % 7;
  const part = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return [w ? part(w, 'week') : '', d ? part(d, 'day') : ''].filter(Boolean).join(' ');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Wed 2 Jun 2027". */
const word = (d) => { const t = new Date(at(d)); return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };

/* Round 42 pick "adoption" B: adoption leave is set by the child's age; a child under
   3 months gets 12 weeks from the day the child comes home (Maternity Benefit Act). */
export const ADOPTION = /adopt/i;
export const ADOPTION_WEEKS = 12;

export default function LongLeaveSpan({ typeName, fromDate, toDate, onFill }) {
  const adoption = ADOPTION.test(typeName || '');
  if ((!MATERNITY.test(typeName || '') && !adoption) || !fromDate) return null;
  if (document.documentElement.dataset.palette === 'indigo') return null;
  const weeks = adoption ? ADOPTION_WEEKS : MATERNITY_WEEKS;
  const full = lastDayOf(fromDate, weeks);
  return (
    <div className="ui-long-leave text-sm">
      {toDate && toDate >= fromDate
        ? <p><span className="tabular-nums">{spanWords(fromDate, toDate)}</span> · back at work on <b className="tabular-nums">{word(backOn(toDate))}</b></p>
        : null}
      {adoption ? <p className="ui-muted">For a child under 3 months: {ADOPTION_WEEKS} weeks from the day the child comes home.</p> : null}
      {toDate !== full ? <button type="button" className="ui-link" onClick={() => onFill(full)}>Fill {weeks} weeks, to {word(full)}</button> : null}
    </div>
  );
}
