import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, FileText } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import NotConnected from '@ui/components/ui/NotConnected';
import { formatMoney } from '@ui/utils/money';
import { getAccountOverview } from '../../api/admin';
import { getEntitlement } from '@ui/api/features';

/**
 * Billing, built ahead of the service behind it.
 *
 * The plan an account is on is real — it is stored, it decides what the product
 * offers, and it is read here from the server. What does not exist yet is
 * everything a billing provider owns: the money taken, the card on file, the
 * receipts. Those are shown as sample rows so the shape of the screen can be
 * settled now, and they are labelled as sample rows so nobody demonstrates them
 * as this account's.
 *
 * Pricing itself is deliberately not decided here. The amounts below are
 * placeholders for a layout, not a proposal.
 */

const SAMPLE_INVOICES = [
  { id: 'sample-3', number: 'NB-0003', date: '2026-09-01', period: 'Sep 2026', amount: 2499, status: 'Paid' },
  { id: 'sample-2', number: 'NB-0002', date: '2026-08-01', period: 'Aug 2026', amount: 2499, status: 'Paid' },
  { id: 'sample-1', number: 'NB-0001', date: '2026-07-01', period: 'Jul 2026', amount: 2499, status: 'Paid' },
];

export default function BillingPreview({ currentCompany }) {
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // The plan and the usage are real; only the money is invented.
    Promise.all([getEntitlement().catch(() => null), getAccountOverview().catch(() => null)]).then(([ent, acct]) => {
      if (cancelled) return;
      setPlan(ent?.plan || acct?.plan || null);
      setUsage(acct?.usage || ent?.usage || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const money = (v) => formatMoney(Number(v || 0), currentCompany);
  const nextTotal = useMemo(() => SAMPLE_INVOICES[0]?.amount ?? 0, []);

  return (
    <div className="space-y-6">
      <PageHeader entity="company" title="Billing" />

      <NotConnected what="billing" sample>
        The plan and the usage below are read from the server and are real. Payments, cards and receipts need a payment
        provider, which has not been chosen yet — pricing is still to be set.
      </NotConnected>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="ui-card p-4">
          <div className="ui-label">Current plan</div>
          <div className="mt-1 text-2xl">{plan?.name || '—'}</div>
          <div className="ui-caption ui-muted">{plan?.inGoodStanding === false ? plan?.status : 'Active'}</div>
        </div>
        <div className="ui-card p-4">
          <div className="ui-label">Companies</div>
          <div className="mt-1 text-2xl ui-money">
            {usage?.companies ?? '—'}
            {plan?.limits?.maxCompanies ? <span className="ui-muted text-base"> / {plan.limits.maxCompanies}</span> : null}
          </div>
        </div>
        <div className="ui-card p-4">
          <div className="ui-label">Users</div>
          <div className="mt-1 text-2xl ui-money">
            {usage?.users ?? '—'}
            {plan?.limits?.maxUsers ? <span className="ui-muted text-base"> / {plan.limits.maxUsers}</span> : null}
          </div>
        </div>
      </div>

      <div className="ui-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CreditCard size={18} aria-hidden="true" className="ui-muted mt-0.5" />
            <div>
              <div className="ui-label">Payment method</div>
              <div className="text-sm ui-muted">None on file. Nothing has been charged to this account.</div>
            </div>
          </div>
          <button type="button" className="ui-btn ui-btn-secondary" disabled>
            Add a card
          </button>
        </div>
      </div>

      <div>
        <div className="ui-label mb-2">Billing history — sample</div>
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th className="ui-th text-left">Invoice</th>
                <th className="ui-th text-left">Date</th>
                <th className="ui-th text-left">Period</th>
                <th className="ui-th ui-num text-right">Amount</th>
                <th className="ui-th text-left">Status</th>
                <th className="ui-th"></th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_INVOICES.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="ui-col-id px-4 py-2.5 ui-mono">{inv.number}</td>
                  <td className="ui-col-date px-4 py-2.5">{inv.date}</td>
                  <td className="ui-col-meta px-4 py-2.5">{inv.period}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(inv.amount)}</td>
                  <td className="ui-col-meta px-4 py-2.5">{inv.status}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm text-xs" disabled>
                      <FileText size={14} aria-hidden="true" /> Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ui-caption ui-muted mt-2">
          Next charge would be {money(nextTotal)}. No charge will be taken: there is no payment provider connected.
        </div>
      </div>
    </div>
  );
}
