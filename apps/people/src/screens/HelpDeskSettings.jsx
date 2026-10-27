import React, { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { notify } from '@ui/components/ui/notify';
import { deskCategories, deskTemplates, orgUsers, saveDeskCategory, saveDeskTemplate } from '../api/desk';
import { listPolicies } from '../api/policies';

/**
 * Help desk settings (DESK-03, DESK-06): each category's queue, lead,
 * reply-by hours and resolve-by working days; and the answer templates,
 * each of which may cite a policy — the version in force is named when
 * the answer is sent. Two lists, each edited in a drawer.
 */
export default function HelpDeskSettings() {
  const [tab, setTab] = useState('categories');
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const req = useRequest(() => Promise.all([deskCategories(), deskTemplates().catch(() => []), orgUsers(), listPolicies('', '').then((r) => r?.policies || []).catch(() => [])]), []);
  const [cats, templates, users, policies] = req.data || [[], [], [], []];
  const [editingCat, setEditingCat] = useState(null);
  const [draft, setDraft] = useState(null);
  const userName = (id) => { const u = users.find((x) => x.id === id); return u ? u.fullName || u.name || u.email : null; };
  const catLabel = (key) => cats.find((c) => c.key === key)?.label || key;

  const catColumns = [
    { key: 'label', label: 'Category', always: true, render: (c) => <span className="font-medium">{c.label}</span> },
    { key: 'queue', label: 'Queue', render: (c) => c.queue },
    { key: 'lead', label: 'Queue lead', render: (c) => userName(c.leadUserId) || <span className="ui-muted">Nobody</span> },
    { key: 'reply', label: 'Reply within', align: 'right', render: (c) => <span className="tabular-nums">{c.replyHours} h</span> },
    { key: 'resolve', label: 'Resolve within', align: 'right', render: (c) => <span className="tabular-nums whitespace-nowrap">{c.resolveDays} {c.resolveDays === 1 ? 'working day' : 'working days'}</span> },
    { key: 'on', label: 'In use', render: (c) => (c.isActive ? 'Yes' : <span className="ui-muted">No</span>) },
  ];
  const tplColumns = [
    { key: 'title', label: 'Template', always: true, render: (t) => <span className="font-medium">{t.title}</span> },
    { key: 'category', label: 'For', render: (t) => (t.category ? catLabel(t.category) : <span className="ui-muted">Any category</span>) },
    { key: 'policy', label: 'Cites', render: (t) => t.policyTitle || <span className="ui-muted">No policy</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Help Desk"
        actions={tab === 'templates' ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setDraft({ title: '', body: '', category: '', policyId: '' })}><Plus size={16} aria-hidden="true" /> New template</button> : null} />
      <div ref={tabsRef} role="tablist" aria-label="Help desk settings" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['categories', 'Categories', cats.length], ['templates', 'Answer templates', templates.length]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : tab === 'categories' ? (
        <DataTable label="Categories" columns={catColumns} rows={cats} rowKey={(c) => c.key} loading={req.loading} refreshing={req.refreshing}
          total={cats.length} pageSize={Math.max(25, cats.length)} noun="categories" onRowClick={(c) => setEditingCat(c)}
          card={(c) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.label}</span>{c.isActive ? null : <span className="ui-pill ui-pill-neutral">Off</span>}</span><span className="block truncate ui-caption">{[c.queue, `reply in ${c.replyHours} h`, `resolve in ${c.resolveDays} days`].join(' · ')}</span></span>}
          empty={<EmptyState title="No categories" description="Categories come with the help desk; reload if this stays empty." />} />
      ) : (
        <DataTable label="Answer templates" columns={tplColumns} rows={templates} loading={req.loading} refreshing={req.refreshing}
          total={templates.length} pageSize={Math.max(25, templates.length)} noun="templates"
          onRowClick={(t) => setDraft({ id: t.id, title: t.title, body: t.body, category: t.category || '', policyId: t.policyId || '' })}
          card={(t) => <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="block truncate ui-caption">{[t.category ? catLabel(t.category) : 'Any category', t.policyTitle ? `cites ${t.policyTitle}` : null].filter(Boolean).join(' · ')}</span></span>}
          empty={<EmptyState title="No templates yet" description="A template goes into a reply with one click; one that cites a policy names the version in force that day." />} />
      )}
      {editingCat ? <CategoryDrawer value={editingCat} users={users} queues={[...new Set(cats.map((c) => c.queue).filter(Boolean))]} onClose={() => setEditingCat(null)} onDone={() => { setEditingCat(null); req.reload(); }} /> : null}
      {draft ? <TemplateDrawer value={draft} cats={cats} policies={policies} onClose={() => setDraft(null)} onDone={() => { setDraft(null); req.reload(); }} /> : null}
    </div>
  );
}

