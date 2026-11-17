import React from 'react';

/**
 * Which dates of a leave request count and which do not, said on the form
 * (owner's round 20 pick: the weekend between leave days is told on the form,
 * with the days shown). The server marks each date `counted` with a `why`:
 * a weekly off or holiday that is skipped, or one charged by the company's
 * sandwich rule or because the type counts calendar days. The charged ones
 * used to sit under "Dates not counted"; they are their own line now.
 */
export function splitDates(parts = []) {
  const dates = parts.flatMap((p) => p.dates || []).filter((d) => d.why);
  return {
    charged: dates.filter((d) => d.counted),
    skipped: dates.filter((d) => !d.counted),
  };
}

const plainWhy = (why) => String(why || '').replace(/, counted \((sandwich rule|calendar days)\)$/, '');

export default function DateNotes({ parts, label, className = '' }) {
  const { charged, skipped } = splitDates(parts);
  if (!charged.length && !skipped.length) return null;
  const byRule = charged.some((d) => /sandwich rule/.test(d.why));
  return (
    <div className={`space-y-1 ${className}`}>
      {charged.length ? (
        <div className="ui-date-notes-charged" role="note">
          <p className="font-medium">
            {charged.length === 1 ? '1 day off in between counts' : `${charged.length} days off in between count`}
            {byRule ? ', by your company’s leave rule' : ', as this leave counts every calendar day'}:
          </p>
          <ul className="space-y-0.5" aria-label="Days off that count">
            {charged.map((d) => <li key={d.date}><span className="tabular-nums">{label(d.date)}</span> — {plainWhy(d.why)}</li>)}
          </ul>
        </div>
      ) : null}
      {skipped.length ? (
        <ul className="space-y-0.5 ui-muted" aria-label="Dates not counted">
          {skipped.map((d) => <li key={d.date}><span className="tabular-nums">{label(d.date)}</span> — {d.why}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
