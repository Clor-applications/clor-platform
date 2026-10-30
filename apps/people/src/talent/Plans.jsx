import React, { useMemo, useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { createPlan, decidePlan, listPlans, notePlan } from '../api/talent';
import { FormError, Footer, PLAN_STATUS, Pill, SHEET, Tabs, WIDE_SHEET, day, staffOptions, todayIst, useParamState, useStaff, when } from './shared';

/**
 * Improvement plans (TALENT-DECISIONS.md, Growth): why, what is expected by the end, from and to,
 * notes along the way, and the outcome a person decides (completed, extended with a new end date,
 * not met). Seen by HR and the person's manager; the person sees their own in the employee app.
 * Nothing happens on its own when a plan is not met.
 */
const TABS = [['', 'Running'], ['COMPLETED', 'Completed'], ['NOT_MET', 'Not met'], ['all', 'All']];
const OUTCOMES = [['COMPLETED', 'Completed: expectations met'], ['EXTENDED', 'Extended to a new end date'], ['NOT_MET', 'Not met'], ['CANCELLED', 'Cancelled']];

export default function Plans({ params = {} }) {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useParamState(params?.id);
  const [creating, setCreating] = useState(false);
  const req = useRequest(() => listPlans({ status }), [status]);
  const rows = req.data?.plans || [];
  /* A plan is HR's or a manager's: New plan only for them, picking from the whole company or their own team. */
  const canStart = Boolean(req.data?.hr || req.data?.reports?.length);
  const today = todayIst();
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (p) => <span className="font-medium">{p.employee?.name || '—'}</span> },
    { key: 'manager', label: 'Manager', render: (p) => p.manager?.name || <span className="ui-muted">—</span> },
    { key: 'from', label: 'From', render: (p) => <span className="tabular-nums whitespace-nowrap">{day(p.startDate)}</span> },
    { key: 'to', label: 'To', render: (p) => <span className={`tabular-nums whitespace-nowrap ${['ACTIVE', 'EXTENDED'].includes(p.status) && p.endDate < today ? 'ui-text-neg' : ''}`}>{day(p.endDate)}</span> },
    { key: 'notes', label: 'Notes', render: (p) => <span className="tabular-nums">{p.notes.length}</span> },
    { key: 'status', label: 'Status', render: (p) => <Pill map={PLAN_STATUS} value={p.status} /> },
  ];
  /* A link to one plan finds it even once it is decided and off the Running tab. */
  const lookup = useRequest(() => (params?.id ? listPlans({ status: 'all' }).then((r) => r.plans).catch(() => []) : Promise.resolve(null)), [params?.id]);
  const current = rows.find((p) => p.id === open) || (lookup.data || []).find((p) => p.id === open);
  const gone = Boolean(open && open === params?.id && lookup.data && !lookup.loading && !lookup.refreshing && !current);
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Improvement plans' }]} title="Improvement plans"
        actions={canStart ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New plan</button> : null} />
      {gone ? <p className="ui-alert ui-alert-info text-sm" role="status">That plan is not in your sight any more. The plans you can see are below.</p> : null}
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable tabs={<Tabs label="Plans" tabs={TABS} value={status} onChange={setStatus} />}
          label="Improvement plans" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="plans"
          onRowClick={(p) => setOpen(p.id)}
          card={(p) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.employee?.name}</span><Pill map={PLAN_STATUS} value={p.status} /></span>
              <span className="block truncate ui-caption tabular-nums">{day(p.startDate)} – {day(p.endDate)}</span>
            </span>
          )}
          empty={<EmptyState title={status ? 'No plans here' : 'No plans running'} description="A plan is agreed with someone whose work needs to change: why, what is expected, and by when." />} />
      )}
      {current ? <PlanDrawer plan={current} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {creating ? <PlanForm hr={Boolean(req.data?.hr)} reports={req.data?.reports || []} onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); req.reload(); setOpen(p.id); }} /> : null}
    </div>
  );
}

