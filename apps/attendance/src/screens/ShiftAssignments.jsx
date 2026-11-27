import TimeRegisterTable from '@ui/components/list/TimeRegisterTable';
import { useReviewSelection, SelectionBar, MobilePageCheckbox, PageCheckbox, RowCheckbox } from '@ui/components/ui/ReviewTable';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarRange, Clock3, Plus, Trash2, Upload, Users } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { assignShift, listAssignments, listEmployees, listShifts, removeAssignment, todayIst } from '../api/attendance';
import { confirmScheduleChange } from '../components/scheduleCheck';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';
import { confirmRemoveSchedule } from '../components/removeSchedule';
import { dateWords } from '@ui/utils/dates';

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
/* What Export writes (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'shiftName', label: 'Shift' },
  { key: 'effectiveFrom', label: 'From' },
  { key: 'effectiveTo', label: 'Until', value: (r) => r.effectiveTo || 'until changed' },
];

export default function ShiftAssignments({ peopleTimePage = false, openScreen, menuLabel } = {}) {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [shiftId, setShiftId] = useState('');
  const [from, setFrom] = useState(todayIst());
  const [until, setUntil] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState('');

  const load = useCallback(() => {
    listAssignments().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(errorWords(e, 'load assignments')));
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
  const selection = useReviewSelection(pageRows);
  const visibleRows = peopleTimePage && selection.focused ? selection.selectedRows : pageRows;
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
    if (saving) return;
    if (!(await confirmScheduleChange({ kind: 'EMPLOYEE', employeeIds: [...picked], shiftId, from, to: until || null }))) return;
    setSaving(true);
    try {
      const r = await assignShift({ employeeIds: [...picked], shiftId, effectiveFrom: from, effectiveTo: until || null });
      notify.success(`${r.assigned} people assigned.`);
      setFormOpen(false);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(errorWords(e, 'assign it'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (removing) return;
    if (!(await confirmRemoveSchedule({ name: r.employeeName, shift: r.shiftName, from: r.effectiveFrom }))) return;
    setRemoving(r.id);
    try {
      await removeAssignment(r.id);
      notify.success(`${r.employeeName} taken off ${r.shiftName}.`);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'remove it'));
    } finally {
      setRemoving('');
    }
  };

  return (
    <DocumentListShell
      timeRegister={peopleTimePage}
      entity="shift"
      title={menuLabel || 'Shift assignments'}
      moreItems={[exportMenuItem('Export'), ...(openScreen ? [{ key: 'import', label: 'Import from a spreadsheet', Icon: Upload }] : [])]}
      onMoreSelect={(k) => {
        if (k === 'import') return openScreen('dataImport', { kind: 'assignments' });
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Shift assignments', fileName: 'Shift assignments', label: 'assignment/assignments', columns: EXPORT_COLUMNS, rows: shownRows });
      }}
      description={peopleTimePage ? undefined : "A person’s own shift from a date (and until a date, if it ends). It beats their rotation and department schedule; a temporary schedule beats it."}
      compact
      tight
      search={{ value: list.query, onChange: list.setQuery, placeholder: 'Search schedules…', label: 'Search employee schedules' }}
      countLine={countItems([
        { label: 'Schedules', value: figures.total, count: true, tone: 'all', Icon: CalendarRange },
        { label: 'People', value: figures.people, count: true, tone: 'sent', Icon: Users },
        { label: 'Shifts in use', value: figures.shifts, count: true, tone: 'paid', Icon: Clock3 },
        { label: 'With an end date', value: figures.ending, count: true, tone: 'outstanding', Icon: CalendarClock },
      ])}
      primary={peopleTimePage && <button type="button" className="ui-btn ui-btn-primary" aria-controls="shift-entry" aria-expanded={formOpen} onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Close form' : 'Assign shift'}</button>}
      above={(!peopleTimePage || formOpen) &&
        <section id="shift-entry" className="space-y-3" aria-labelledby="assign-h">
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
              {peopleTimePage && shiftId && picked.size > 0 && <p className="ui-caption">This assignment overrides rotations and department shifts. Temporary shifts still take priority.</p>}
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
            {peopleTimePage ? <SelectionBar selection={selection} /> : null}
            {peopleTimePage ? <MobilePageCheckbox rows={visibleRows} selection={selection} /> : null}
            <TimeRegisterTable enabled={peopleTimePage} register="ShiftAssignments" required={['Employee']} className="ui-table ui-table-sticky ui-table-phone w-full">
              <thead>
                <tr>
                  {peopleTimePage ? <th scope="col" className="record-checkbox"><PageCheckbox rows={visibleRows} selection={selection} /></th> : null}
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
                    <td colSpan={(5) + (peopleTimePage ? 1 : 0)}>
                      {rows.length ? (
                        <EmptyState kind="filtered" totalCount={rows.length} title="No schedules match" description="Nothing matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={CalendarRange}
                          title="No one has their own schedule"
                          description={peopleTimePage ? "Employees without an assignment follow their rotation, department schedule or default shift." : "A person’s own shift from a date (and until a date, if it ends). It beats their rotation and department schedule; a temporary schedule beats it. People without one follow their rotation, their department’s schedule, or the company default shift (Attendance rules)."}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr key={r.id}>
                      {peopleTimePage ? <RowCheckbox row={r} label={r.employeeName} selection={selection} phoneSlot="select" /> : null}
                      <td className="ui-col-entity" data-phone="name">{r.employeeName}</td>
                      <td data-phone="sub">{r.shiftName}</td>
                      <td className="ui-col-date whitespace-nowrap" data-phone="key">{dateWords(r.effectiveFrom)}</td>
                      <td className="ui-col-date whitespace-nowrap" data-phone="tag">{r.effectiveTo ? dateWords(r.effectiveTo) : 'until changed'}</td>
                      <td className="ui-col-meta" data-phone="act">
                        <span className="flex justify-end">
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.employeeName} from ${r.shiftName}`} disabled={removing === r.id} aria-busy={removing === r.id || undefined} onClick={() => remove(r)}>
                            <Trash2 size={14} aria-hidden="true" /> {removing === r.id ? 'Removing…' : 'Remove'}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </TimeRegisterTable>
          </div>
          {!selection.focused && (<Pagination total={shownRows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="schedules" />)}
        </>
      )}
    </DocumentListShell>
  );
}
