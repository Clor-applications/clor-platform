import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { checkIn, createGoal, getGoal, listGoals, updateGoal } from '../api/talent';
import { FormError, Footer, HEALTH, Pill, SHEET, Tabs, day, staffOptions, todayIst, useParamState, usedValues, useStaff, when } from './shared';

/**
 * Goals (TALENT-DECISIONS.md, Growth): what a person is working towards, how it is measured and
 * by when. HR, the person's manager or the person sets them; a check-in records progress, how it
 * is going and a note, so the goal keeps its history instead of one bare percentage.
 */
const TABS = [['ACTIVE', 'Active'], ['DONE', 'Done'], ['DROPPED', 'Dropped'], ['all', 'All']];
const STATUS = { ACTIVE: ['Active', 'ui-pill-info'], DONE: ['Done', 'ui-pill-pos'], DROPPED: ['Dropped', 'ui-pill-neutral'] };

export const Progress = ({ value }) => (
  <span className="inline-flex items-center gap-2 min-w-[7rem]">
    <span className="h-1.5 w-16 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--border))' }} aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, backgroundColor: 'rgb(var(--brand))' }} />
    </span>
    <span className="tabular-nums">{value || 0}%</span>
  </span>
);

export default function Goals({ params = {} }) {
  const [status, setStatus] = useState('ACTIVE');
  const [person, setPerson] = useParamState(params?.employeeId, '');
  const [q, setQ] = useState('');
  const [open, setOpen] = useParamState(params?.id);
  const [editing, setEditing] = useState(null);
  const staff = useStaff();
  const req = useRequest(() => listGoals({ status, employeeId: person, q }), [status, person, q]);
  const rows = req.data?.goals || [];
  /* Who they may set goals for: everyone they can read, or, without the directory, themselves and their team. */
  const me = req.data?.me || null;
  const people = staff.length ? staff : [...(me ? [me] : []), ...(req.data?.reports || [])];
  const canAdd = Boolean(people.length || req.data?.hr);
  const columns = [
    { key: 'title', label: 'Goal', always: true, render: (g) => <span className="min-w-0"><span className="block truncate font-medium">{g.title}</span>{g.measure ? <span className="block truncate ui-caption">{g.measure}</span> : null}</span> },
    ...(person ? [] : [{ key: 'person', label: 'Person', render: (g) => g.employee?.name || '—' }]),
    { key: 'due', label: 'Due', render: (g) => <span className={`tabular-nums whitespace-nowrap ${g.overdue ? 'ui-text-neg' : ''}`}>{day(g.dueDate) || '—'}{g.overdue ? ' (late)' : ''}</span> },
    { key: 'progress', label: 'Progress', render: (g) => <Progress value={g.progress} /> },
    { key: 'health', label: 'How it is going', render: (g) => (g.status === 'ACTIVE' ? <Pill map={HEALTH} value={g.health} /> : <Pill map={STATUS} value={g.status} />) },
    { key: 'last', label: 'Last check-in', render: (g) => <span className="tabular-nums whitespace-nowrap">{g.lastCheckIn ? day(g.lastCheckIn) : <span className="ui-muted">None</span>}</span> },
  ];
  const blank = { employeeId: person || (people.length === 1 ? people[0].id : me && !staff.length ? me.id : '') };
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Goals' }]} title="Goals"
        actions={canAdd ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank)}><Plus size={16} aria-hidden="true" /> New goal</button> : null} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          tabs={<Tabs label="Goals" tabs={TABS} value={status} onChange={setStatus} />}
          label="Goals" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="goals"
          onRowClick={(g) => setOpen(g.id)}
          card={(g) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{g.title}</span><span className="tabular-nums">{g.progress || 0}%</span></span>
              <span className="block truncate ui-caption">{[g.employee?.name, g.dueDate ? `due ${day(g.dueDate)}` : null, g.status === 'ACTIVE' ? HEALTH[g.health]?.[0] : STATUS[g.status]?.[0]].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={q || person || status !== 'ACTIVE'
            ? <EmptyState kind="filtered" title="No goals match" description="Nothing here matches the search, the person or the tab." />
            : <EmptyState title="No goals yet" description="Agree what someone is working towards, how it is measured and by when." routes={canAdd ? [{ label: 'New goal', onSelect: () => setEditing(blank) }] : undefined} />}
          toolbar={<>
            <SearchField value={q} onSearch={setQ} placeholder="Search goal or person" label="Search goals" className="w-full sm:w-72" />
            <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Person" value={person} alwaysSearch onChange={(v) => setPerson(v || '')} options={[{ value: '', label: 'Everyone I can see' }, ...staffOptions(people)]} /></div>
          </>} />
      )}
      {open ? <GoalDrawer id={open} onEdit={(g) => { setOpen(null); setEditing(g); }} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {editing ? <GoalForm value={editing} staff={people} rows={rows} onClose={() => setEditing(null)} onSaved={(g) => { setEditing(null); req.reload(); setOpen(g.id); }} /> : null}
    </div>
  );
}

