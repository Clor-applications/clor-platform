import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { runListExport } from '@ui/components/list/exportMenu';
import { employeeRegister, leaveRegister, leaveSummary, listEstablishments, musterRoll } from '../api/registers';
import { todayIst } from '@ui/utils/dates';

/**
 * Insights → Registers (HR view audit, gap 4): what a labour inspector asks
 * to see, ready to print or export for an establishment and a period. The
 * register of employees, the leave register, the muster roll (from the day
 * record, so a People-only company has one too) and a leave summary; wages
 * are Payroll's register. These are the content of each register, not a
 * state's certified form.
 *
 * The printed page is a document, black on white whatever the theme, like
 * an invoice (DESIGN.md: printed documents are the exception to tokens).
 */
const REGISTERS = [
  { key: 'employees', label: 'Register of employees', period: 'none', hint: 'Everyone employed today, with the details an inspector reads.' },
  { key: 'leave', label: 'Leave register', period: 'range', hint: 'Approved leave in the period, by person.' },
  { key: 'muster', label: 'Muster roll', period: 'month', hint: 'Each person, each day of the month, from the day record.' },
  { key: 'leave-summary', label: 'Leave summary', period: 'range', hint: 'Leave taken by department and type, paid and unpaid.' },
];

const pad = (n) => String(n).padStart(2, '0');
const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const lastOf = (month) => { const [y, m] = month.split('-').map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const monthTitle = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** Columns that hold figures or day marks: right-aligned (figures) or centred (marks), never left. */
const isFigure = (label) => ['Present', 'Absent', 'Leave', 'Holidays & offs', 'Days', 'People', 'Sl. no.'].includes(label);
const isDay = (label) => /^\d{1,2}$/.test(label);

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .register-print, .register-print * { visibility: visible !important; }
  .register-print { position: absolute; inset: 0 auto auto 0; width: 100%; background: #fff; color: #000; }
  .register-print table { border-collapse: collapse; width: 100%; font-size: 9pt; }
  .register-print th, .register-print td { border: 0.5pt solid #000; padding: 2pt 3pt; color: #000; background: #fff; }
  .register-print .register-noprint { display: none !important; }
  @page { size: A4 landscape; margin: 10mm; }
}`;

export default function Registers({ params = {}, updateParams, register: fixed }) {
  const today = todayIst();
  const p = params || {};
  const set = (patch) => updateParams?.(patch, { push: false });
  const kind = fixed || (REGISTERS.some((r) => r.key === p.register) ? p.register : 'employees');
  const reg = REGISTERS.find((r) => r.key === kind);
  const [month, setMonth] = useState(p.month && /^\d{4}-\d{2}$/.test(p.month) ? p.month : today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [est, setEst] = useState('');
  const places = useRequest(() => listEstablishments(), []);
  const data = useRequest(() => {
    if (kind === 'employees') return employeeRegister(est);
    if (kind === 'muster') return musterRoll(month, est);
    if (!from || !to || to < from) return Promise.resolve(null);
    return kind === 'leave' ? leaveRegister(from, to, est) : leaveSummary(from, to, est);
  }, [kind, month, from, to, est]);
  const d = data.data;
  const period = reg.period === 'month' ? monthTitle(month) : reg.period === 'range' ? `${formatDate(from)} – ${formatDate(to)}` : `As on ${formatDate(d?.generatedOn || today)}`;
  const placeName = d?.establishment?.name || (est ? (places.data || []).find((x) => x.id === est)?.name : '') || '';
  const establishmentOptions = useMemo(() => [{ value: '', label: 'Whole company' }, ...(places.data || []).map((x) => ({ value: x.id, label: x.state ? `${x.name} (${x.state})` : x.name }))], [places.data]);

  const exportCsv = () => {
    if (!d?.rows?.length) return;
    try {
      const columns = d.columns.map((label, i) => ({ key: `c${i}`, label }));
      const rows = [...d.rows, ...(d.totals ? [d.totals] : [])].map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
      const slug = reg.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      runListExport({ format: 'csv', fileName: `${slug}-${reg.period === 'month' ? month : reg.period === 'range' ? `${from}-to-${to}` : d.generatedOn || today}`, columns, rows, label: 'rows', title: reg.label });
      notify.success('Exported.');
    } catch (e) {
      notify.error(String(e?.message || 'Could not export.'));
    }
  };

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Reports' }]}
        title={fixed ? reg.label : 'Statutory registers'}
        actions={<>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={!d?.rows?.length} onClick={exportCsv}><Download size={16} aria-hidden="true" /> Export CSV</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={!d?.rows?.length} onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>
        </>}
      />

      <div className="flex flex-wrap items-end gap-3">
        {!fixed ? (
          <div className="w-full sm:w-64">
            <PopupSelect showValueSubtext={false} label="Register" value={kind} onChange={(v) => v && set({ register: v === 'employees' ? null : v })} options={REGISTERS.map((r) => ({ value: r.key, label: r.label }))} />
          </div>
        ) : null}
        {(places.data || []).length ? (
          <div className="w-full sm:w-64"><PopupSelect showValueSubtext={false} label="Establishment" value={est} onChange={(v) => setEst(v || '')} options={establishmentOptions} /></div>
        ) : null}
        {reg.period === 'month' ? (
          <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-36 text-center font-medium" aria-live="polite">{monthTitle(month)}</span>
            <button type="button" className="ui-icon-btn" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        ) : null}
        {reg.period === 'range' ? (
          <>
            <div className="w-44"><span className="ui-label" id="reg-from">From</span><DatePicker label="From" describedBy="reg-from" value={from} max={to || undefined} onChange={(v) => setFrom(v || '')} /></div>
            <div className="w-44"><span className="ui-label" id="reg-to">To</span><DatePicker label="To" describedBy="reg-to" value={to} min={from || undefined} onChange={(v) => setTo(v || '')} /></div>
            <div className="inline-flex gap-1" role="group" aria-label="Quick periods">
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { const m = shiftMonth(today.slice(0, 7), -1); setFrom(`${m}-01`); setTo(lastOf(m)); }}>Last month</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }}>This month</button>
            </div>
          </>
        ) : null}
      </div>
      <p className="ui-caption">{reg.hint} Wages are in Payroll’s registers.</p>

      {data.error && !d ? <ErrorState error={data.error} onRetry={data.reload} /> : data.loading && !d ? <SkeletonCard lines={8} /> : !d ? (
        <EmptyState title="Choose a period" description="The end has to be on or after the start." />
      ) : (
        <section className="register-print space-y-3" aria-label={reg.label}>
          <header className="space-y-0.5">
            <h2 className="ui-t-sec">{reg.label}</h2>
            <p className="text-sm">{[placeName, d.establishment?.state, period].filter(Boolean).join(' · ')}</p>
            {d.establishment?.address ? <p className="ui-caption">{d.establishment.address}</p> : null}
          </header>
          {!d.rows.length ? (
            <div className="register-noprint"><EmptyState title="Nothing in this register for the period" /></div>
          ) : (
            <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }}>
              <table className={`w-full border-collapse ${kind === 'muster' ? 'text-xs' : 'text-sm'}`} aria-label={reg.label}>
                <thead>
                  <tr>
                    {d.columns.map((c, i) => <th key={i} scope="col" className={`p-2 font-medium ${isDay(c) ? 'text-center p-0.5 min-w-5' : isFigure(c) ? 'text-right' : 'text-left'}`}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, ri) => (
                    <tr key={ri} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                      {r.map((v, i) => <td key={i} className={`p-2 align-top ${isDay(d.columns[i]) ? 'text-center p-0.5' : isFigure(d.columns[i]) ? 'text-right tabular-nums' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'tabular-nums whitespace-nowrap' : ''}`}>{v}</td>)}
                    </tr>
                  ))}
                  {d.totals ? (
                    <tr className="border-t font-medium" style={{ borderColor: 'rgb(var(--border-strong))' }}>
                      {d.totals.map((v, i) => <td key={i} className={`p-2 ${isFigure(d.columns[i]) ? 'text-right tabular-nums' : ''}`}>{v}</td>)}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          {(d.notes || []).map((n) => <p key={n} className="ui-caption">{n}</p>)}
          <p className="ui-caption">Made on {formatDate(d.generatedOn || today)} from CLOR People. {d.rows.length} {d.rows.length === 1 ? 'row' : 'rows'}.</p>
        </section>
      )}
    </div>
  );
}

/** Insights → Leave Summary: the same page, held on the leave summary. */
export function LeaveSummaryReport(props) {
  return <Registers {...props} register="leave-summary" />;
}
