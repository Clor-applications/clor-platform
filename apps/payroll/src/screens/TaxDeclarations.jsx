import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Download, FileText, Printer, Receipt, RotateCcw } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { formatDateIn } from '@ui/utils/dates';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { get24q, getForm16, getTaxDeclaration, listTaxDeclarations, reopenTaxDeclaration, saveTaxDeclaration, verifyTaxDeclaration } from '../api/payrollTaxDeclarations';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { wholeRupees as money } from '@ui/utils/money';
import { escapeHtml } from '@ui/utils/html';

const STATUS = {
  NONE: { label: 'Not declared', pill: 'ui-pill-neutral' },
  DRAFT: { label: 'Draft', pill: 'ui-pill-neutral' },
  SUBMITTED: { label: 'To verify', pill: 'ui-pill-warn' },
  VERIFIED: { label: 'Verified', pill: 'ui-pill-pos' },
};


/** "2026-27" for today, and the year before it. */
const yearOf = (d) => {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const thisYear = yearOf(new Date());
const lastYear = `${Number(thisYear.slice(0, 4)) - 1}-${thisYear.slice(2, 4)}`;

/**
 * Income tax declarations for the year: what people declared (from the
 * portal, or entered here), what their proofs support, and verification.
 * Until verified, tax is withheld on what was declared; after, on what was proved.
 */
const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'SUBMITTED', label: 'To verify', tone: 'outstanding' },
  { value: 'VERIFIED', label: 'Verified', tone: 'paid' },
  { value: 'DRAFT', label: 'Draft', tone: 'partial' },
  { value: 'NONE', label: 'Not declared', tone: 'cancelled' },
];
const regimeOf = (p) => (p.regime === 'OLD' ? 'Old' : 'New');
const COLUMNS = {
  name: (p) => p.name,
  regime: regimeOf,
};
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Employee' },
  { key: 'code', label: 'Code' },
  { key: 'regime', label: 'Regime', value: regimeOf },
  { key: 'declared', label: 'Declared', value: (p) => (p.regime === 'OLD' ? Number(p.declared || 0) : '') },
  { key: 'verified', label: 'Verified', value: (p) => (p.regime === 'OLD' && p.verified != null ? Number(p.verified) : '') },
  { key: 'status', label: 'Status', value: (p) => STATUS[p.status]?.label || p.status },
];

