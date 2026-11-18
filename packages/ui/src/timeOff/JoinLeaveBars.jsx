import React from 'react';

/**
 * Joiners and leavers each month in one picture (round 22 pick "joinleave" A):
 * a bar up from the middle line for the people who joined, a bar down for the
 * people who left, with both figures written under the month.
 */
export default function JoinLeaveBars({ rows, label = 'Joiners and leavers each month' }) {
  /* Round 29 pick "chartempty" C: nobody joined or left, so no empty chart. */
  if (!rows?.some((r) => Number(r.joiners) > 0 || Number(r.leavers) > 0)) return null;
  const top = Math.max(1, ...rows.map((r) => Math.max(Number(r.joiners) || 0, Number(r.leavers) || 0)));
  const said = rows.map((r) => `${r.label} ${r.joiners || 0} joined, ${r.leavers || 0} left`).join(', ');
  return (
    <div className="ui-joinleave" role="img" aria-label={`${label}: ${said}`}>
      {rows.map((r) => {
        const j = Math.max(0, Number(r.joiners) || 0);
        const l = Math.max(0, Number(r.leavers) || 0);
        return (
          <div key={r.key || r.label} className="ui-joinleave-col">
            <span className="ui-joinleave-up"><span className="ui-joinleave-bar is-join" style={{ height: `${(j / top) * 100}%` }} /></span>
            <span className="ui-joinleave-down"><span className="ui-joinleave-bar is-leave" style={{ height: `${(l / top) * 100}%` }} /></span>
            <span className="ui-joinleave-label">{r.label}</span>
            <span className="ui-joinleave-figs tabular-nums">+{j} −{l}</span>
          </div>
        );
      })}
    </div>
  );
}
