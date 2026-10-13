import React, { useMemo, useRef, useState } from 'react';
import { Upload, BadgePercent, Download } from 'lucide-react';
import { PageHeader, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import { ListToolbar, useListSearch } from '@ui/components/ListToolbar';
import { notify } from '@ui/components/ui/notify';
import { formatMoney } from '@ui/utils/money';
import { parseGstr2b, reconcileGstr2b } from '@ui/utils/gstr2b';
import { csvSafeValue } from '@ui/utils/csv';

/**
 * GSTR-2B reconciliation — the monthly "can I claim this ITC" answer.
 *
 * Upload the portal's GSTR-2B JSON; every supplier invoice in it is matched
 * against the books (supplier GSTIN + their invoice number, amount within
 * ₹1). Four buckets fall out:
 *   Matched            → ITC safe to claim
 *   Amount mismatch    → probably a data-entry slip; fix before claiming
 *   In 2B, not books   → supplier filed it, the bill was never entered
 *   In books, not 2B   → supplier has NOT filed — ITC at risk, chase them
 */
export default function Gstr2bReco({ db, currentCompany }) {
  const companyId = currentCompany.id;
  const bills = useMemo(() => (db.bills || []).filter((b) => b.companyId === companyId), [db.bills, companyId]);

  const fileRef = useRef(null);
  const [meta, setMeta] = useState(null); // { gstin, period, fileName }
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('matched');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const parsed = parseGstr2b(json);
      if (!parsed.rows.length) {
        notify.error('No B2B invoices found in this file — is it the GSTR-2B JSON from the portal?');
        return;
      }
      const reco = reconcileGstr2b(parsed.rows, bills);
      setMeta({ gstin: parsed.gstin, period: parsed.period, fileName: file.name });
      setResult(reco);
      setTab('matched');
      notify.success(`${parsed.rows.length} supplier invoice(s) reconciled against ${bills.length} bill(s).`);
    } catch (err) {
      notify.error(`Could not read the file: ${String(err?.message || err)}`);
    } finally {
      e.target.value = '';
    }
  };

  const exportCsv = (rows, headers, mapRow, name) => {
    const lines = [headers.join(','), ...rows.map((r) => mapRow(r).map((v) => `"${csvSafeValue(v).replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const TABS = result
    ? [
        ['matched', `Matched (${result.summary.counts.matched})`],
        ['amountMismatch', `Amount mismatch (${result.summary.counts.amountMismatch})`],
        ['onlyIn2B', `In 2B, not in books (${result.summary.counts.onlyIn2B})`],
        ['onlyInBooks', `In books, not in 2B (${result.summary.counts.onlyInBooks})`],
      ]
    : [];

  const itcLine = (t) => money(t.igst + t.cgst + t.sgst);

  // One search box over whichever tab is showing — the shapes differ (2B rows
  // vs bills), so the accessors cover both.
  const recoSearch = useListSearch(result ? result[tab] || [] : [], [
    'inum',
    'trdnm',
    'ctin',
    'number',
    'refNo',
    'vendorName',
    'vendorGstin',
    (r) => r.bill?.number,
  ]);
  const visibleReco = recoSearch.filtered;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="gst"
        title="GSTR-2B Reconciliation"
        description="Upload the portal's GSTR-2B JSON — every supplier invoice is matched to your bills so you know exactly which ITC is safe to claim."
      />

      <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          {meta ? (
            <>
              <span className="font-medium">{meta.fileName}</span>
              <span className="ui-muted"> · GSTIN {meta.gstin || '—'} · period {meta.period || '—'}</span>
            </>
          ) : (
            <span className="ui-muted">GST portal → Returns → GSTR-2B → Download JSON, then upload it here.</span>
          )}
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} className="ui-btn ui-btn-primary">
            <Upload size={16} aria-hidden="true" /> Upload GSTR-2B JSON
          </button>
        </div>
      </div>

      {!result ? (
        <div className="ui-card">
          <EmptyState icon={BadgePercent} title="No reconciliation yet" description="Upload a GSTR-2B JSON to see matched, mismatched, and missing invoices with their ITC." />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="ui-card p-4">
              <div className="ui-caption">ITC safe to claim (matched)</div>
              <div className="ui-money-lg ui-amount-pos">{itcLine(result.summary.claimable)}</div>
              <div className="ui-caption mt-0.5">
                IGST {money(result.summary.claimable.igst)} · CGST {money(result.summary.claimable.cgst)} · SGST {money(result.summary.claimable.sgst)}
              </div>
            </div>
            <div className="ui-card p-4">
              <div className="ui-caption">ITC in 2B but missing from books</div>
              <div className="ui-money-lg">{itcLine(result.summary.missingFromBooks)}</div>
              <div className="ui-caption mt-0.5">Enter these bills to claim it.</div>
            </div>
            <div className="ui-card p-4">
              <div className="ui-caption">Bills the supplier has not filed</div>
              <div className="ui-money-lg ui-amount-neg">{result.summary.atRiskBills}</div>
              <div className="ui-caption mt-0.5">ITC at risk — chase these suppliers.</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`ui-btn ui-btn-sm ${tab === key ? 'ui-btn-primary' : 'ui-btn-secondary'}`}>
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (tab === 'onlyInBooks') {
                  exportCsv(result.onlyInBooks, ['Bill no', 'Supplier inv', 'Vendor', 'GSTIN', 'Date', 'Total'], (b) => [b.number, b.refNo, b.vendorName, b.vendorGstin, b.date, b.total], 'gstr2b-only-in-books.csv');
                } else {
                  const rows = result[tab] || [];
                  exportCsv(rows, ['Supplier GSTIN', 'Supplier', 'Invoice no', 'Date', 'Taxable', 'IGST', 'CGST', 'SGST', 'Total', 'Bill no', 'Diff'], (r) => [r.ctin, r.trdnm, r.inum, r.date, r.taxable, r.igst, r.cgst, r.sgst, r.total, r.bill?.number || '', r.diff ?? ''], `gstr2b-${tab}.csv`);
                }
              }}
              className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
            >
              <Download size={14} aria-hidden="true" /> CSV
            </button>
          </div>

          <ListToolbar
      search={recoSearch.query}
            onSearch={recoSearch.setQuery}
            placeholder="Search this view (invoice, supplier, GSTIN, bill)"
            count={visibleReco.length}
            countLabel="rows"
          />

          <div className="ui-card overflow-x-auto">
            {tab === 'onlyInBooks' ? (
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th className="ui-th">Bill</th>
                    <th className="ui-th">Supplier inv no</th>
                    <th className="ui-th">Vendor</th>
                    <th className="ui-th">GSTIN</th>
                    <th className="ui-th ui-col-h-center">Date</th>
                    <th className="ui-th ui-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReco.map((b, i) => (
                    <tr key={i} className="border-t">
                      <td className="ui-col-id px-4 py-2.5">{b.number}</td>
                      <td className="ui-col-meta px-4 py-2.5">{b.refNo || '—'}</td>
                      <td className="ui-col-entity px-4 py-2.5">{b.vendorName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{b.vendorGstin}</td>
                      <td className="ui-col-date px-4 py-2.5">{b.date}</td>
                      <td className="ui-col-amount px-4 py-2.5 text-right">{money(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th className="ui-th">Supplier</th>
                    <th className="ui-th">Invoice no</th>
                    <th className="ui-th ui-col-h-center">Date</th>
                    <th className="ui-th ui-num">Taxable</th>
                    <th className="ui-th ui-num">ITC (I+C+S)</th>
                    <th className="ui-th ui-num">Total</th>
                    <th className="ui-th">Book bill</th>
                    <th className="ui-th">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReco.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="ui-col-entity px-4 py-2.5">
                        {r.trdnm || '—'}
                        <span className="ui-caption block font-mono">{r.ctin}</span>
                      </td>
                      <td className="ui-col-id px-4 py-2.5">{r.inum}</td>
                      <td className="ui-col-date px-4 py-2.5">{r.date}</td>
                      <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.taxable)}</td>
                      <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.igst + r.cgst + r.sgst)}</td>
                      <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.total)}</td>
                      <td className="ui-col-meta px-4 py-2.5">{r.bill?.number || '—'}</td>
                      <td className="px-4 py-2.5">
                        {tab === 'amountMismatch' ? <StatusPill status={`Diff ${money(r.diff)}`} /> : null}
                        {!r.itcAvailable ? <StatusPill status="ITC blocked" /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
