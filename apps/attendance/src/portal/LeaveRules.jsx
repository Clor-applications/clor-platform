import React from 'react';

/*
 * Round 59 leavepolicyread A (18 Nov 2026): "My leave rules" in the employee
 * app, one plain line a leave type, read from the balances the app already has.
 */

const n = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(Number(v) * 10) / 10));

/** One plain line for a leave type: how many a year, how they come, what carries over. */
export function ruleLine(t) {
  const parts = [];
  if (!t.isPaid) parts.push('unpaid');
  const year = t.fullYear ?? t.entitled ?? t.allocated;
  if (t.isPaid && year != null && Number(year) > 0) parts.push(`${n(year)} ${t.unit === 'HOUR' ? 'hours' : Number(year) === 1 ? 'day' : 'days'} a year`);
  if (t.isPaid && Array.isArray(t.credits) && t.credits.length) parts.push('earned through the year');
  if (t.isPaid && t.carryLimit != null) parts.push(Number(t.carryLimit) > 0 ? `up to ${n(t.carryLimit)} carry over` : 'no carry over');
  if (t.allowHalfDay) parts.push('half days allowed');
  return parts.join(' · ');
}

export function LeaveRules({ types }) {
  const list = (types || []).filter((t) => ruleLine(t));
  if (!list.length) return null;
  return (
    <details className="ui-leave-rules">
      <summary>My leave rules</summary>
      <ul>
        {list.map((t) => (
          <li key={t.id}><span className="ui-leave-rules-name">{t.name}</span><span className="ui-caption">{ruleLine(t)}</span></li>
        ))}
      </ul>
    </details>
  );
}
