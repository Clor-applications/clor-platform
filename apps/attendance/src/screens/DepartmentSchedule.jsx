import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarClock, CalendarRange, Plus, Trash2 } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { addDepartmentSchedule, listDepartmentSchedules, listShifts, removeDepartmentSchedule, todayIst } from '../api/attendance';
import { confirmScheduleChange } from '../components/scheduleCheck';
import LoadFailed from '../components/LoadFailed';

const COLUMNS = {
  department: (r) => r.departmentName,
  shift: (r) => r.shiftName,
  from: (r) => r.effectiveFrom,
  until: (r) => r.effectiveTo,
};

/**
 * The shift a whole department works (ClorTime's Department Schedule). Applies
 * to anyone in it without a schedule or rotation of their own.
 */
export default function DepartmentSchedule() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [form, setForm] = useState({ departmentId: '', shiftId: '', effectiveFrom: todayIst(), effectiveTo: '' });
  const load = useCallback(() => {
    listDepartmentSchedules().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
    listStructure('departments').then(setDepartments).catch(() => setDepartments([]));
    listShifts().then((s) => setShifts(s.filter((x) => x.isActive))).catch(() => setShifts([]));
  }, [load]);

  const list = useListSearch(rows, ['departmentName', 'shiftName', 'effectiveFrom', 'effectiveTo']);
  const filters = useColumnFilters();
  const shownRows = filters.applyFilters(list.filtered, COLUMNS);
  const figures = useMemo(() => {
    const all = rows || [];
    return {
      total: all.length,
      departments: new Set(all.map((r) => r.departmentId || r.departmentName)).size,
      ending: all.filter((r) => r.effectiveTo).length,
    };
  }, [rows]);

  const add = async (e) => {
    e.preventDefault();
    if (!(await confirmScheduleChange({ kind: 'DEPARTMENT', departmentId: form.departmentId, shiftId: form.shiftId, from: form.effectiveFrom, to: form.effectiveTo || null }))) return;
    try {
      await addDepartmentSchedule({ ...form, effectiveTo: form.effectiveTo || null });
      notify.success('Department schedule saved.');
      setForm((f) => ({ ...f, departmentId: '', effectiveTo: '' }));
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };

  return (
    <DocumentListShell
      entity="shift"
      title="Department schedule"
      description="The shift a department works from a date. People with their own schedule or a rotation keep theirs."
      compact
      tight
      denseCards
      search={{ value: list.query, onChange: list.setQuery, placeholder: 'Search department schedules…', label: 'Search department schedules' }}
      cards={[
        { label: 'Schedules', value: figures.total, count: true, tone: 'all', Icon: CalendarRange },
        { label: 'Departments', value: figures.departments, count: true, tone: 'paid', Icon: Building2 },
        { label: 'With an end date', value: figures.ending, count: true, tone: 'outstanding', Icon: CalendarClock },
      ]}
      above={
        <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4" aria-label="Give a department its shift">
          <label className="block">
            <span className="ui-label">Department *</span>
            <select className="ui-select" required value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">Choose…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="ui-label">Shift *</span>
            <select className="ui-select" required value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
              <option value="">Choose…</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
            </select>
          </label>
          <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Until</span><input type="date" className="ui-input" min={form.effectiveFrom} value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></label>
          <button type="submit" className="ui-btn ui-btn-primary"><Plus size={16} aria-hidden="true" /> Save</button>
        </form>
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Department" col="department" state={filters} />
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
                      <EmptyState kind="filtered" totalCount={rows.length} title="No department schedules match" description="Nothing matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Building2}
                        title="No department schedules"
                        description={`The shift a department works from a date. People with their own schedule or a rotation keep theirs. ${departments.length ? 'Give a department its shift above.' : 'Create departments under Personnel first.'}`}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                shownRows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">{r.departmentName}</td>
                    <td>{r.shiftName}</td>
                    <td className="ui-col-date whitespace-nowrap">{r.effectiveFrom}</td>
                    <td className="ui-col-date whitespace-nowrap">{r.effectiveTo || 'until changed'}</td>
                    <td className="ui-col-meta">
                      <span className="flex justify-end">
                        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.departmentName} from ${r.effectiveFrom}`} onClick={async () => { await removeDepartmentSchedule(r.id); load(); }}>
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
      )}
    </DocumentListShell>
  );
}
