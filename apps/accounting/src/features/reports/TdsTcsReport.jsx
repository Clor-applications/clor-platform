import React, { useMemo, useState } from 'react';
import { Download, Landmark } from 'lucide-react';
import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { ListToolbar, exportRows, useListSearch } from '@ui/components/ListToolbar';
import { notify } from '@ui/components/ui/notify';
import { formatMoney } from '@ui/utils/money';
import { fyRange, getTdsConfig, tds194qRows, tcs206cRows } from '@ui/utils/tdsTcs';
import { csvSafeValue } from '@ui/utils/csv';

/**
 * TDS 194Q / TCS 206C(1H) — the payable report for challan filing.
 *
 * Per-party cumulative purchases (194Q) and receipts (206C), the excess over
 * the FY threshold, and the tax on it. The Draft-journal button books the
 * liability: Dr party ledger / Cr "TDS Payable 194Q" (or Cr party /
 * Dr "TCS Receivable" mirror for collections) — as a normal journal entry
 * you can review before anything else happens.
 */
export default function TdsTcsReport({ db, setDb, currentCompany }) {
  const companyId = currentCompany.id;
  const fy = useMemo(() => fyRange(), []);
  const config = getTdsConfig(db, companyId);

  const [tab, setTab] = useState('tds');
  const [threshold, setThreshold] = useState(String(config.threshold));
  const [rate, setRate] = useState(String(config.rate));

  const effConfig = { ...config, threshold: Number(threshold) || 0, rate: Number(rate) || 0 };
  const tdsRows = useMemo(() => tds194qRows(db, companyId, effConfig, fy), [db, companyId, threshold, rate, fy]);
  const tcsRows = useMemo(() => tcs206cRows(db, companyId, effConfig, fy), [db, companyId, threshold, rate, fy]);

  const rows = tab === 'tds' ? tdsRows : tcsRows;
  const liable = rows.filter((r) => r.tax > 0);
  const totalTax = liable.reduce((s, r) => s + r.tax, 0);

  const saveConfig = () => {
    setDb((prev) => {
      const others = (prev.tdsConfigs || []).filter((c) => c.companyId !== companyId);
      return { ...prev, tdsConfigs: [...others, { companyId, threshold: Number(threshold) || 0, rate: Number(rate) || 0 }] };
    });
    notify.success('TDS/TCS settings saved.');
  };

  const money = (v) => formatMoney(Number(v || 0), currentCompany);

  const exportCsv = () => {
    const headers = ['Party', 'GSTIN', 'Docs', 'Cumulative', 'Excess over threshold', tab === 'tds' ? 'TDS 194Q' : 'TCS 206C'];
    const lines = [headers.join(','), ...rows.map((r) => [r.party, r.gstin, r.docs, r.cumulative, r.excess, r.tax].map((v) => `"${csvSafeValue(v).replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab === 'tds' ? 'tds-194q' : 'tcs-206c'}-${fy.label.replace(/\s/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const draftJournal = () => {
    if (!liable.length) {
      notify.error('No party is over the threshold — nothing to book.');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const isTds = tab === 'tds';
    const lines = [
      ...liable.map((r) => ({
        accountId: '',
        accountCode: '',
        accountName: r.party,
        debit: isTds ? r.tax : 0,
        credit: isTds ? 0 : r.tax,
      })),
      {
        accountId: '',
        accountCode: '',
        accountName: isTds ? 'TDS Payable 194Q' : 'TCS Payable 206C',
        debit: isTds ? 0 : totalTax,
        credit: isTds ? totalTax : 0,
      },
    ];
    const nextId = (db.journalEntries || []).reduce((m, j) => Math.max(m, Number(j.id) || 0), 0) + 1;
    setDb((prev) => ({
      ...prev,
      journalEntries: [
        ...(prev.journalEntries || []),
        {
          id: nextId,
          companyId,
          number: `JE-${isTds ? 'TDS' : 'TCS'}-${nextId}`,
          date: today,
          narration: `${isTds ? 'TDS u/s 194Q' : 'TCS u/s 206C(1H)'} for ${fy.label} — auto-drafted from the payable report`,
          lines,
          totalDebit: totalTax,
          totalCredit: totalTax,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    notify.success(`Journal JE-${isTds ? 'TDS' : 'TCS'}-${nextId} drafted for ${money(totalTax)} — review it under Journal Entries.`);
  };

  const ttSearch = useListSearch(rows, ['party', 'gstin']);
  const ttSearchRows = ttSearch.filtered;
  return (
    <div className="space-y-6">
      <PageHeader
        entity="tds"
        title="TDS / TCS (194Q & 206C)"
      />

      <div className="ui-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="ui-label" htmlFor="tdstcsreport-fy-threshold">FY threshold (₹)</label>
          <input id="tdstcsreport-fy-threshold" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="ui-input w-40" />
        </div>
        <div>
          <label className="ui-label" htmlFor="tdstcsreport-rate">Rate (%)</label>
          <input id="tdstcsreport-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="ui-input w-28" />
        </div>
        <button type="button" onClick={saveConfig} className="ui-btn ui-btn-secondary">Save settings</button>
        <div className="ui-caption pb-2">Statutory defaults: ₹50,00,000 · 0.1% (5% without PAN — set per filing).</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab('tds')} className={`ui-btn ui-btn-sm ${tab === 'tds' ? 'ui-btn-primary' : 'ui-btn-secondary'}`}>
          TDS 194Q — purchases ({tdsRows.filter((r) => r.tax > 0).length} liable)
        </button>
        <button type="button" onClick={() => setTab('tcs')} className={`ui-btn ui-btn-sm ${tab === 'tcs' ? 'ui-btn-primary' : 'ui-btn-secondary'}`}>
          TCS 206C — receipts ({tcsRows.filter((r) => r.tax > 0).length} liable)
        </button>
        <button type="button" onClick={exportCsv} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
          <Download size={14} aria-hidden="true" /> CSV
        </button>
        <button type="button" onClick={draftJournal} className="ui-btn ui-btn-secondary ui-btn-sm text-xs">
          Draft {tab === 'tds' ? 'TDS' : 'TCS'} journal ({money(totalTax)})
        </button>
      </div>

      <ListToolbar
        search={ttSearch.query}
        onSearch={ttSearch.setQuery}
        placeholder="Search parties (name, GSTIN)"
        count={ttSearchRows.length}
        countLabel="parties"
        onExport={() =>
          exportRows({
            fileName: `TdsTcs_${currentCompany?.name || 'company'}`,
            label: 'row(s)',
            columns: [
              { key: 'party', label: 'Party' },
              { key: 'gstin', label: 'GSTIN' },
              { key: 'docs', label: 'Docs' },
              { key: 'cumulative', label: 'Cumulative', value: (r) => Number(r.cumulative || 0) },
              { key: 'excess', label: 'Excess', value: (r) => Number(r.excess || 0) },
              { key: 'tax', label: 'Tax', value: (r) => Number(r.tax || 0) },
            ],
            rows: ttSearchRows,
          })
        }
      />

      {rows.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon={Landmark} title="No transactions this FY" description={tab === 'tds' ? 'Purchase bills drive 194Q.' : 'Receipts drive 206C(1H).'} />
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th className="ui-th">Party</th>
                <th className="ui-th">GSTIN</th>
                <th className="ui-th ui-num">Docs</th>
                <th className="ui-th ui-num">Cumulative ({fy.label})</th>
                <th className="ui-th ui-num">Excess</th>
                <th className="ui-th ui-num">{tab === 'tds' ? 'TDS @' : 'TCS @'} {rate}%</th>
              </tr>
            </thead>
            <tbody>
              {ttSearchRows.map((r, i) => (
                <tr key={i} className={`border-t ${r.tax > 0 ? '' : 'opacity-60'}`}>
                  <td className="ui-col-entity px-4 py-2.5">
                    {r.party}
                    {r.exempt ? <span className="ui-caption ml-1">(buyer deducts 194Q — exempt)</span> : null}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.gstin || '—'}</td>
                  <td className="px-4 py-2.5 text-right">{r.docs}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{money(r.cumulative)}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{r.excess ? money(r.excess) : '—'}</td>
                  <td className="ui-col-amount px-4 py-2.5 text-right">{r.tax ? money(r.tax) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
