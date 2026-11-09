import React, { useMemo, useRef, useState } from 'react';
import { Download, Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { assignSeats, certificateFile, deleteTraining, expiringCertificates, getTraining, listTrainings, markSeat, readFile, removeSeat, saveTraining } from '../api/talent';
import { FormError, Footer, Pill, SHEET, WIDE_SHEET, day, staffOptions, tabItems, todayIst, useParamState, usePerm, usedValues, useStaff } from './shared';

/**
 * Training (TALENT-DECISIONS.md): one training, many people. Each attendee is assigned, completes
 * on a date with an optional certificate, or misses it. A certificate good for N months lapses N
 * months after completion; Expiring lists those lapsing within 60 days, and HR and the person are
 * told at 60, 30 and 0 days.
 */
const TABS = [['', 'Current'], ['PLANNED', 'Planned'], ['DONE', 'Done'], ['CANCELLED', 'Cancelled'], ['expiring', 'Expiring certificates']];
const KINDS = [['INTERNAL', 'In-house'], ['EXTERNAL', 'Outside provider'], ['ONLINE', 'Online']];
const STATUS = { PLANNED: ['Planned', 'ui-pill-info'], DONE: ['Done', 'ui-pill-pos'], CANCELLED: ['Cancelled', 'ui-pill-neutral'] };
const SEAT = { ASSIGNED: ['Assigned', 'ui-pill-info'], COMPLETED: ['Completed', 'ui-pill-pos'], MISSED: ['Missed', 'ui-pill-neg'] };
const kindWord = (k) => KINDS.find((x) => x[0] === k)?.[1] || k;
const months = (n) => (n ? `${n} month${n === 1 ? '' : 's'}` : 'Does not lapse');
const Lapse = ({ seat }) => (seat.expired ? <span className="ui-pill ui-pill-neg">Lapsed {day(seat.expiresOn)}</span> : seat.expiringSoon ? <span className="ui-pill ui-pill-warn">Lapses {day(seat.expiresOn)}</span> : seat.expiresOn ? <span className="tabular-nums">{day(seat.expiresOn)}</span> : <span className="ui-muted">—</span>);

export default function Trainings({ params = {} }) {
  const allowed = usePerm();
  const canCreate = allowed('PEOPLE::Learning::CREATE');
  const [tab, setTab] = useParamState(params?.view === 'expiring' ? 'expiring' : undefined, '');
  const [q, setQ] = useState('');
  const [open, setOpen] = useParamState(params?.id);
  const [editing, setEditing] = useState(null);
  const expiring = tab === 'expiring';
  const req = useRequest(() => (expiring ? expiringCertificates() : listTrainings({ status: tab, q })), [tab, q]);
  const rows = req.data || [];
  const columns = expiring ? [
    { key: 'person', label: 'Person', always: true, render: (s) => <span className="font-medium">{s.employee?.name}</span> },
    { key: 'training', label: 'Training', render: (s) => s.trainingTitle },
    { key: 'done', label: 'Completed', render: (s) => <span className="tabular-nums">{day(s.completedOn)}</span> },
    { key: 'lapses', label: 'Lapses', render: (s) => <Lapse seat={s} /> },
  ] : [
    { key: 'title', label: 'Training', always: true, render: (t) => <span className="min-w-0"><span className="block truncate font-medium">{t.title}</span><span className="block truncate ui-caption">{[kindWord(t.kind), t.provider].filter(Boolean).join(' · ')}</span></span> },
    { key: 'dates', label: 'Dates', render: (t) => <span className="tabular-nums whitespace-nowrap">{t.startDate ? `${day(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` – ${day(t.endDate)}` : ''}` : '—'}</span> },
    { key: 'hours', label: 'Hours', render: (t) => <span className="tabular-nums">{t.hours ?? '—'}</span> },
    { key: 'people', label: 'People', render: (t) => <span className="tabular-nums">{t.completed}<span className="ui-muted"> / {t.assigned + t.completed + t.missed}</span></span> },
    { key: 'valid', label: 'Certificate', render: (t) => months(t.validMonths) },
    { key: 'status', label: 'Status', render: (t) => <span className="inline-flex flex-wrap gap-1.5"><Pill map={STATUS} value={t.status} />{t.mandatory ? <span className="ui-pill ui-pill-warn">Must do</span> : null}</span> },
  ];
  return (
    <div className="space-y-6">
      <ListHeader
        module="Talent"
        title="Training"
        description="Trainings, who attends them, and the certificates that lapse."
        primary={canCreate ? { label: 'New training', icon: Plus, onClick: () => setEditing({}) } : null}
        toolbar={expiring ? null : <SearchField value={q} onSearch={setQ} placeholder="Search training or provider" label="Search trainings" className="w-full sm:w-80" />}
        tabs={tabItems(TABS)}
        tab={tab}
        onTab={setTab}
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Training" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun={expiring ? 'certificates' : 'trainings'}
          onRowClick={(r) => setOpen(expiring ? r.trainingId : r.id)}
          card={(r) => (expiring ? (
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.employee?.name}</span><Lapse seat={r} /></span><span className="block truncate ui-caption">{r.trainingTitle}</span></span>
          ) : (
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.title}</span><Pill map={STATUS} value={r.status} /></span><span className="block truncate ui-caption">{[r.startDate ? day(r.startDate) : null, `${r.completed} of ${r.assigned + r.completed + r.missed} completed`].filter(Boolean).join(' · ')}</span></span>
          ))}
          empty={expiring ? <EmptyState title="Nothing lapsing" description="No certificate lapses in the next 60 days." />
            : q || tab ? <EmptyState kind="filtered" title="No trainings match" description="Nothing here matches the search or the tab." />
              : <EmptyState title="No trainings yet" description="Fire safety, first aid, forklift: add a training and who attends it." routes={canCreate ? [{ label: 'New training', onSelect: () => setEditing({}) }] : undefined} />} />
      )}
      {open ? <TrainingDrawer id={open} onEdit={(t) => { setOpen(null); setEditing(t); }} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {editing ? <TrainingForm value={editing} rows={expiring ? [] : rows} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); req.reload(); setOpen(t.id); }} /> : null}
    </div>
  );
}

