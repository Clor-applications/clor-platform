import React, { useEffect, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import { SkeletonCard } from '@ui/components/ui/Primitives';

const num = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1).replace(/\.0$/, ''));
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

/**
 * How a leave balance is made up: what was carried in, what has been earned
 * (month by month for monthly accrual), what was taken and what is waiting.
 * The figures come from the server's own balance calculation.
 */
export default function LeaveExplain({ open, onClose, load }) {
  const [result, setResult] = useState({ for: null, data: null, error: '' });
  useEffect(() => {
    if (!open) return undefined;
    let off = false;
    Promise.resolve()
      .then(load)
      .then((d) => !off && setResult({ for: load, data: d, error: '' }))
      .catch((e) => !off && setResult({ for: load, data: null, error: String(e?.message || 'Could not explain this balance.') }));
    return () => {
      off = true;
    };
  }, [open, load]);
  const data = result.for === load ? result.data : null;
  const error = result.for === load ? result.error : '';
  const b = data?.balance;

  return (
    <Drawer open={open} onClose={onClose} title={data ? `${data.type.name}, ${data.year}` : 'Leave balance'} description={data ? `${data.employee.name}, as of ${data.asOf}` : ''} widthClass="w-[min(32rem,96vw)]">
      {error ? <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!data && !error ? <SkeletonCard lines={5} /> : null}
      {data ? (
        <div className="space-y-5">
          {data.type.isPaid && b ? (
            <div className="ui-explain-summary">
              <div><span className="ui-caption">Available</span><strong className="text-lg tabular-nums">{num(b.available)}</strong></div>
              <div><span className="ui-caption">Allotted so far</span><strong className="tabular-nums">{num(b.allocated)}</strong></div>
              <div><span className="ui-caption">Taken</span><strong className="tabular-nums">{num(b.used)}</strong></div>
              <div><span className="ui-caption">Waiting</span><strong className="tabular-nums">{num(b.pending)}</strong></div>
            </div>
          ) : null}
          <section aria-labelledby="leave-lines">
            <h3 id="leave-lines" className="ui-t-sec mb-2">How it adds up</h3>
            <ul className="ui-ledger">
              {data.lines.map((l, i) => (
                <li key={i} data-kind={l.kind}>
                  <span>{l.label}</span>
                  <span className="tabular-nums">{l.days > 0 ? `+${num(l.days)}` : num(l.days)}</span>
                </li>
              ))}
              {data.type.isPaid && b ? (
                <li data-kind="total"><span>Available now</span><span className="tabular-nums">{num(b.available)}</span></li>
              ) : null}
            </ul>
          </section>
          {data.months?.length > 1 ? (
            <section aria-labelledby="leave-months">
              <h3 id="leave-months" className="ui-t-sec mb-2">Earned each month</h3>
              <ol className="ui-accrual">
                {data.months.map((m) => (
                  <li key={m.month}><span className="ui-caption">{monthLabel(m.month)}</span><strong className="tabular-nums">+{num(m.earned)}</strong><span className="ui-caption tabular-nums">{num(m.total)}</span></li>
                ))}
              </ol>
            </section>
          ) : null}
          <section aria-labelledby="leave-rules">
            <h3 id="leave-rules" className="ui-t-sec mb-2">The rules for {data.type.name}</h3>
            <ul className="list-disc pl-5 text-sm ui-muted space-y-1">
              {data.rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
