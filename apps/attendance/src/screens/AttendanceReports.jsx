import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, History, Mail, Play, Printer } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { PageHeader, SkeletonCard, EmptyState, StatTile } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { exportListXlsx } from '@ui/utils/listXlsx';
import { createReportSchedule, deleteReportSchedule, listReportSchedules, listReports, listScheduleRuns, runReport, sendReportSchedule, todayIst, updateReportSchedule } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The report as a real spreadsheet: a column is numeric only if every value in it is a number. */
function exportXlsx(result) {
  const numeric = (key) => result.rows.length > 0 && result.rows.every((r) => r[key] === '' || r[key] == null || (typeof r[key] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[key]))));
  exportListXlsx({
    fileName: `${result.title} ${result.period}`,
    sheetName: result.title,
    columns: result.columns.map((c) => ({ key: c.key, label: c.label, ...(c.align === 'end' && numeric(c.key) ? { type: 'number' } : {}) })),
    rows: result.totals ? [...result.rows, result.totals] : result.rows,
  });
}

/** A plain printable page: the inspector's copy of a register. */
function printReport(r) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) {
    notify.error('Allow pop-ups for this site to print.');
    return;
  }
  const head = r.columns.map((c) => `<th style="text-align:${c.align === 'end' ? 'right' : c.align === 'center' ? 'center' : 'left'}">${escapeHtml(c.label)}</th>`).join('');
  const body = r.rows
    .map((row) => `<tr>${r.columns.map((c) => `<td style="text-align:${c.align === 'end' ? 'right' : c.align === 'center' ? 'center' : 'left'}">${escapeHtml(row[c.key])}</td>`).join('')}</tr>`)
    .join('');
  const totals = r.totals ? `<tr class="t">${r.columns.map((c) => `<td>${escapeHtml(r.totals[c.key] ?? '')}</td>`).join('')}</tr>` : '';
  const notes = (r.notes || []).map((n) => `<p class="n">${escapeHtml(n)}</p>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(r.title)} ${escapeHtml(r.period)}</title>
<style>body{font:11px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0}h2{font-size:12px;font-weight:400;margin:2px 0 10px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px}th{background:#f2f2f2}tr.t td{font-weight:600;background:#fafafa}.n{color:#444;margin:6px 0 0}
@page{size:${r.columns.length > 14 ? 'landscape' : 'portrait'};margin:10mm}</style></head><body>
<h1>${escapeHtml(r.title)}</h1><h2>${escapeHtml(r.period)} · printed ${escapeHtml(new Date().toLocaleString())}</h2>
<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>${notes}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

/* Period shortcuts, by the kind of period a report takes. */
const iso = (d) => d.toISOString().slice(0, 10);
const shiftDays = (day, n) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
const monthOf = (day, back = 0) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 - back, 1));
  return iso(d).slice(0, 7);
};
const lastDayOf = (m) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const presetsFor = (report) => {
  const t = todayIst();
  if (report.params.includes('date')) return [{ label: 'Today', set: { date: t } }, { label: 'Yesterday', set: { date: shiftDays(t, -1) } }];
  if (report.params.includes('month')) return [{ label: 'This month', set: { month: monthOf(t) } }, { label: 'Last month', set: { month: monthOf(t, 1) } }];
  if (report.params.includes('from')) {
    const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const last = monthOf(t, 1);
    return [
      { label: 'This week', set: { from: shiftDays(t, -dow), to: t } },
      { label: 'This month', set: { from: `${monthOf(t)}-01`, to: t } },
      { label: 'Last month', set: { from: `${last}-01`, to: lastDayOf(last) } },
      { label: 'Last 30 days', set: { from: shiftDays(t, -29), to: t } },
    ];
  }
  return [];
};
/* Report groups, in the order the page shows them. */
const GROUPS = ['Attendance', 'Workforce', 'Statutory Registers', 'Devices', 'People'];

/**
 * Attendance reports (ClorTime's catalogue), upgraded on 21 Oct 2026:
 *  - one list of reports: the sidebar's named reports, and this library page
 *    with every report grouped and searchable; one name for each;
 *  - a report opens already run, for this month or today, and re-runs as
 *    its period or filters change, with shortcuts for the usual periods;
 *  - the same filters on every report that covers people (department,
 *    location, contractor, person);
 *  - the few figures that matter above each table, from the server
 *    (figuresFor), so they always agree with the rows;
 *  - export, print and schedule in the report's header.
 *
 * `initialReport` opens it on one report (the sidebar's named reports).
 */
export default function AttendanceReports({ openScreen, initialReport = '' } = {}) {
  const [catalogue, setCatalogue] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ date: todayIst(), month: todayIst().slice(0, 7), from: `${todayIst().slice(0, 7)}-01`, to: todayIst(), departmentId: '', employeeId: '', areaId: '', contractorId: '' });
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState('');
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState(0);

  useEffect(() => {
    listReports()
      .then((v) => {
        setCatalogue(v);
        setLoadError('');
        if (initialReport) setActive((a) => a || v?.reports?.find((r) => r.id === initialReport) || null);
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load reports.')));
  }, [attempt, initialReport]);

  const filters = useColumnFilters();
  const shownRows = result ? filters.applyFilters(result.rows, Object.fromEntries(result.columns.filter((c) => c.align !== 'end').map((c) => [c.key, (row) => row[c.key]]))) : [];
  const covers = (r) => r.params.includes('department') || r.id === 'contractor';
  const paramsFor = (r, f) => {
    const p = {};
    for (const k of r.params) {
      if (k === 'department') Object.assign(p, { departmentId: f.departmentId, areaId: f.areaId, contractorId: f.contractorId, employeeId: f.employeeId });
      else if (k === 'employee') p.employeeId = f.employeeId;
      else p[k] = f[k];
    }
    if (r.id === 'contractor') Object.assign(p, { areaId: f.areaId, contractorId: f.contractorId });
    return p;
  };

  /* Runs on open and again when the period or a filter changes; the last answer wins. */
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      setRunning(true);
      runReport(active.id, paramsFor(active, form))
        .then((r) => { if (live) { setResult(r); setRunError(''); filters.clearAll(); } })
        .catch((e) => { if (live) { setResult(null); setRunError(String(e?.message || 'The report did not run.')); } })
        .finally(() => { if (live) setRunning(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters is a fresh object each render; clearing it must not re-run the report
  }, [active, form, runs]);

  const open = (r) => {
    setResult(null);
    setRunError('');
    setActive(r);
  };
  /* A row that names a person (by employee code) opens their days in Records for the row's day or the report's period. */
  const byCode = new Map((catalogue?.employees || []).filter((e) => e.code).map((e) => [String(e.code), e.id]));
  const drill = (row) => {
    if (!openScreen || !row) return null;
    const employeeId = byCode.get(String(row.code ?? row.employeeCode ?? ''));
    if (!employeeId) return null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')) ? row.date : null;
    const from = day || (active?.params.includes('month') ? `${form.month}-01` : active?.params.includes('date') ? form.date : form.from);
    const to = day || (active?.params.includes('month') ? lastDayOf(form.month) : active?.params.includes('date') ? form.date : form.to);
    return () => openScreen('records', { employeeId, from, to });
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const exportCsv = () => downloadCsv({ fileName: `${result.title} ${result.period}`, columns: result.columns.map((c) => ({ key: c.key, label: c.label })), rows: result.rows, footerRows: result.totals ? [result.totals] : [] });
  const toSchedule = () => document.getElementById('report-schedules')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!catalogue) return loadError ? <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonCard lines={6} />;

  /* The library: every report, grouped, searchable. */
  if (!active) {
    const q = query.trim().toLowerCase();
    const matches = catalogue.reports.filter((r) => !q || `${r.name} ${r.description}`.toLowerCase().includes(q));
    return (
      <div className="space-y-3">
        <PageHeader entity="report" title="Report catalogue" description="Every attendance report and statutory register. Open one to see it for this month or today." />
        <div className="pb-8 space-y-5">
          <input type="search" className="ui-input w-full max-w-md" placeholder="Search reports…" aria-label="Search reports" value={query} onChange={(e) => setQuery(e.target.value)} />
          {!matches.length ? <EmptyState kind="filtered" totalCount={catalogue.reports.length} title="No report matches" description="Try another word." /> : null}
          {GROUPS.map((g) => {
            const list = matches.filter((r) => (r.group || 'Attendance') === g);
            if (!list.length) return null;
            return (
              <section key={g} aria-labelledby={`grp-${g}`} className="space-y-2">
                <h2 id={`grp-${g}`} className="ui-t-sec">{g}</h2>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="ui-card ui-report-card" onClick={() => open(r)}>
                        <span className="font-medium">{r.name}</span>
                        <span className="ui-caption">{r.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <Scheduled catalogue={catalogue} form={form} active={null} />
        </div>
      </div>
    );
  }

  const presets = presetsFor(active);
  const isPreset = (p) => Object.entries(p.set).every(([k, v]) => form[k] === v);
  return (
    <div className="space-y-3">
      <PageHeader
        entity="report"
        title={active.name}
        description={active.description}
        actions={
          <>
            {!initialReport ? <button type="button" className="ui-btn ui-btn-ghost" onClick={() => { setActive(null); setResult(null); }}>All reports</button> : null}
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => exportXlsx(result)} disabled={!result?.rows.length}><FileSpreadsheet size={16} aria-hidden="true" /> Excel</button>
            <MoreButton
              items={[
                { key: 'csv', label: 'Export CSV', Icon: Download },
                { key: 'print', label: 'Print', Icon: Printer },
                { key: 'schedule', label: 'E-mail on a schedule', Icon: Mail },
              ]}
              onSelect={(k) => {
                if (k === 'schedule') return toSchedule();
                if (!result) return;
                if (k === 'csv') exportCsv();
                else if (k === 'print') printReport(result);
              }}
            />
          </>
        }
      />
      <div className="pb-8 space-y-3">
        <section className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label={`${active.name} options`}>
          {presets.length ? (
            <div className="ui-segmented" role="tablist" aria-label="Period">
              {presets.map((p) => (
                <button key={p.label} type="button" role="tab" className="ui-segment" aria-selected={isPreset(p)} onClick={() => setForm((f) => ({ ...f, ...p.set }))}>{p.label}</button>
              ))}
            </div>
          ) : null}
          {active.params.includes('date') ? (
            <label className="block"><span className="ui-label">Day</span><input type="date" className="ui-input" max={todayIst()} value={form.date} onChange={set('date')} /></label>
          ) : null}
          {active.params.includes('month') ? (
            <label className="block"><span className="ui-label">Month</span><input type="month" className="ui-input" value={form.month} onChange={set('month')} /></label>
          ) : null}
          {active.params.includes('from') ? (
            <>
              <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={form.from} max={form.to} onChange={set('from')} /></label>
              <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={form.to} onChange={set('to')} /></label>
            </>
          ) : null}
          {covers(active) && catalogue.departments.length ? (
            <label className="block"><span className="ui-label">Department</span>
              <select className="ui-select" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">All</option>
                {catalogue.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          ) : null}
          {covers(active) && (catalogue.areas || []).length ? (
            <label className="block"><span className="ui-label">Location</span>
              <select className="ui-select" value={form.areaId} onChange={set('areaId')}>
                <option value="">All</option>
                {catalogue.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ) : null}
          {covers(active) && (catalogue.contractors || []).length ? (
            <label className="block"><span className="ui-label">Contractor</span>
              <select className="ui-select" value={form.contractorId} onChange={set('contractorId')}>
                <option value="">All</option>
                {catalogue.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : null}
          {(covers(active) || active.params.includes('employee')) && (catalogue.employees || []).length ? (
            <label className="block"><span className="ui-label">Person</span>
              <select className="ui-select" value={form.employeeId} onChange={set('employeeId')}>
                <option value="">Everyone</option>
                {catalogue.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.code ? ` · ${e.code}` : ''}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setRuns((n) => n + 1)} disabled={running} title="Run again for the latest data">
            <Play size={16} aria-hidden="true" /> {running ? 'Running…' : 'Refresh'}
          </button>
        </section>

        {runError ? <p className="ui-card p-4 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{runError}</p> : null}
        {!result && !runError ? <SkeletonCard lines={6} /> : null}

        {result?.figures?.length ? (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Summary">
            {result.figures.map((f) => <StatTile key={f.label} label={f.label} value={f.value} hint={f.hint} tone={f.tone || 'neutral'} />)}
          </section>
        ) : null}

        {result ? (
          <section className="ui-card overflow-hidden" aria-label={result.title} aria-busy={running || undefined}>
            <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
              <div className="min-w-0">
                {/* The page title names the report; the printed copy keeps the register's own title (result.title). */}
                <h2 className="ui-t-sec">{result.period}</h2>
                <p className="ui-caption">{result.rows.length} rows{openScreen && result.rows.some((r) => drill(r)) ? ' · click a row to open its days' : ''}</p>
              </div>
            </div>
            {result.notes?.length ? (
              <ul className="space-y-1 px-4 pt-2 text-xs">
                {result.notes.map((n) => <li key={n} className={n.startsWith('Nobody') ? '' : 'ui-muted'} style={n.startsWith('Nobody') ? { color: 'rgb(var(--warn-ink))' } : undefined}>{n}</li>)}
              </ul>
            ) : null}
            <div className="mt-2 ui-table-scroll">
              <table className="ui-table ui-table-sticky w-full">
                <thead>
                  <tr>
                    {result.columns.map((c) =>
                      c.align === 'end' ? (
                        <th key={c.key} scope="col" className="ui-num whitespace-nowrap">{c.label}</th>
                      ) : (
                        <ColumnHeader key={c.key} label={c.label} col={c.key} state={filters} align={c.align === 'center' ? 'center' : 'left'} className="whitespace-nowrap" />
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {!shownRows.length ? (
                    <tr>
                      <td colSpan={result.columns.length}>
                        {result.rows.length ? (
                          <EmptyState kind="filtered" totalCount={result.rows.length} title="No rows match" description="Nothing matches the column filters." />
                        ) : (
                          <EmptyState icon={FileSpreadsheet} title="Nothing in this period" description="Try another period or filter." />
                        )}
                      </td>
                    </tr>
                  ) : (
                    shownRows.map((row, i) => (
                      <tr key={i} className={drill(row) ? 'ui-row-click' : undefined} onClick={drill(row) ? () => drill(row)() : undefined} title={drill(row) ? 'Open these days in Records' : undefined}>
                        {result.columns.map((c) => (
                          <td key={c.key} className={`${c.align === 'end' ? 'ui-num' : c.align === 'center' ? 'ui-col-h-center' : ''} whitespace-nowrap`}>{row[c.key] ?? ''}</td>
                        ))}
                      </tr>
                    ))
                  )}
                  {/* The totals are of every row; with a column filter on they would not add up to what is shown. */}
                  {result.totals && shownRows.length && !Object.keys(filters.filters).length ? (
                    <tr className="font-semibold">
                      {result.columns.map((c) => (
                        <td key={c.key} className={`${c.align === 'end' ? 'ui-num' : ''} whitespace-nowrap`}>{result.totals[c.key] ?? ''}</td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        <div id="report-schedules">
          <Scheduled catalogue={catalogue} form={form} active={active} />
        </div>
      </div>
    </div>
  );
}

const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Reports by e-mail on their own: daily (yesterday), weekly (the week just
 * ended), monthly (the month just ended), at an hour, to a list. The filters
 * come from the form above when a schedule is made from a chosen report.
 */
function Scheduled({ catalogue, form, active }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [runs, setRuns] = useState(null);
  const load = useCallback(() => listReportSchedules().then(setRows).catch(() => setRows([])), []);
  const showRuns = async (s) => {
    if (runs?.id === s.id) { setRuns(null); return; }
    try { setRuns({ id: s.id, list: await listScheduleRuns(s.id) }); } catch (err) { notify.error(String(err?.message || 'Could not load the history.')); }
  };
  useEffect(() => { load(); }, [load]);
  const start = () => setDraft({ reportId: active?.id || catalogue.reports[0].id, cadence: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, hour: 7, recipients: '', params: { ...(form.departmentId ? { departmentId: form.departmentId } : {}), ...(form.employeeId ? { employeeId: form.employeeId } : {}), ...(form.areaId ? { areaId: form.areaId } : {}), ...(form.contractorId ? { contractorId: form.contractorId } : {}) } });
  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    try {
      await createReportSchedule(draft);
      notify.success('Scheduled. “Send now” to see it arrive.');
      setDraft(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  const when = (s) => `${s.cadence === 'DAILY' ? 'Every day' : s.cadence === 'WEEKLY' ? `Every ${DOW[(s.dayOfWeek || 1) - 1]}` : `On the ${s.dayOfMonth || 1}${[1, 21].includes(s.dayOfMonth) ? 'st' : [2, 22].includes(s.dayOfMonth) ? 'nd' : [3, 23].includes(s.dayOfMonth) ? 'rd' : 'th'}`} at ${String(s.hour).padStart(2, '0')}:00`;
  return (
    <section className="ui-card space-y-3 p-4" aria-labelledby="sched-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sched-h" className="ui-t-sec flex items-center gap-2"><Mail size={16} aria-hidden="true" /> Scheduled</h2>
        {!draft ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={start}>{active ? `E-mail “${active.name}” on a schedule` : 'E-mail a report on a schedule'}</button> : null}
      </div>
      <p className="ui-caption">A daily one covers yesterday, a weekly one the week just ended, a monthly one the month just ended. Sent from the company’s mail settings as a table, with the CSV attached.</p>
      {!rows ? null : rows.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.reportName} <span className="ui-caption font-normal">· {when(s)}</span></div>
                <div className="ui-caption">To {s.recipients}{s.lastSentAt ? ` · last sent ${new Date(s.lastSentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ' · not sent yet'}</div>
                {s.lastError ? <div className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{s.lastError}</div> : null}
                {runs?.id === s.id ? (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {runs.list.length ? runs.list.slice(0, 12).map((r) => (
                      <li key={r.id} className="flex gap-2"><span className={`ui-pill ui-pill-${r.ok ? 'pos' : 'neg'}`}>{r.ok ? 'sent' : 'failed'}</span><span className="ui-caption">{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{r.ok ? ` · ${r.rows} rows to ${r.recipients}` : ` · ${r.error}`}</span></li>
                    )) : <li className="ui-caption">Not run yet.</li>}
                  </ul>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className={`ui-pill ${s.enabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{s.enabled ? 'On' : 'Off'}</span>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === s.id} onClick={async () => { setBusy(s.id); try { const r = await sendReportSchedule(s.id); (r.ok ? notify.success : notify.error)(r.ok ? `Sent to ${r.sent}.` : r.error); load(); } finally { setBusy(''); } }}>Send now</button>
                <button type="button" className="ui-icon-btn" title="When it was sent" aria-label={`History of ${s.reportName}`} onClick={() => showRuns(s)}><History size={15} aria-hidden="true" /></button>
                <button type="button" className="ui-link text-sm" onClick={() => updateReportSchedule(s.id, { enabled: !s.enabled }).then(load)}>{s.enabled ? 'Pause' : 'Resume'}</button>
                <button type="button" className="ui-link text-sm" onClick={async () => { if (await confirmDialog({ title: 'Stop this schedule?', message: `${s.reportName} will no longer be e-mailed.`, confirmLabel: 'Stop' })) { await deleteReportSchedule(s.id); load(); } }}>Stop</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ui-caption">Nothing scheduled yet.</p>}
      {draft ? (
        <form onSubmit={save} className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block md:col-span-2"><span className="ui-label">Report</span>
              <select className="ui-select w-full" value={draft.reportId} onChange={(e) => setDraft({ ...draft, reportId: e.target.value })}>
                {catalogue.reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">How often</span>
              <select className="ui-select w-full" value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}>
                <option value="DAILY">Every day</option><option value="WEEKLY">Every week</option><option value="MONTHLY">Every month</option>
              </select>
            </label>
            {draft.cadence === 'WEEKLY' ? (
              <label className="block"><span className="ui-label">On</span><select className="ui-select w-full" value={draft.dayOfWeek} onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}>{DOW.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>
            ) : draft.cadence === 'MONTHLY' ? (
              <label className="block"><span className="ui-label">Day of month</span><input type="number" min={1} max={28} className="ui-input w-full" value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })} /></label>
            ) : <div />}
            <label className="block"><span className="ui-label">At (hour, IST)</span><input type="number" min={0} max={23} className="ui-input w-full" value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })} /></label>
            <label className="block md:col-span-3"><span className="ui-label">To</span><input className="ui-input w-full" required placeholder="owner@company.in, hr@company.in" value={draft.recipients} onChange={(e) => setDraft({ ...draft, recipients: e.target.value })} /></label>
          </div>
          {Object.keys(draft.params).length ? <p className="ui-caption">With the filters chosen above ({Object.entries(draft.params).map(([k, v]) => `${{ departmentId: 'department', employeeId: 'person', areaId: 'site', contractorId: 'contractor' }[k] || k}: ${v}`).join(', ')}).</p> : null}
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy === 'save'}>Schedule</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
