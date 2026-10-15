import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  assignRotation,
  createRotation,
  deleteRotation,
  listEmployees,
  listRotationPeople,
  listRotations,
  listShifts,
  removeRotationAssignment,
  todayIst,
  updateRotation,
} from '../api/attendance';

const PERIODS = { 7: 'a week', 14: 'two weeks', 1: 'a day' };

/**
 * Repeating patterns — week A days, week B nights (ClorTime's Rotations).
 * Two crews on the same pattern with offsets 0 and 1 cover both shifts every
 * week. A person's own schedule or a temporary one beats the pattern.
 */
export default function Rotations() {
  const [rows, setRows] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [crew, setCrew] = useState(null);
  const load = useCallback(() => {
    listRotations().then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load rotations.')));
  }, []);
  useEffect(() => {
    load();
    listShifts().then(setShifts).catch(() => setShifts([]));
  }, [load]);
  const name = (id) => (id === 'OFF' ? 'Off' : shifts.find((s) => s.id === id)?.name || '?');

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Rotations"
        description="Repeating shift patterns. Each step lasts a week (or a day); crews on the same pattern can start at different steps."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" disabled={shifts.length < 1} onClick={() => setEditing({ name: '', sequence: ['', ''], periodDays: 7, anchorDate: todayIst(), isActive: true })}>
            <Plus size={16} aria-hidden="true" /> New rotation
          </button>
        }
      />
      {!rows ? (
        <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No rotations" description={shifts.length ? 'Create a pattern, e.g. Day week → Night week.' : 'Create shifts first.'} />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Rotation</th>
                <th scope="col" className="ui-th">Pattern</th>
                <th scope="col" className="ui-th">Each step</th>
                <th scope="col" className="ui-th">From</th>
                <th scope="col" className="ui-th text-end">People</th>
                <th scope="col" className="ui-th ui-col-h-center">Active</th>
                <th scope="col" className="ui-th"><span className="sr-only">People</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity"><button type="button" className="ui-link" onClick={() => setEditing({ ...r })}>{r.name}</button></td>
                  <td>{r.sequence.map(name).join(' → ')}</td>
                  <td>{PERIODS[r.periodDays] || `${r.periodDays} days`}</td>
                  <td>{r.anchorDate}</td>
                  <td className="text-end tabular-nums">{r.people}</td>
                  <td className="ui-col-h-center">{r.isActive ? '✓' : ''}</td>
                  <td className="text-end"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setCrew(r)}>People</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <RotationForm initial={editing} shifts={shifts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
      {crew ? <RotationCrew rotation={crew} name={name} onClose={() => { setCrew(null); load(); }} /> : null}
    </div>
  );
}

function RotationForm({ initial, shifts, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const setStep = (i, v) => setForm((f) => ({ ...f, sequence: f.sequence.map((x, j) => (j === i ? v : x)) }));
  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name, sequence: form.sequence, periodDays: Number(form.periodDays), anchorDate: form.anchorDate, isActive: form.isActive !== false };
    try {
      if (form.id) await updateRotation(form.id, body);
      else await createRotation(body);
      notify.success('Rotation saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a rotation nobody is on can be deleted.', confirmLabel: 'Delete' }))) return;
    try {
      await deleteRotation(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? form.name : 'New rotation'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="rotation-form" className="ui-btn ui-btn-primary" disabled={!form.name.trim() || form.sequence.some((x) => !x)}>Save</button>
        </>
      }
    >
      <form id="rotation-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Days / Nights" /></label>
        <fieldset>
          <legend className="ui-label">Pattern, in order</legend>
          <ol className="space-y-2">
            {form.sequence.map((v, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="ui-caption w-14">Step {i + 1}</span>
                <select className="ui-select flex-1" value={v} onChange={(e) => setStep(i, e.target.value)} aria-label={`Step ${i + 1}`}>
                  <option value="">Choose…</option>
                  {shifts.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                  <option value="OFF">Off (their other schedules apply)</option>
                </select>
                {form.sequence.length > 2 ? (
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove step ${i + 1}`} onClick={() => setForm((f) => ({ ...f, sequence: f.sequence.filter((_, j) => j !== i) }))}>
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-2" onClick={() => setForm((f) => ({ ...f, sequence: [...f.sequence, ''] }))}>Add step</button>
        </fieldset>
        <label className="block">
          <span className="ui-label">Each step lasts</span>
          <select className="ui-select w-full" value={String(form.periodDays)} onChange={(e) => setForm({ ...form, periodDays: Number(e.target.value) })}>
            <option value="7">A week</option>
            <option value="14">Two weeks</option>
            <option value="1">A day</option>
          </select>
        </label>
        <label className="block">
          <span className="ui-label">Step 1 starts on</span>
          <input type="date" className="ui-input w-full" required value={form.anchorDate} onChange={(e) => setForm({ ...form, anchorDate: e.target.value })} />
          <span className="ui-caption">Usually a Monday. Steps are counted from here.</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="ui-checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
      </form>
    </Drawer>
  );
}

function RotationCrew({ rotation, name, onClose }) {
  const [rows, setRows] = useState(null);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ employeeIds: [], slotOffset: 0, startsOn: todayIst(), endsOn: '' });
  const load = useCallback(() => {
    listRotationPeople(rotation.id).then(setRows).catch(() => setRows([]));
  }, [rotation.id]);
  useEffect(() => {
    load();
    listEmployees().then(setPeople).catch(() => setPeople([]));
  }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      const r = await assignRotation(rotation.id, { ...form, endsOn: form.endsOn || null });
      notify.success(`${r.assigned} on the rotation.`);
      setForm((f) => ({ ...f, employeeIds: [] }));
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  return (
    <Drawer open onClose={onClose} title={`${rotation.name} — people`} description={rotation.sequence.map(name).join(' → ')} widthClass="w-[min(40rem,96vw)]">
      <div className="space-y-5">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="ui-label">People *</span>
            <select multiple className="ui-select h-36 w-full" value={form.employeeIds} onChange={(e) => setForm({ ...form, employeeIds: [...e.target.selectedOptions].map((o) => o.value) })}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
            </select>
            <span className="ui-caption">Ctrl/⌘-click to pick several.</span>
          </label>
          <label className="block">
            <span className="ui-label">Start at step</span>
            <select className="ui-select w-full" value={form.slotOffset} onChange={(e) => setForm({ ...form, slotOffset: Number(e.target.value) })}>
              {rotation.sequence.map((s, i) => <option key={i} value={i}>{i + 1} — {name(s)}</option>)}
            </select>
          </label>
          <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input w-full" required value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Until</span><input type="date" className="ui-input w-full" min={form.startsOn} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></label>
          <div className="self-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={!form.employeeIds.length}>Put on rotation</button></div>
        </form>
        {!rows ? (
          <SkeletonCard lines={3} />
        ) : !rows.length ? (
          <p className="ui-muted text-sm">Nobody on this rotation yet.</p>
        ) : (
          <table className="ui-table w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Employee</th>
                <th scope="col" className="ui-th">Starts at step</th>
                <th scope="col" className="ui-th">From</th>
                <th scope="col" className="ui-th">Until</th>
                <th scope="col" className="ui-th"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity">{r.employeeName}</td>
                  <td>{r.slotOffset + 1} — {name(rotation.sequence[r.slotOffset] || '')}</td>
                  <td>{r.startsOn}</td>
                  <td>{r.endsOn || '—'}</td>
                  <td className="text-end">
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Take ${r.employeeName} off the rotation`} onClick={async () => { await removeRotationAssignment(r.id); load(); }}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}
