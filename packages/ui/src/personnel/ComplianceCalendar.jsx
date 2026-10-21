import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Plus } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { addComplianceTask, getComplianceCalendar, getComplianceEvidence, updateComplianceTask } from './api';

/**
 * Compliance calendar (HR research, Phase 2). The statutory deadlines that
 * apply to this company — PF, ESIC, TDS and 24Q, Form 16, Professional Tax
 * by state, bonus, the POSH annual report — worked out from its own payroll
 * and headcount, beside its own deadlines. Each has an owner; done means a
 * challan or acknowledgement number, and the evidence is kept here.
 */
const STATUS = {
  late: { label: 'Late', tone: 'neg' },
  soon: { label: 'Due this week', tone: 'warn' },
  OPEN: { label: 'Open', tone: 'neutral' },
  DONE: { label: 'Done', tone: 'pos' },
  NOT_APPLICABLE: { label: 'Not needed', tone: 'neutral' },
};
const stateOf = (t) => (t.overdue ? 'late' : t.dueSoon ? 'soon' : t.status);
const monthOf = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });

function EditTask({ task, onClose, onSaved }) {
  const [form, setForm] = useState({ owner: task.owner || '', reference: task.reference || '', note: task.note || '', dueDate: task.dueDate });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (status) => {
    setSaving(true);
    try {
      const body = { owner: form.owner, reference: form.reference, note: form.note, ...(task.code === 'CUSTOM' || task.code.startsWith('PT_') ? { dueDate: form.dueDate } : {}), ...(status ? { status } : {}) };
      if (file) body.evidence = { name: file.name, mime: file.type, dataUrl: await readFile(file) };
      onSaved(await updateComplianceTask(task.id, body));
      notify.success(status === 'DONE' ? 'Marked done.' : 'Saved.');
      onClose();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={task.title}
      description={`Due ${task.dueDate}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => save(task.status === 'NOT_APPLICABLE' ? 'OPEN' : 'NOT_APPLICABLE')} disabled={saving}>{task.status === 'NOT_APPLICABLE' ? 'Needed after all' : 'Not needed'}</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => save()} disabled={saving}>Save</button>
          {task.status !== 'DONE' ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => save('DONE')} disabled={saving}>Mark done</button> : null}
        </>
      }
    >
      <div className="space-y-4">
        {task.note ? <p className="ui-caption">{task.note}</p> : null}
        <label className="block"><span className="ui-label">Owner</span><input className="ui-input w-full" value={form.owner} onChange={set('owner')} placeholder="Who files it" maxLength={200} /></label>
        {task.code === 'CUSTOM' || task.code.startsWith('PT_') ? (
          <label className="block"><span className="ui-label">Due date</span><input type="date" className="ui-input w-full" value={form.dueDate} onChange={set('dueDate')} /></label>
        ) : null}
        <label className="block"><span className="ui-label">Challan or acknowledgement number</span><input className="ui-input w-full" value={form.reference} onChange={set('reference')} maxLength={200} /></label>
        <label className="block"><span className="ui-label">Note</span><textarea className="ui-input w-full" rows={3} value={form.note} onChange={set('note')} maxLength={1000} /></label>
        <label className="block">
          <span className="ui-label">Evidence (PDF, PNG or JPEG, up to 5 MB)</span>
          <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {task.evidenceName && !file ? <span className="ui-caption block">Kept: {task.evidenceName}</span> : null}
        </label>
      </div>
    </Drawer>
  );
}

function AddDeadline({ onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', dueDate: '', owner: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      await addComplianceTask(form);
      onSaved();
      onClose();
    } catch (e) {
      notify.error(String(e?.message || 'Not added.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title="Add a deadline" description="Your own: a licence renewal, an inspection, a return CLOR does not track." actions={<button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={saving || !form.title || !form.dueDate}>Add</button>}>
      <div className="space-y-4">
        <label className="block"><span className="ui-label">What</span><input className="ui-input w-full" value={form.title} onChange={set('title')} maxLength={200} placeholder="Shops & Establishments licence renewal" /></label>
        <label className="block"><span className="ui-label">Due date</span><input type="date" className="ui-input w-full" value={form.dueDate} onChange={set('dueDate')} /></label>
        <label className="block"><span className="ui-label">Owner</span><input className="ui-input w-full" value={form.owner} onChange={set('owner')} maxLength={200} /></label>
      </div>
    </Drawer>
  );
}

export default function ComplianceCalendar() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    getComplianceCalendar().then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load the calendar.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const open = async (t) => {
    const ev = await getComplianceEvidence(t.id).catch(() => null);
    if (!ev) return notify.error('No evidence kept.');
    const w = window.open();
    if (w) w.document.write(`<iframe src="${ev.dataUrl}" style="border:0;width:100%;height:100%"></iframe>`);
  };
  const months = data ? [...new Set(data.tasks.map((t) => t.dueDate.slice(0, 7)))] : [];
  const applies = data?.applies;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="privacy"
        title="Compliance Calendar"
        description="Statutory deadlines that apply to this company, and your own, with who owns each and the proof it was done."
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add a deadline</button>}
      />
      <div className="pb-8 space-y-4">
        {error ? <p className="ui-card p-4 text-sm" role="alert">{error}</p> : null}
        {!data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
              <StatTile label="Late" value={data.summary.overdue} hint="past the due date" tone={data.summary.overdue ? 'neg' : 'pos'} />
              <StatTile label="Due this week" value={data.summary.dueSoon} hint="next seven days" tone={data.summary.dueSoon ? 'warn' : 'neutral'} />
              <StatTile label="Open" value={data.summary.open} hint="not done yet" />
              <StatTile label="Done" value={data.summary.done} hint="with reference kept" tone="pos" />
            </section>
            <p className="ui-caption">
              Applies here: {[applies.pf && 'PF', applies.esi && 'ESIC', applies.payroll && 'TDS, 24Q, Form 16, bonus', applies.ptStates.length && `Professional Tax (${applies.ptStates.join(', ')})`, applies.posh && 'POSH annual report'].filter(Boolean).join(' · ') || 'nothing yet — statutory deadlines appear once people are in payroll'}.
            </p>
            {!data.tasks.length ? (
              <EmptyState icon={CalendarCheck} title="No deadlines in these months" description="Add your own, or put people in payroll with PF, ESI or PT switched on." />
            ) : (
              months.map((m) => (
                <section key={m} className="ui-card overflow-hidden" aria-label={monthOf(`${m}-01`)}>
                  <h2 className="ui-t-sec px-4 pt-4 pb-2">{monthOf(`${m}-01`)}</h2>
                  <ul className="divide-y">
                    {data.tasks.filter((t) => t.dueDate.slice(0, 7) === m).map((t) => {
                      const s = STATUS[stateOf(t)] || STATUS.OPEN;
                      return (
                        <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <span className="tabular-nums text-sm w-24 shrink-0">{t.dueDate}</span>
                          <span className={`ui-pill ui-pill-${s.tone}`}>{s.label}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{t.title}</p>
                            <p className="ui-caption">
                              {[t.owner && `Owner: ${t.owner}`, t.reference && `Ref: ${t.reference}`, t.status === 'DONE' && t.doneBy && `done by ${t.doneBy}`].filter(Boolean).join(' · ') || 'No owner yet'}
                            </p>
                          </div>
                          <span className="flex flex-wrap gap-2">
                            {t.evidenceName ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => open(t)}>Evidence</button> : null}
                            {t.link ? <a className="ui-btn ui-btn-ghost ui-btn-sm" href={`?app=${t.link.app}&open=${t.link.screen}`}>Open {t.link.app === 'payroll' ? 'Payroll' : 'Attendance'}</a> : null}
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(t)}>{t.status === 'DONE' ? 'Details' : 'Update'}</button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
      {editing ? <EditTask task={editing} onClose={() => setEditing(null)} onSaved={setData} /> : null}
      {adding ? <AddDeadline onClose={() => setAdding(false)} onSaved={load} /> : null}
    </div>
  );
}
