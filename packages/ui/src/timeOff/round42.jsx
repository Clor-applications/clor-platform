import React from 'react';

/*
 * Round 42 picks (18 Nov 2026), on the leave form outside Books:
 * - childsick A: sick leave can be taken for an ill child, picked on the form ("My child").
 * - unpaidleave A: leave without pay says plainly that the month's pay is cut for those days.
 */

const isBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

export const SICK = /sick/i;
export const CHILD_PREFIX = 'For my child: ';

/** The reason as sent: "For my child: fever" when the leave is for a child, else as typed. */
export function reasonFor(reason, forChild) {
  const text = (reason || '').trim();
  if (!forChild || text.startsWith(CHILD_PREFIX)) return text;
  return `${CHILD_PREFIX}${text}`;
}

/** Sick leave only: whose illness it is. One balance either way. */
export function ForWhom({ typeName, value, onChange }) {
  if (!SICK.test(typeName || '') || isBooks()) return null;
  return (
    <fieldset className="ui-for-whom">
      <legend className="ui-label">Who is ill</legend>
      <div className="ui-for-whom-choices" role="radiogroup" aria-label="Who is ill">
        <button type="button" role="radio" aria-checked={!value} className="ui-for-whom-choice" onClick={() => onChange(false)}>Me</button>
        <button type="button" role="radio" aria-checked={Boolean(value)} className="ui-for-whom-choice" onClick={() => onChange(true)}>My child</button>
      </div>
      {value ? <p className="text-sm ui-muted">Taken from your own sick leave. The reason starts with “For my child”.</p> : null}
    </fieldset>
  );
}

const daysWord = (n) => `${n} day${n === 1 ? '' : 's'}`;

/** Unpaid leave: the cost in plain words, under the day count. */
export function UnpaidNote({ type, total }) {
  if (!type || type.isPaid !== false || !(total > 0) || isBooks()) return null;
  return <p className="ui-unpaid-note" role="note">Without pay: your pay for the month is cut for these <span className="tabular-nums">{daysWord(total)}</span>.</p>;
}
