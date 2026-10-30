import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { structure } from '../workforce/api';
import { calibration, createCycle, getCycle, listCycles, moveCycle, setFinal, writeManager, writeSelf } from '../api/talent';
import { CYCLE_STATUS, FormError, Footer, Pill, RATINGS, SHEET, Tabs, WIDE_SHEET, day, ratingWord, useParamState, usedValues } from './shared';

/**
 * Reviews (TALENT-DECISIONS.md, Growth): a review cycle for a period; opening it makes one review
 * per person with their manager at that moment. Each person writes a self-review, their manager
 * writes theirs, HR calibrates and sets the final rating (a reason when it differs from the
 * manager's), then shares; each person reads theirs in the employee app and acknowledges it.
 * Nobody reviews or rates themselves as manager.
 */
const NEXT = {
  DRAFT: ['OPEN', 'Open the cycle', 'Reviews are made for everyone in it, and their managers are told.'],
  OPEN: ['CALIBRATING', 'Start calibration', 'Self-reviews close. Managers can still finish theirs while you calibrate.'],
  CALIBRATING: ['SHARED', 'Share with each person', 'Each person sees their final rating and their manager’s words in the employee app.'],
  SHARED: ['CLOSED', 'Close the cycle', 'Nothing more is written in this cycle.'],
};
const of = (counts, n) => <span className="tabular-nums">{counts}<span className="ui-muted"> / {n}</span></span>;

export default function Reviews({ params = {} }) {
  const [open, setOpen] = useParamState(params?.id);
  const [creating, setCreating] = useState(false);
  const req = useRequest(() => listCycles(), []);
  const cycles = req.data?.cycles || [];
  const hr = Boolean(req.data?.hr);
  if (open) return <Cycle id={open} hr={hr} onBack={() => { setOpen(null); req.reload(); }} />;
  const columns = [
    { key: 'name', label: 'Cycle', always: true, render: (c) => <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block truncate ui-caption tabular-nums">{day(c.periodFrom)} – {day(c.periodTo)}</span></span> },
    { key: 'people', label: 'People', render: (c) => <span className="tabular-nums">{c.counts.people}</span> },
    { key: 'self', label: 'Self-reviews', render: (c) => of(c.counts.self, c.counts.people) },
    { key: 'manager', label: 'Manager reviews', render: (c) => of(c.counts.manager, c.counts.people) },
    { key: 'final', label: 'Final ratings', render: (c) => of(c.counts.final, c.counts.people) },
    { key: 'read', label: 'Read', render: (c) => of(c.counts.read, c.counts.people) },
    { key: 'status', label: 'Status', render: (c) => <Pill map={CYCLE_STATUS} value={c.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Reviews' }]} title="Reviews"
        actions={hr ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New cycle</button> : null} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Review cycles" columns={columns} rows={cycles} loading={req.loading} refreshing={req.refreshing} total={cycles.length} pageSize={Math.max(25, cycles.length)} noun="cycles"
          onRowClick={(c) => setOpen(c.id)}
          card={(c) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.name}</span><Pill map={CYCLE_STATUS} value={c.status} /></span>
              <span className="block truncate ui-caption tabular-nums">{day(c.periodFrom)} – {day(c.periodTo)} · {c.counts.people} people</span>
            </span>
          )}
          empty={<EmptyState title="No review cycles yet" description={hr ? 'A cycle covers a period, for example the 2026–27 year, and everyone working in it.' : 'HR starts review cycles; the ones you take part in show here.'} routes={hr ? [{ label: 'New cycle', onSelect: () => setCreating(true) }] : undefined} />} />
      )}
      {creating ? <CycleForm cycles={cycles} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); req.reload(); setOpen(c.id); }} /> : null}
    </div>
  );
}

