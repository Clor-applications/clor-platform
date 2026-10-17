import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Download, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { approveOvertime, dayLabel, deleteDay, hm, listEmployees, listRecords, markDay, STATUS, todayIst, validateDays } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Everyone's days: filter, correct, validate, approve overtime. After
 * Horilla's attendance list (validate / overtime approval live here too).
 */
const weekAgo = () => new Date(Date.now() + 330 * 60_000 - 6 * 86_400_000).toISOString().slice(0, 10);

export default function AttendanceRecords() {
  const [filters, setFilters] = useState({ from: weekAgo(), to: todayIst(), employeeId: '', status: '', validated: '', late: '' });
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    listRecords(filters)
      .then((r) => {
        setRows(r.records || []);
        setLoadError('');
        setSelected(new Set());
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load days.')));
  }, [filters]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    listEmployees().then(setPeople).catch(() => setPeople([]));
  }, []);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const unvalidated = useMemo(() => (rows || []).filter((r) => !r.validated && r.checkOut), [rows]);

  const validate = async () => {
    try {
      const r = await validateDays([...selected]);
      notify.success(`${r.validated} days validated.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not validated.'));
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Records"
        description="Mark, correct and validate days. A corrected day needs validating again."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() =>
                downloadCsv({
                  fileName: `Attendance ${filters.from} to ${filters.to}`,
                  columns: [
                    { key: 'date', label: 'Date' },
                    { key: 'employeeCode', label: 'Employee ID' },
                    { key: 'employeeName', label: 'Name' },
                    { key: 'checkInTime', label: 'In' },
                    { key: 'checkOutTime', label: 'Out' },
                    { key: 'workedMinutes', label: 'Worked (h:mm)', value: (r) => hm(r.workedMinutes) },
                    { key: 'lateMinutes', label: 'Late (min)' },
                    { key: 'earlyOutMinutes', label: 'Early out (min)' },
                    { key: 'overtimeMinutes', label: 'Overtime (min)' },
                    { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label || r.status },
                    { key: 'validated', label: 'Validated', value: (r) => (r.validated ? 'Yes' : 'No') },
                  ],
                  rows: rows || [],
                })
              }
            >
              <Download size={16} aria-hidden="true" /> Export
            </button>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!selected.size} onClick={validate}>
              <CheckCheck size={16} aria-hidden="true" /> Validate {selected.size || ''}
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ date: todayIst(), checkIn: '', checkOut: '', status: '' })}>
              <Plus size={16} aria-hidden="true" /> Mark attendance
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="ui-input !w-auto" value={filters.from} max={filters.to} onChange={set('from')} aria-label="From" />
        <input type="date" className="ui-input !w-auto" value={filters.to} max={todayIst()} onChange={set('to')} aria-label="To" />
        <select className="ui-select" style={{ width: 'auto', minWidth: '10rem' }} value={filters.employeeId} onChange={set('employeeId')} aria-label="Employee">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="ui-select" style={{ width: 'auto' }} value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="ui-select" style={{ width: 'auto' }} value={filters.validated} onChange={set('validated')} aria-label="Validated">
          <option value="">Validated or not</option>
          <option value="false">Not validated</option>
          <option value="true">Validated</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="ui-checkbox" checked={filters.late === 'true'} onChange={(e) => setFilters((f) => ({ ...f, late: e.target.checked ? 'true' : '' }))} /> Late only
        </label>
      </div>

      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={6} />
      ) : !rows.length ? (
        <EmptyState title="No days in this range" description="Mark attendance, or widen the dates." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th w-8">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label="Select all closed days not yet validated"
                      checked={unvalidated.length > 0 && unvalidated.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(unvalidated.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th scope="col" className="ui-th">Day</th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th ui-col-h-center">In</th>
                  <th scope="col" className="ui-th ui-col-h-center">Out</th>
                  <th scope="col" className="ui-th text-end hidden md:table-cell">Worked</th>
                  <th scope="col" className="ui-th text-end hidden md:table-cell">Late</th>
                  <th scope="col" className="ui-th text-end hidden md:table-cell">Overtime</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center hidden md:table-cell">Validated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setEditing({ ...r, checkIn: r.checkInTime || '', checkOut: r.checkOutTime || '', status: r.checkIn ? '' : r.status })}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="ui-checkbox" aria-label={`Select ${r.employeeName} ${r.date}`} disabled={r.validated || !r.checkOut} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}</td>
                    <td className="ui-col-entity">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                    <td className="ui-col-h-center">{r.checkInTime || '—'}</td>
                    <td className="ui-col-h-center">{r.checkOutTime || '—'}</td>
                    <td className="text-end tabular-nums hidden md:table-cell">{r.checkOut ? hm(r.workedMinutes) : '—'}</td>
                    <td className="text-end tabular-nums hidden md:table-cell">{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</td>
                    <td className="text-end tabular-nums hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      {r.overtimeMinutes ? (
                        <span className="inline-flex items-center justify-end gap-2">
                        <span>{hm(r.overtimeMinutes)}</span>
                        <button
                          type="button"
                          className={`ui-btn ui-btn-sm ${r.overtimeApproved ? 'ui-btn-ghost' : 'ui-btn-secondary'}`}
                          aria-label={r.overtimeApproved ? `Overtime ${hm(r.overtimeMinutes)} approved; withdraw approval` : `Approve ${hm(r.overtimeMinutes)} overtime`}
                          title={r.overtimeApproved ? 'Approved: counts in the month summary. Click to withdraw.' : 'Not approved yet: does not count in the month summary.'}
                          onClick={async () => {
                            try {
                              await approveOvertime(r.id, !r.overtimeApproved);
                              load();
                            } catch (e) {
                              notify.error(String(e?.message || 'Not saved.'));
                            }
                          }}
                        >
                          {r.overtimeApproved ? 'Approved' : 'Approve'}
                        </button>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                    <td className="ui-col-h-center hidden md:table-cell">{r.validated ? <span className="ui-pill ui-pill-pos">Validated</span> : <span className="ui-caption">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? <MarkDay initial={editing} people={people} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function MarkDay({ initial, people, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...initial }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await markDay({
        employeeId: form.employeeId,
        date: form.date,
        checkIn: form.checkIn || null,
        checkOut: form.checkOut || null,
        status: form.checkIn ? null : form.status || 'ABSENT',
        note: form.note || null,
      });
      notify.success('Day saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: 'Delete this day?', message: 'The day goes back to unmarked.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteDay(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? `${form.employeeName} · ${form.date}` : 'Mark attendance'}
      description="Times are 24-hour, Indian Standard Time. An out earlier than the in is the next morning."
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="mark-day" className="ui-btn ui-btn-primary" disabled={saving || !form.employeeId || !form.date}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="mark-day" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {form.id ? null : (
          <label className="block sm:col-span-2">
            <span className="ui-label">Employee *</span>
            <select className="ui-select w-full" required value={form.employeeId || ''} onChange={set('employeeId')}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="ui-label">Day *</span><input type="date" className="ui-input w-full" required max={todayIst()} value={form.date} onChange={set('date')} disabled={Boolean(form.id)} /></label>
        <span />
        <label className="block"><span className="ui-label">In</span><input type="time" className="ui-input w-full" value={form.checkIn} onChange={set('checkIn')} /></label>
        <label className="block"><span className="ui-label">Out</span><input type="time" className="ui-input w-full" value={form.checkOut} onChange={set('checkOut')} disabled={!form.checkIn} /></label>
        {!form.checkIn ? (
          <label className="block sm:col-span-2">
            <span className="ui-label">No times — mark as</span>
            <select className="ui-select w-full" value={form.status || 'ABSENT'} onChange={set('status')}>
              <option value="ABSENT">Absent</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="HOLIDAY">Holiday</option>
              <option value="WEEKLY_OFF">Weekly off</option>
            </select>
          </label>
        ) : null}
        <label className="block sm:col-span-2"><span className="ui-label">Note</span><input className="ui-input w-full" value={form.note || ''} onChange={set('note')} /></label>
      </form>
    </Drawer>
  );
}
