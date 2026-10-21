import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarRange, Plus, Trash2, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { addTemporarySchedule, dayLabel, listEmployees, listShifts, listTemporarySchedules, removeTemporarySchedule, todayIst } from '../api/attendance';
import { confirmScheduleChange } from '../components/scheduleCheck';
import LoadFailed from '../components/LoadFailed';

const COLUMNS = {
  employee: (r) => r.employeeName,
  shift: (r) => r.shiftName,
  from: (r) => r.fromDate,
  to: (r) => r.toDate,
  reason: (r) => r.reason,
};

/**
 * A different shift for a few days — cover, a training week, a swap. Wins over
 * every other schedule for those days (ClorTime's Temporary Schedule).
 */
export default function TemporarySchedule() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ shiftId: '', fromDate: todayIst(), toDate: todayIst(), reason: '' });
  const load = useCallback(() => {
    listTemporarySchedules().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
    listEmployees().then(setPeople).catch(() => setPeople([]));
    listShifts().then((s) => setShifts(s.filter((x) => x.isActive))).catch(() => setShifts([]));
  }, [load]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.code || ''} ${p.department || ''}`.toLowerCase().includes(n)) : people;
  }, [people, q]);
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const list = useListSearch(rows, ['employeeName', 'shiftName', 'fromDate', 'toDate', 'reason']);
  const filters = useColumnFilters();
  const shownRows = filters.applyFilters(list.filtered, COLUMNS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const { pageCount, safePage, pageRows } = usePaged(shownRows, perPage, page);
  useResetPage(setPage, [list.query]);
  const figures = useMemo(() => {
    const all = rows || [];
    const today = todayIst();
    return {
      total: all.length,
      people: new Set(all.map((r) => r.employeeId || r.employeeName)).size,
      today: all.filter((r) => r.fromDate <= today && r.toDate >= today).length,
      upcoming: all.filter((r) => r.fromDate > today).length,
    };
  }, [rows]);

  const add = async () => {
    if (!(await confirmScheduleChange({ kind: 'TEMPORARY', employeeIds: [...picked], shiftId: form.shiftId, from: form.fromDate, to: form.toDate || null }))) return;
    try {
      const r = await addTemporarySchedule({ ...form, employeeIds: [...picked], reason: form.reason || null });
      notify.success(`${r.scheduled} scheduled.`);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  return (
    <DocumentListShell
      entity="shift"
      title="Temporary schedule"
      description="A different shift for some days. It wins over every other schedule on those days."
      compact
      tight
      denseCards
      search={{ value: list.query, onChange: list.setQuery, placeholder: 'Search temporary schedules…', label: 'Search temporary schedules' }}
      cards={[
        { label: 'Schedules', value: figures.total, count: true, tone: 'all', Icon: CalendarClock },
        { label: 'People', value: figures.people, count: true, tone: 'sent', Icon: Users },
        { label: 'On today', value: figures.today, count: true, tone: 'paid', Icon: CalendarCheck },
        { label: 'Still to come', value: figures.upcoming, count: true, tone: 'partial', Icon: CalendarRange },
      ]}
      above={
        <section className="ui-card space-y-3 p-4" aria-label="New temporary schedule">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="ui-label">Shift *</span>
              <select className="ui-select" value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                <option value="">Choose…</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate < e.target.value ? e.target.value : form.toDate })} /></label>
            <label className="block"><span className="ui-label">To *</span><input type="date" className="ui-input" min={form.fromDate} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></label>
            <label className="block min-w-[12rem] flex-1"><span className="ui-label">Why</span><input className="ui-input w-full" maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Covering night shift" /></label>
            <button type="button" className="ui-btn ui-btn-primary" disabled={!form.shiftId || !picked.size} onClick={add}><Plus size={16} aria-hidden="true" /> Schedule {picked.size || ''}</button>
          </div>
          <input type="search" className="ui-input" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          <ul className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="ui-checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="truncate">{p.name}<span className="ui-caption">{p.department ? ` · ${p.department}` : ''}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Shift" col="shift" state={filters} />
                  <ColumnHeader label="From" col="from" state={filters} type="date" />
                  <ColumnHeader label="To" col="to" state={filters} type="date" />
                  <ColumnHeader label="Why" col="reason" state={filters}  className="ui-col-grow" />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!shownRows.length ? (
                  <tr>
                    <td colSpan={6}>
                      {rows.length ? (
                        <EmptyState kind="filtered" totalCount={rows.length} title="No temporary schedules match" description="Nothing matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={CalendarClock}
                          title="No temporary schedules"
                          description="A different shift for some days. It wins over every other schedule on those days. None from this month on."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-entity">{r.employeeName}</td>
                      <td>{r.shiftName}</td>
                      <td className="ui-col-date whitespace-nowrap">{dayLabel(r.fromDate)}</td>
                      <td className="ui-col-date whitespace-nowrap">{dayLabel(r.toDate)}</td>
                      <td className="ui-col-grow whitespace-normal min-w-[10rem]">{r.reason || '—'}</td>
                      <td className="ui-col-meta">
                        <span className="flex justify-end">
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.employeeName}'s temporary schedule`} onClick={async () => { await removeTemporarySchedule(r.id); load(); }}>
                            <Trash2 size={14} aria-hidden="true" /> Remove
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={shownRows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="schedules" />
        </>
      )}
    </DocumentListShell>
  );
}
