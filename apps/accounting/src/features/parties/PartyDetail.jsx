import React, { Suspense, lazy, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Mail, MapPin, Pencil, Phone, Wallet } from 'lucide-react';

import { formatMoney, formatMoneyCompact } from '@ui/utils/money';
import ChartCard from '@ui/components/charts/ChartCard';
import { PageHeader, EmptyState, StatTile, StatusPill } from '@ui/components/ui/Primitives';
import { DocumentNumber, DocDate, MoneyValue } from '@ui/components/docs';

/**
 * One party, the whole story: the 360 view a phone call needs.
 *
 * Until now a customer existed only as a row with an edit modal; answering
 * "how much do they owe and since when" meant a filtered invoice list and
 * mental arithmetic. This page puts the balance, the open documents and the
 * contact card on one screen, in the same KPI-and-card language as the rest
 * of the product.
 *
 * Works for both sides of the ledger: kind="customer" reads invoices,
 * kind="vendor" reads bills and expense vouchers.
 */

const PeriodBars = lazy(() =>
  import('@ui/components/charts/CircularCharts').then((m) => ({ default: m.PeriodBars }))
);

const ChartFallback = ({ height = 220 }) => (
  <div className="ui-skel w-full" style={{ height, borderRadius: 'var(--radius)' }} aria-hidden="true" />
);

