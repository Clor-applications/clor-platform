import React from 'react';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

import useRequest from '@ui/components/ui/useRequest';

/**
 * My attendance: the month's late marks against the company's rule, in one line
 * ("2 of 3 late marks; the next one costs ½ day"), and the rule itself, so a
 * deduction is never a surprise (WORKFLOW-GAP-RESEARCH 4.4; server:
 * routes/peopleTimeRules.ts my/late-marks). Nothing shows while the rule is off.
 */
const half = (d) => (d === 0.5 ? '½ day' : d === 1 ? '1 day' : `${d} days`);
const load = (month) => Promise.resolve().then(() => apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/my/late-marks?month=${encodeURIComponent(month)}`, { skipWarehouseHeader: true })).catch(() => null);

export default function MarksLine({ month }) {
  const req = useRequest(() => load(month), [month]);
  const m = req.data;
  if (!m?.on) return null;
  const lines = [m.late?.line, m.early?.line].filter(Boolean);
  return (
    <section className="space-y-1" aria-label="Late marks this month">
      {lines.map((l) => <p key={l} className="text-sm tabular-nums">{l}</p>)}
      {m.days > 0 ? (
        <p className="text-sm tabular-nums">
          {m.status === 'WAIVED' ? `${half(m.days)} waived${m.waivedReason ? `: ${m.waivedReason}` : ''}.` : `Costs ${half(m.days)} this month${m.fromLeave?.length ? `, from ${m.fromLeave.map((p) => p.name).join(', ')}` : ''}${m.lossOfPayDays ? `, ${half(m.lossOfPayDays)} unpaid` : ''}.`}
        </p>
      ) : null}
      {m.policy ? <p className="ui-caption">{m.policy}</p> : null}
    </section>
  );
}