function CategoryDrawer({ value, users, queues, onClose, onDone }) {
  const initial = useMemo(() => ({ label: value.label || '', queue: value.queue || '', leadUserId: value.leadUserId || '', replyHours: String(value.replyHours ?? ''), resolveDays: String(value.resolveDays ?? ''), isActive: value.isActive !== false }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    const hours = Number(form.replyHours);
    const days = Number(form.resolveDays);
    const problem = !form.label.trim() ? 'Give it a name.' : !form.queue.trim() ? 'Name the queue.' : !(hours >= 1 && hours <= 720) ? 'Reply within 1 to 720 hours.' : !(days >= 1 && days <= 90) ? 'Resolve within 1 to 90 working days.' : null;
    if (problem) { setError({ message: problem }); return; }
    setBusy(true);
    setError(null);
    try {
      await saveDeskCategory(value.key, { label: form.label.trim(), queue: form.queue.trim(), leadUserId: form.leadUserId || null, replyHours: hours, resolveDays: days, isActive: form.isActive });
      notify.success(`${form.label.trim()} saved.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={`Edit ${value.label}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={80} value={form.label} onChange={(e) => set('label', e.target.value)} autoFocus /></label>
        <label className="block"><span className="ui-label">Queue *</span><SuggestInput maxLength={60} value={form.queue} onChange={(v) => set('queue', v)} suggestions={queues} /></label>
        <div className="sm:col-span-2">
          {users.length
            ? <PopupSelect showValueSubtext={false} label="Queue lead" value={form.leadUserId} placeholder="Nobody" alwaysSearch={users.length > 8} onChange={(v) => set('leadUserId', v || '')} options={[{ value: '', label: 'Nobody' }, ...users.map((u) => ({ value: u.id, label: u.fullName || u.name || u.email }))]} />
            : <p className="text-sm ui-muted">Choosing a lead needs the Users grant.</p>}
        </div>
        <label className="block"><span className="ui-label">Reply within (hours) *</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={form.replyHours} onChange={(e) => set('replyHours', e.target.value.replace(/\D/g, ''))} /></label>
        <label className="block"><span className="ui-label">Resolve within (working days) *</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={form.resolveDays} onChange={(e) => set('resolveDays', e.target.value.replace(/\D/g, ''))} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />In use</label>
      </form>
    </Drawer>
  );
}

function TemplateDrawer({ value, cats, policies, onClose, onDone }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) { setError({ message: !form.title.trim() ? 'Give it a title.' : 'Write the answer.' }); return; }
    setBusy(true);
    setError(null);
    try {
      await saveDeskTemplate({ ...form, title: form.title.trim() });
      notify.success('Template saved.');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={value.id ? `Edit ${value.title}` : 'New template'} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Title *</span><input className="ui-input w-full" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Answer *</span><textarea className="ui-input w-full" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="For category" value={form.category} placeholder="Any category" onChange={(v) => setForm({ ...form, category: v || '' })} options={[{ value: '', label: 'Any category' }, ...cats.map((c) => ({ value: c.key, label: c.label }))]} /></div>
        <div><PopupSelect showValueSubtext={false} label="Cites policy" value={form.policyId} placeholder="No policy" onChange={(v) => setForm({ ...form, policyId: v || '' })} alwaysSearch={policies.length > 8} options={[{ value: '', label: 'No policy' }, ...policies.map((p) => ({ value: p.id, label: p.title }))]} /></div>
      </form>
    </Drawer>
  );
}
