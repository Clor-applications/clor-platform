import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createHoliday, deleteHoliday, listHolidays, todayIst, updateHoliday } from '../api/attendance';
import { listStructure } from '@ui/personnel/api';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (iso) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];

/** The year's holidays. A day worked on a holiday is all overtime. */
export default function Holidays() {
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ date: '', name: '', isOptional: false, areaId: '' });
  const [areas, setAreas] = useState([]);
  useEffect(() => {
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, []);

  const load = useCallback(() => {
    listHolidays(year).then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load holidays.')));
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await createHoliday({ ...form, areaId: form.areaId || null });
      notify.success('Holiday added.');
      setForm({ date: '', name: '', isOptional: false, areaId: '' });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not added.'));
    }
  };

  const toggleOptional = async (h) => {
    try {
      await updateHoliday(h.id, { date: h.date, name: h.name, isOptional: !h.isOptional, branchId: h.branchId, areaId: h.areaId });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };

  const remove = async (h) => {
    const ok = await confirmDialog({ title: `Delete ${h.name}?`, message: 'Days already marked as this holiday keep their status.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteHoliday(h.id);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Holidays"
        description="Paid days off — for everyone, or only one area’s people (a plant in another state keeps its own). Optional holidays do not change anyone's attendance."
        actions={
          <div className="flex items-center gap-1">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
            <span className="min-w-[4ch] text-center font-medium tabular-nums">{year}</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
          </div>
        }
      />

      <form onSubmit={add} className="ui-card flex flex-wrap items-end gap-3 p-4">
        <label className="block"><span className="ui-label">Date</span><input type="date" className="ui-input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label className="block min-w-[14rem] flex-1"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali" /></label>
        {areas.length ? (
          <label className="block">
            <span className="ui-label">For</span>
            <select className="ui-select" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
              <option value="">Everyone</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name} only</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.isOptional} onChange={(e) => setForm({ ...form, isOptional: e.target.checked })} /> Optional</label>
        <button type="submit" className="ui-btn ui-btn-primary">Add holiday</button>
      </form>

      {!rows ? (
        <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState title={`No holidays in ${year}`} description="Add the year's holidays above." />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Date</th>
                <th scope="col" className="ui-th">Day</th>
                <th scope="col" className="ui-th">Holiday</th>
                <th scope="col" className="ui-th">For</th>
                <th scope="col" className="ui-th ui-col-h-center">Optional</th>
                <th scope="col" className="ui-th"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{h.date}</td>
                  <td className="ui-col-meta">{weekday(h.date)}</td>
                  <td className="ui-col-entity">{h.name}</td>
                  <td className="ui-col-meta">{h.areaName || 'Everyone'}</td>
                  <td className="ui-col-h-center">
                    <input type="checkbox" className="ui-checkbox" aria-label={`${h.name} is optional`} checked={h.isOptional} onChange={() => toggleOptional(h)} />
                  </td>
                  <td className="text-end">
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Delete ${h.name}`} onClick={() => remove(h)}>
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
