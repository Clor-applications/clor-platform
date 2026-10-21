import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarRange, Clock3, Plus, Trash2, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { assignShift, listAssignments, listEmployees, listShifts, removeAssignment, todayIst } from '../api/attendance';
import { confirmScheduleChange } from '../components/scheduleCheck';
import LoadFailed from '../components/LoadFailed';

const COLUMNS = {
  employee: (r) => r.employeeName,
  shift: (r) => r.shiftName,
  from: (r) => r.effectiveFrom,
  until: (r) => r.effectiveTo,
};

/**
 * Who works which shift, from when. Assigning again from a later date
 * changes the shift from that day; earlier days keep the old one.
 */
export default function ShiftAssignments() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [shiftId, setShiftId] = useState('');
  const [from, setFrom] = useState(todayIst());
  const [until, setUntil] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    listAssignments().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load assignments.')));
  }, []);
  useEffect(() => {
    load();
    listEmployees().then(setPeople).catch(() => setPeople([]));
    listShifts().then((s) => setShifts(s.filter((x) => x.isActive))).catch(() => setShifts([]));
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((p) => `${p.name} ${p.code || ''} ${p.department || ''}`.toLowerCase().includes(q)) : people;
  }, [people, search]);

  const list = useListSearch(rows || [], ['employeeName', 'shiftName', 'effectiveFrom', 'effectiveTo']);
  const filters = useColumnFilters();
  const shownRows = filters.applyFilters(list.filtered, COLUMNS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const { pageCount, safePage, pageRows } = usePaged(shownRows, perPage, page);
  useEffect(() => setPage(1), [list.query]);
  const figures = useMemo(() => {
    const all = rows || [];
    return {
      total: all.length,
      people: new Set(all.map((r) => r.employeeId || r.employeeName)).size,
      shifts: new Set(all.map((r) => r.shiftId || r.shiftName)).size,
      ending: all.filter((r) => r.effectiveTo).length,
    };
  }, [rows]);

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const assign = async () => {
    if (!(await confirmScheduleChange({ kind: 'EMPLOYEE', employeeIds: [...picked], shiftId, from, to: until || null }))) return;
    setSaving(true);
    try {
      const r = await assignShift({ employeeIds: [...picked], shiftId, effectiveFrom: from, effectiveTo: until || null });
      notify.success(`${r.assigned} people assigned.`);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not assigned.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await removeAssignment(id);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not removed.'));
    }
  };

  return (
    <DocumentListShell
      entity="shift"
      title="Shift assignments"
      description="A person’s own shift from a date (and until a date, if it ends). It beats their rotation and department schedule; a temporary schedule beats it."
      compact
      tight
      denseCards
      search={{ value: list.query, onChange: list.setQuery, placeholder: 'Search schedules…', label: 'Search employee schedules' }}
      cards={[
        { label: 'Schedules', value: figures.total, count: true, tone: 'all', Icon: CalendarRange },
        { label: 'People', value: figures.people, count: true, tone: 'sent', Icon: Users },
        { label: 'Shifts in use', value: figures.shifts, count: true, tone: 'paid', Icon: Clock3 },
        { label: 'With an end date', value: figures.ending, count: true, tone: 'outstanding', Icon: CalendarClock },
      ]}
      above={
        <section className="ui-card space-y-3 p-4" aria-labelledby="assign-h">
          <h2 id="assign-h" className="ui-t-sec">Assign</h2>
          {!shifts.length ? (
            <p className="ui-muted text-sm">Create a shift first (Shifts).</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="ui-label">Shift</span>
                  <select className="ui-select" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                    <option value="">Choose…</option>
                    {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                  </select>
                </label>
                <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="block"><span className="ui-label">Until</span><input type="date" className="ui-input" min={from} value={until} onChange={(e) => setUntil(e.target.value)} aria-describedby="until-h" /></label>
                <button type="button" className="ui-btn ui-btn-primary" disabled={saving || !shiftId || !picked.size || !from} onClick={assign}>
                  <Plus size={16} aria-hidden="true" /> {saving ? 'Assigning…' : `Assign ${picked.size || ''}`}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input type="search" className="ui-input" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPicked(new Set(shown.map((p) => p.id)))}>Select {search ? 'shown' : 'all'}</button>
                {picked.size ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setPicked(new Set())}>Clear</button> : null}
              </div>
              <ul className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="ui-checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                      <span className="truncate">{p.name}<span className="ui-caption">{p.department ? ` · ${p.department}` : ''}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters}  className="ui-col-grow" />
                  <ColumnHeader label="Shift" col="shift" state={filters} />
                  <ColumnHeader label="From" col="from" state={filters} type="date" />
                  <ColumnHeader label="Until" col="until" state={filters} type="date" />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!shownRows.length ? (
                  <tr>
                    <td colSpan={5}>
                      {rows.length ? (
                        <EmptyState kind="filtered" totalCount={rows.length} title="No schedules match" description="Nothing matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={CalendarRange}
                          title="No one has their own schedule"
                          description="A person’s own shift from a date (and until a date, if it ends). It beats their rotation and department schedule; a temporary schedule beats it. People without one follow their rotation, their department’s schedule, or the company default shift (Attendance rules)."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-entity">{r.employeeName}</td>
                      <td>{r.shiftName}</td>
                      <td className="ui-col-date whitespace-nowrap">{r.effectiveFrom}</td>
                      <td className="ui-col-date whitespace-nowrap">{r.effectiveTo || 'until changed'}</td>
                      <td className="ui-col-meta">
                        <span className="flex justify-end">
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.employeeName} from ${r.shiftName}`} onClick={() => remove(r.id)}>
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