const DAY = 86_400_000;

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v) => {
  const d = new Date(`${String(v || '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export default function PartyDetail({ db, currentCompany, party, kind = 'customer', displayName, onBack, onEdit, onOpenDocument }) {
  const [nowTs] = useState(() => Date.now());
  const isCustomer = kind === 'customer';
  const name = displayName || party?.name || party?.companyName || 'Party';

  /** Every document this party appears on, normalised to one row shape. */
  const docs = useMemo(() => {
    const idStr = String(party?.id ?? '');
    const take = (rows, type) =>
      (Array.isArray(rows) ? rows : [])
        .filter((r) => r.companyId === currentCompany?.id)
        .filter((r) => String(isCustomer ? r.customerId : r.vendorId) === idStr)
        .map((r) => ({
          type,
          id: r.id,
          number: r.number,
          date: r.date,
          dueDate: r.dueDate,
          total: num(r.total),
          paid: num(r.paidAmount),
          status: r.status,
          raw: r,
        }));
    return isCustomer
      ? take(db?.invoices, 'Invoice')
      : [...take(db?.bills, 'Bill'), ...take(db?.expenses, 'Expense')];
  }, [db, currentCompany, party, isCustomer]);

  const active = useMemo(
    () => docs.filter((d) => !['draft', 'cancelled'].includes(String(d.status || '').toLowerCase())),
    [docs]
  );

  const billed = active.reduce((s, d) => s + d.total, 0);
  const settled = active.reduce((s, d) => s + Math.min(d.paid, d.total), 0);
  const outstanding = Math.max(0, billed - settled);
  const openDocs = active
    .filter((d) => d.total - d.paid > 0.0001)
    .sort((a, b) => String(a.dueDate || a.date || '').localeCompare(String(b.dueDate || b.date || '')));

  /** Age of the oldest unpaid rupee — the number a collections call starts with. */
  const oldestOpenDays = useMemo(() => {
    let oldest = 0;
    for (const d of openDocs) {
      const t = toDate(d.date)?.getTime();
      if (t == null) continue;
      oldest = Math.max(oldest, Math.floor((nowTs - t) / DAY));
    }
    return oldest;
  }, [openDocs, nowTs]);

  const monthly = useMemo(() => {
    const base = new Date(nowTs);
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short' }), value: 0 });
    }
    const byKey = new Map(out.map((b) => [b.key, b]));
    for (const doc of active) {
      const d = toDate(doc.date);
      if (!d) continue;
      const b = byKey.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
      if (b) b.value += doc.total;
    }
    return out;
  }, [active, nowTs]);

  const recent = useMemo(
    () => [...docs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8),
    [docs]
  );

  // Addresses arrive as either a string or a structured object; render text.
  const addressText = (a) => {
    if (!a) return '';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') {
      return [a.line1, a.line2, a.city, a.state, a.pincode || a.pin || a.zip]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join(', ');
    }
    return '';
  };

  const contactRows = [
    { icon: Phone, value: party?.mobile || party?.phone },
    { icon: Mail, value: party?.email },
    { icon: MapPin, value: addressText(party?.billingAddress) || addressText(party?.address) },
  ].filter((r) => String(r.value || '').trim());

  return (
    <div className="space-y-6">
      <PageHeader
        entity="customer"
        title={name}
        description={[
          party?.gstin ? `GSTIN ${party.gstin}` : party?.gstRegistration || null,
          party?.paymentTermDays ? `${party.paymentTermDays}-day terms` : null,
        ]
          .filter(Boolean)
          .join(' · ') || (isCustomer ? 'Customer' : 'Vendor')}
        actions={
          <>
            <button type="button" onClick={onBack} className="ui-btn ui-btn-secondary">
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {onEdit ? (
              <button type="button" onClick={onEdit} className="ui-btn ui-btn-primary">
                <Pencil size={16} aria-hidden="true" /> Edit
              </button>
            ) : null}
          </>
        }
      />

      <div className="ui-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={isCustomer ? 'Billed to them' : 'Billed by them'}
          amount={billed}
          format={(v) => formatMoneyCompact(v, currentCompany)}
          title={formatMoney(billed, currentCompany)}
          hint={`Across ${active.length} document${active.length === 1 ? '' : 's'}`}
          icon={FileText}
          tint={isCustomer ? 'sales' : 'purchases'}
        />
        <StatTile
          label={isCustomer ? 'Collected' : 'Paid'}
          amount={settled}
          format={(v) => formatMoneyCompact(v, currentCompany)}
          title={formatMoney(settled, currentCompany)}
          hint={billed > 0 ? `${Math.round((settled / billed) * 100)}% settled` : 'Nothing yet'}
          tone="pos"
          icon={Wallet}
          tint={isCustomer ? 'sales' : 'purchases'}
        />
        <StatTile
          label="Outstanding"
          amount={outstanding}
          format={(v) => formatMoneyCompact(v, currentCompany)}
          title={formatMoney(outstanding, currentCompany)}
          hint={`${openDocs.length} open document${openDocs.length === 1 ? '' : 's'}`}
          tone={outstanding > 0 ? 'neg' : 'neutral'}
          icon={FileText}
          tint={isCustomer ? 'sales' : 'purchases'}
        />
        <StatTile
          label="Oldest open"
          value={openDocs.length ? `${oldestOpenDays}d` : '—'}
          hint={openDocs.length ? 'Age of the oldest unpaid document' : 'Nothing unpaid'}
          icon={Wallet}
          tint={isCustomer ? 'sales' : 'purchases'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="ui-card overflow-hidden">
            <header className="ui-card-head">
              <h3 className="ui-card-label" style={{ color: 'rgb(var(--fg))' }}>Open documents</h3>
            </header>
            {openDocs.length === 0 ? (
              <EmptyState icon={Wallet} title="Nothing outstanding" description="Every document is settled." />
            ) : (
              <div className="overflow-x-auto">
                <table className="ui-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>#</th>
                      {isCustomer ? null : <th>Type</th>}
                      <th>Date</th>
                      <th>Due</th>
                      <th className="ui-num">Total</th>
                      <th className="ui-num">Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody className="ui-rows">
                    {openDocs.map((d) => (
                      <tr
                        key={`${d.type}-${d.id}`}
                        className={onOpenDocument ? 'cursor-pointer' : ''}
                        onClick={onOpenDocument ? () => onOpenDocument(d) : undefined}
                      >
                        <td className="ui-col-id"><DocumentNumber value={d.number} /></td>
                        {isCustomer ? null : <td className="ui-col-meta">{d.type}</td>}
                        <td className="ui-col-date"><DocDate value={d.date || '-'} /></td>
                        <td className="ui-col-date"><DocDate value={d.dueDate || '-'} /></td>
                        <td className="ui-col-amount"><MoneyValue value={d.total} company={currentCompany} /></td>
                        <td className="ui-col-amount"><MoneyValue value={Math.max(0, d.total - d.paid)} company={currentCompany} /></td>
                        <td><StatusPill status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <ChartCard title={isCustomer ? 'Billed by month' : 'Purchased by month'} subtitle="Last six months">
            {monthly.every((b) => b.value <= 0) ? (
              <EmptyState icon={FileText} title="No recent documents" description="Six quiet months." />
            ) : (
              <Suspense fallback={<ChartFallback height={220} />}>
                <PeriodBars
                  data={monthly}
                  height={220}
                  tone={isCustomer ? 'brand' : 'deep'}
                  formatter={(v) => formatMoneyCompact(v, currentCompany)}
                />
              </Suspense>
            )}
          </ChartCard>
        </div>

        <div className="space-y-4">
          <section className="ui-card p-5">
            <h3 className="ui-card-label mb-3" style={{ color: 'rgb(var(--fg))' }}>Contact</h3>
            {contactRows.length === 0 ? (
              <p className="ui-caption">No contact details on file.</p>
            ) : (
              <ul className="space-y-2.5">
                {contactRows.map(({ icon: Icon, value }, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <Icon size={16} className="ui-subtle mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span className="break-words">{value}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ui-card overflow-hidden">
            <header className="ui-card-head">
              <h3 className="ui-card-label" style={{ color: 'rgb(var(--fg))' }}>Recent activity</h3>
            </header>
            {recent.length === 0 ? (
              <EmptyState icon={FileText} title="No documents yet" />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                {recent.map((d) => (
                  <li key={`${d.type}-${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="ui-col-id block truncate">{d.number}</span>
                      <span className="ui-caption">{d.date || '-'}</span>
                    </span>
                    <span className="ui-col-amount flex-shrink-0">{formatMoney(d.total, currentCompany)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
