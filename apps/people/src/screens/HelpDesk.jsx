import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
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
 * move to Private cases.
 */

const TABS = [['OPEN', 'Open'], ['WAITING_EMPLOYEE', 'Waiting on them'], ['RESOLVED', 'Resolved'], ['MOVED', 'Moved'], ['', 'All']];
const STATUS = { OPEN: ['Open', 'ui-pill-info'], REOPENED: ['Reopened', 'ui-pill-warn'], WAITING_EMPLOYEE: ['Waiting on them', 'ui-pill-neutral'], RESOLVED: ['Resolved', 'ui-pill-pos'], MOVED: ['Moved', 'ui-pill-neutral'] };
const URGENCY = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '');

export default function HelpDesk() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const canEdit = allowed('PEOPLE::HR Cases::EDIT');
  const [status, setStatus] = useState('OPEN');
  const [queue, setQueue] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [raising, setRaising] = useState(false);
  const load = useCallback(() => listDesk({ status, queue, mine: mine ? '1' : '', q }).then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.'))), [status, queue, mine, q]);
  useEffect(() => { load(); }, [load]);
  const catLabel = (key) => data?.categories?.find((c) => c.key === key)?.label || key;

  return (
    <div className="space-y-4">
      <PageHeader title="Help desk" description="What people asked, by queue. Reply by and resolve by come from the category; overdue goes to the queue lead."
        actions={canEdit ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setRaising(true)}><Plus size={16} aria-hidden="true" /> New request</button> : null} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Status" className="flex gap-1">
          {TABS.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={status === v} className={`ui-pill ${status === v ? 'ui-pill-info' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <select className="ui-select" value={queue} onChange={(e) => setQueue(e.target.value)} aria-label="Queue">
          <option value="">All queues</option>
          {(data?.queues || []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="ui-checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Assigned to me</label>
        <input className="ui-input" placeholder="Search subject or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      {!data ? <SkeletonCard lines={5} /> : !data.requests.length ? <EmptyState title="Nothing here" description="Requests from the employee app land here the moment they are sent." /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Request</th><th className="py-1.5 font-medium">From</th><th className="py-1.5 font-medium">Queue</th><th className="py-1.5 font-medium">Urgency</th><th className="py-1.5 font-medium">Reply by</th><th className="py-1.5 font-medium">Resolve by</th><th className="py-1.5 font-medium">Status</th></tr></thead>
          <tbody className="divide-y">
            {data.requests.map((r) => (
              <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                <td className="py-2 pr-2"><span className="font-medium">{r.subject}</span><span className="ui-caption block">{catLabel(r.category)}</span></td>
                <td className="py-2 pr-2">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                <td className="py-2 pr-2">{r.queue}</td>
                <td className="py-2 pr-2">{URGENCY[r.urgency] || r.urgency}</td>
                <td className={`py-2 pr-2 tabular-nums ${r.replyOverdue ? 'text-[rgb(var(--neg))] font-medium' : ''}`}>{r.firstReplyAt ? <span className="ui-muted">replied</span> : when(r.replyBy)}</td>
                <td className={`py-2 pr-2 tabular-nums ${r.resolveOverdue ? 'text-[rgb(var(--neg))] font-medium' : ''}`}>{day(r.resolveBy)}{r.resolveOverdue ? ' (late)' : ''}</td>
                <td className="py-2"><span className={`ui-pill ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {raising ? <RaiseForm categories={data?.categories || []} onClose={() => setRaising(false)} onSaved={(r) => { setRaising(false); load(); setOpen(r.id); }} /> : null}
      {open ? <RequestDrawer id={open} canEdit={canEdit} categories={data?.categories || []} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </div>
  );
}

function RaiseForm({ categories, onClose, onSaved }) {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ employeeId: '', category: categories[0]?.key || 'OTHER', subject: '', description: '', urgency: 'NORMAL', replyChannel: 'APP' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { listEmployees({ limit: 500 }).then((r) => setPeople((r?.employees || r || []).filter((p) => p.status !== 'LEFT'))).catch(() => setPeople([])); }, []);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await raiseDeskRequest(form);
      notify.success('Raised; it is in the queue.');
      onSaved(r.request);
    } catch (err) {
      notify.error(String(err?.message || 'Not raised.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title="New request on someone's behalf" description="For a call or a visit to the desk. The person sees it in the employee app like one they raised."
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="raise-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Raising…' : 'Raise'}</button></>}>
      <form id="raise-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">Employee *</span>
          <select className="ui-select w-full" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">— Pick —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="ui-label">Category</span>
            <select className="ui-select w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.filter((c) => c.isActive).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          </label>
          <label className="block"><span className="ui-label">Urgency</span>
            <select className="ui-select w-full" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>{Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
        </div>
        <label className="block"><span className="ui-label">Subject *</span><input className="ui-input w-full" required maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
        <label className="block"><span className="ui-label">What happened *</span><textarea className="ui-input w-full" rows={5} required minLength={5} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

function RequestDrawer({ id, canEdit, categories, onClose, onChanged }) {
  const [r, setR] = useState(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [waitForEmployee, setWaitForEmployee] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => getDeskRequest(id).then(setR).catch((e) => notify.error(String(e?.message || 'Could not load.'))), [id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (canEdit) { deskTemplates().then(setTemplates).catch(() => setTemplates([])); orgUsers().then(setUsers); } }, [canEdit]);
  if (!r) return <Drawer open onClose={onClose} title="Request"><SkeletonCard lines={6} /></Drawer>;
  const act = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) notify.success(ok);
      reload();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
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
    }, internal ? 'Note added (the employee does not see it).' : 'Sent to the employee.');
  };
  const resolve = async () => {
    const resolution = window.prompt('How was it resolved? The person reads this.');
    if (resolution && resolution.trim()) act(() => deskResolve(id, resolution.trim()), 'Resolved.');
  };
  const move = async () => {
    if (await confirmDialog({ title: 'Move to Private cases?', message: 'The subject, the details and the thread are wiped here; only the date it moved stays. Open Private cases to carry the details across first.', confirmLabel: 'Move' })) act(() => deskMoveToCase(id), 'Moved. Only the date stays here.');
  };
  const live = ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'].includes(r.status);
  const catLabel = categories.find((c) => c.key === r.category)?.label || r.category;
  return (
    <Drawer open onClose={onClose} title={r.subject} description={`${r.employeeName}${r.employeeCode ? ` · ${r.employeeCode}` : ''} · ${catLabel} · ${r.queue} queue · ${URGENCY[r.urgency] || r.urgency}`} widthClass="w-[min(44rem,96vw)]"
      actions={canEdit && r.status !== 'MOVED' ? (
        <>
          {live ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={move}>Move to Private cases</button> : null}
          {r.status === 'RESOLVED' ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => act(() => deskReopen(id), 'Reopened.')}>Reopen</button> : null}
          {live ? <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={resolve}>Resolve</button> : null}
        </>
      ) : null}>
      <div className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-3 text-sm">
          <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span></dd></div>
          <div><dt className="ui-t-label">Reply by</dt><dd className={`tabular-nums ${r.replyOverdue ? 'text-[rgb(var(--neg))]' : ''}`}>{r.firstReplyAt ? `replied ${when(r.firstReplyAt)}` : when(r.replyBy)}</dd></div>
          <div><dt className="ui-t-label">Resolve by</dt><dd className={`tabular-nums ${r.resolveOverdue ? 'text-[rgb(var(--neg))]' : ''}`}>{day(r.resolveBy)}{r.resolveOverdue ? ' (late)' : ''}</dd></div>
          {canEdit && r.status !== 'MOVED' ? (
            <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
              <dt className="ui-t-label">Assigned to</dt>
              <dd>
                {users.length ? (
                  <select className="ui-select" value={r.assigneeUserId || ''} onChange={(e) => act(() => deskAssign(id, { assigneeUserId: e.target.value || null }), 'Assigned.')} aria-label="Assign to">
                    <option value="">Nobody yet</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.name || u.email}</option>)}
                  </select>
                ) : <span>{r.assigneeName || 'Nobody yet'}</span>}
              </dd>
              <dt className="ui-t-label ml-3">Queue</dt>
              <dd>
                <select className="ui-select" value={r.queue} onChange={(e) => act(() => deskAssign(id, { queue: e.target.value }), 'Moved to the queue.')} aria-label="Queue">
                  {[...new Set([...categories.map((c) => c.queue), r.queue])].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </dd>
            </div>
          ) : null}
        </dl>
        {r.status === 'MOVED' ? <p className="ui-muted text-sm">Moved to Private cases on {day(r.movedToCaseAt)}. Nothing else is kept here.</p> : (
          <>
            <section aria-label="What they said" className="text-sm"><p className="whitespace-pre-wrap">{r.description}</p><p className="ui-caption">{when(r.createdAt)}{r.replyChannel ? ` · prefers a reply by ${r.replyChannel.toLowerCase()}` : ''}</p></section>
            {r.resolution ? <section className="ui-card p-3 text-sm"><p className="ui-t-label">Resolved {when(r.resolvedAt)}</p><p className="whitespace-pre-wrap">{r.resolution}</p></section> : null}
            <ul className="space-y-2" aria-label="Thread">
              {r.messages.map((m) => (
                <li key={m.id} className={`text-sm rounded-xl p-3 ${m.internal ? 'border border-dashed' : 'ui-card'}`}>
                  <p className="ui-caption">{m.authorName}{m.internal ? ' · internal note, the employee does not see this' : ''} · {when(m.createdAt)}{m.policyVersionId ? ' · cites a policy' : ''}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ul>
            {canEdit && live ? (
              <form onSubmit={sendMessage} className="space-y-2">
                {templates.length ? (
                  <select className="ui-select w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
                    <option value="">Insert a template…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.title}{t.policyTitle ? ` (cites ${t.policyTitle})` : ''}</option>)}
                  </select>
                ) : null}
                <textarea className="ui-input w-full" rows={3} placeholder={internal ? 'A note for HR only' : 'Reply to the employee'} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="ui-checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note</label>
                  {!internal ? <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="ui-checkbox" checked={waitForEmployee} onChange={(e) => setWaitForEmployee(e.target.checked)} />Waiting on them</label> : null}
                  <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm ml-auto" disabled={busy || (!body.trim() && !templateId)}>{internal ? 'Add note' : 'Send'}</button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </div>
    </Drawer>
  );
}
