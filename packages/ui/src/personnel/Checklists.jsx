import React, { useMemo, useRef, useState } from 'react';
import { CheckCheck, Plus, Trash2 } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { CHECKLIST_OWNER, getChecklistTemplates, listOpenChecklistTasks, resetChecklistTemplate, saveChecklistTemplate, updateChecklistTask } from './api';

/**
 * Onboarding & Exit (HR research, People first release): the joining and
 * leaving checklists. Open items across the company first — overdue at the
 * top, ticked here — then the two checklists themselves, which a company can
 * change (or put back to CLOR's defaults). A change applies to people who
 * join or leave from now on. Three tabs: open items, joining, leaving.
 */
const KIND_COPY = {
  JOINING: { title: 'Joining checklist', due: 'Days after joining' },
  LEAVING: { title: 'Leaving checklist', due: 'Days from last day' },
};
/* Every kind of plan task by name: a change, a renewal or a letter is not a leaving task. */
const TASK_KIND = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter' };
const OWNERS = Object.entries(CHECKLIST_OWNER).map(([value, label]) => ({ value, label }));

function TemplateEditor({ kind, template, onSaved }) {
  const initial = useMemo(() => JSON.stringify(template.items), [template]);
  const [items, setItems] = useState(template.items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(items) !== initial;
  useUnsavedChanges(dirty);
  const set = (i, patch) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const save = async () => {
    const blank = items.findIndex((it) => !String(it.title || '').trim());
    if (blank >= 0) { setError({ message: `Item ${blank + 1} has no words.` }); return; }
    setSaving(true);
    setError(null);
    try {
      onSaved(kind, await saveChecklistTemplate(kind, items.map((it) => ({ ...it, title: it.title.trim(), dueDays: Number(it.dueDays) || 0 }))));
      notify.success(`${KIND_COPY[kind].title} saved.`);
    } catch (e) { setError(e); } finally { setSaving(false); }
  };
  const reset = async () => {
    const ok = await confirmDialog({ title: 'Back to CLOR’s checklist?', message: 'Your own items are replaced by CLOR’s defaults for people who join or leave from now on.', confirmLabel: 'Use defaults' });
    if (!ok) return;
    try { onSaved(kind, await resetChecklistTemplate(kind)); } catch (e) { setError(e); }
  };
  return (
    <section className="space-y-4" aria-label={KIND_COPY[kind].title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{template.custom ? 'Your company’s own.' : 'CLOR’s defaults.'} A change applies to people who {kind === 'JOINING' ? 'join' : 'leave'} from now on.</p>
        <span className="flex gap-2">
          {template.custom ? <button type="button" className="ui-btn ui-btn-ghost" onClick={reset}>Use defaults</button> : null}
          <button type="button" className="ui-btn ui-btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
      {/* One header row on wide screens; on a phone each field keeps its own label. */}
      <div className="hidden sm:grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_2rem] ui-label border-b pb-2" aria-hidden="true"><span>Item</span><span>Owner</span><span>{KIND_COPY[kind].due}</span><span /></div>
      <ol className="divide-y sm:-mt-4" aria-label="Items">
        {items.map((it, i) => (
          <li key={i} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_2rem] sm:items-center ui-checklist-row">
            <label className="block"><span className="ui-label sm:sr-only">Item {i + 1}</span><input className="ui-input w-full" value={it.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={200} /></label>
            <div><span className="ui-label sm:hidden" aria-hidden="true">Owner</span><PopupSelect showValueSubtext={false} ariaLabel={`Item ${i + 1} owner`} icon={null} value={it.owner} onChange={(v) => set(i, { owner: v || 'HR' })} options={OWNERS} /></div>
            <label className="block"><span className="ui-label sm:sr-only">{KIND_COPY[kind].due}</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={it.dueDays} onChange={(e) => set(i, { dueDays: e.target.value.replace(/[^\d-]/g, '').slice(0, 4) })} /></label>
            <button type="button" className="ui-icon-btn" onClick={() => setItems((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${it.title || `item ${i + 1}`}`}><Trash2 size={16} aria-hidden="true" /></button>
          </li>
        ))}
      </ol>
      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setItems((list) => [...list, { title: '', owner: 'HR', dueDays: 0 }])}><Plus size={16} aria-hidden="true" /> Add item</button>
    </section>
  );
}

export default function Checklists({ openScreen }) {
  const [tab, setTab] = useState('open');
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const req = useRequest(() => Promise.all([listOpenChecklistTasks(), getChecklistTemplates()]), []);
  const [doneIds, setDoneIds] = useState(() => new Set());
  const [saved, setSaved] = useState({});
  const [tasks, fetched] = req.data || [[], null];
  const open = tasks.filter((t) => !doneIds.has(t.id));
  const templates = fetched ? { ...fetched, ...saved } : null;
  const tick = async (t) => {
    try {
      await updateChecklistTask(t.id, { done: true });
      setDoneIds((s) => new Set(s).add(t.id));
      notify.success('Done.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const columns = [
    { key: 'employee', label: 'Employee', always: true, render: (t) => <span className="min-w-0"><span className="block truncate font-medium">{t.employee.name}{t.employee.code ? <span className="ui-caption tabular-nums font-normal"> · {t.employee.code}</span> : null}</span><span className="block ui-caption">{TASK_KIND[t.kind] || t.kind}</span></span> },
    { key: 'item', label: 'Item', render: (t) => <span className="whitespace-normal">{t.title}</span> },
    { key: 'owner', label: 'Owner', render: (t) => CHECKLIST_OWNER[t.owner] || t.owner },
    { key: 'due', label: 'Due', render: (t) => <span className={`whitespace-nowrap tabular-nums ${t.overdue ? 'ui-text-neg font-medium' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : '—'}{t.overdue ? ' (late)' : ''}</span> },
    { key: 'done', label: '', render: (t) => <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={(e) => { e.stopPropagation(); tick(t); }}><CheckCheck size={14} aria-hidden="true" /> Done</button> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader entity="employee" breadcrumb={[{ label: 'People' }, { label: 'Onboarding & Exit' }]} title="Onboarding & Exit" />
      <div ref={tabsRef} role="tablist" aria-label="Onboarding and exit" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['open', 'Open items', open.length], ['JOINING', 'Joining checklist'], ['LEAVING', 'Leaving checklist']].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : tab === 'open' ? (
        <DataTable label="Open items" columns={columns} rows={open} loading={req.loading} refreshing={req.refreshing}
          total={open.length} pageSize={Math.max(25, open.length)} noun="items"
          onRowClick={(t) => openScreen?.('employee', { id: t.employee.id })}
          card={(t) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{t.title}</span><span className={`ui-caption tabular-nums ${t.overdue ? 'ui-text-neg' : ''}`}>{t.dueDate ? formatDate(t.dueDate) : ''}</span></span><span className="block truncate ui-caption">{[t.employee.name, CHECKLIST_OWNER[t.owner] || t.owner].join(' · ')}</span></span>}
          rowActions={(t) => [{ key: 'done', label: 'Mark done', onSelect: () => tick(t) }, { key: 'open', label: 'Open their record', onSelect: () => openScreen?.('employee', { id: t.employee.id }) }]}
          empty={<EmptyState icon={CheckCheck} title="Nothing open" description="When someone joins or leaves, their checklist items appear here until they are done." />} />
      ) : templates ? (
        <TemplateEditor key={`${tab}-${templates[tab.toLowerCase()].custom}-${JSON.stringify(templates[tab.toLowerCase()].items).length}`} kind={tab} template={templates[tab.toLowerCase()]} onSaved={(k, t) => setSaved((all) => ({ ...all, [k.toLowerCase()]: t }))} />
      ) : null}
    </div>
  );
}
