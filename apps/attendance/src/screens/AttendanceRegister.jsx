import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { downloadCsv } from '@ui/utils/csv';
import { listReports, runReport, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * The muster roll as a screen: one row per person, one mark per day, read
 * across. The same figures as Reports → Muster roll (it is that report), but
 * coloured, filterable and scrollable rather than a plain export — the view a
 * supervisor opens every morning. ClorTime's Attendance Register.
 */
const TONE = {
  P: { label: 'Present', bg: 'rgb(var(--pos) / 0.14)', fg: 'rgb(var(--pos))' },
  HD: { label: 'Half day', bg: 'rgb(var(--warn) / 0.16)', fg: 'rgb(var(--warn))' },
  A: { label: 'Absent', bg: 'rgb(var(--neg) / 0.14)', fg: 'rgb(var(--neg))' },
  L: { label: 'Leave', bg: 'rgb(var(--info, var(--accent)) / 0.14)', fg: 'rgb(var(--fg))' },
  H: { label: 'Holiday', bg: 'rgb(var(--surface-sunken))', fg: 'rgb(var(--fg-muted))' },
  W: { label: 'Weekly off', bg: 'rgb(var(--surface-sunken))', fg: 'rgb(var(--fg-muted))' },
  '–': { label: 'Not employed', bg: 'transparent', fg: 'rgb(var(--fg-subtle))' },
};

export default function AttendanceRegister() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listReports().then((d) => setDepartments(d?.departments || [])).catch(() => {});
  }, []);
  /* No synchronous resets in the effect: the old month stays on screen until the new one arrives. */
  const load = useCallback(() => runReport('muster', { month, ...(departmentId ? { departmentId } : {}) }).then((r) => { setReport(r); setError(null); }).catch(setError), [month, departmentId]);
  useEffect(() => { load(); }, [load]);
  const loading = !report || report.period !== month;

  const dayCols = useMemo(() => (report ? report.columns.filter((c) => /^\d{2}$/.test(c.key)) : []), [report]);
  const rows = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    return q ? report.rows.filter((r) => `${r.name} ${r.code || ''}`.toLowerCase().includes(q)) : report.rows;
  }, [report, search]);
  /* Which weekday each column is, so the head can show it. */
  const weekday = (dd) => new Date(`${month}-${dd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'UTC' });

  if (error && !report) return <LoadFailed error={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Register"
        description="One mark per person per day — the muster roll, read across."
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            disabled={!report || !rows.length}
            onClick={() => downloadCsv({ fileName: `Attendance register ${month}`, columns: report.columns.map((c) => ({ key: c.key, label: c.label })), rows })}
          >
            <Download size={16} aria-hidden="true" /> Export
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" className="ui-input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <select className="ui-select" style={{ width: 'auto' }} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="search" className="ui-input" style={{ width: '14rem' }} placeholder="Find a person" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a person" />
      </div>
      {loading ? <SkeletonCard lines={8} /> : !rows.length ? (
        <EmptyState title="Nobody on the register" description={search ? 'Nobody matches that name.' : 'No one was employed in this month.'} />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table ui-table-register">
              <thead>
                <tr>
                  <th scope="col" className="ui-th ui-register-sticky">Employee</th>
                  {dayCols.map((c) => (
                    <th key={c.key} scope="col" className="ui-th ui-col-h-center ui-register-day">
                      <span className="block">{c.label}</span>
                      <span className="block ui-caption">{weekday(c.key)}</span>
                    </th>
                  ))}
                  <th scope="col" className="ui-th ui-col-h-right">P</th>
                  <th scope="col" className="ui-th ui-col-h-right">A</th>
                  <th scope="col" className="ui-th ui-col-h-right">L</th>
                  <th scope="col" className="ui-th ui-col-h-right">Off</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.code}-${r.name}`}>
                    <td className="ui-col-entity ui-register-sticky">
                      <span className="block truncate" style={{ maxWidth: '14rem' }}>{r.name}</span>
                      <span className="ui-caption">{r.code}</span>
                    </td>
                    {dayCols.map((c) => {
                      const m = r[c.key] || '';
                      const t = TONE[m];
                      return (
                        <td key={c.key} className="ui-col-h-center ui-register-day" title={t ? t.label : 'Not yet'}>
                          {m ? <span className="ui-register-mark" style={{ backgroundColor: t?.bg, color: t?.fg }}>{m}</span> : null}
                        </td>
                      );
                    })}
                    <td className="ui-col-amount">{r.present}</td>
                    <td className="ui-col-amount">{r.absent}</td>
                    <td className="ui-col-amount">{r.leave}</td>
                    <td className="ui-col-amount">{r.off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-caption px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(TONE).filter(([k]) => k !== '–').map(([k, t]) => (
              <span key={k} className="inline-flex items-center gap-1"><span className="ui-register-mark" style={{ backgroundColor: t.bg, color: t.fg }}>{k}</span> {t.label}</span>
            ))}
            <span>– not employed that day · blank: day to come</span>
          </p>
        </div>
      )}
    </div>
  );
}