export default function TaxDeclarations() {
  const [fy, setFy] = useState(thisYear);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listTaxDeclarations(fy)
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load declarations.')));
  }, [fy]);
  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(() => data?.people || [], [data]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, people.filter((p) => !t.value || p.status === t.value).length])), [people]);
  const figures = useMemo(
    () => ({
      oldRegime: people.filter((p) => p.regime === 'OLD').length,
      declared: people.filter((p) => p.regime === 'OLD').reduce((a, p) => a + Number(p.declared || 0), 0),
      verified: people.filter((p) => p.regime === 'OLD' && p.verified != null).reduce((a, p) => a + Number(p.verified || 0), 0),
    }),
    [people]
  );
  const inTab = useMemo(() => people.filter((p) => !status || p.status === status), [people, status]);
  const search = useListSearch(inTab, ['name', 'code']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  return (
    <DocumentListShell
      entity="taxDeclaration"
      title="Tax declarations"
      description="Regime and investments for income tax. Tax is withheld on what was declared until the proofs are verified."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search tax declarations' }}
      headerExtras={<Return24q fy={fy} />}
      moreItems={people.length ? [exportMenuItem('Export declarations')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Tax declarations', subtitle: `FY ${fy}`, fileName: `Tax declarations FY ${fy}`, label: 'person/people', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'To verify', value: counts.SUBMITTED || 0, count: true, tone: 'outstanding', Icon: Clock, onSelect: () => setStatus('SUBMITTED') },
        { label: 'Old regime', value: figures.oldRegime, count: true, tone: 'partial', Icon: Receipt },
        { label: 'Declared', value: figures.declared, tone: 'sent', Icon: FileText },
        { label: 'Verified', value: figures.verified, tone: 'paid', Icon: Check, onSelect: () => setStatus('VERIFIED') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Declaration status"
      tabsExtras={
        <select className="ui-select ui-btn-sm !w-auto" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          <option value={thisYear}>FY {thisYear}</option>
          <option value={lastYear}>FY {lastYear}</option>
        </select>
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="name" state={filters} />
                <ColumnHeader label="Regime" col="regime" state={filters} />
                <th scope="col" className="ui-col-h-right">Declared</th>
                <th scope="col" className="ui-col-h-right">Verified</th>
                <th scope="col" className="ui-col-h-center">Status</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={5}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="Nobody matches" description="Nobody in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Receipt}
                        title={status ? `Nobody ${STATUS[status]?.label.toLowerCase()}` : 'Nobody in payroll yet'}
                        description={status ? 'Pick another tab to see everyone.' : 'People paid through payroll appear here. They declare from the employee portal, or HR enters it here.'}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.employeeId} className="ui-row-click" onClick={() => setOpen(p.employeeId)}>
                    <td className="ui-col-entity">
                      {p.name}
                      {p.code ? <span className="ui-caption"> · {p.code}</span> : null}
                    </td>
                    <td className="ui-col-meta">{regimeOf(p)}</td>
                    <td className="ui-col-amount">{p.regime === 'OLD' && p.declared ? money(p.declared) : '—'}</td>
                    <td className="ui-col-amount">{p.verified != null && p.regime === 'OLD' ? money(p.verified) : '—'}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[p.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[p.status]?.label || p.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {open ? <Declaration employeeId={open} fy={fy} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </DocumentListShell>
  );
}

function Declaration({ employeeId, fy, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const take = (row) => {
    setD(row);
    setForm({
      regime: row.regime,
      items: row.items.map((i) => ({ code: i.code, declared: i.declared || '', verified: i.verified ?? '', note: i.note || '' })),
      monthlyRent: row.monthlyRent || '',
      metroCity: row.metroCity,
      landlordPan: row.landlordPan || '',
      seniorSelf: row.seniorSelf,
      seniorParents: row.seniorParents,
    });
  };
  useEffect(() => {
    getTaxDeclaration(employeeId, fy)
      .then(take)
      .catch((e) => setError(String(e?.message || 'Could not load the declaration.')));
  }, [employeeId, fy]);

  const verified = d?.status === 'VERIFIED';
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (code, patch) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.code === code ? { ...i, ...patch } : i)) }));

  const run = async (fn, done) => {
    setBusy(true);
    try {
      take(await fn());
      notify.success(done);
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({
    regime: form.regime,
    items: form.items.map((i) => ({ code: i.code, declared: Number(i.declared) || 0, verified: i.verified === '' ? null : Number(i.verified) || 0, note: i.note || null })),
    monthlyRent: Number(form.monthlyRent) || 0,
    metroCity: form.metroCity,
    landlordPan: form.landlordPan || null,
    seniorSelf: form.seniorSelf,
    seniorParents: form.seniorParents,
  });
  const save = () => run(() => saveTaxDeclaration(employeeId, fy, body()), 'Saved.');
  const verify = async () => {
    const ok = await confirmDialog({
      title: 'Mark the proofs verified?',
      message: 'Tax from the next pay run is worked out on the verified amounts. Blank verified amounts count as nothing proved.',
      confirmLabel: 'Verify',
      tone: 'default',
    });
    if (!ok) return;
    run(async () => {
      await saveTaxDeclaration(employeeId, fy, body());
      return verifyTaxDeclaration(employeeId, fy);
    }, 'Verified.');
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(48rem,96vw)]"
      title={d ? `${d.employeeName} · FY ${fy}` : 'Tax declaration'}
      description={d ? `${STATUS[d.status]?.label || d.status}${d.submittedAt ? ` · declared ${formatDateIn(String(d.submittedAt).slice(0, 10))}` : ''}` : ''}
      actions={
        !form ? null : verified ? (
          <>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => printForm16(employeeId, fy)}>
              <Printer size={14} aria-hidden="true" /> Form 16
            </button>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => run(() => reopenTaxDeclaration(employeeId, fy), 'Reopened.')}>
              <RotateCcw size={14} aria-hidden="true" /> Reopen
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => printForm16(employeeId, fy)}>
              <Printer size={14} aria-hidden="true" /> Form 16
            </button>
          <>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={save}>Save</button>
            {form.regime === 'OLD' ? (
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={verify}>
                <Check size={14} aria-hidden="true" /> Verify proofs
              </button>
            ) : null}
          </>
          </>
        )
      }
    >
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {!form ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <fieldset disabled={verified || busy} className="space-y-4">
          <div>
            <span className="ui-label">Tax regime</span>
            <div className="flex flex-wrap gap-4 text-sm">
              {[
                ['NEW', 'New regime — lower rates, no investment deductions'],
                ['OLD', 'Old regime — deductions for investments, rent and home loan'],
              ].map(([v, label]) => (
                <label key={v} className="inline-flex items-center gap-2">
                  <input type="radio" name="regime" value={v} checked={form.regime === v} onChange={() => set({ regime: v })} /> {label}
                </label>
              ))}
            </div>
          </div>

          {form.regime === 'OLD' ? (
            <>
              <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full">
                  <thead>
                    <tr>
                      <th scope="col">Section</th>
                      <th scope="col" className="ui-col-h-right">Declared</th>
                      <th scope="col" className="ui-col-h-right">Verified</th>
                    </tr>
                  </thead>
                  <tbody className="ui-rows">
                    {d.items.map((meta) => {
                      const i = form.items.find((x) => x.code === meta.code);
                      const cap = (meta.code === '80D_SELF' && form.seniorSelf) || (meta.code === '80D_PARENTS' && form.seniorParents) ? meta.seniorCap : meta.cap;
                      return (
                        <tr key={meta.code}>
                          <td>
                            <span className="text-sm">{meta.label}</span>
                            <span className="ui-caption block">{meta.hint}{cap ? ` Up to ${money(cap)}.` : ''}</span>
                          </td>
                          <td className="ui-col-amount">
                            <input type="number" min="0" step="1" className="ui-input ui-num w-28" aria-label={`${meta.label} declared`} value={i.declared} onChange={(e) => setItem(meta.code, { declared: e.target.value })} />
                          </td>
                          <td className="ui-col-amount">
                            <input type="number" min="0" step="1" className="ui-input ui-num w-28" aria-label={`${meta.label} verified`} placeholder="—" value={i.verified} onChange={(e) => setItem(meta.code, { verified: e.target.value })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="ui-label" htmlFor="tx-rent">Rent a month</label>
                  <input id="tx-rent" type="number" min="0" className="ui-input ui-num w-full" value={form.monthlyRent} onChange={(e) => set({ monthlyRent: e.target.value })} />
                </div>
                <div>
                  <label className="ui-label" htmlFor="tx-pan">Landlord’s PAN</label>
                  <input id="tx-pan" className="ui-input w-full uppercase" maxLength={10} value={form.landlordPan} onChange={(e) => set({ landlordPan: e.target.value })} />
                  <span className="ui-caption">Needed when rent is over ₹1,00,000 a year.</span>
                </div>
                <div className="space-y-2 pt-6 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.metroCity} onChange={(e) => set({ metroCity: e.target.checked })} /> Lives in Delhi, Mumbai, Kolkata or Chennai</label>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.seniorSelf} onChange={(e) => set({ seniorSelf: e.target.checked })} /> They are 60 or older</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.seniorParents} onChange={(e) => set({ seniorParents: e.target.checked })} /> Their parents are 60 or older</label>
              </div>
              <p className="ui-caption">
                Their own PF from salary is added to 80C automatically. The HRA exemption is worked out from their Basic and HRA on each payslip. Enter verified amounts from the
                proofs, then verify.
              </p>
            </>
          ) : (
            <p className="ui-caption">Under the new regime only the standard deduction applies; nothing else needs declaring.</p>
          )}
        </fieldset>
      )}
    </Drawer>
  );
}

const inr = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const QUARTERS = [
  [1, 'Q1 · Apr–Jun'],
  [2, 'Q2 · Jul–Sep'],
  [3, 'Q3 · Oct–Dec'],
  [4, 'Q4 · Jan–Mar'],
];

/** Form 24Q Annexure I for a quarter, as a spreadsheet a return tool can take. */
function Return24q({ fy }) {
  const [quarter, setQuarter] = useState(1);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await get24q(fy, quarter);
      if (!r.rows.length) {
        notify.error('No tax was deducted in that quarter.');
        return;
      }
      downloadCsv({
        fileName: `24Q Annexure I FY ${fy} Q${quarter}`,
        prefixRows: [[`Deductor: ${r.employer.name}`, `TAN: ${r.employer.tan || 'not set'}`, `FY ${fy}`, `Quarter ${quarter}`]],
        columns: [
          { key: 'code', label: 'Employee code' },
          { key: 'pan', label: 'PAN', value: (x) => x.pan || 'PANNOTAVBL' },
          { key: 'name', label: 'Name' },
          { key: 'section', label: 'Section' },
          { key: 'paymentDate', label: 'Date of payment', value: (x) => formatDateIn(x.paymentDate) },
          { key: 'amountPaid', label: 'Amount paid', value: (x) => Number(x.amountPaid).toFixed(2) },
          { key: 'tds', label: 'Tax deducted', value: (x) => Number(x.tds).toFixed(2) },
          { key: 'deducted', label: 'Date of deduction', value: (x) => formatDateIn(x.paymentDate) },
        ],
        rows: r.rows,
      });
      if (r.problems.length) notify.error(`${r.problems.length} without a valid PAN: ${r.problems.map((p) => p.name).join(', ')}.`);
      else notify.success('Downloaded.');
    } catch (e) {
      notify.error(String(e?.message || 'Could not build the return.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <select className="ui-select w-36" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} aria-label="Quarter for 24Q">
        {QUARTERS.map(([q, label]) => (
          <option key={q} value={q}>{label}</option>
        ))}
      </select>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={go}>
        <Download size={16} aria-hidden="true" /> 24Q
      </button>
    </span>
  );
}

/** Form 16 Part B, printable. Part A is downloaded from TRACES. */
async function printForm16(employeeId, fy) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) {
    notify.error('Allow pop-ups for this site to print.');
    return;
  }
  let r;
  try {
    r = await getForm16(fy, employeeId);
  } catch (e) {
    w.close();
    notify.error(String(e?.message || 'Could not build Form 16.'));
    return;
  }
  const p = r.people[0];
  if (!p) {
    w.close();
    notify.error('Nothing has been paid to them in this year yet.');
    return;
  }
  const row = (label, amount, strong) => `<tr${strong ? ' class="t"' : ''}><td>${escapeHtml(label)}</td><td class="r">${inr(amount)}</td></tr>`;
  const lines = (rows) => rows.map((l) => row(`${l.label}${l.claimed !== l.allowed ? ` (claimed ${inr(l.claimed)})` : ''}`, l.allowed)).join('');
  const sum = (rows) => rows.reduce((t, l) => t + l.allowed, 0);
  const months = p.months.map((m) => `<tr><td>${escapeHtml(m.month)}</td><td>${escapeHtml(formatDateIn(m.paymentDate))}</td><td class="r">${inr(m.gross)}</td><td class="r">${inr(m.tds)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Form 16 Part B ${escapeHtml(p.name)} FY ${escapeHtml(fy)}</title>
<style>body{font:12px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0}h2{font-size:13px;margin:16px 0 6px}p{margin:2px 0;color:#333}
table{border-collapse:collapse;width:100%;margin-top:4px}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#f2f2f2}.r{text-align:right}tr.t td{font-weight:600;background:#fafafa}.n{color:#555;margin-top:12px}
@page{size:portrait;margin:12mm}</style></head><body>
<h1>Form 16 — Part B</h1>
<p>Details of salary paid and tax deducted, financial year ${escapeHtml(fy)} (assessment year ${escapeHtml(`${Number(fy.slice(0, 4)) + 1}-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, '0')}`)})</p>
<h2>Employer and employee</h2>
<table><tr><th>Employer</th><td>${escapeHtml(r.employer.name)}</td><th>TAN</th><td>${escapeHtml(r.employer.tan || 'not set')}</td><th>PAN</th><td>${escapeHtml(r.employer.pan || '—')}</td></tr>
<tr><th>Employee</th><td>${escapeHtml(p.name)}${p.designation ? `, ${escapeHtml(p.designation)}` : ''}</td><th>PAN</th><td>${escapeHtml(p.pan || 'not on file')}</td><th>Period</th><td>${escapeHtml(formatDateIn(p.periodFrom))} – ${escapeHtml(formatDateIn(p.periodTo))}</td></tr></table>
<h2>Computation (${p.regime === 'OLD' ? 'old regime' : 'new regime, section 115BAC'})</h2>
<table>
${row('1. Gross salary', p.gross, true)}
${lines(p.exemptions)}
${row('2. Less: allowances exempt under section 10', sum(p.exemptions))}
${row('3. Less: standard deduction under section 16(ia)', p.standardDeduction)}
${p.houseProperty.length ? lines(p.houseProperty) + row('4. Less: loss from house property (interest on housing loan)', sum(p.houseProperty)) : ''}
${lines(p.chapterVIA)}
${row('5. Less: deductions under Chapter VI-A', sum(p.chapterVIA))}
${row('6. Total taxable income', p.taxable, true)}
${row('7. Tax on total income', p.slabTax)}
${row('8. Less: rebate under section 87A', p.rebate)}
${row('9. Health and education cess', p.cess)}
${row('10. Tax payable', p.taxPayable, true)}
${row('11. Tax deducted at source', p.tdsDeducted)}
${row(p.balance >= 0 ? '12. Tax still payable' : '12. Deducted in excess', Math.abs(p.balance || 0), true)}
</table>
<h2>Tax deducted, month by month</h2>
<table><thead><tr><th>Month</th><th>Paid on</th><th class="r">Salary</th><th class="r">TDS</th></tr></thead><tbody className="ui-rows">${months}</tbody></table>
<p class="n">${p.regime === 'OLD' ? `Deductions are as ${p.deductionBasis === 'VERIFIED' ? 'verified from proofs' : 'declared, not yet verified'}. ` : ''}Worked out from approved payslips. Part A (details of tax deposited) is issued from TRACES. Printed ${escapeHtml(new Date().toLocaleString())}.</p>
</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
