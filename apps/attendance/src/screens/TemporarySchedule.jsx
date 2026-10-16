import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { addTemporarySchedule, dayLabel, listEmployees, listShifts, listTemporarySchedules, removeTemporarySchedule, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

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

  const add = async () => {
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
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Temporary schedule" description="A different shift for some days. It wins over every other schedule on those days." />
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
          <button type="button" className="ui-btn ui-btn-primary" disabled={!form.shiftId || !picked.size} onClick={add}>Schedule {picked.size || ''}</button>
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
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No temporary schedules" description="None from this month on." />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Employee</th>
                <th scope="col" className="ui-th">Shift</th>
                <th scope="col" className="ui-th">From</th>
                <th scope="col" className="ui-th">To</th>
                <th scope="col" className="ui-th">Why</th>
                <th scope="col" className="ui-th"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity">{r.employeeName}</td>
                  <td>{r.shiftName}</td>
                  <td className="whitespace-nowrap">{dayLabel(r.fromDate)}</td>
                  <td className="whitespace-nowrap">{dayLabel(r.toDate)}</td>
                  <td className="ui-col-meta">{r.reason || '—'}</td>
                  <td className="text-end">
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove ${r.employeeName}'s temporary schedule`} onClick={async () => { await removeTemporarySchedule(r.id); load(); }}>
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
