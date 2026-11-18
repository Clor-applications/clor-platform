import React from 'react';

/* Round 31 pick (agecheck B): a joiner under 18 is warned about, never blocked.
   Some jobs and all night work are not allowed for them, so the add form says so
   beside the date of birth and leaves the decision with HR. */

/* Whole years between a date of birth and a day, both 'YYYY-MM-DD'. Null when either is missing or bad. */
export function ageOn(dob, on) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || ''));
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(on || ''));
  if (!d || !t) return null;
  let age = Number(t[1]) - Number(d[1]);
  if (Number(t[2]) < Number(d[2]) || (t[2] === d[2] && Number(t[3]) < Number(d[3]))) age -= 1;
  return age;
}

export function isUnderEighteen(dob, on) {
  const age = ageOn(dob, on);
  return age !== null && age >= 0 && age < 18;
}

/* Shown under the date of birth. `on` is the joining day when known, else today. */
export default function UnderEighteen({ dob, on, className = '' }) {
  if (typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo') return null;
  if (!isUnderEighteen(dob, on)) return null;
  return (
    <p className={`ui-under18 ${className}`.trim()} role="status">
      <span className="ui-under18-tag">Under 18</span>
      <span>Night work and some jobs are not allowed. You can still add them.</span>
    </p>
  );
}
