import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { addDepartmentSchedule, listDepartmentSchedules, listShifts, removeDepartmentSchedule, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

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

  const add = async (e) => {
    e.preventDefault();
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
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Department schedule" description="The shift a department works from a date. People with their own schedule or a rotation keep theirs." />
      <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4">
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
        <button type="submit" className="ui-btn ui-btn-primary">Save</button>
      </form>
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No department schedules" description={departments.length ? 'Give a department its shift above.' : 'Create departments under Personnel first.'} />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Department</th>
                <th scope="col" className="ui-th">Shift</th>
                <th scope="col" className="ui-th">From</th>
                <th scope="col" className="ui-th">Until</th>
                <th scope="col" className="ui-th"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity">{r.departmentName}</td>
                  <td>{r.shiftName}</td>
                  <td>{r.effectiveFrom}</td>
                  <td>{r.effectiveTo || 'until changed'}</td>
                  <td className="text-end">
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.departmentName} from ${r.effectiveFrom}`} onClick={async () => { await removeDepartmentSchedule(r.id); load(); }}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
