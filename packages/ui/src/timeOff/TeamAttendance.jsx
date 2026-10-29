import React, { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Download } from '@ui/components/ui/lineIcons';

import { useListSearch } from '@ui/components/ListToolbar';
import { usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { getPayableDays, listPeople } from './api';
import { runListExport } from '@ui/components/list/exportMenu';
import { notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';
import { DAY_LABEL, DAY_PILL, attendanceIsOn, listRecords, markDay, todayIst } from './api';
import { homeCrumbs } from './shared';

/**
 * Time & Leave → Attendance: everyone's days, read only — the day record leave
 * and holidays write, people's own check-ins, and readers' and phones' when
 * the company has Attendance. Corrections, shifts and readers are
 * Attendance's own work. Workflows carry no subscription promotion (brief):
 * without Attendance the page says only where its days come from.
 *
 * A day's note is not shown for a leave day: approval writes the leave's
 * reason into it, and a private leave's reason is not for every reader.
 *
 * The month view carries each person's unpaid leave, loss-of-pay and payable
 * days, from the calculation Payroll takes them with (server:
 * services/attendance/payableDays.ts), so HR checks the month before payroll
 * against the very numbers payroll will use, and can export them.
 */
const fig = (n) => (n == null ? '—' : String(Math.round(Number(n) * 100) / 100));
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
/* The day as a line: 07:00 to 21:00, the usual shift shaded, the time actually in drawn over it. */
const AXIS_FROM = 7 * 60;
const AXIS_TO = 21 * 60;
const SHIFT = [9 * 60, 18 * 60];
const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const pct = (min) => `${Math.max(0, Math.min(100, ((min - AXIS_FROM) / (AXIS_TO - AXIS_FROM)) * 100))}%`;
const nowHHMM = () => {
  const d = new Date(Date.now() + 330 * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const initialsOf = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
function DayLine({ day, isToday }) {
  const inMin = toMin(day?.checkInTime);
  const outMin = toMin(day?.checkOutTime) ?? (isToday && inMin != null ? toMin(nowHHMM()) : null);
  const open = inMin != null && !day?.checkOutTime;
  return (
    <span className="att-line" role="img" aria-label={inMin != null ? `In ${day.checkInTime}${day.checkOutTime ? `, out ${day.checkOutTime}` : ', still in'}` : 'No time recorded'}>
      <span className="att-line-shift" style={{ left: pct(SHIFT[0]), right: `calc(100% - ${pct(SHIFT[1])})` }} />
      {inMin != null && outMin != null ? (
        <span className="att-line-span" data-late={day?.lateMinutes ? '' : undefined} data-open={open ? '' : undefined} style={{ left: pct(inMin), right: `calc(100% - ${pct(Math.max(outMin, inMin + 10))})` }} />
      ) : null}
    </span>
  );
}

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
  const people = useRequest(() => listPeople(), []);
  const range = view === 'day' ? { from: date, to: date } : { from: `${month}-01`, to: daysIn(month).at(-1) };
  const records = useRequest(() => listRecords(range), [range.from, range.to]);
  const payable = useRequest(() => (view === 'month' ? getPayableDays(month) : Promise.resolve(null)), [view, month]);
  const payOf = useMemo(() => new Map((payable.data?.rows || []).map((r) => [r.employeeId, r])), [payable.data]);
  const [busy, setBusy] = useState('');
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
  const isToday = date === today;
  const mark = async (p, body, done) => {
    setBusy(p.id);
    try {
      await markDay({ employeeId: p.id, date, ...body });
      notify.success(`${p.name}: ${done}.`);
      records.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };

  const exportMonth = () => {
    try {
      const rows = search.filtered.map((p) => {
        const mine = byPerson.get(p.id) || new Map();
        const n = (st) => [...mine.values()].filter((r) => r.status === st).length;
        const pay = payOf.get(p.id);
        return { name: p.name, code: p.code || '', department: p.departmentName || p.department || '', present: n('PRESENT') + n('HALF_DAY') / 2, leave: n('ON_LEAVE'), absent: n('ABSENT'), unpaid: pay?.unpaidLeaveDays ?? '', lop: pay?.lossOfPayDays ?? '', payable: pay?.payableDays ?? '', totalDays: pay?.totalDays ?? '', why: pay?.why || '' };
      });
      const cols = [['name', 'Employee'], ['code', 'Employee ID'], ['department', 'Department'], ['present', 'Present'], ['leave', 'Leave'], ['absent', 'Absent'], ['unpaid', 'Unpaid leave'], ['lop', 'Loss of pay'], ['payable', 'Payable days'], ['totalDays', 'Days in month'], ['why', 'Loss of pay from']].map(([key, label]) => ({ key, label }));
      runListExport({ format: 'xlsx', title: `Attendance ${monthTitle(month)}`, fileName: `attendance-${month}`, label: 'Attendance', rows, columns: cols });
    } catch (e) {
      notify.error(String(e?.message || 'Could not export.'));
    }
  };

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (p) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="att-face" aria-hidden="true">{initialsOf(p.name)}</span>
        <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate ui-caption">{[p.code, p.departmentName || p.department].filter(Boolean).join(' · ')}</span></span>
      </span>
    ) },
    { key: 'day', label: 'Status', render: (p) => (p.day ? <span className={`ui-pill ${DAY_PILL[p.day.status] || 'ui-pill-neutral'}`}>{DAY_LABEL[p.day.status] || p.day.status}</span> : <span className="ui-pill ui-pill-neutral">Not marked</span>) },
    /* The bar only where there is a time to draw; an empty grey track on every unmarked row repeated the Status column. */
    { key: 'line', label: 'Day (7 am – 9 pm)', render: (p) => (p.day?.checkInTime ? <DayLine day={p.day} isToday={isToday} /> : <span className="ui-subtle" aria-label="No time recorded">—</span>) },
    { key: 'in', label: 'In', align: 'right', render: (p) => <span className="tabular-nums">{p.day?.checkInTime || '—'}{p.day?.lateMinutes ? <span className="att-late">+{p.day.lateMinutes}m</span> : null}</span> },
    { key: 'out', label: 'Out', align: 'right', render: (p) => <span className="tabular-nums">{p.day?.checkOutTime || '—'}</span> },
    { key: 'worked', label: 'Worked', align: 'right', render: (p) => <span className="tabular-nums">{hours(p.day?.workedMinutes)}</span> },
    { key: 'act', label: 'Mark', render: (p) => {
      if (p.day?.status === 'ON_LEAVE' || p.day?.status === 'HOLIDAY') return <span className="ui-caption">—</span>;
      const inNow = isToday && !p.day?.checkInTime;
      const outNow = isToday && p.day?.checkInTime && !p.day?.checkOutTime;
      return (
        <span className="flex items-center justify-end gap-1.5">
          {inNow ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm att-act-in" disabled={busy === p.id} onClick={() => mark(p, { checkIn: nowHHMM() }, `checked in at ${nowHHMM()}`)}>Check in</button> : null}
          {outNow ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === p.id} onClick={() => mark(p, { checkIn: p.day.checkInTime, checkOut: nowHHMM() }, `checked out at ${nowHHMM()}`)}>Check out</button> : null}
          <select className="ui-select ui-ctl-compact att-mark" aria-label={`Mark ${p.name}`} value="" disabled={busy === p.id} onChange={(e) => { const v = e.target.value; if (v) mark(p, { status: v, checkIn: p.day?.checkInTime || null, checkOut: p.day?.checkOutTime || null }, `marked ${DAY_LABEL[v].toLowerCase()}`); }}>
            <option value="">Mark…</option>
            <option value="PRESENT">Present</option>
            <option value="HALF_DAY">Half day</option>
            <option value="ABSENT">Absent</option>
          </select>
        </span>
      );
    } },
    { key: 'note', label: 'Note', render: (p) => <span className="ui-caption whitespace-normal">{noteOf(p.day)}</span> },
  ];

  /* The day at a glance: one bar, each status its share of the company. */
  const SUMMARY = [['PRESENT', 'Present', 'pos'], ['HALF_DAY', 'Half day', 'warn'], ['ON_LEAVE', 'On leave', 'info'], ['ABSENT', 'Absent', 'neg'], ['NONE', 'Not marked', 'none']];
  const lateCount = rows.filter((r) => r.day?.lateMinutes).length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="Daily attendance"
        actions={<>
          {view === 'month' && !loading ? <button type="button" className="ui-btn ui-btn-secondary" onClick={exportMonth}><Download size={16} aria-hidden="true" /> Export</button> : null}
          {hasAttendance.data ? <a className="ui-btn ui-btn-secondary" href="?app=attendance&open=records">Shifts & readers <ArrowUpRight size={16} aria-hidden="true" /></a> : null}
        </>}
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

      {view === 'day' && !loading ? (
        <section className="att-summary" aria-label="The day at a glance">
          <div className="att-summary-bar" role="img" aria-label={SUMMARY.map(([k, l]) => `${l} ${counts[k] || 0}`).join(', ')}>
            {SUMMARY.map(([k, , tone]) => (counts[k] ? <span key={k} data-tone={tone} style={{ flexGrow: counts[k] }} /> : null))}
          </div>
          <ul className="att-summary-keys">
            {SUMMARY.map(([k, l, tone]) => (
              <li key={k}><button type="button" data-tone={tone} aria-pressed={status === k} onClick={() => setStatus(status === k ? '' : k)}><i aria-hidden="true" />{l}<b>{counts[k] || 0}</b></button></li>
            ))}
            {lateCount ? <li className="att-summary-late">{lateCount} late</li> : null}
          </ul>
        </section>
      ) : null}

      {error && loading ? <ErrorState error={error} onRetry={() => { people.reload(); records.reload(); }} /> : view === 'day' ? (
        <DataTable
          tabs={(
            <div ref={tabsRef} role="tablist" aria-label="Day" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
              {TABS.map(([k, l]) => (
                <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>
                  {l}{counts[k] ? <span className="ui-tab-count tabular-nums">{counts[k]}</span> : null}
                </button>
              ))}
              {tabIndicator}
            </div>
          )}
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
                    <th scope="col" className="p-2 text-right font-medium">Unpaid leave</th>
                    <th scope="col" className="p-2 text-right font-medium">Loss of pay</th>
                    <th scope="col" className="p-2 text-right font-medium">Payable</th>
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
                        <td className="p-2 text-right tabular-nums">{fig(payOf.get(p.id)?.unpaidLeaveDays)}</td>
                        <td className="p-2 text-right tabular-nums" title={payOf.get(p.id)?.why || undefined}>{fig(payOf.get(p.id)?.lossOfPayDays)}</td>
                        <td className="p-2 text-right tabular-nums font-medium">{fig(payOf.get(p.id)?.payableDays)}</td>
                        {daysIn(month).map((d) => {
                          const r = mine.get(d);
                          return <td key={d} className="p-0.5 text-center" title={r ? `${d}: ${DAY_LABEL[r.status] || r.status}${r.checkInTime ? `, in ${r.checkInTime}` : ''}` : undefined}><span className="att-cell" data-s={r?.status || ''}>{r ? LETTER[r.status] || '·' : ''}</span></td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="ui-caption">P present, ½ half day, A absent, L leave, H holiday, W weekly off.</p>
          {payable.data ? (
            <p className="ui-caption">
              {payable.data.source === 'ATTENDANCE' ? 'Loss of pay and payable days are what Payroll takes from Attendance: absences, half days, unpaid leave and late penalties.' : 'Loss of pay and payable days are what Payroll takes from leave: unpaid leave only, out of every day of the month.'}
              {payable.data.payrollTaken ? ` Payroll took these on ${formatDate(payable.data.payrollTaken.on)} (${payable.data.payrollTaken.period}).` : ''}
            </p>
          ) : payable.error ? <p className="ui-caption">Loss of pay could not be worked out: {String(payable.error?.message || payable.error)}</p> : null}
        </section>
      )}
    </div>
  );
}