function GoalDrawer({ id, onEdit, onClose, onChanged }) {
  const req = useRequest(() => getGoal(id), [id]);
  const g = req.data?.goal;
  const [form, setForm] = useState({ progress: '', health: 'ON_TRACK', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (g) setForm((f) => ({ ...f, progress: f.progress === '' ? String(g.progress || 0) : f.progress, health: g.health || 'ON_TRACK' })); }, [g]);
  const reload = () => { req.reload(); onChanged(); };
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await checkIn(id, { progress: Number(form.progress), health: form.health, note: form.note.trim() || null }); notify.success('Check-in saved.'); setForm((f) => ({ ...f, note: '' })); reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const close = async (status) => {
    if (!(await confirmDialog({ title: status === 'DONE' ? 'Mark this goal done?' : 'Drop this goal?', message: status === 'DONE' ? 'It is set to 100% and leaves the active list.' : 'It leaves the active list; its check-ins stay.', confirmLabel: status === 'DONE' ? 'Mark done' : 'Drop', tone: status === 'DONE' ? 'neutral' : 'danger' }))) return;
    try { await updateGoal(id, { status }); notify.success('Saved.'); reload(); } catch (e) { notify.error(String(e?.message || 'Not saved.')); }
  };
  const active = g?.status === 'ACTIVE';
  return (
    <Drawer open onClose={onClose} title={g?.title || 'Goal'} widthClass={SHEET} dirty={Boolean(form.note.trim())}
      footer={g && active ? (
        <>
          <button type="button" className="ui-btn ui-btn-ghost mr-auto" onClick={() => close('DROPPED')}>Drop</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => onEdit(g)}>Edit</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => close('DONE')}>Mark done</button>
        </>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !g ? <SkeletonCard lines={6} /> : (
        <div className="space-y-5">
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Person</dt><dd className="text-sm">{g.employee?.name || '—'}</dd></div>
            <div><dt className="ui-label">Due</dt><dd className="text-sm tabular-nums">{day(g.dueDate) || '—'}</dd></div>
            <div><dt className="ui-label">Progress</dt><dd className="text-sm"><Progress value={g.progress} /></dd></div>
            <div><dt className="ui-label">Status</dt><dd>{active ? <Pill map={HEALTH} value={g.health} /> : <Pill map={STATUS} value={g.status} />}</dd></div>
            {g.measure ? <div className="sm:col-span-2"><dt className="ui-label">Measured by</dt><dd className="text-sm">{g.measure}</dd></div> : null}
            {g.weight !== null && g.weight !== undefined ? <div><dt className="ui-label">Weight</dt><dd className="text-sm tabular-nums">{g.weight}%</dd></div> : null}
          </dl>
          {g.description ? <p className="text-sm whitespace-pre-wrap">{g.description}</p> : null}
          {active ? (
            <form className="ui-form-grid border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }} aria-label="Check in">
              <p className="ui-label sm:col-span-2">Check in</p>
              <FormError error={error} />
              <label className="block"><span className="ui-label">Progress (%)</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
              <div><PopupSelect showValueSubtext={false} label="How it is going" value={form.health} onChange={(v) => setForm({ ...form, health: v || 'ON_TRACK' })} options={Object.entries(HEALTH).map(([v, [l]]) => ({ value: v, label: l }))} /></div>
              <label className="block sm:col-span-2"><span className="ui-label">{form.health === 'ON_TRACK' ? 'Note' : 'What is in the way *'}</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              <div className="sm:col-span-2 flex justify-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={busy || form.progress === ''}>{busy ? 'Saving…' : 'Save check-in'}</button></div>
            </form>
          ) : null}
          <section aria-label="Check-ins" className="space-y-2">
            <h3 className="ui-label">Check-ins</h3>
            {!req.data.checkIns.length ? <p className="text-sm ui-muted">None yet.</p> : (
              <ol className="ui-history-list">
                {req.data.checkIns.map((c) => (
                  <li key={c.id} className="ui-history-row space-y-1">
                    <p className="ui-caption flex flex-wrap items-center gap-x-2"><span className="font-medium tabular-nums">{c.progress}%</span><Pill map={HEALTH} value={c.health} /><span>{c.by}{c.source === 'SELF_SERVICE' ? ' (employee app)' : ''}</span><span className="tabular-nums ms-auto">{when(c.createdAt)}</span></p>
                    {c.note ? <p className="text-sm whitespace-pre-wrap">{c.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function GoalForm({ value, staff, rows, onClose, onSaved }) {
  const initial = useMemo(() => ({ employeeId: value.employeeId || '', title: value.title || '', measure: value.measure || '', dueDate: value.dueDate || '', weight: value.weight === null || value.weight === undefined ? '' : String(value.weight), description: value.description || '' }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (inFlight.current) return;
    const missing = !form.employeeId ? 'Choose whose goal it is.' : !form.title.trim() ? 'Say what the goal is.' : null;
    if (missing) { setError({ message: missing }); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = { employeeId: form.employeeId, title: form.title.trim(), measure: form.measure.trim() || null, dueDate: form.dueDate || null, weight: form.weight === '' ? null : Number(form.weight), description: form.description.trim() || null };
    try {
      const g = value.id ? await updateGoal(value.id, body) : await createGoal(body);
      notify.success('Goal saved.');
      onSaved(g);
    } catch (e) { setError(e); } finally { inFlight.current = false; setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={value.id ? 'Edit goal' : 'New goal'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" disabled={Boolean(value.id) && !dirty} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        {!value.id ? <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Person *" value={form.employeeId} placeholder="Choose…" alwaysSearch onChange={(v) => set({ employeeId: v || '' })} options={staffOptions(staff)} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Goal *</span><SuggestInput autoFocus maxLength={200} value={form.title} onChange={(v) => set({ title: v })} suggestions={usedValues(rows, (r) => r.title)} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Measured by</span><SuggestInput maxLength={300} value={form.measure} onChange={(v) => set({ measure: v })} suggestions={usedValues(rows, (r) => r.measure)} /></label>
        <div><label className="ui-label" htmlFor="goal-due">Due</label><DatePicker id="goal-due" min={value.id ? '' : todayIst()} value={form.dueDate} onChange={(d) => set({ dueDate: d || '' })} /></div>
        <label className="block"><span className="ui-label">Weight (%)</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={form.weight} onChange={(e) => set({ weight: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">More about it</span><textarea className="ui-input w-full" rows={4} maxLength={4000} value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}
