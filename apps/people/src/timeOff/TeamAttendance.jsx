import React, { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import { usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { listEmployees } from '@ui/personnel/api';
import { DAY_LABEL, DAY_PILL, attendanceIsOn, listRecords, todayIst } from './api';

/**
 * Time & Leave → Attendance: everyone's days, read only — the day record leave
 * and holidays write, people's own check-ins, and readers' and phones' when
 * the company has Attendance. Corrections, shifts and readers are
 * Attendance's own work. Workflows carry no subscription promotion (brief):
 * without Attendance the page says only where its days come from.
 *
 * A day's note is not shown for a leave day: approval writes the leave's
 * reason into it, and a private leave's reason is not for every reader.
 */
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (month) => {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
};
const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const monthTitle = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LETTER = { PRESENT: 'P', HALF_DAY: '½', ABSENT: 'A', ON_LEAVE: 'L', HOLIDAY: 'H', WEEKLY_OFF: 'W' };
const hours = (m) => (m ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : '—');
const TABS = [['', 'All'], ['PRESENT', DAY_LABEL.PRESENT], ['ABSENT', DAY_LABEL.ABSENT], ['ON_LEAVE', DAY_LABEL.ON_LEAVE], ['NONE', 'Not marked']];
const noteOf = (day) => (day && !day.leaveRequestId && day.status !== 'ON_LEAVE' ? day.note || '' : '');

export default function TeamAttendance() {
  const today = todayIst();
  const [view, setView] = useState('day');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const hasAttendance = useRequest(() => attendanceIsOn(), []);
  const people = useRequest(() => listEmployees({ limit: 500, sort: 'name', status: 'CURRENT' }).then((r) => (r?.employees || []).filter((e) => e.status !== 'LEFT')), []);
  const range = view === 'day' ? { from: date, to: date } : { from: `${month}-01`, to: daysIn(month).at(-1) };
  const records = useRequest(() => listRecords(range), [range.from, range.to]);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status);

  const byPerson = useMemo(() => {
    const m = new Map();
    for (const r of records.data || []) {
      if (!m.has(r.employeeId)) m.set(r.employeeId, new Map());
      m.get(r.employeeId).set(r.date, r);
    }
    return m;
  }, [records.data]);
  const rows = useMemo(() => (people.data || []).map((p) => ({ ...p, day: byPerson.get(p.id)?.get(date) || null })), [people.data, byPerson, date]);
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
  useResetPage(setPage, [search.query, size, status, view, date, month]);
  const { pageRows, safePage } = usePaged(search.filtered, size, page);
  const error = people.error || records.error;
  const loading = !people.data || !records.data;

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (p) => (
      <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate ui-caption">{[p.code, p.departmentName || p.department].filter(Boolean).join(' · ')}</span></span>
    ) },
    { key: 'day', label: 'Day', render: (p) => (p.day ? <span className={`ui-pill ${DAY_PILL[p.day.status] || 'ui-pill-neutral'}`}>{DAY_LABEL[p.day.status] || p.day.status}</span> : <span className="ui-caption">Not marked</span>) },
    { key: 'in', label: 'In', align: 'right', render: (p) => <span className="tabular-nums">{p.day?.checkInTime || '—'}</span> },
    { key: 'out', label: 'Out', align: 'right', render: (p) => <span className="tabular-nums">{p.day?.checkOutTime || '—'}</span> },
    { key: 'worked', label: 'Worked', align: 'right', render: (p) => <span className="tabular-nums">{hours(p.day?.workedMinutes)}</span> },
    { key: 'late', label: 'Late', align: 'right', render: (p) => <span className="tabular-nums">{p.day?.lateMinutes ? `${p.day.lateMinutes}m` : '—'}</span> },
    { key: 'note', label: 'Note', render: (p) => <span className="ui-caption whitespace-normal">{noteOf(p.day)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Time & Leave' }]}
        title="Attendance"
        actions={hasAttendance.data ? <a className="ui-btn ui-btn-secondary" href="?app=attendance&open=records">Open in Attendance <ArrowUpRight size={16} aria-hidden="true" /></a> : null}
      />
      {hasAttendance.data === false ? <p className="text-sm ui-muted">Days from leave, holidays and people’s own check-ins.</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1" role="radiogroup" aria-label="View">
          {[['day', 'Day'], ['month', 'Month']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} className={`ui-btn ${view === k ? 'ui-btn-soft' : 'ui-btn-ghost'}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        {view === 'day' ? (
          <div className="w-44"><DatePicker label="Day" value={date} max={today} onChange={(v) => setDate(v || today)} /></div>
        ) : (
          <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
            <button type="button" className="ui-icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
            <span className="min-w-36 text-center font-medium" aria-live="polite">{monthTitle(month)}</span>
            <button type="button" className="ui-icon-btn" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {view === 'day' ? (
        <div ref={tabsRef} role="tablist" aria-label="Day" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
          {TABS.map(([k, l]) => (
            <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>
              {l}{counts[k] ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
            </button>
          ))}
          {tabIndicator}
        </div>
      ) : null}

      {error && loading ? <ErrorState error={error} onRetry={() => { people.reload(); records.reload(); }} /> : view === 'day' ? (
        <DataTable
          label={`Attendance on ${date}`}
          columns={columns}
          rows={pageRows}
          total={search.filtered.length}
          page={safePage}
          pageSize={size}
          noun="people"
          onPage={setPage}
          onPageSize={setSize}
          loading={loading}
          refreshing={records.refreshing}
          card={(p) => (
            <span className="min-w-0">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.name}</span>{p.day ? <span className={`ui-pill ${DAY_PILL[p.day.status] || 'ui-pill-neutral'}`}>{DAY_LABEL[p.day.status] || p.day.status}</span> : <span className="ui-caption">Not marked</span>}</span>
              <span className="block ui-caption tabular-nums">{p.day?.checkInTime ? `In ${p.day.checkInTime}${p.day.checkOutTime ? `, out ${p.day.checkOutTime}` : ''}` : ''}</span>
            </span>
          )}
          toolbar={<SearchField value={search.query} onSearch={search.setQuery} placeholder="Search name, employee ID or department" label="Search attendance" className="w-full sm:w-80" />}
          empty={search.query || status ? <EmptyState kind="filtered" title="Nobody here" onClearFilters={() => { search.setQuery(''); setStatus(''); }} /> : <EmptyState title="Nobody employed yet" />}
        />
      ) : loading ? <SkeletonCard lines={6} /> : (
        <section className="space-y-3" aria-label={`Attendance in ${monthTitle(month)}`}>
          <SearchField value={search.query} onSearch={search.setQuery} placeholder="Search name, employee ID or department" label="Search attendance" className="w-full sm:w-80" />
          {!search.filtered.length ? <EmptyState kind="filtered" title="Nobody here" onClearFilters={() => search.setQuery('')} /> : (
            <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }}>
              <table className="w-full border-collapse text-xs" aria-label={`Attendance in ${monthTitle(month)}`}>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-medium min-w-44">Employee</th>
                    <th scope="col" className="p-2 text-right font-medium">Present</th>
                    <th scope="col" className="p-2 text-right font-medium">Leave</th>
                    <th scope="col" className="p-2 text-right font-medium">Absent</th>
                    {daysIn(month).map((d) => <th key={d} scope="col" className={`p-0.5 text-center font-normal min-w-5 tabular-nums ${d === today ? 'text-[rgb(var(--brand-ink))]' : ''}`}>{Number(d.slice(8))}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {search.filtered.map((p) => {
                    const mine = byPerson.get(p.id) || new Map();
                    const n = (s) => [...mine.values()].filter((r) => r.status === s).length;
                    return (
                      <tr key={p.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
                        <th scope="row" className="sticky left-0 z-10 bg-[rgb(var(--app-bg))] p-2 text-left text-sm font-normal">{p.name}</th>
                        <td className="p-2 text-right tabular-nums">{n('PRESENT') + n('HALF_DAY') / 2}</td>
                        <td className="p-2 text-right tabular-nums">{n('ON_LEAVE')}</td>
                        <td className="p-2 text-right tabular-nums">{n('ABSENT')}</td>
                        {daysIn(month).map((d) => {
                          const r = mine.get(d);
                          return <td key={d} className="p-0.5 text-center" title={r ? `${d}: ${DAY_LABEL[r.status] || r.status}` : undefined}>{r ? LETTER[r.status] || '·' : <span className="ui-muted">·</span>}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="ui-caption">P present, ½ half day, A absent, L leave, H holiday, W weekly off.</p>
        </section>
      )}
    </div>
  );
}
