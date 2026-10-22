import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Fingerprint } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { listEmployees } from '@ui/personnel/api';
import { DAY_LABEL, DAY_PILL, attendanceIsOn, listRecords } from './api';

/**
 * People → Leave & Attendance → Attendance: everyone's days as Attendance
 * marked them — from readers, phones, check-ins, leave and holidays. Read
 * only: corrections, shifts and readers are Attendance's own work.
 * Without Attendance, the days come from leave and the basic check-in, and
 * the page says what Attendance would add (founder, 22 Oct 2026: recommend
 * it alongside HR).
 */
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const daysIn = (month) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
};
const LETTER = { PRESENT: 'P', HALF_DAY: '½', ABSENT: 'A', ON_LEAVE: 'L', HOLIDAY: 'H', WEEKLY_OFF: 'W' };
const hours = (m) => (m ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : '—');

export default function TeamAttendance() {
  const [view, setView] = useState('day');
  const [date, setDate] = useState(todayIso());
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [people, setPeople] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [hasAttendance, setHasAttendance] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    attendanceIsOn().then(setHasAttendance);
    listEmployees().then((r) => setPeople((r?.employees || []).filter((e) => e.status !== 'LEFT'))).catch((e) => setError(String(e?.message || 'Could not load people.')));
  }, []);
  const load = useCallback(() => {
    const range = view === 'day' ? { from: date, to: date } : { from: `${month}-01`, to: daysIn(month).at(-1) };
    listRecords(range).then((r) => { setRecords(r); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load attendance.')));
  }, [view, date, month]);
  useEffect(() => { load(); }, [load]);

  const byPerson = useMemo(() => {
    const m = new Map();
    for (const r of records || []) {
      if (!m.has(r.employeeId)) m.set(r.employeeId, new Map());
      m.get(r.employeeId).set(r.date, r);
    }
    return m;
  }, [records]);
  const rows = useMemo(() => (people || []).map((p) => ({ ...p, day: byPerson.get(p.id)?.get(date) || null })), [people, byPerson, date]);
  const counts = useMemo(() => {
    const c = { '': rows.length, NONE: 0 };
    for (const r of rows) {
      const k = r.day?.status || 'NONE';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [rows]);
  const inTab = view === 'day' ? rows.filter((r) => !status || (r.day?.status || 'NONE') === status) : rows;
  const search = useListSearch(inTab, ['name', 'code', 'departmentName', 'department']);
  const loading = !people || !records;

  return (
    <DocumentListShell
      entity="attendance"
      title="Attendance"
      description={hasAttendance ? 'Everyone’s days as Attendance marked them. Corrections, shifts and readers are in the Attendance app.' : 'Days from leave, holidays and people’s own check-ins.'}
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search attendance' }}
      headerExtras={
        <div className="flex flex-nowrap items-center gap-2">
          <div className="inline-flex shrink-0 rounded-lg border" style={{ borderColor: 'rgb(var(--border))' }} role="group" aria-label="View">
            <button type="button" className="ui-btn ui-btn-ghost" aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button>
            <button type="button" className="ui-btn ui-btn-ghost" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
          </div>
          {view === 'day'
            ? <input type="date" className="ui-input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} aria-label="Day" />
            : <input type="month" className="ui-input" value={month} onChange={(e) => setMonth(e.target.value || todayIso().slice(0, 7))} aria-label="Month" />}
        </div>
      }
      tabs={view === 'day' ? ['', 'PRESENT', 'ABSENT', 'ON_LEAVE', 'NONE'].map((s) => ({ value: s, label: s === 'NONE' ? 'Not marked' : s ? DAY_LABEL[s] : 'All', tone: 'all' })) : undefined}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Day"
    >
      {!hasAttendance ? (
        <div className="m-4 ui-card p-4 flex items-start gap-3" role="note">
          <Fingerprint size={22} aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium">Mark attendance automatically with the Attendance app</p>
            <p className="ui-muted">Biometric readers, shifts, late marks, overtime and corrections, with payable days sent to Payroll. Recommended with HR: leave and holidays stay here and are kept in step. Add it from More apps.</p>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3"><a className="ui-link inline-flex items-center gap-1 text-sm" href="?app=attendance&open=records">Open in Attendance <ArrowUpRight size={14} aria-hidden="true" /></a></div>
      )}
      {error ? <p role="alert" className="p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {loading ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !search.filtered.length ? (
        <EmptyState kind="filtered" title="Nobody here" description="Change the tab or the search." />
      ) : view === 'day' ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Day</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col" className="ui-num">Worked</th>
                <th scope="col" className="ui-num">Late</th>
                <th scope="col" className="ui-col-grow">Note</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {search.filtered.map((p) => (
                <tr key={p.id}>
                  <td className="ui-col-entity">{p.name}<span className="ui-caption block">{[p.code, p.departmentName || p.department].filter(Boolean).join(', ')}</span></td>
                  <td>{p.day ? <span className={`ui-pill ${DAY_PILL[p.day.status] || ''}`}>{DAY_LABEL[p.day.status] || p.day.status}</span> : <span className="ui-caption">Not marked</span>}</td>
                  <td className="ui-col-meta">{p.day?.checkInTime || '—'}</td>
                  <td className="ui-col-meta">{p.day?.checkOutTime || '—'}</td>
                  <td className="ui-num">{hours(p.day?.workedMinutes)}</td>
                  <td className="ui-num">{p.day?.lateMinutes ? `${p.day.lateMinutes}m` : '—'}</td>
                  <td className="ui-col-grow whitespace-normal ui-caption">{p.day?.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ui-table-scroll">
          <table className="w-full border-collapse text-xs" aria-label={`Attendance in ${month}`}>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-[rgb(var(--surface))] p-2 text-left text-sm font-medium min-w-44">Employee</th>
                <th scope="col" className="p-2 text-right font-medium">Present</th>
                <th scope="col" className="p-2 text-right font-medium">Leave</th>
                <th scope="col" className="p-2 text-right font-medium">Absent</th>
                {daysIn(month).map((d) => <th key={d} scope="col" className="p-0.5 text-center font-normal min-w-5">{Number(d.slice(8))}</th>)}
              </tr>
            </thead>
            <tbody>
              {search.filtered.map((p) => {
                const mine = byPerson.get(p.id) || new Map();
                const n = (s) => [...mine.values()].filter((r) => r.status === s).length;
                return (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                    <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--surface))] p-2 text-left text-sm font-normal">{p.name}</th>
                    <td className="p-2 text-right font-medium">{n('PRESENT') + n('HALF_DAY') / 2}</td>
                    <td className="p-2 text-right">{n('ON_LEAVE')}</td>
                    <td className="p-2 text-right">{n('ABSENT')}</td>
                    {daysIn(month).map((d) => {
                      const r = mine.get(d);
                      return <td key={d} className="p-0.5 text-center" title={r ? `${d}: ${DAY_LABEL[r.status]}` : undefined}>{r ? LETTER[r.status] || '·' : <span className="ui-muted">·</span>}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="p-3 ui-caption">P present, ½ half day, A absent, L leave, H holiday, W weekly off.</p>
        </div>
      )}
    </DocumentListShell>
  );
}