function TrainingDrawer({ id, onEdit, onClose, onChanged }) {
  const allowed = usePerm();
  const canEdit = allowed('PEOPLE::Learning::EDIT');
  const canDelete = allowed('PEOPLE::Learning::DELETE');
  const req = useRequest(() => getTraining(id), [id]);
  const t = req.data?.training;
  const seats = req.data?.seats || [];
  const staff = useStaff(canEdit);
  const [completing, setCompleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const reload = () => { req.reload(); onChanged(); };
  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) notify.success(ok); reload(); } catch (e) { notify.error(String(e?.message || 'Not done.')); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (await confirmDialog({ title: `Delete ${t.title}?`, message: 'Only a training nobody has completed can be deleted. Cancel it instead to keep the record.', confirmLabel: 'Delete' })) {
      try { await deleteTraining(id); notify.success('Deleted.'); onChanged(); onClose(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
    }
  };
  const setStatus = (status) => act(() => saveTraining({ ...t, status }, id), status === 'CANCELLED' ? 'Cancelled.' : 'Marked done.');
  const seated = new Set(seats.map((s) => s.employeeId));
  const live = t && t.status !== 'CANCELLED';
  return (
    <Drawer open onClose={onClose} title={t?.title || 'Training'} widthClass={WIDE_SHEET}
      footer={t && canEdit ? (
        <>
          {canDelete ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={remove}>Delete</button> : null}
          {live ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setStatus('CANCELLED')}>Cancel training</button> : null}
          {t.status === 'PLANNED' ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setStatus('DONE')}>Mark done</button> : null}
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => onEdit(t)}>Edit</button>
        </>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !t ? <SkeletonCard lines={6} /> : (
        <div className="space-y-5">
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Status</dt><dd className="flex gap-1.5"><Pill map={STATUS} value={t.status} />{t.mandatory ? <span className="ui-pill ui-pill-warn">Must do</span> : null}</dd></div>
            <div><dt className="ui-label">How</dt><dd className="text-sm">{[kindWord(t.kind), t.provider].filter(Boolean).join(', ')}</dd></div>
            <div><dt className="ui-label">Dates</dt><dd className="text-sm tabular-nums">{t.startDate ? `${day(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` – ${day(t.endDate)}` : ''}` : '—'}</dd></div>
            <div><dt className="ui-label">Hours</dt><dd className="text-sm tabular-nums">{t.hours ?? '—'}</dd></div>
            <div><dt className="ui-label">Certificate good for</dt><dd className="text-sm">{months(t.validMonths)}</dd></div>
          </dl>
          {t.description ? <p className="text-sm whitespace-pre-wrap">{t.description}</p> : null}
          <section aria-label="Attendees" className="space-y-2">
            <h3 className="ui-label flex items-center justify-between">Attendees<span className="tabular-nums">{seats.length}</span></h3>
            {canEdit && live ? (
              <div className="sm:w-80"><PopupSelect showValueSubtext={false} ariaLabel="Add a person" value="" placeholder="Add a person…" alwaysSearch
                onChange={(v) => v && act(() => assignSeats(id, [v]), 'Added. They are told.')} options={staffOptions(staff.filter((p) => !seated.has(p.id)))} /></div>
            ) : null}
            {!seats.length ? <p className="text-sm ui-muted">Nobody yet.</p> : (
              <div className="ui-table-scroll">
                <table className="ui-table w-full">
                  <thead><tr><th scope="col">Person</th><th scope="col">Status</th><th scope="col">Completed</th><th scope="col">Lapses</th><th scope="col">Certificate</th>{canEdit ? <th scope="col"><span className="sr-only">Actions</span></th> : null}</tr></thead>
                  <tbody>
                    {seats.map((s) => (
                      <tr key={s.id}>
                        <td className="font-medium">{s.employee?.name}</td>
                        <td><Pill map={SEAT} value={s.status} /></td>
                        <td className="tabular-nums whitespace-nowrap">{day(s.completedOn) || '—'}</td>
                        <td className="whitespace-nowrap"><Lapse seat={s} /></td>
                        <td>{s.cert ? <button type="button" className="ui-link inline-flex items-center gap-1" onClick={() => certificateFile(s.id).catch((e) => notify.error(e.message))}><Download size={14} aria-hidden="true" />{s.cert.name}</button> : <span className="ui-muted">—</span>}</td>
                        {canEdit ? (
                          <td className="whitespace-nowrap text-right">
                            <span className="inline-flex gap-1">
                              {live ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => setCompleting(s)}>{s.status === 'COMPLETED' ? 'Change' : 'Completed'}</button> : null}
                              {s.status === 'ASSIGNED' && live ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => act(() => markSeat(s.id, { status: 'MISSED' }), 'Marked missed.')}>Missed</button> : null}
                              {s.status === 'MISSED' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => act(() => markSeat(s.id, { status: 'ASSIGNED' }), 'Back to assigned.')}>Undo</button> : null}
                              {s.status !== 'COMPLETED' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => act(() => removeSeat(s.id), 'Removed.')}>Remove</button> : null}
                            </span>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
      {completing ? <CompleteForm seat={completing} validMonths={t?.validMonths} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); reload(); }} /> : null}
    </Drawer>
  );
}

function CompleteForm({ seat, validMonths, onClose, onSaved }) {
  const [completedOn, setDate] = useState(seat.completedOn || todayIst());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const save = async () => {
    if (!completedOn) { setError({ message: 'Choose the day they completed it.' }); return; }
    if (file && file.size > 5 * 1024 * 1024) { setError({ message: 'A certificate is up to 5 MB.' }); return; }
    setBusy(true);
    setError(null);
    try { await markSeat(seat.id, { status: 'COMPLETED', completedOn, ...(file ? await readFile(file) : {}) }); notify.success('Completed.'); onSaved(); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={`${seat.employee?.name}: completed`} dirty={Boolean(file)}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <div><label className="ui-label" htmlFor="seat-done">Completed on *</label><DatePicker id="seat-done" max={todayIst()} value={completedOn} onChange={(d) => setDate(d || '')} /></div>
        <div>
          <span className="ui-label">Certificate</span>
          <input ref={ref} type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-label="Certificate file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" className="ui-btn ui-btn-secondary w-full justify-start truncate" onClick={() => ref.current?.click()}>{file ? file.name : seat.cert ? `Replace ${seat.cert.name}` : 'Choose a PDF or photo'}</button>
        </div>
        {validMonths ? <p className="sm:col-span-2 ui-caption">Good for {months(validMonths)} from this date.</p> : null}
      </form>
    </Drawer>
  );
}

function TrainingForm({ value, rows, onClose, onSaved }) {
  const initial = useMemo(() => ({
    title: value.title || '', provider: value.provider || '', kind: value.kind || 'INTERNAL', startDate: value.startDate || '', endDate: value.endDate || '',
    hours: value.hours === null || value.hours === undefined ? '' : String(value.hours), mandatory: Boolean(value.mandatory), validMonths: value.validMonths ? String(value.validMonths) : '', description: value.description || '',
  }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (inFlight.current) return;
    if (!form.title.trim()) { setError({ message: 'Name the training.' }); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = { ...form, title: form.title.trim(), provider: form.provider.trim() || null, startDate: form.startDate || null, endDate: form.endDate || null, hours: form.hours === '' ? null : Number(form.hours), validMonths: form.validMonths === '' ? null : Number(form.validMonths), description: form.description.trim() || null, ...(value.id ? { status: value.status } : {}) };
    try { const t = await saveTraining(body, value.id); notify.success('Training saved.'); onSaved(t); } catch (e) { setError(e); } finally { inFlight.current = false; setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={value.id ? `Edit ${value.title}` : 'New training'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" disabled={Boolean(value.id) && !dirty} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        <label className="block sm:col-span-2"><span className="ui-label">Training *</span><SuggestInput autoFocus maxLength={200} value={form.title} onChange={(v) => set({ title: v })} suggestions={[...usedValues(rows, (r) => r.title), 'Fire safety', 'First aid', 'POSH awareness', 'Forklift operation']} /></label>
        <div><PopupSelect showValueSubtext={false} label="How" value={form.kind} onChange={(v) => set({ kind: v || 'INTERNAL' })} options={KINDS.map(([v, l]) => ({ value: v, label: l }))} /></div>
        <label className="block"><span className="ui-label">Provider</span><SuggestInput maxLength={200} value={form.provider} onChange={(v) => set({ provider: v })} suggestions={usedValues(rows, (r) => r.provider)} /></label>
        <div><label className="ui-label" htmlFor="training-from">From</label><DatePicker id="training-from" value={form.startDate} onChange={(d) => set({ startDate: d || '' })} /></div>
        <div><label className="ui-label" htmlFor="training-to">To</label><DatePicker id="training-to" min={form.startDate} value={form.endDate} onChange={(d) => set({ endDate: d || '' })} /></div>
        <label className="block"><span className="ui-label">Hours</span><input className="ui-input w-full tabular-nums" inputMode="decimal" value={form.hours} onChange={(e) => set({ hours: e.target.value.replace(/[^\d.]/g, '') })} /></label>
        <label className="block"><span className="ui-label">Certificate good for (months)</span><input className="ui-input w-full tabular-nums" inputMode="numeric" placeholder="Blank if it does not lapse" value={form.validMonths} onChange={(e) => set({ validMonths: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.mandatory} onChange={(e) => set({ mandatory: e.target.checked })} />Everyone named must do it</label>
        <label className="block sm:col-span-2"><span className="ui-label">More about it</span><textarea className="ui-input w-full" rows={4} maxLength={4000} value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}
