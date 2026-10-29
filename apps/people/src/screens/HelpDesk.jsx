import React, { useMemo, useRef, useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listEmployees } from '@ui/personnel/api';
import {
  deskAssign, deskMessage, deskMoveToCase, deskReopen, deskResolve, deskTemplates, getDeskRequest, listDesk, orgUsers, raiseDeskRequest,
} from '../api/desk';

/**
 * Help desk (DESK-01..06): what employees asked, by queue, with reply-by
 * and resolve-by; the thread, where an internal note never reaches the
 * employee; assign, resolve with a reason, reopen within seven days, or
 * move to Private cases. Laid out as every Workforce list: header, status
 * tabs, search and queue filter, the shared table, drawers for the rest.
 */

const TABS = [['OPEN', 'Open'], ['WAITING_EMPLOYEE', 'Waiting on them'], ['RESOLVED', 'Resolved'], ['MOVED', 'Moved'], ['ALL', 'All']];
const STATUS = { OPEN: ['Open', 'ui-pill-info'], REOPENED: ['Reopened', 'ui-pill-warn'], WAITING_EMPLOYEE: ['Waiting on them', 'ui-pill-neutral'], RESOLVED: ['Resolved', 'ui-pill-pos'], MOVED: ['Moved', 'ui-pill-neutral'] };
const URGENCY = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const day = (d) => (d ? formatDate(istDay(d)) : '');
const when = (d) => (d ? `${day(d)}, ${time(d)}` : '');

