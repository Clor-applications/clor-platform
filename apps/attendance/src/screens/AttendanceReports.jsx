import React, { useCallback, useEffect, useState } from 'react';
import { Download, Mail, Play, Printer } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { createReportSchedule, deleteReportSchedule, listReportSchedules, listReports, runReport, sendReportSchedule, todayIst, updateReportSchedule } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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

/**
 * Attendance reports and statutory registers (ClorTime's catalogue). Pick one,
 * set its dates, run it; export to a spreadsheet or print it.
 */
export default function AttendanceReports() {
  const [catalogue, setCatalogue] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ date: todayIst(), month: todayIst().slice(0, 7), from: `${todayIst().slice(0, 7)}-01`, to: todayIst(), departmentId: '', employeeId: '' });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    listReports().then((v) => { setCatalogue(v); setLoadError(''); setActive((a) => a || v?.reports?.[0] || null); }).catch((e) => setLoadError(String(e?.message || 'Could not load reports.')));
  }, [attempt]);

  const pick = (r) => {
    setActive(r);
    setResult(null);
  };
  const run = async () => {
    if (!active) return;
    setRunning(true);
    try {
      const p = {};
      for (const k of active.params) {
        if (k === 'department') p.departmentId = form.departmentId;
        else if (k === 'employee') p.employeeId = form.employeeId;
        else p[k] = form[k];
      }
      setResult(await runReport(active.id, p));
    } catch (e) {
      notify.error(String(e?.message || 'The report did not run.'));
    } finally {
      setRunning(false);
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!catalogue) return loadError ? <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonCard lines={6} />;

  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Reports" description="Attendance reports and the statutory registers — muster roll, overtime and leave." />
      <div className="grid items-start gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Reports" className="ui-card p-2">
          <ul className="space-y-0.5">
            {catalogue.reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={active?.id === r.id ? 'true' : undefined}
                  className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ui-hover-sunken ${active?.id === r.id ? 'font-medium' : ''}`}
                  title={r.description}
                  style={active?.id === r.id ? { backgroundColor: 'rgb(var(--surface-sunken))' } : undefined}
                  onClick={() => pick(r)}
                >
                  <div>{r.name}</div>
                  {/* Only the chosen one explains itself; twelve descriptions at once is a page of reading. */}
                  {active?.id === r.id ? <div className="ui-caption">{r.description}</div> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          {!active ? (
            <EmptyState title="Choose a report" description="Pick one on the left." />
          ) : (
            <>
              <section className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label={`${active.name} options`}>
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
                {active.params.includes('employee') ? (
                  <label className="block"><span className="ui-label">Person</span>
                    <select className="ui-select" value={form.employeeId} onChange={set('employeeId')}>
                      <option value="">Everyone</option>
                      {(catalogue.employees || []).map((e) => <option key={e.id} value={e.id}>{e.name}{e.code ? ` · ${e.code}` : ''}</option>)}
                    </select>
                  </label>
                ) : null}
                {active.params.includes('department') && catalogue.departments.length ? (
                  <label className="block">
                    <span className="ui-label">Department</span>
                    <select className="ui-select" value={form.departmentId} onChange={set('departmentId')}>
                      <option value="">All</option>
                      {catalogue.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <button type="button" className="ui-btn ui-btn-primary" onClick={run} disabled={running}>
                  <Play size={16} aria-hidden="true" /> {running ? 'Running…' : 'Run'}
                </button>
                {result ? (
                  <>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary"
                      onClick={() => downloadCsv({ fileName: `${result.title} ${result.period}`, columns: result.columns.map((c) => ({ key: c.key, label: c.label })), rows: result.rows, footerRows: result.totals ? [result.totals] : [] })}
                    >
                      <Download size={16} aria-hidden="true" /> Export
                    </button>
                    <button type="button" className="ui-btn ui-btn-secondary" onClick={() => printReport(result)}>
                      <Printer size={16} aria-hidden="true" /> Print
                    </button>
                  </>
                ) : null}
              </section>

              {result ? (
                <section className="ui-card overflow-hidden" aria-label={result.title}>
                  <div className="px-4 pt-3">
                    <h2 className="ui-t-sec">{result.title}</h2>
                    <p className="ui-caption">{result.period} · {result.rows.length} rows</p>
                  </div>
                  {result.notes?.length ? (
                    <ul className="space-y-1 px-4 pt-2 text-xs">
                      {result.notes.map((n) => <li key={n} className={n.startsWith('Nobody') ? '' : 'ui-muted'} style={n.startsWith('Nobody') ? { color: 'rgb(var(--warn-ink))' } : undefined}>{n}</li>)}
                    </ul>
                  ) : null}
                  {!result.rows.length ? (
                    <p className="ui-muted p-6 text-center text-sm">Nothing in this period.</p>
                  ) : (
                    <div className="mt-2 overflow-x-auto ui-table-scroll ui-table-fit">
                      <table className="ui-table w-full text-sm">
                        <thead>
                          <tr>
                            {result.columns.map((c) => (
                              <th key={c.key} scope="col" className={`ui-th whitespace-nowrap ${c.align === 'end' ? 'text-end' : c.align === 'center' ? 'ui-col-h-center' : ''}`}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>
                              {result.columns.map((c) => (
                                <td key={c.key} className={`${c.align === 'end' ? 'text-end tabular-nums' : c.align === 'center' ? 'ui-col-h-center' : ''} whitespace-nowrap`}>{row[c.key] ?? ''}</td>
                              ))}
                            </tr>
                          ))}
                          {result.totals ? (
                            <tr className="font-semibold">
                              {result.columns.map((c) => (
                                <td key={c.key} className={`${c.align === 'end' ? 'text-end tabular-nums' : ''} whitespace-nowrap`}>{result.totals[c.key] ?? ''}</td>
                              ))}
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
      <Scheduled catalogue={catalogue} form={form} active={active} />
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
  const load = useCallback(() => listReportSchedules().then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const start = () => setDraft({ reportId: active?.id || catalogue.reports[0].id, cadence: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, hour: 7, recipients: '', params: { ...(form.departmentId ? { departmentId: form.departmentId } : {}), ...(form.employeeId ? { employeeId: form.employeeId } : {}) } });
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
      <p className="ui-caption">A daily one covers yesterday, a weekly one the week just ended, a monthly one the month just ended. Sent from the company’s mail settings as a table.</p>
      {!rows ? null : rows.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.reportName} <span className="ui-caption font-normal">· {when(s)}</span></div>
                <div className="ui-caption">To {s.recipients}{s.lastSentAt ? ` · last sent ${new Date(s.lastSentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ' · not sent yet'}</div>
                {s.lastError ? <div className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{s.lastError}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <span className={`ui-pill ${s.enabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{s.enabled ? 'On' : 'Off'}</span>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === s.id} onClick={async () => { setBusy(s.id); try { const r = await sendReportSchedule(s.id); (r.ok ? notify.success : notify.error)(r.ok ? `Sent to ${r.sent}.` : r.error); load(); } finally { setBusy(''); } }}>Send now</button>
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
          {Object.keys(draft.params).length ? <p className="ui-caption">With the filters chosen above ({Object.entries(draft.params).map(([k, v]) => `${k === 'departmentId' ? 'department' : 'person'}: ${v}`).join(', ')}).</p> : null}
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy === 'save'}>Schedule</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