function Cycle({ id, hr, onBack }) {
  const req = useRequest(() => getCycle(id), [id]);
  const [tab, setTab] = useState('reviews');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const c = req.data?.cycle;
  const reviews = req.data?.reviews || [];
  const next = c && hr ? NEXT[c.status] : null;
  const move = async () => {
    if (!(await confirmDialog({ title: `${next[1]}?`, message: next[2], confirmLabel: next[1], tone: 'neutral' }))) return;
    setBusy(true);
    try {
      const r = await moveCycle(id, next[0]);
      notify.success(r.reviews ? `Open: ${r.reviews} reviews made.` : `${CYCLE_STATUS[r.status]?.[0] || 'Moved'}.`);
      req.reload();
    } catch (e) { notify.error(String(e?.message || 'Not moved.')); } finally { setBusy(false); }
  };
  const mine = reviews.filter((r) => r.mineToWrite && !r.managerAt).length;
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.employee?.name}{r.own ? ' (you)' : ''}</span><span className="block truncate ui-caption">{r.department}</span></span> },
    { key: 'manager', label: 'Reviewed by', render: (r) => r.manager?.name || <span className="ui-muted">HR</span> },
    { key: 'self', label: 'Self', render: (r) => (r.selfAt ? <span className="tabular-nums">{r.selfRating}</span> : <span className="ui-muted">Not yet</span>) },
    { key: 'mgr', label: 'Manager', render: (r) => (r.managerAt ? <span className="tabular-nums">{r.managerRating ?? '✓'}</span> : r.mineToWrite ? <span className="ui-pill ui-pill-warn">Yours to write</span> : <span className="ui-muted">Not yet</span>) },
    { key: 'final', label: 'Final', render: (r) => (r.finalRating ? <span className="tabular-nums">{r.finalRating}</span> : <span className="ui-muted">—</span>) },
    { key: 'read', label: 'Read', render: (r) => (r.acknowledgedAt ? <span className="tabular-nums">{day(r.acknowledgedAt)}</span> : r.sharedAt ? <span className="ui-muted">Not yet</span> : <span className="ui-muted">—</span>) },
  ];
  return (
    <div className="space-y-6">
      <div><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Reviews</button></div>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} onBack={onBack} /> : !c ? <SkeletonCard lines={6} /> : (
        <>
          <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Reviews' }, { label: c.name }]} title={c.name}
            actions={next ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={move}>{next[1]}</button> : null} />
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Status</dt><dd><Pill map={CYCLE_STATUS} value={c.status} /></dd></div>
            <div><dt className="ui-label">Period</dt><dd className="text-sm tabular-nums">{day(c.periodFrom)} – {day(c.periodTo)}</dd></div>
            <div><dt className="ui-label">Self-reviews by</dt><dd className="text-sm tabular-nums">{day(c.selfDue) || '—'}</dd></div>
            <div><dt className="ui-label">Manager reviews by</dt><dd className="text-sm tabular-nums">{day(c.managerDue) || '—'}</dd></div>
          </dl>
          {mine ? <p className="ui-alert ui-alert-warn text-sm" role="status">{mine === 1 ? 'One review is yours to write.' : `${mine} reviews are yours to write.`}</p> : null}
          {c.status === 'DRAFT' ? <p className="text-sm ui-muted">{hr ? 'Open the cycle to make a review for everyone in it.' : 'HR has not opened this cycle yet.'}</p> : tab === 'calibration' ? (
            <div className="space-y-3">
              <Tabs label="Cycle" tabs={[['reviews', 'Reviews'], ['calibration', 'Calibration']]} value={tab} onChange={setTab} />
              <Calibration id={id} />
            </div>
          ) : (
            <DataTable
              tabs={hr ? <Tabs label="Cycle" tabs={[['reviews', 'Reviews'], ['calibration', 'Calibration']]} value={tab} onChange={setTab} /> : null}
              label="Reviews" columns={columns} rows={reviews} loading={req.loading} total={reviews.length} pageSize={Math.max(25, reviews.length)} noun="reviews"
              onRowClick={(r) => setOpen(r.id)}
              card={(r) => (
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employee?.name}</span>{r.mineToWrite && !r.managerAt ? <span className="ui-pill ui-pill-warn">Yours to write</span> : r.finalRating ? <span className="tabular-nums">{r.finalRating}</span> : null}</span>
                  <span className="block truncate ui-caption">{[r.department, r.selfAt ? 'self-review in' : 'no self-review yet', r.managerAt ? 'manager review in' : null].filter(Boolean).join(' · ')}</span>
                </span>
              )}
              empty={<EmptyState title="No reviews in your sight" description="You see the reviews of the people you manage, and your own." />} />
          )}
        </>
      )}
      {open && c ? <ReviewDrawer review={reviews.find((r) => r.id === open)} cycle={c} hr={hr} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); req.reload(); }} /> : null}
    </div>
  );
}

