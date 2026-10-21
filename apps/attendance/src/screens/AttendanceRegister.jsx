import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarOff, Users, UserX } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
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

const COLUMNS = { name: (r) => `${r.name} ${r.code || ''}`.trim() };

export default function AttendanceRegister() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listReports().then((d) => setDepartments(d?.departments || [])).catch(() => {});
  }, []);
  /* No synchronous resets in the effect: the old month stays on screen until the new one arrives. */
  const load = useCallback(() => runReport('muster', { month, ...(departmentId ? { departmentId } : {}) }).then((r) => { setReport(r); setError(null); }).catch(setError), [month, departmentId]);
  useEffect(() => { load(); }, [load]);
  const loading = !report || report.period !== month;

  const dayCols = useMemo(() => (report ? report.columns.filter((c) => /^\d{2}$/.test(c.key)) : []), [report]);
  const search = useListSearch(report?.rows || [], ['name', 'code']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const list = report?.rows || [];
    const sum = (k) => list.reduce((a, r) => a + Number(r[k] || 0), 0);
    return { people: list.length, present: sum('present'), absent: sum('absent'), leave: sum('leave') };
  }, [report]);
  /* Which weekday each column is, so the head can show it. */
  const weekday = (dd) => new Date(`${month}-${dd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'UTC' });

  if (error && !report) return <LoadFailed error={error} onRetry={load} />;

  return (
    <DocumentListShell
      entity="report"
      title="Daily attendance register"
      description="One mark per person per day — the muster roll, read across."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Find a person…', label: 'Find a person' }}
      headerExtras={
        <>
          <input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          <select className="ui-select ui-ctl-compact !w-auto" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </>
      }
      moreItems={[exportMenuItem('Export register')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format || !report || !rows.length) return;
        runListExport({ format, title: 'Attendance register', subtitle: month, fileName: `Attendance register ${month}`, label: 'person/people', columns: report.columns.map((c) => ({ key: c.key, label: c.label })), rows });
      }}
      cards={loading ? null : [
        { label: 'People', value: figures.people, count: true, tone: 'all', Icon: Users },
        { label: 'Present days', value: figures.present, count: true, tone: 'paid', Icon: CalendarCheck },
        { label: 'Absent days', value: figures.absent, count: true, tone: 'overdue', Icon: UserX },
        { label: 'Leave days', value: figures.leave, count: true, tone: 'sent', Icon: CalendarOff },
      ]}
    >
      {loading ? <SkeletonCard lines={8} /> : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky ui-table-register">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="name" state={filters} className="ui-register-sticky" />
                  {dayCols.map((c) => (
                    <th key={c.key} scope="col" className="ui-col-h-center ui-register-day">
                      <span className="block">{c.label}</span>
                      <span className="block ui-caption">{weekday(c.key)}</span>
                    </th>
                  ))}
                  <th scope="col" className="ui-num">P</th>
                  <th scope="col" className="ui-num">A</th>
                  <th scope="col" className="ui-num">L</th>
                  <th scope="col" className="ui-num">Off</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={dayCols.length + 5}>
                      {report.rows.length ? (
                        <EmptyState kind="filtered" totalCount={report.rows.length} title="Nobody matches" description="Nobody matches the search or the column filter." />
                      ) : (
                        <EmptyState icon={Users} title="Nobody on the register" description="No one was employed in this month." />
                      )}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
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
                      <td className="ui-num">{r.present}</td>
                      <td className="ui-num">{r.absent}</td>
                      <td className="ui-num">{r.leave}</td>
                      <td className="ui-num">{r.off}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="ui-caption px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(TONE).filter(([k]) => k !== '–').map(([k, t]) => (
              <span key={k} className="inline-flex items-center gap-1"><span className="ui-register-mark" style={{ backgroundColor: t.bg, color: t.fg }}>{k}</span> {t.label}</span>
            ))}
            <span>– not employed that day · blank: day to come</span>
          </p>
        </>
      )}
    </DocumentListShell>
  );
}
