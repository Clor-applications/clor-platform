import React, { useState } from 'react';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';

import { moneyRequest, openBill, sanctionClaim } from '../api/money';
import { MONEY_TYPES, money } from './words';

/**
 * The money behind an approval in the one inbox (WORKFLOW-GAP-RESEARCH 4.1,
 * 4.2): an expense claim with each bill, its photo, the GST kept and any
 * warning (over the category's limit, looks like another bill); an advance;
 * or a salary advance with what can come off the person's pay. Whoever the
 * claim waits on may allow less on a bill, saying why, before approving.
 */
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');

export default function MoneyRequestDetail({ request }) {
  if (!request || !MONEY_TYPES[request.requestType]) return null;
  return <Detail requestId={request.id} />;
}

function Detail({ requestId }) {
  const req = useRequest(() => moneyRequest(requestId), [requestId]);
  if (req.error) return <ErrorState error={req.error} onRetry={req.reload} compact />;
  const d = req.data;
  if (!d) return <div className="ui-skel ui-skel-text" aria-busy="true" />;
  if (!d.record) return <p className="ui-muted">Nothing was sent with this request from the employee app.</p>;
  if (d.kind === 'EXPENSE_CLAIM') return <ClaimDetail claim={d.record} advance={d.advance} canCut={d.waitingOnMe} onSaved={req.reload} />;
  if (d.kind === 'EMPLOYEE_ADVANCE') {
    const a = d.record;
    return (
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="ui-t-label">For</dt><dd>{a.purpose}</dd></div>
        <div><dt className="ui-t-label">Amount</dt><dd className="tabular-nums">{money(a.amount)}</dd></div>
        <div><dt className="ui-t-label">Needed by</dt><dd>{a.neededBy ? day(a.neededBy) : 'Not said'}</dd></div>
        <div><dt className="ui-t-label">Other advances still open</dt><dd className="tabular-nums">{d.openElsewhere ? money(d.openElsewhere) : 'None'}</dd></div>
      </dl>
    );
  }
  const a = d.record;
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="ui-t-label">Asked</dt><dd className="tabular-nums">{money(a.amount)} over {a.months} month{a.months === 1 ? '' : 's'}</dd></div>
        <div><dt className="ui-t-label">Each month</dt><dd className="tabular-nums">{money(a.emi)}, no interest</dd></div>
        <div><dt className="ui-t-label">What for</dt><dd>{a.reason}</dd></div>
        <div><dt className="ui-t-label">Can come off their pay</dt><dd className="tabular-nums">{d.cap?.known ? `${money(d.cap.monthlyRoom)} a month` : 'Not known: no pay in Payroll'}</dd></div>
      </dl>
      {d.cap?.known && !d.cap.fits ? <p className="ui-text-warn">The monthly repayment is more than half their pay allows, after what already comes off it.</p> : null}
      {d.cap?.known ? <p className="ui-caption">From their {d.cap.basis}: half of {money(d.cap.wages)} a month, less PF, tax and other repayments. Approved, it becomes a Payroll loan recovered from the next salary.</p> : null}
      {d.perquisite ? <p className="ui-text-warn">{d.perquisite}</p> : null}
      {a.loan ? <p className="ui-caption tabular-nums">Payroll loan {a.loan.number}: {money(a.loan.outstanding)} left to repay.</p> : null}
      {a.payrollNote ? <p className="ui-text-warn">{a.payrollNote}</p> : null}
    </div>
  );
}

function ClaimDetail({ claim: c, advance, canCut, onSaved }) {
  const [cutting, setCutting] = useState(false);
  const [cuts, setCuts] = useState({});
  const [busy, setBusy] = useState(false);
  const setCut = (lineId, patch) => setCuts((m) => ({ ...m, [lineId]: { ...(m[lineId] || {}), ...patch } }));
  const save = async () => {
    setBusy(true);
    try {
      const lines = Object.entries(cuts).map(([lineId, v]) => ({ id: lineId, approvedAmount: v.approvedAmount === '' || v.approvedAmount == null ? null : Number(v.approvedAmount), reason: v.reason || '' }));
      await sanctionClaim(c.id, lines);
      notify.success('Saved. Approve when ready.');
      setCutting(false);
      setCuts({});
      onSaved();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const allowed = c.lines.reduce((t, l) => t + (l.approvedAmount ?? l.amount), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="ui-t-label">{c.number} · {c.lines.length} bill{c.lines.length === 1 ? '' : 's'}</h3>
        {canCut && !cutting ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setCutting(true)}>Allow less on a bill</button> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="ui-t-label text-left">
              <th className="py-1.5 pr-3 font-medium">Bill</th>
              <th className="py-1.5 pr-3 text-right font-medium">Asked</th>
              <th className="py-1.5 text-right font-medium">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.id} className="border-t align-top" style={{ borderColor: 'rgb(var(--border))' }}>
                <td className="py-2 pr-3">
                  <span className="block font-medium">{l.merchant}</span>
                  <span className="ui-caption block">{day(l.spentOn)} · {l.category}{l.note ? ` · ${l.note}` : ''}</span>
                  {l.companyGstin ? <span className="ui-caption block">Bill in our GSTIN{l.supplierGstin ? ` · ${l.supplierGstin}` : ''}{l.taxAmount != null ? ` · GST ${money(l.taxAmount)}` : ''}{l.creditBlocked ? ' · credit usually not available' : ''}</span> : null}
                  {l.overLimit ? <span className="ui-caption block ui-text-warn">Over the {money(l.overLimit)} limit for {l.category}</span> : null}
                  {l.possibleDuplicate ? <span className="ui-caption block ui-text-warn">Same amount, day and place as another bill; they say it is a different one</span> : null}
                  {l.billId ? <button type="button" className="ui-link text-xs" onClick={() => openBill(l.billId).catch((e) => notify.error(String(e?.message || 'Could not open the bill.')))}>See the bill</button> : <span className="ui-caption block">No bill</span>}
                  {l.cutReason && !cutting ? <span className="ui-caption block">Allowed less: {l.cutReason}</span> : null}
                  {cutting ? (
                    <span className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
                      <input className="ui-input tabular-nums" inputMode="decimal" aria-label={`Allow for ${l.merchant}`} placeholder={String(l.amount)} value={cuts[l.id]?.approvedAmount ?? (l.approvedAmount ?? '')} onChange={(e) => setCut(l.id, { approvedAmount: e.target.value.replace(/[^\d.]/g, '') })} />
                      <SuggestInput aria-label={`Why less for ${l.merchant}`} placeholder="Why less (they read this)" maxLength={300} value={cuts[l.id]?.reason ?? (l.cutReason || '')} onChange={(v) => setCut(l.id, { reason: v })} suggestions={['No bill', 'Over the limit for this category', 'Personal part not covered']} />
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.amount)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.approvedAmount ?? l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t font-medium" style={{ borderColor: 'rgb(var(--border))' }}>
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(c.claimed)}</td>
              <td className="py-2 text-right tabular-nums">{money(allowed)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {cutting ? (
        <div className="flex gap-2">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !Object.keys(cuts).length} onClick={save}>{busy ? 'Saving…' : 'Save allowed amounts'}</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setCutting(false); setCuts({}); }}>Cancel</button>
        </div>
      ) : null}
      {advance ? <p className="ui-caption tabular-nums">Set against advance {advance.number} ({advance.purpose}): {money(advance.open)} of {money(advance.amount)} left on it, used first.</p> : null}
    </div>
  );
}
