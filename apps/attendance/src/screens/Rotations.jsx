import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Repeat, Trash2, Users, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
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
import LoadFailed from '../components/LoadFailed';

const PERIODS = { 7: 'a week', 14: 'two weeks', 1: 'a day' };
const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'cancelled' },
];
const COLUMNS = {
  name: (r) => r.name,
  from: (r) => r.anchorDate,
  active: (r) => (r.isActive ? 'Active' : 'Inactive'),
};

/**
 * Repeating patterns — week A days, week B nights (ClorTime's Rotations).
 * Two crews on the same pattern with offsets 0 and 1 cover both shifts every
 * week. A person's own schedule or a temporary one beats the pattern.
 */
export default function Rotations() {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [shifts, setShifts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [crew, setCrew] = useState(null);
  const [status, setStatus] = useState('');
  const load = useCallback(() => {
    listRotations().then((v) => { setAll(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load rotations.')));
  }, []);
  useEffect(() => {
    load();
    listShifts().then(setShifts).catch(() => setShifts([]));
  }, [load]);
  const name = (id) => (id === 'OFF' ? 'Off' : shifts.find((s) => s.id === id)?.name || '?');

  const counts = useMemo(() => {
    const list = all || [];
    const active = list.filter((r) => r.isActive).length;
    return { '': list.length, ACTIVE: active, INACTIVE: list.length - active };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || (status === 'ACTIVE') === Boolean(r.isActive)), [all, status]);
  const search = useListSearch(inTab, ['name', 'anchorDate']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const people = useMemo(() => (all || []).reduce((a, r) => a + Number(r.people || 0), 0), [all]);
  const create = () => setEditing({ name: '', sequence: ['', ''], periodDays: 7, anchorDate: todayIst(), isActive: true });

  return (
    <DocumentListShell
      entity="shift"
      title="Rotations"
      description="Repeating shift patterns. Each step lasts a week (or a day); crews on the same pattern can start at different steps."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search rotations…', label: 'Search rotations' }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" disabled={shifts.length < 1} onClick={create}>
          <Plus size={16} aria-hidden="true" /> New rotation
        </button>
      }
      cards={[
        { label: 'Rotations', value: counts[''], count: true, tone: 'all', Icon: Repeat },
        { label: 'Active', value: counts.ACTIVE, count: true, tone: 'paid', Icon: CheckCircle2, onSelect: () => setStatus('ACTIVE') },
        { label: 'People on them', value: people, count: true, tone: 'sent', Icon: Users },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Rotation status"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Rotation" col="name" state={filters}  className="ui-col-grow" />
                <th scope="col">Pattern</th>
                <th scope="col">Each step</th>
                <ColumnHeader label="From" col="from" state={filters} type="date" />
                <th scope="col" className="ui-num">People</th>
                <ColumnHeader label="Active" col="active" state={filters} align="center" />
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No rotations match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Repeat}
                        title={status ? `No ${status.toLowerCase()} rotations` : 'No rotations'}
                        description={`Repeating shift patterns. Each step lasts a week (or a day); crews on the same pattern can start at different steps. ${shifts.length ? 'Create a pattern, e.g. Day week → Night week.' : 'Create shifts first.'}`}
                        routes={status || !shifts.length ? undefined : [{ label: 'New rotation', description: 'A pattern, e.g. Day week → Night week.', onSelect: create }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity"><button type="button" className="ui-link" onClick={() => setEditing({ ...r })}>{r.name}</button></td>
                    <td>{r.sequence.map(name).join(' → ')}</td>
                    <td>{PERIODS[r.periodDays] || `${r.periodDays} days`}</td>
                    <td className="ui-col-date whitespace-nowrap">{r.anchorDate}</td>
                    <td className="ui-num">{r.people}</td>
                    <td className="ui-col-h-center">{r.isActive ? <StatusPill status="active" /> : <span className="ui-caption">Inactive</span>}</td>
                    <td className="ui-col-meta">
                      <span className="flex justify-end">
                        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`People on ${r.name}`} onClick={() => setCrew(r)}>
                          <Users size={14} aria-hidden="true" /> People
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
      {editing ? <RotationForm initial={editing} shifts={shifts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
      {crew ? <RotationCrew rotation={crew} name={name} onClose={() => { setCrew(null); load(); }} /> : null}
    </DocumentListShell>
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
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
          <table className="ui-table w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="ui-col-grow ui-th">Employee</th>
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
          </div>
        )}
      </div>
    </Drawer>
  );
}