/** Ratings by department and by manager, and the spread; no forced curve. */
function Calibration({ id }) {
  const req = useRequest(() => calibration(id), [id]);
  if (req.error) return <ErrorState error={req.error} compact onRetry={req.reload} />;
  if (!req.data) return <SkeletonCard lines={5} />;
  const { spread, groups } = req.data;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-label="Spread" className="space-y-2">
        <h3 className="ui-label">Spread</h3>
        <table className="ui-table w-full">
          <thead><tr><th scope="col">Rating</th><th scope="col" className="text-right">Manager</th><th scope="col" className="text-right">Final</th></tr></thead>
          <tbody>{spread.map((s) => <tr key={s.rating}><td>{ratingWord(s.rating)}</td><td className="text-right tabular-nums">{s.manager}</td><td className="text-right tabular-nums">{s.final}</td></tr>)}</tbody>
        </table>
      </section>
      <section aria-label="By department and manager" className="space-y-2">
        <h3 className="ui-label">Manager ratings by department and manager</h3>
        <table className="ui-table w-full">
          <thead><tr><th scope="col">Group</th><th scope="col" className="text-right">Rated</th><th scope="col" className="text-right">Average</th></tr></thead>
          <tbody>{groups.map((g) => <tr key={g.key}><td>{g.label}</td><td className="text-right tabular-nums">{g.count}</td><td className="text-right tabular-nums">{g.average ?? '—'}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

const RatingPick = ({ label, value, onChange }) => (
  <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label={label} value={value ? String(value) : ''} placeholder="Choose…" onChange={(v) => onChange(v ? Number(v) : '')} options={RATINGS.map(([n, w]) => ({ value: String(n), label: `${n} · ${w}` }))} /></div>
);

function ReviewDrawer({ review: r, cycle, hr, onClose, onSaved }) {
  const canSelf = r?.own && cycle.status === 'OPEN';
  const canManager = r && !r.own && ['OPEN', 'CALIBRATING'].includes(cycle.status) && (r.mineToWrite || (hr && !r.manager));
  const canFinal = r && hr && !r.own && ['OPEN', 'CALIBRATING'].includes(cycle.status);
  const [form, setForm] = useState({ selfRating: r?.selfRating || '', selfText: r?.selfText || '', managerRating: r?.managerRating || '', managerText: r?.managerText || '', finalRating: r?.finalRating || '', finalReason: r?.finalReason || '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  if (!r) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const run = async (what, fn, ok) => {
    setBusy(what);
    setError(null);
    try { await fn(); notify.success(ok); onSaved(); } catch (e) { setError(e); setBusy(''); }
  };
  const block = (title, rating, text, at) => (
    <section className="space-y-1">
      <h3 className="ui-label">{title}</h3>
      {at ? <><p className="text-sm">{ratingWord(rating)}</p>{text ? <p className="text-sm whitespace-pre-wrap">{text}</p> : null}<p className="ui-caption tabular-nums">{day(at)}</p></> : <p className="text-sm ui-muted">Not written yet.</p>}
    </section>
  );
  return (
    <Drawer open onClose={onClose} title={`${r.employee?.name || 'Review'}: ${cycle.name}`} widthClass={WIDE_SHEET}>
      <div className="space-y-5">
        <FormError error={error} />
        {canSelf ? (
          <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; run('self', () => writeSelf(r.id, { selfRating: form.selfRating, selfText: form.selfText }), 'Self-review saved.'); }}>
            <p className="ui-label sm:col-span-2">Your self-review</p>
            <RatingPick label="How did the period go? *" value={form.selfRating} onChange={(v) => set({ selfRating: v })} />
            <label className="block sm:col-span-2"><span className="ui-label">What you did and what you want to work on *</span><textarea className="ui-input w-full" rows={5} maxLength={8000} value={form.selfText} onChange={(e) => set({ selfText: e.target.value })} /></label>
            <div className="sm:col-span-2 flex justify-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={Boolean(busy)}>{busy === 'self' ? 'Saving…' : 'Save self-review'}</button></div>
          </form>
        ) : block('Self-review', r.selfRating, r.selfText, r.selfAt)}
        {canManager ? (
          <form className="ui-form-grid border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} onSubmit={(e) => { e.preventDefault(); if (busy) return; run('manager', () => writeManager(r.id, { managerRating: form.managerRating, managerText: form.managerText }), 'Manager review saved.'); }}>
            <p className="ui-label sm:col-span-2">{r.manager ? 'Your review as their manager' : 'Manager review (they have no manager)'}</p>
            <RatingPick label="Rating *" value={form.managerRating} onChange={(v) => set({ managerRating: v })} />
            <label className="block sm:col-span-2"><span className="ui-label">What went well and what to work on *</span><textarea className="ui-input w-full" rows={5} maxLength={8000} value={form.managerText} onChange={(e) => set({ managerText: e.target.value })} /></label>
            <div className="sm:col-span-2 flex justify-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={Boolean(busy)}>{busy === 'manager' ? 'Saving…' : 'Save manager review'}</button></div>
          </form>
        ) : block(`Manager review${r.manager ? ` by ${r.manager.name}` : ''}`, r.managerRating, r.managerText, r.managerAt)}
        {canFinal ? (
          <form className="ui-form-grid border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} onSubmit={(e) => { e.preventDefault(); if (busy) return; run('final', () => setFinal(r.id, { finalRating: form.finalRating, finalReason: form.finalReason.trim() || null }), 'Final rating set.'); }}>
            <p className="ui-label sm:col-span-2">Final rating</p>
            <RatingPick label="Final rating *" value={form.finalRating} onChange={(v) => set({ finalRating: v })} />
            {r.managerRating && form.finalRating && Number(form.finalRating) !== r.managerRating ? (
              <label className="block sm:col-span-2"><span className="ui-label">Why it differs from the manager’s *</span><SuggestInput maxLength={2000} value={form.finalReason} onChange={(v) => set({ finalReason: v })} suggestions={['Brought in line with the department', 'Goals not met in the period', 'Work outside the goals recognised']} /></label>
            ) : null}
            <div className="sm:col-span-2 flex justify-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={Boolean(busy)}>{busy === 'final' ? 'Saving…' : 'Set final rating'}</button></div>
          </form>
        ) : r.finalRating ? (
          <section className="space-y-1 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }}><h3 className="ui-label">Final rating</h3><p className="text-sm">{ratingWord(r.finalRating)}</p>{r.finalReason ? <p className="text-sm ui-muted">{r.finalReason}</p> : null}</section>
        ) : null}
        {r.sharedAt ? <p className="ui-caption">Shared {day(r.sharedAt)}{r.acknowledgedAt ? `; read ${day(r.acknowledgedAt)}` : '; not read yet'}.</p> : null}
      </div>
    </Drawer>
  );
}

function CycleForm({ cycles, onClose, onSaved }) {
  const depts = useRequest(() => structure('departments').catch(() => []), []);
  const year = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const initial = useMemo(() => ({ name: `${year}–${String(year + 1).slice(2)} annual review`, periodFrom: `${year}-04-01`, periodTo: `${year + 1}-03-31`, selfDue: '', managerDue: '', departmentIds: [] }), [year]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    if (!form.name.trim()) { setError({ message: 'Name the cycle.' }); return; }
    setBusy(true);
    setError(null);
    try { const c = await createCycle({ ...form, name: form.name.trim(), selfDue: form.selfDue || null, managerDue: form.managerDue || null }); notify.success('Cycle saved as a draft. Open it when ready.'); onSaved(c); } catch (e) { setError(e); setBusy(false); }
  };
  const list = (depts.data || []).filter((d) => d.isActive !== false);
  const toggle = (did) => set({ departmentIds: form.departmentIds.includes(did) ? form.departmentIds.filter((x) => x !== did) : [...form.departmentIds, did] });
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={JSON.stringify(form) !== JSON.stringify(initial)} title="New review cycle"
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><SuggestInput autoFocus maxLength={120} value={form.name} onChange={(v) => set({ name: v })} suggestions={usedValues(cycles, (c) => c.name)} /></label>
        <div><label className="ui-label" htmlFor="cycle-from">Period from *</label><DatePicker id="cycle-from" value={form.periodFrom} onChange={(d) => set({ periodFrom: d || '' })} /></div>
        <div><label className="ui-label" htmlFor="cycle-to">Period to *</label><DatePicker id="cycle-to" value={form.periodTo} onChange={(d) => set({ periodTo: d || '' })} /></div>
        <div><label className="ui-label" htmlFor="cycle-self">Self-reviews by</label><DatePicker id="cycle-self" value={form.selfDue} onChange={(d) => set({ selfDue: d || '' })} /></div>
        <div><label className="ui-label" htmlFor="cycle-mgr">Manager reviews by</label><DatePicker id="cycle-mgr" value={form.managerDue} onChange={(d) => set({ managerDue: d || '' })} /></div>
        <fieldset className="sm:col-span-2 space-y-1.5">
          <legend className="ui-label">Who is in it</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={!form.departmentIds.length} onChange={() => set({ departmentIds: [] })} />Everyone working in the period</label>
          {list.length ? <div className="grid gap-1.5 sm:grid-cols-2">{list.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.departmentIds.includes(d.id)} onChange={() => toggle(d.id)} />{d.name}</label>)}</div> : null}
        </fieldset>
      </form>
    </Drawer>
  );
}