function PlanDrawer({ plan: p, onClose, onChanged }) {
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = ['ACTIVE', 'EXTENDED'].includes(p.status);
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try { await notePlan(p.id, note.trim()); setNote(''); notify.success('Note added.'); onChanged(); } catch (err) { notify.error(String(err?.message || 'Not added.')); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} title={`Plan: ${p.employee?.name || ''}`} widthClass={WIDE_SHEET} dirty={Boolean(note.trim())}
      footer={live ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setDeciding(true)}>Record the outcome</button> : null}>
      <div className="space-y-5">
        <dl className="ui-field-grid">
          <div><dt className="ui-label">Status</dt><dd><Pill map={PLAN_STATUS} value={p.status} /></dd></div>
          <div><dt className="ui-label">Period</dt><dd className="text-sm tabular-nums">{day(p.startDate)} – {day(p.endDate)}</dd></div>
          <div><dt className="ui-label">Manager</dt><dd className="text-sm">{p.manager?.name || '—'}</dd></div>
          {p.decidedBy ? <div><dt className="ui-label">Decided by</dt><dd className="text-sm">{p.decidedBy}, <span className="tabular-nums">{day(p.decidedAt)}</span></dd></div> : null}
        </dl>
        <section className="space-y-1"><h3 className="ui-label">Why</h3><p className="text-sm whitespace-pre-wrap">{p.reason}</p></section>
        <section className="space-y-1"><h3 className="ui-label">Expected by the end</h3><p className="text-sm whitespace-pre-wrap">{p.expectations}</p></section>
        {p.outcomeNote ? <section className="space-y-1"><h3 className="ui-label">Outcome</h3><p className="text-sm whitespace-pre-wrap">{p.outcomeNote}</p></section> : null}
        <section aria-label="Notes" className="space-y-2">
          <h3 className="ui-label">Notes</h3>
          {live ? (
            <form onSubmit={addNote} className="flex gap-2">
              <input className="ui-input w-full" maxLength={4000} placeholder="What was seen this week" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !note.trim()}>Add</button>
            </form>
          ) : null}
          {!p.notes.length ? <p className="text-sm ui-muted">None yet.</p> : (
            <ol className="ui-history-list">
              {p.notes.map((n) => <li key={n.id} className="ui-history-row"><p className="ui-caption flex gap-2"><span className="font-medium">{n.by}</span><span className="tabular-nums ms-auto">{when(n.at)}</span></p><p className="text-sm whitespace-pre-wrap">{n.note}</p></li>)}
            </ol>
          )}
        </section>
      </div>
      {deciding ? <OutcomeForm plan={p} onClose={() => setDeciding(false)} onSaved={() => { setDeciding(false); onChanged(); }} /> : null}
    </Drawer>
  );
}

function OutcomeForm({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({ outcome: '', note: '', endDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    const missing = !form.outcome ? 'Pick the outcome.' : !form.note.trim() ? 'Say what was seen. It stays on the plan.' : form.outcome === 'EXTENDED' && !form.endDate ? 'Choose the new end date.' : null;
    if (missing) { setError({ message: missing }); return; }
    setBusy(true);
    setError(null);
    try { await decidePlan(plan.id, { outcome: form.outcome, note: form.note.trim(), endDate: form.endDate || null }); notify.success('Outcome recorded.'); onSaved(); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={Boolean(form.outcome || form.note)} title="Record the outcome"
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Outcome *" value={form.outcome} placeholder="Choose…" onChange={(v) => setForm({ ...form, outcome: v || '' })} options={OUTCOMES.map(([v, l]) => ({ value: v, label: l }))} /></div>
        {form.outcome === 'EXTENDED' ? <div><label className="ui-label" htmlFor="plan-new-end">New end date *</label><DatePicker id="plan-new-end" min={plan.endDate} value={form.endDate} onChange={(d) => setForm({ ...form, endDate: d || '' })} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">What was seen *</span><textarea className="ui-input w-full" rows={5} maxLength={4000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        {form.outcome === 'NOT_MET' ? <p className="sm:col-span-2 ui-caption">Nothing else happens on its own. Any next step goes through Joining &amp; leaving.</p> : null}
      </form>
    </Drawer>
  );
}

function PlanForm({ hr, reports, onClose, onSaved }) {
  const staff = useStaff(hr);
  const people = hr && staff.length ? staff : reports;
  const initial = useMemo(() => ({ employeeId: '', reason: '', expectations: '', startDate: todayIst(), endDate: '' }), []);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    const missing = !form.employeeId ? 'Choose who the plan is with.' : !form.reason.trim() || !form.expectations.trim() ? 'Say why, and what is expected by the end.' : !form.endDate ? 'Choose the end date.' : null;
    if (missing) { setError({ message: missing }); return; }
    setBusy(true);
    setError(null);
    try { const p = await createPlan({ ...form, reason: form.reason.trim(), expectations: form.expectations.trim() }); notify.success('Plan started. They are told.'); onSaved(p); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={JSON.stringify(form) !== JSON.stringify(initial)} title="New improvement plan"
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Start plan" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Person *" value={form.employeeId} placeholder="Choose…" alwaysSearch onChange={(v) => set({ employeeId: v || '' })} options={staffOptions(people)} /></div>
        <div><label className="ui-label" htmlFor="plan-from">From *</label><DatePicker id="plan-from" value={form.startDate} onChange={(d) => set({ startDate: d || '' })} /></div>
        <div><label className="ui-label" htmlFor="plan-to">To *</label><DatePicker id="plan-to" min={form.startDate} value={form.endDate} onChange={(d) => set({ endDate: d || '' })} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">Why *</span><textarea className="ui-input w-full" rows={4} maxLength={4000} value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Expected by the end *</span><textarea className="ui-input w-full" rows={4} maxLength={8000} value={form.expectations} onChange={(e) => set({ expectations: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}
