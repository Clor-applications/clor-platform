import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createShift, deleteShift, hm, listShifts, updateShift } from '../api/attendance';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLANK = {
  name: '',
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  graceMinutes: 10,
  earlyOutGraceMinutes: 0,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  overtimeAfterMinutes: '',
  weeklyOffDays: '0',
  offSaturdays: '',
  code: '',
  color: '',
  isActive: true,
};
const NTH = ['1st', '2nd', '3rd', '4th', '5th'];
const offs = (s, sats) => {
  const days = s ? s.split(',').map((d) => DAYS[Number(d)]) : [];
  const nth = sats ? sats.split(',').map((n) => `${NTH[Number(n) - 1]} Sat`) : [];
  return [...days, ...nth].join(', ') || 'None';
};

/**
 * Work timings. People with no shift fall back to 09:00–18:00, Sunday off.
 * An end at or before the start is a night shift (ends the next morning).
 */
export default function Shifts() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    listShifts().then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load shifts.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Shifts"
        description="Timings, grace and weekly offs. Anyone without a shift works 09:00–18:00 with Sunday off."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            <Plus size={16} aria-hidden="true" /> New shift
          </button>
        }
      />
      {!rows ? (
        <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No shifts yet" description="Create one, then assign people to it." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Shift</th>
                  <th scope="col" className="ui-th ui-col-h-center">Timing</th>
                  <th scope="col" className="ui-th text-end">Break</th>
                  <th scope="col" className="ui-th text-end">Grace</th>
                  <th scope="col" className="ui-th text-end">Full day</th>
                  <th scope="col" className="ui-th">Weekly off</th>
                  <th scope="col" className="ui-th text-end">People</th>
                  <th scope="col" className="ui-th ui-col-h-center">Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="ui-row-click" onClick={() => setEditing({ ...s, overtimeAfterMinutes: s.overtimeAfterMinutes ?? '', code: s.code || '', color: s.color || '', offSaturdays: s.offSaturdays || '' })}>
                    <td className="ui-col-entity">
                      {s.code ? <span className="mr-1.5 inline-block rounded px-1.5 text-xs font-semibold text-white" style={{ backgroundColor: s.color || '#64748b' }}>{s.code}</span> : null}
                      {s.name}
                    </td>
                    <td className="ui-col-h-center whitespace-nowrap">
                      {s.startTime}–{s.endTime}
                      {s.endTime <= s.startTime ? <span className="ui-caption"> (night)</span> : null}
                    </td>
                    <td className="text-end tabular-nums">{s.breakMinutes}m</td>
                    <td className="text-end tabular-nums">{s.graceMinutes}m</td>
                    <td className="text-end tabular-nums">{hm(s.fullDayMinutes)}</td>
                    <td>{offs(s.weeklyOffDays, s.offSaturdays)}</td>
                    <td className="text-end tabular-nums">{s.assignments}</td>
                    <td className="ui-col-h-center">{s.isActive ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing ? <ShiftForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function ShiftForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const offSet = new Set(String(form.weeklyOffDays || '').split(',').filter(Boolean));
  const toggleOff = (i) => {
    const n = new Set(offSet);
    if (n.has(String(i))) n.delete(String(i));
    else n.add(String(i));
    setForm((f) => ({ ...f, weeklyOffDays: [...n].sort().join(',') }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name,
      startTime: form.startTime,
      endTime: form.endTime,
      breakMinutes: Number(form.breakMinutes),
      graceMinutes: Number(form.graceMinutes),
      earlyOutGraceMinutes: Number(form.earlyOutGraceMinutes),
      halfDayMinutes: Number(form.halfDayMinutes),
      fullDayMinutes: Number(form.fullDayMinutes),
      overtimeAfterMinutes: form.overtimeAfterMinutes === '' ? null : Number(form.overtimeAfterMinutes),
      weeklyOffDays: form.weeklyOffDays,
      offSaturdays: form.offSaturdays || '',
      code: form.code || null,
      color: form.color || null,
      isActive: Boolean(form.isActive),
    };
    try {
      if (form.id) await updateShift(form.id, body);
      else await createShift(body);
      notify.success('Shift saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a shift nobody has used can be deleted.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteShift(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  const num = (k, label, hint) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input type="number" min={0} className="ui-input w-full" value={form[k]} onChange={set(k)} />
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </label>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? form.name : 'New shift'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="shift-form" className="ui-btn ui-btn-primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="shift-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" required value={form.name} onChange={set('name')} /></label>
        <label className="block"><span className="ui-label">Starts</span><input type="time" className="ui-input w-full" required value={form.startTime} onChange={set('startTime')} /></label>
        <label className="block">
          <span className="ui-label">Ends</span>
          <input type="time" className="ui-input w-full" required value={form.endTime} onChange={set('endTime')} />
          {form.endTime <= form.startTime ? <span className="ui-caption">Night shift — ends the next morning.</span> : null}
        </label>
        {num('breakMinutes', 'Break (minutes)', 'Deducted when the day runs past a half day.')}
        {num('graceMinutes', 'Late grace (minutes)')}
        {num('earlyOutGraceMinutes', 'Early-out grace (minutes)')}
        {num('halfDayMinutes', 'Half day (minutes worked)')}
        {num('fullDayMinutes', 'Full day (minutes worked)')}
        {num('overtimeAfterMinutes', 'Overtime after (minutes)', 'Blank = after a full day.')}
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Weekly off</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={offSet.has(String(i))} onChange={() => toggleOff(i)} /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Saturdays off as well</legend>
          <div className="flex flex-wrap gap-3">
            {NTH.map((n, i) => {
              const sats = new Set(String(form.offSaturdays || '').split(',').filter(Boolean));
              const k = String(i + 1);
              return (
                <label key={n} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={sats.has(k)}
                    onChange={() => {
                      const next = new Set(sats);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      setForm((f) => ({ ...f, offSaturdays: [...next].sort().join(',') }));
                    }}
                  />
                  {n}
                </label>
              );
            })}
          </div>
          <span className="ui-caption">For “2nd and 4th Saturday off” — leave Saturday unticked above.</span>
        </fieldset>
        <label className="block"><span className="ui-label">Code</span><input className="ui-input w-full" maxLength={6} value={form.code || ''} onChange={set('code')} placeholder="e.g. G, N1 — for the schedule calendar" /></label>
        <label className="block"><span className="ui-label">Colour</span><input type="color" className="ui-input h-10 w-full p-1" value={form.color || '#64748b'} onChange={set('color')} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
        </label>
      </form>
    </Drawer>
  );
}
