import React, { useMemo, useState } from 'react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';
import { Users } from 'lucide-react';

/**
 * Sales by Salesman — invoices, sales orders and estimates grouped by the
 * salesman stamped on them, over a date range. Commission is computed on the
 * pre-GST invoice subtotal at each salesman's configured rate (drafts and
 * cancelled documents excluded, matching the Salesmen master's numbers).
 */
export default function SalesBySalesman({ db, currentCompany }) {
  const companyId = currentCompany.id;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const salesmen = (db.salesmen || []).filter((s) => s.companyId === companyId);

  const inRange = (d) => {
    const day = String(d || '').slice(0, 10);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };

  const rows = useMemo(() => {
    const map = new Map(
      salesmen.map((s) => [
        Number(s.id),
        { salesman: s, invoices: 0, invoiceSales: 0, orders: 0, orderValue: 0, estimates: 0, estimateValue: 0, commission: 0 },
      ])
    );
    const unassigned = { salesman: null, invoices: 0, invoiceSales: 0, orders: 0, orderValue: 0, estimates: 0, estimateValue: 0, commission: 0 };

    for (const inv of db.invoices || []) {
      if (inv.companyId !== companyId || !inRange(inv.date)) continue;
      const st = String(inv.status || '').toLowerCase();
      if (st === 'draft' || st === 'cancelled') continue;
      const slot = map.get(Number(inv.salesmanId)) || unassigned;
      slot.invoices += 1;
      slot.invoiceSales += Number(inv.subtotal || 0);
      if (slot.salesman) slot.commission += (Number(inv.subtotal || 0) * Number(slot.salesman.commissionPct || 0)) / 100;
    }
    for (const so of db.salesOrders || []) {
      if (so.companyId !== companyId || !inRange(so.date)) continue;
      if (String(so.status || '').toLowerCase() === 'cancelled') continue;
      const slot = map.get(Number(so.salesmanId)) || unassigned;
      slot.orders += 1;
      slot.orderValue += Number(so.subtotal || so.total || 0);
    }
    for (const est of db.estimates || []) {
      if (est.companyId !== companyId || !inRange(est.date)) continue;
      const slot = map.get(Number(est.salesmanId)) || unassigned;
      slot.estimates += 1;
      slot.estimateValue += Number(est.subtotal || est.total || 0);
    }

    const out = [...map.values()].sort((a, b) => b.invoiceSales - a.invoiceSales);
    if (unassigned.invoices || unassigned.orders || unassigned.estimates) out.push(unassigned);
    return out;
  }, [db.invoices, db.salesOrders, db.estimates, salesmen, companyId, from, to]);

  const totals = rows.reduce(
    (t, r) => ({
      invoices: t.invoices + r.invoices,
      invoiceSales: t.invoiceSales + r.invoiceSales,
      commission: t.commission + r.commission,
    }),
    { invoices: 0, invoiceSales: 0, commission: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        entity="report"
        title="Sales by Salesman"
      />

      <div className="ui-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="ui-label" htmlFor="salesbysalesman-from">From</label>
          <input id="salesbysalesman-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ui-input" />
        </div>
        <div>
          <label className="ui-label" htmlFor="salesbysalesman-to">To</label>
          <input id="salesbysalesman-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ui-input" />
        </div>
        {(from || to) ? (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="ui-btn ui-btn-secondary">
            Clear
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={Users} title="No salesmen yet" description="Add salesmen under Master Data → Salesmen, then stamp them on invoices, sales orders and estimates." />
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead className="ui-sunken border-b">
              <tr>
                <th className="ui-th">Salesman</th>
                <th className="ui-th ui-num">Invoices</th>
                <th className="ui-th ui-num">Invoiced Sales (pre-GST)</th>
                <th className="ui-th ui-num">Sales Orders</th>
                <th className="ui-th ui-num">Order Value</th>
                <th className="ui-th ui-num">Quotations</th>
                <th className="ui-th ui-num">Quote Value</th>
                <th className="ui-th ui-num">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr key={r.salesman ? r.salesman.id : `un-${i}`} className="ui-hover-sunken">
                  <td className="ui-col-entity px-4 py-2.5">{r.salesman ? r.salesman.name : 'Unassigned'}</td>
                  <td className="px-4 py-2.5 text-right">{r.invoices}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(r.invoiceSales, currentCompany)}</td>
                  <td className="px-4 py-2.5 text-right">{r.orders}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(r.orderValue, currentCompany)}</td>
                  <td className="px-4 py-2.5 text-right">{r.estimates}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(r.estimateValue, currentCompany)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{r.salesman ? formatMoney(r.commission, currentCompany) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="ui-sunken border-t">
              <tr>
                <td className="px-4 py-2.5 font-semibold">Total</td>
                <td className="px-4 py-2.5 text-right font-medium">{totals.invoices}</td>
                <td className="ui-col-amount px-4 py-2.5 text-right font-medium">{formatMoney(totals.invoiceSales, currentCompany)}</td>
                <td colSpan={4}></td>
                <td className="ui-col-amount px-4 py-2.5 text-right">{formatMoney(totals.commission, currentCompany)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
