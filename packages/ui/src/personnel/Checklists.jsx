import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Plus, Trash2 } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { CHECKLIST_OWNER, getChecklistTemplates, listOpenChecklistTasks, resetChecklistTemplate, saveChecklistTemplate, updateChecklistTask } from './api';

/**
 * Onboarding & Exit (HR research, People first release): the joining and
 * leaving checklists. Open items across the company first — overdue at the
 * top, ticked here — then the two checklists themselves, which a company can
 * change (or put back to CLOR's defaults). A change applies to people who
 * join or leave from now on.
 */
const KIND_COPY = {
  JOINING: { title: 'Joining checklist', days: 'days after joining' },
  LEAVING: { title: 'Leaving checklist', days: 'days from the last working day (minus = before)' },
};

function TemplateEditor({ kind, template, onSaved }) {
  const [items, setItems] = useState(template.items);
  const [saving, setSaving] = useState(false);
  const set = (i, k) => (e) => setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: k === 'dueDays' ? Number(e.target.value) : e.target.value } : it)));
  const save = async () => {
    setSaving(true);
    try {
      onSaved(kind, await saveChecklistTemplate(kind, items));
      notify.success(`${KIND_COPY[kind].title} saved.`);
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    const ok = await confirmDialog({ title: 'Back to CLOR’s checklist?', message: 'Your own items are replaced by CLOR’s defaults for people who join or leave from now on.', confirmLabel: 'Use defaults' });
    if (!ok) return;
    const t = await resetChecklistTemplate(kind);
    setItems(t.items);
    onSaved(kind, t);
  };
  return (
    <section className="space-y-3 border-t pt-6" aria-label={KIND_COPY[kind].title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="ui-t-sec">{KIND_COPY[kind].title}</h2>
          <p className="ui-caption">{template.custom ? 'Your company’s own.' : 'CLOR’s defaults. Change them to make it yours.'} Due dates are {KIND_COPY[kind].days}.</p>
        </div>
        <span className="flex gap-2">
          {template.custom ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={reset}>Use defaults</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_7rem_auto] items-center">
            <input className="ui-input w-full" value={it.title} onChange={set(i, 'title')} aria-label="Item" maxLength={200} />
            <select className="ui-select" value={it.owner} onChange={set(i, 'owner')} aria-label="Owner">
              {Object.entries(CHECKLIST_OWNER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="number" className="ui-input" value={it.dueDays} onChange={set(i, 'dueDays')} min={-365} max={365} aria-label="Due, in days" />
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setItems((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${it.title}`}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setItems((list) => [...list, { title: '', owner: 'HR', dueDays: 0 }])}>
        <Plus size={14} aria-hidden="true" /> Add item
      </button>
    </section>
  );
}

/* Every kind of plan task by name: a change, a renewal or a letter is not a leaving task. */
const TASK_KIND = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter' };

export default function Checklists({ openScreen }) {
  const [open, setOpen] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all([listOpenChecklistTasks(), getChecklistTemplates()])
      .then(([tasks, t]) => {
        setOpen(tasks);
        setTemplates(t);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load the checklists.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const tick = async (t) => {
    try {
      await updateChecklistTask(t.id, { done: true });
      setOpen((list) => list.filter((x) => x.id !== t.id));
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader entity="employee" title="Onboarding & Exit" />
      <div className="pb-8 space-y-6">
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        {!open || !templates ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            {/* A list on the page ground under one rule, late first; each person's full plan is on their record. */}
            <section className="space-y-2" aria-labelledby="open-h">
              <h2 id="open-h" className="ui-t-sec">Open items <span className="ui-caption tabular-nums">{open.length}</span></h2>
              {open.length ? (
                <div className="ui-table-scroll">
                  <table className="ui-table w-full">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Item</th>
                        <th>Owner</th>
                        <th>Due</th>
                        <th aria-label="Done" />
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((t) => (
                        <tr key={t.id}>
                          <td><button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: t.employee.id })}>{t.employee.name}</button>{t.employee.code ? <span className="ui-caption tabular-nums"> · {t.employee.code}</span> : null}<div className="ui-caption">{TASK_KIND[t.kind] || t.kind}</div></td>
                          <td className="whitespace-normal">{t.title}</td>
                          <td>{CHECKLIST_OWNER[t.owner] || t.owner}</td>
                          <td className={`whitespace-nowrap tabular-nums ${t.overdue ? 'text-[rgb(var(--neg))] font-medium' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : '—'}{t.overdue ? ' (late)' : ''}</td>
                          <td className="text-right">
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => tick(t)}>
                              <CheckCheck size={14} aria-hidden="true" /> Done
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={CheckCheck} title="Nothing open" description="When someone joins or leaves, their checklist items appear here until they are done." />
              )}
            </section>
            {['JOINING', 'LEAVING'].map((kind) => (
              <TemplateEditor key={`${kind}-${templates[kind.toLowerCase()].custom}`} kind={kind} template={templates[kind.toLowerCase()]} onSaved={(k, t) => setTemplates((all) => ({ ...all, [k.toLowerCase()]: t }))} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