export default function HelpDesk({ params = {} }) {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const canEdit = allowed('PEOPLE::HR Cases::EDIT');
  const [status, setStatus] = useState('OPEN');
  const [queue, setQueue] = useState('all');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  /* Opened from the Approvals inbox or a notice with the case named: it opens on that case. */
  const [open, setOpen] = useState(params?.id || null);
  const [raising, setRaising] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status);
  const req = useRequest(() => listDesk({ status: status === 'ALL' ? '' : status, queue: queue === 'all' ? '' : queue, mine: mine ? '1' : '', q }), [status, queue, mine, q]);
  const data = req.data;
  const catLabel = (key) => data?.categories?.find((c) => c.key === key)?.label || key;
  const late = (flag) => (flag ? 'ui-text-neg font-medium' : '');

  const columns = [
    { key: 'subject', label: 'Request', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.subject}</span><span className="block truncate ui-caption">{catLabel(r.category)}</span></span> },
    { key: 'from', label: 'From', render: (r) => <span>{r.employeeName}{r.employeeCode ? <span className="ui-caption tabular-nums"> · {r.employeeCode}</span> : null}</span> },
    { key: 'queue', label: 'Queue', render: (r) => r.queue },
    { key: 'urgency', label: 'Urgency', render: (r) => URGENCY[r.urgency] || r.urgency },
    { key: 'reply', label: 'Reply by', render: (r) => (r.firstReplyAt ? <span className="ui-muted">Replied</span> : <span className={`tabular-nums whitespace-nowrap ${late(r.replyOverdue)}`}>{when(r.replyBy)}</span>) },
    { key: 'resolve', label: 'Resolve by', render: (r) => <span className={`tabular-nums whitespace-nowrap ${late(r.resolveOverdue)}`}>{day(r.resolveBy)}{r.resolveOverdue ? ' (late)' : ''}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span> },
  ];
  /* A tab whose rows all share one status already says it; Open keeps the column while a reopened case sits among them. */
  const rowsShown = data?.requests || [];
  const oneStatus = status !== 'ALL' && rowsShown.length > 0 && rowsShown.every((r) => r.status === rowsShown[0].status);

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Help desk' }]} title="Help desk"
        actions={canEdit ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setRaising(true)}><Plus size={16} aria-hidden="true" /> New request</button> : null} />
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          tabs={(
            <div ref={tabsRef} role="tablist" aria-label="Requests" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
              {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={status === k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
              {tabIndicator}
            </div>
          )}
          label="Requests"
          columns={oneStatus ? columns.filter((c) => c.key !== 'status') : columns}
          rows={data?.requests || []}
          loading={req.loading}
          refreshing={req.refreshing}
          total={data?.requests?.length || 0}
          pageSize={Math.max(25, data?.requests?.length || 0)}
          noun="requests"
          onRowClick={(r) => setOpen(r.id)}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.subject}</span><span className={`ui-pill ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span></span>
              <span className="block truncate ui-caption">{[r.employeeName, catLabel(r.category), r.resolveBy ? `resolve by ${day(r.resolveBy)}` : null].filter(Boolean).join(' · ')}</span>
            </span>
          )}
          empty={q || queue !== 'all' || mine
            ? <EmptyState kind="filtered" title="No requests match" description="Nothing here matches the search or filters." />
            : <EmptyState title="Nothing here" description="Requests from the employee app land here the moment they are sent." />}
          toolbar={<>
            <SearchField value={q} onSearch={setQ} placeholder="Search subject or name" label="Search requests" className="w-full sm:w-80" />
            <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Queue" value={queue} onChange={(v) => setQueue(v || 'all')} options={[{ value: 'all', label: 'All queues' }, ...(data?.queues || []).map((x) => ({ value: x, label: x }))]} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Assigned to me</label>
          </>}
        />
      )}
      {raising ? <RaiseForm categories={data?.categories || []} onClose={() => setRaising(false)} onSaved={(r) => { setRaising(false); req.reload(); setOpen(r.id); }} /> : null}
      {open ? <RequestDrawer id={open} canEdit={canEdit} categories={data?.categories || []} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
    </div>
  );
}

function RaiseForm({ categories, onClose, onSaved }) {
  const people = useRequest(() => listEmployees({ limit: 500, status: 'CURRENT' }).then((r) => (r?.employees || r || []).filter((p) => p.status !== 'LEFT')), []);
  const active = categories.filter((c) => c.isActive);
  const initial = useMemo(() => ({ employeeId: '', category: active[0]?.key || 'OTHER', subject: '', description: '', urgency: 'NORMAL', replyChannel: 'APP' }), [active]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = Boolean(form.employeeId || form.subject || form.description);
  /* Enter in a text field submits the form; pressed twice it lands before
     the disabled button re-renders, so a ref (not state) stops the second save. */
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current) return;
    const missing = !form.employeeId ? 'Choose who it is for.' : !form.subject.trim() ? 'Give it a subject.' : form.description.trim().length < 5 ? 'Say what happened.' : null;
    if (missing) { setError({ message: missing }); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const r = await raiseDeskRequest({ ...form, subject: form.subject.trim(), description: form.description.trim() });
      notify.success('Raised; it is in the queue.');
      onSaved(r.request);
    } catch (err) { setError(err); } finally { inFlight.current = false; setSaving(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="New request for someone" dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={saving} onClick={save}>{saving ? 'Raising…' : 'Raise'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Employee *" value={form.employeeId} onChange={(v) => setForm({ ...form, employeeId: v || '' })} placeholder={people.data ? 'Choose…' : 'Loading…'} alwaysSearch options={(people.data || []).map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))} /></div>
        <div><PopupSelect showValueSubtext={false} label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v || form.category })} options={active.map((c) => ({ value: c.key, label: c.label }))} /></div>
        <div><PopupSelect showValueSubtext={false} label="Urgency" value={form.urgency} onChange={(v) => setForm({ ...form, urgency: v || 'NORMAL' })} options={Object.entries(URGENCY).map(([value, label]) => ({ value, label }))} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">Subject *</span><input className="ui-input w-full" maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">What happened *</span><textarea className="ui-input w-full" rows={5} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

function RequestDrawer({ id, canEdit, categories, onClose, onChanged }) {
  const req = useRequest(() => getDeskRequest(id), [id]);
  const extras = useRequest(() => (canEdit ? Promise.all([deskTemplates().catch(() => []), orgUsers()]) : Promise.resolve([[], []])), [canEdit]);
  const [templates, users] = extras.data || [[], []];
  const r = req.data;
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [waitForEmployee, setWaitForEmployee] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const act = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) notify.success(ok);
      req.reload();
      onChanged();
      return true;
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const sendMessage = (e) => {
    e.preventDefault();
    if (!body.trim() && !templateId) return;
    act(async () => {
      await deskMessage(id, { body, internal, templateId: templateId || null, waitForEmployee: !internal && waitForEmployee });
      setBody(''); setTemplateId(''); setWaitForEmployee(false);
    }, internal ? 'Note added. The employee does not see it.' : 'Sent to the employee.');
  };
  const move = async () => {
    if (await confirmDialog({ title: 'Move to Confidential cases?', message: 'The subject, the details and the thread are wiped here; only the date it moved stays. Open Confidential cases to carry the details across first.', confirmLabel: 'Move' })) act(() => deskMoveToCase(id), 'Moved. Only the date stays here.');
  };
  const live = r ? ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'].includes(r.status) : false;
  const catLabel = r ? categories.find((c) => c.key === r.category)?.label || r.category : '';
  return (
    <Drawer open onClose={onClose} title={r?.subject || 'Request'} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet" dirty={Boolean(body.trim())}
      footer={r && canEdit && r.status !== 'MOVED' ? (
        <>
          {live ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" disabled={busy} onClick={move}>Move to Confidential cases</button> : null}
          {r.status === 'RESOLVED' ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => act(() => deskReopen(id), 'Reopened.')}>Reopen</button> : null}
          {live ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => setResolving(true)}>Resolve</button> : null}
        </>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !r ? <SkeletonCard lines={6} /> : (
        <div className="space-y-5">
          <p className="ui-caption">{[`${r.employeeName}${r.employeeCode ? ` (${r.employeeCode})` : ''}`, catLabel, `${r.queue} queue`, URGENCY[r.urgency] || r.urgency].join(' · ')}</p>
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Status</dt><dd><span className={`ui-pill ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span></dd></div>
            <div><dt className="ui-label">Reply by</dt><dd className={`text-sm tabular-nums ${r.replyOverdue ? 'ui-text-neg' : ''}`}>{r.firstReplyAt ? `Replied ${when(r.firstReplyAt)}` : when(r.replyBy)}</dd></div>
            <div><dt className="ui-label">Resolve by</dt><dd className={`text-sm tabular-nums ${r.resolveOverdue ? 'ui-text-neg' : ''}`}>{day(r.resolveBy)}{r.resolveOverdue ? ' (late)' : ''}</dd></div>
          </dl>
          {canEdit && r.status !== 'MOVED' ? (
            <div className="ui-form-grid">
              <div><PopupSelect showValueSubtext={false} label="Assigned to" value={r.assigneeUserId || ''} placeholder="Nobody yet" alwaysSearch={users.length > 8}
                onChange={(v) => act(() => deskAssign(id, { assigneeUserId: v || null }), 'Assigned.')}
                options={[{ value: '', label: 'Nobody yet' }, ...users.map((u) => ({ value: u.id, label: u.fullName || u.name || u.email }))]} /></div>
              <div><PopupSelect showValueSubtext={false} label="Queue" value={r.queue} onChange={(v) => { if (v && v !== r.queue) act(() => deskAssign(id, { queue: v }), 'Moved to the queue.'); }}
                options={[...new Set([...categories.map((c) => c.queue), r.queue])].map((x) => ({ value: x, label: x }))} /></div>
            </div>
          ) : null}
          {r.status === 'MOVED' ? <p className="ui-muted text-sm">Moved to Confidential cases on {day(r.movedToCaseAt)}. Nothing else is kept here.</p> : (
            <>
              <section aria-label="What they said" className="text-sm space-y-1">
                <p className="whitespace-pre-wrap">{r.description}</p>
                <p className="ui-caption tabular-nums">{when(r.createdAt)}{r.replyChannel ? ` · prefers a reply by ${r.replyChannel.toLowerCase()}` : ''}</p>
              </section>
              {r.resolution ? <section className="text-sm border-t pt-3 space-y-1"><p className="ui-label">Resolved {when(r.resolvedAt)}</p><p className="whitespace-pre-wrap">{r.resolution}</p></section> : null}
              {r.messages.length ? (
                <ol className="ui-history-list" aria-label="Thread">
                  {r.messages.map((m) => (
                    <li key={m.id} className="ui-history-row space-y-1">
                      <p className="ui-caption flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">{m.authorName}</span>
                        {m.internal ? <span className="ui-pill ui-pill-neutral">Internal note</span> : null}
                        {m.policyVersionId ? <span>cites a policy</span> : null}
                        <span className="tabular-nums ms-auto">{when(m.createdAt)}</span>
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              {canEdit && live ? (
                <form onSubmit={sendMessage} className="space-y-3 border-t pt-3">
                  {templates.length ? <PopupSelect showValueSubtext={false} ariaLabel="Template" value={templateId} placeholder="Insert a template…" onChange={(v) => setTemplateId(v || '')} options={[{ value: '', label: 'No template' }, ...templates.map((t) => ({ value: t.id, label: t.policyTitle ? `${t.title} (cites ${t.policyTitle})` : t.title }))]} /> : null}
                  <textarea className="ui-input w-full" rows={3} placeholder={internal ? 'A note for HR only' : 'Reply to the employee'} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note</label>
                    {!internal ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={waitForEmployee} onChange={(e) => setWaitForEmployee(e.target.checked)} />Waiting on them</label> : null}
                    <button type="submit" className="ui-btn ui-btn-secondary ms-auto" disabled={busy || (!body.trim() && !templateId)}>{internal ? 'Add note' : 'Send'}</button>
                  </div>
                </form>
              ) : null}
            </>
          )}
        </div>
      )}
      {resolving ? <ResolveDrawer onClose={() => setResolving(false)} onResolve={async (text) => { if (await act(() => deskResolve(id, text), 'Resolved.')) setResolving(false); }} busy={busy} /> : null}
    </Drawer>
  );
}

/* Resolving: the person reads what is written here, so it is asked for, not guessed. */
function ResolveDrawer({ onClose, onResolve, busy }) {
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="Resolve" dirty={Boolean(text.trim())}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => (text.trim() ? onResolve(text.trim()) : setMissing(true))}>{busy ? 'Resolving…' : 'Resolve'}</button></>}>
      <label className="block"><span className="ui-label">How it was resolved *</span>
        <textarea className="ui-input w-full" rows={4} maxLength={2000} value={text} autoFocus aria-invalid={missing || undefined} aria-describedby="resolve-help" onChange={(e) => { setText(e.target.value); setMissing(false); }} />
        <span id="resolve-help" className={missing ? 'ui-field-error' : 'ui-caption'}>{missing ? 'Say how it was resolved.' : 'The employee reads this.'}</span>
      </label>
    </Drawer>
  );
}
