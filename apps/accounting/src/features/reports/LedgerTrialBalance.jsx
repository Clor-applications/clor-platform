import React, { useEffect, useState } from 'react';
import { BookOpen, Download, Printer, RefreshCw, X } from 'lucide-react';

import { getAccountLedgerLines, getTrialBalance } from '@ui/api/ledger';
import { EmptyState, PageHeader, Spinner, TableSkeleton } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';
import { csvSafeValue } from '@ui/utils/csv';
import { useFeatures } from '@ui/permissions/useFeatures';

/**
 * Trial balance from the general ledger.
 *
 * Distinct from the older report of the same name, which recomputes from
 * vouchers held in the browser. This reads posted journal lines, so it is the
 * one that must foot to zero.
 */
export const LedgerTrialBalance = ({ currentCompany }) => {
  const { isEnabled } = useFeatures();
  const branchesEnabled = isEnabled('branches');
  const [data, setData] = useState(null);
  const [allBranches, setAllBranches] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Compare: the same-length window immediately before [from, to].
  const [compare, setCompare] = useState(false);
  const [prevData, setPrevData] = useState(null);
  // Drill-down: the account whose journal lines are open below the table.
  const [drill, setDrill] = useState(null); // { account, rows, truncated } | { loading, name } | null

  const priorWindow = (from, to) => {
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return null;
    const days = Math.round((t - f) / 86_400_000) + 1;
    const pf = new Date(f.getTime() - days * 86_400_000);
    const pt = new Date(f.getTime() - 86_400_000);
    return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
  };

  const load = (scope = allBranches) => {
    const effectiveScope = branchesEnabled ? scope : false;
    setLoading(true);
    setError('');
    const wantCompare = compare && fromDate && toDate;
    const prior = wantCompare ? priorWindow(fromDate, toDate) : null;
    return Promise.all([
      getTrialBalance(effectiveScope, fromDate, toDate),
      prior ? getTrialBalance(effectiveScope, prior.from, prior.to) : Promise.resolve(null),
    ])
      .then(([cur, prev]) => {
        setData(cur);
        setPrevData(prev);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(allBranches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBranches, fromDate, toDate, compare]);

  const openDrill = (row) => {
    setDrill({ loading: true, name: row.name });
    getAccountLedgerLines(row.accountId, { from: fromDate, to: toDate, allBranches: branchesEnabled ? allBranches : false })
      .then((res) => setDrill(res))
      .catch((e) => setDrill({ error: String(e?.message || e), name: row.name }));
  };

  /** Closing balance of one account in the prior window, signed Dr-positive. */
  const prevClosing = (accountId) => {
    const r = (prevData?.rows || []).find((x) => x.accountId === accountId);
    if (!r) return null;
    return (r.closingDebit || 0) - (r.closingCredit || 0);
  };

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="ledger"
        title="Trial Balance"
        description="From posted journal entries. Debits and credits must agree exactly."
        actions={
          <>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="ui-input w-auto text-sm"
              aria-label="From date"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="ui-input w-auto text-sm"
              aria-label="To date"
            />
            <label
              className={`flex items-center gap-2 text-sm ${fromDate && toDate ? 'cursor-pointer' : 'opacity-50'}`}
      title={fromDate && toDate ? 'Compare with the previous period of the same length' : 'Pick a date range first'}
            >
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={compare}
                disabled={!fromDate || !toDate}
                onChange={(e) => setCompare(e.target.checked)}
              />
              Compare
            </label>
            {branchesEnabled ? <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="ui-checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
              All branches
            </label> : null}
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => load()}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </>
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="ui-card overflow-hidden">
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : !data?.rows?.length ? (
        <div className="ui-card">
          <EmptyState
            icon={BookOpen}
      title="Nothing posted yet"
            description="Once a document posts to the ledger its accounts appear here."
          />
        </div>
      ) : (
        <>
          <div className="ui-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Account</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="ui-num">Debit</th>
                    <th scope="col" className="ui-num">Credit</th>
                    <th scope="col" className="ui-num">Closing</th>
                    {prevData ? <th scope="col" className="ui-num">Prior period</th> : null}
                    {prevData ? <th scope="col" className="ui-num">Change</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const cur = (r.closingDebit || 0) - (r.closingCredit || 0);
                    const prev = prevData ? prevClosing(r.accountId) : null;
                    const delta = prev === null ? cur : cur - prev;
                    return (
                    <tr
                      key={r.accountId}
                      className="cursor-pointer"
                      onClick={() => openDrill(r)}
      title={`Open the ${r.name} ledger`}
                    >
                      <td className="ui-col-id">{r.code}</td>
                      <td className="ui-col-entity">{r.name}</td>
                      <td className="ui-col-meta ui-muted text-xs">{r.accountType}</td>
                      <td className="ui-col-amount">{r.debit ? formatMoney(r.debit, currentCompany) : '—'}</td>
                      <td className="ui-col-amount">{r.credit ? formatMoney(r.credit, currentCompany) : '—'}</td>
                      <td className="ui-col-amount">
                        {r.closingDebit
                          ? `${formatMoney(r.closingDebit, currentCompany)} Dr`
                          : r.closingCredit
                          ? `${formatMoney(r.closingCredit, currentCompany)} Cr`
                          : '—'}
                      </td>
                      {prevData ? (
                        <td className="ui-col-amount">
                          {prev === null
                            ? '—'
                            : prev >= 0
                            ? `${formatMoney(prev, currentCompany)} Dr`
                            : `${formatMoney(-prev, currentCompany)} Cr`}
                        </td>
                      ) : null}
                      {prevData ? (
                        <td className="ui-col-amount">
                          {Math.abs(delta) < 0.005 ? '—' : `${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta), currentCompany)}`}
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-6 text-sm">
              <span>
                <span className="ui-muted">Total debit </span>
                <span className="ui-amount">{formatMoney(totals.debit, currentCompany)}</span>
              </span>
              <span>
                <span className="ui-muted">Total credit </span>
                <span className="ui-amount">{formatMoney(totals.credit, currentCompany)}</span>
              </span>
            </div>
            {totals.balanced ? (
              <span className="ui-pill ui-pill-pos">Balanced</span>
            ) : (
              <span className="ui-pill ui-pill-neg">
                Out by {formatMoney(Math.abs(totals.difference), currentCompany)}
              </span>
            )}
          </div>

          {drill ? (
            <section className="ui-card overflow-hidden ui-in" aria-label="Account ledger">
              <header
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: '1px solid rgb(var(--border))' }}
              >
                <div>
                  <h3 className="ui-title text-sm">
                    {drill.account ? `${drill.account.code} · ${drill.account.name}` : drill.name}
                  </h3>
                  <p className="ui-caption">
                    {drill.loading
                      ? 'Loading…'
                      : drill.error
                      ? drill.error
                      : `${drill.rows.length} posted line${drill.rows.length === 1 ? '' : 's'}${
                          fromDate || toDate ? ' in the selected range' : ''
                        }${drill.truncated ? ' (first 1000 shown)' : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {drill.rows?.length ? (
                    <>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
                        onClick={() => {
                          const esc = (v) => {
                            const t = csvSafeValue(v);
                            return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
                          };
                          const head = ['Date', 'Entry', 'Narration', 'Debit', 'Credit', 'Running'];
                          const lines = drill.rows.map((l) =>
                            [l.date, l.entryNo, l.narration || '', l.debit || '', l.credit || '', l.running].map(esc).join(',')
                          );
                          const csv = '\ufeff' + [head.join(','), ...lines].join('\r\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${drill.account?.code || 'ledger'}-${drill.account?.name || ''}.csv`.replace(/\s+/g, '-');
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download size={14} aria-hidden="true" /> CSV
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-sm text-xs"
                        onClick={() => {
                          // Separate sheet: the same rows in a print-ready window.
                          const w = window.open('', '_blank');
                          if (!w) return;
                          const safe = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
                          w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(drill.account?.name)}</title>
<style>body{font-family:Arial;margin:24px;color:#111}h1{font-size:16px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ddd;padding:5px;text-align:left}.r{text-align:right}th{background:#f5f6f8}</style>
</head><body><h1>${safe(drill.account?.code)} · ${safe(drill.account?.name)}</h1><table><thead><tr><th>Date</th><th>Entry</th><th>Narration</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Running</th></tr></thead><tbody>
${drill.rows.map((l) => `<tr><td>${safe(l.date)}</td><td>${safe(l.entryNo)}</td><td>${safe(l.narration)}</td><td class="r">${l.debit || ''}</td><td class="r">${l.credit || ''}</td><td class="r">${l.running}</td></tr>`).join('')}
</tbody></table></body></html>`);
                          w.document.close();
                          w.focus();
                          w.print();
                        }}
                      >
                        <Printer size={14} aria-hidden="true" /> Sheet
                      </button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => setDrill(null)} className="ui-icon-btn" aria-label="Close account ledger">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </header>

              {drill.rows?.length ? (
                <div className="overflow-x-auto">
                  <table className="ui-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>Narration</th>
                        <th className="ui-num">Debit</th>
                        <th className="ui-num">Credit</th>
                        <th className="ui-num">Running</th>
                      </tr>
                    </thead>
                    <tbody className="ui-rows">
                      {drill.rows.map((l) => (
                        <tr key={l.id}>
                          <td className="ui-col-date">{l.date}</td>
                          <td className="ui-col-id">{l.entryNo}</td>
                          <td className="ui-col-meta max-w-[24rem] truncate" title={l.narration}>
                            {l.narration || l.sourceDocType || '—'}
                          </td>
                          <td className="ui-col-amount">{l.debit ? formatMoney(l.debit, currentCompany) : '—'}</td>
                          <td className="ui-col-amount">{l.credit ? formatMoney(l.credit, currentCompany) : '—'}</td>
                          <td className="ui-col-amount">
                            {l.running >= 0
                              ? `${formatMoney(l.running, currentCompany)} Dr`
                              : `${formatMoney(-l.running, currentCompany)} Cr`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !drill.loading && !drill.error ? (
                <EmptyState icon={BookOpen} title="No lines in this range" description="Widen the dates to see history." />
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export default LedgerTrialBalance;
