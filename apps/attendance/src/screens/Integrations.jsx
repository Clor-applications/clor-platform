import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plug, Plus, Webhook } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  createApiKey,
  createHrConnection,
  deleteHrConnection,
  flushHrConnection,
  hrConnectionLog,
  listHrAdapters,
  listHrConnections,
  pullHrConnection,
  testHrConnection,
  updateHrConnection,
  createWebhook,
  deleteWebhook,
  listApiKeys,
  listWebhookDeliveries,
  listWebhooks,
  publicApiBase,
  resendWebhookDelivery,
  revokeApiKey,
  rotateApiKey,
  testWebhook,
  updateWebhook,
} from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const SCOPE_LABEL = {
  'attendance:read': 'Read attendance (days, punches, shifts, month summary, closed months)',
  'employees:read': 'Read employees',
  'employees:write': 'Add and change employees (your HRMS as the master)',
  'punches:write': 'Send punches (other readers, turnstiles, apps)',
  'leave:read': 'Read leave types, balances and requests',
  'leave:write': 'Ask for, approve and reject leave',
  'readers:read': 'Read readers and whether they are online',
};
/* Groups for the webhook form; the words come from the server (eventHelp). */
const EVENT_GROUPS = [
  ['Attendance', ['punch', 'day', 'correction.approved', 'month.closed', 'month.reopened']],
  ['People', ['employee.created', 'employee.updated', 'employee.left']],
  ['Leave', ['leave.requested', 'leave.approved', 'leave.rejected', 'leave.cancelled']],
  ['Readers', ['reader.offline', 'reader.online']],
];
const FALLBACK_HELP = { punch: 'Punches as they arrive', day: 'Days as they are worked out or changed' };
const DELIVERY_PILL = { OK: 'ui-pill-pos', PENDING: 'ui-pill-warn', FAILED: 'ui-pill-neg' };
const ago = (iso) => (iso ? new Date(iso).toLocaleString() : 'never');
const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    notify.success('Copied.');
  } catch {
    notify.error('Could not copy — select it and copy by hand.');
  }
};

/** A secret shown exactly once, with a copy button. */
function ShownOnce({ label, value, onDone }) {
  return (
    <div className="ui-card space-y-2 p-4" role="alert" style={{ borderColor: 'rgb(var(--warn-ink))' }}>
      <div className="text-sm font-semibold">{label} — shown once. Copy it now; CLOR keeps only a hash and cannot show it again.</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-[rgb(var(--surface-sunken))] px-2 py-1 ui-mono text-xs">{value}</code>
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => copy(value)}><Copy size={14} aria-hidden="true" /> Copy</button>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={onDone}>I have copied it</button>
      </div>
    </div>
  );
}

/**
 * Connecting other systems: API keys for systems that read attendance or send
 * punches, and webhooks CLOR calls as things happen (ClorTime's API clients
 * and integrations, for the cloud).
 */
export default function Integrations() {
  const [keys, setKeys] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [hooks, setHooks] = useState(null);
  const [eventHelp, setEventHelp] = useState(FALLBACK_HELP);
  const [openHook, setOpenHook] = useState(null);
  const [shown, setShown] = useState(null);
  const [keyForm, setKeyForm] = useState({ name: '', scopes: ['attendance:read'], allowedIps: '' });
  const [hookForm, setHookForm] = useState({ name: '', url: '', events: ['day'] });
  const base = publicApiBase();

  const load = useCallback(() => {
    listApiKeys().then((r) => { setKeys(r?.keys || []); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load keys.')));
    listWebhooks()
      .then((r) => {
        setHooks(r?.webhooks || []);
        if (r?.eventHelp) setEventHelp(r.eventHelp);
      })
      .catch(() => setHooks([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const addKey = async (e) => {
    e.preventDefault();
    try {
      const r = await createApiKey({ ...keyForm, allowedIps: keyForm.allowedIps || null });
      setShown({ label: `API key “${r.key.name}”`, value: r.token });
      setKeyForm({ name: '', scopes: ['attendance:read'], allowedIps: '' });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not created.'));
    }
  };
  const rotate = async (k) => {
    const ok = await confirmDialog({ title: `Rotate ${k.name}?`, message: 'The current key stops working at once. Whatever uses it needs the new one.', confirmLabel: 'Rotate' });
    if (!ok) return;
    const r = await rotateApiKey(k.id);
    setShown({ label: `New key for “${k.name}”`, value: r.token });
    load();
  };
  const revoke = async (k) => {
    const ok = await confirmDialog({ title: `Revoke ${k.name}?`, message: 'It stops working at once and cannot be restored (rotate gives a new one).', confirmLabel: 'Revoke' });
    if (!ok) return;
    await revokeApiKey(k.id);
    load();
  };

  const addHook = async (e) => {
    e.preventDefault();
    try {
      const r = await createWebhook(hookForm);
      setShown({ label: `Signing secret for “${r.webhook.name}”`, value: r.secret });
      setHookForm({ name: '', url: '', events: ['day'] });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not created.'));
    }
  };
  const test = async (h) => {
    const r = await testWebhook(h.id);
    if (r.ok) notify.success(`Delivered — the endpoint answered ${r.status}.`);
    else notify.error(r.error || `The endpoint answered ${r.status}.`);
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Integrations" description="Let other systems read attendance or send punches, and have CLOR tell them when things happen." />
      {shown ? <ShownOnce label={shown.label} value={shown.value} onDone={() => setShown(null)} /> : null}

      <HrTools />

      <section className="ui-card space-y-4 p-5" aria-labelledby="keys-h">
        <h2 id="keys-h" className="ui-t-sec flex items-center gap-2"><KeyRound size={16} aria-hidden="true" /> API keys</h2>
        <form onSubmit={addKey} className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="e.g. greytHR sync" /></label>
          <label className="block"><span className="ui-label">Only from these addresses</span><input className="ui-input w-full" value={keyForm.allowedIps} onChange={(e) => setKeyForm({ ...keyForm, allowedIps: e.target.value })} placeholder="Blank = anywhere; e.g. 203.0.113.10, 203.0.113.11" /></label>
          <fieldset className="md:col-span-2">
            <legend className="ui-label">It may</legend>
            {Object.entries(SCOPE_LABEL).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={keyForm.scopes.includes(k)} onChange={() => setKeyForm({ ...keyForm, scopes: toggle(keyForm.scopes, k) })} /> {label}
              </label>
            ))}
          </fieldset>
          <div className="md:col-span-2"><button type="submit" className="ui-btn ui-btn-primary" disabled={!keyForm.scopes.length}><Plus size={16} aria-hidden="true" /> Create key</button></div>
        </form>
        <LoadFailed message={loadError} onRetry={load} />
        {!keys ? (
          loadError ? null : <SkeletonCard lines={2} />
        ) : keys.length ? (
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Name</th>
                  <th scope="col" className="ui-th">Key</th>
                  <th scope="col" className="ui-th">May</th>
                  <th scope="col" className="ui-th">Last used</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td className="ui-col-entity">{k.name}</td>
                    <td className="ui-mono text-xs">{k.tokenPrefix}…</td>
                    <td className="ui-col-meta">{k.scopes.join(', ')}{k.allowedIps.length ? ` · from ${k.allowedIps.join(', ')}` : ''}</td>
                    <td className="ui-col-meta whitespace-nowrap">{ago(k.lastUsedAt)}{k.lastUsedIp ? ` · ${k.lastUsedIp}` : ''}</td>
                    <td className="ui-col-h-center">{k.isActive ? <span className="ui-pill ui-pill-pos">active</span> : <span className="ui-pill ui-pill-neutral">revoked</span>}</td>
                    <td className="whitespace-nowrap text-end">
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Rotate ${k.name}`} onClick={() => rotate(k)}>Rotate</button>
                      {k.isActive ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Revoke ${k.name}`} onClick={() => revoke(k)}>Revoke</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ui-muted text-sm">No keys yet.</p>
        )}
      </section>

      <section className="ui-card space-y-4 p-5" aria-labelledby="hooks-h">
        <h2 id="hooks-h" className="ui-t-sec flex items-center gap-2"><Webhook size={16} aria-hidden="true" /> Webhooks</h2>
        <form onSubmit={addHook} className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={hookForm.name} onChange={(e) => setHookForm({ ...hookForm, name: e.target.value })} placeholder="e.g. Payroll system" /></label>
          <label className="block"><span className="ui-label">Address *</span><input className="ui-input w-full" required type="url" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} placeholder="https://hrms.example.com/clor-events" /></label>
          <fieldset className="md:col-span-2">
            <legend className="ui-label">Send</legend>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {EVENT_GROUPS.map(([group, keys]) => (
                <div key={group}>
                  <div className="ui-caption font-medium">{group}</div>
                  {keys.map((k) => (
                    <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" className="ui-checkbox" checked={hookForm.events.includes(k)} onChange={() => setHookForm({ ...hookForm, events: toggle(hookForm.events, k) })} />
                      <span>{eventHelp[k] || k} <code className="ui-mono ui-caption">{k}</code></span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
          <div className="md:col-span-2"><button type="submit" className="ui-btn ui-btn-primary" disabled={!hookForm.events.length}><Plus size={16} aria-hidden="true" /> Add webhook</button></div>
        </form>
        {!hooks ? (
          <SkeletonCard lines={2} />
        ) : hooks.length ? (
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{h.name} <span className="ui-caption">· {h.events.join(', ')}</span></div>
                  <div className="ui-caption truncate">{h.url}</div>
                  <div className="ui-caption" style={h.lastError ? { color: 'rgb(var(--neg))' } : undefined}>
                    {h.lastDeliveredAt ? `Last sent ${ago(h.lastDeliveredAt)} — ${h.lastError || `answered ${h.lastStatus}`}` : 'Nothing sent yet'}
                  </div>
                </div>
                <span className="flex gap-1">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" className="ui-checkbox" checked={h.isActive} onChange={async (e) => { await updateWebhook(h.id, { name: h.name, url: h.url, events: h.events, isActive: e.target.checked }); load(); }} /> On
                  </label>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpenHook(openHook === h.id ? null : h.id)} aria-expanded={openHook === h.id}>{openHook === h.id ? 'Hide deliveries' : 'Deliveries'}</button>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => test(h)}>Send test</button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm"
                    aria-label={`Delete ${h.name}`}
                    onClick={async () => {
                      if (await confirmDialog({ title: `Delete ${h.name}?`, message: 'CLOR stops sending to it.', confirmLabel: 'Delete' })) {
                        await deleteWebhook(h.id);
                        load();
                      }
                    }}
                  >
                    Delete
                  </button>
                </span>
                {openHook === h.id ? <Deliveries hook={h} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-muted text-sm">No webhooks yet.</p>
        )}
        <p className="ui-caption">
          Each call is a POST with JSON <code className="ui-mono">{'{ event, orgId, sentAt, data }'}</code> and the header <code className="ui-mono">X-Clor-Signature: sha256=…</code> — an HMAC-SHA256 of the body with the webhook’s secret. Check it before trusting the call. <code className="ui-mono">X-Clor-Delivery</code> is the same on every retry of one event, so a call seen twice can be ignored. A failed call is tried again after 1, 5, 30, 120 and 720 minutes; any delivery can be sent again from the list.
        </p>
      </section>

      <section className="ui-card space-y-3 p-5 text-sm" aria-labelledby="api-h">
        <h2 id="api-h" className="ui-t-sec">The API</h2>
        <p>Base address <code className="ui-mono font-semibold">{base}</code>. Send the key as <code className="ui-mono">Authorization: Bearer clor_…</code>. Times are Indian Standard Time; at most 92 days per call, 120 calls a minute per key. Full reference: <a className="ui-link" href={`${base}/docs`} target="_blank" rel="noreferrer">{base}/docs</a> · <a className="ui-link" href={`${base}/openapi.json`} target="_blank" rel="noreferrer">openapi.json</a>. Lists take <code className="ui-mono">updated_since</code> + <code className="ui-mono">cursor</code> to sync only what changed; writes may carry an <code className="ui-mono">Idempotency-Key</code> header so a retry is never a second record.</p>
        <table className="ui-table w-full text-xs">
          <tbody>
            {[
              ['GET', '/ping', '—', 'Check the key'],
              ['GET', '/employees', 'employees:read', 'Everyone, with their Reader ID; ?updated_since= pages what changed'],
              ['POST', '/employees', 'employees:write', 'Add or update by code (an HRMS as master)'],
              ['PATCH', '/employees/{code}', 'employees:write', 'Change some details; LEFT removes them from readers'],
              ['GET', '/attendance/shifts', 'attendance:read', 'Who is on which shift, per day (≤ 31 days)'],
              ['GET', '/attendance/months', 'attendance:read', 'Which months are closed for payroll'],
              ['GET', '/readers', 'readers:read', 'Readers and whether they are online'],
              ['GET', '/leave/types · /leave/balances · /leave/requests', 'leave:read', 'Leave types, balances for a year, requests'],
              ['POST', '/leave/requests · /leave/requests/{id}/approve · /reject', 'leave:write', 'Ask for leave; approve or reject with CLOR’s own checks'],
              ['GET', '/attendance/days?from=YYYY-MM-DD&to=YYYY-MM-DD', 'attendance:read', 'Each person’s days: in, out, worked, late, overtime, status'],
              ['GET', '/attendance/punches?from=…&to=…', 'attendance:read', 'Every punch as received'],
              ['GET', '/attendance/summary?month=YYYY-MM', 'attendance:read', 'Payable and loss-of-pay days'],
              ['POST', '/attendance/punches', 'punches:write', 'Up to 500 punches: { "punches": [{ "employee_code", "timestamp": "YYYY-MM-DD HH:mm:ss", "direction": "in" | "out" }] }'],
            ].map(([m, path, scope, what]) => (
              <tr key={path}>
                <td className="ui-mono">{m}</td>
                <td className="ui-mono">{path}</td>
                <td className="ui-mono ui-col-meta">{scope}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="overflow-x-auto rounded-lg bg-[rgb(var(--surface-sunken))] p-3 text-xs">{`curl -H "Authorization: Bearer clor_…" "${base}/attendance/days?from=2026-10-01&to=2026-10-31"`}</pre>
      </section>
    </div>
  );
}

/** What was sent to one webhook lately, with a resend for anything that did not land. */
function Deliveries({ hook }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    listWebhookDeliveries(hook.id).then((r) => setRows(r?.deliveries || [])).catch(() => setRows([]));
  }, [hook.id]);
  useEffect(() => {
    load();
  }, [load]);
  const resend = async (d) => {
    setBusy(d.id);
    try {
      const r = await resendWebhookDelivery(hook.id, d.id);
      if (r.ok) notify.success(`Delivered — answered ${r.status}.`);
      else notify.error(r.error || `Answered ${r.status}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not sent.'));
    } finally {
      setBusy('');
    }
  };
  if (!rows) return <SkeletonCard lines={2} />;
  if (!rows.length) return <p className="ui-caption w-full pt-2">Nothing sent to this webhook yet.</p>;
  return (
    <div className="w-full overflow-x-auto ui-table-scroll pt-2">
      <table className="ui-table w-full text-xs">
        <thead>
          <tr>
            <th scope="col" className="ui-th">When</th>
            <th scope="col" className="ui-th">Event</th>
            <th scope="col" className="ui-th ui-col-h-center">Status</th>
            <th scope="col" className="ui-th">Tries</th>
            <th scope="col" className="ui-th">Answer</th>
            <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="ui-col-meta whitespace-nowrap">{ago(d.createdAt)}</td>
              <td className="ui-mono">{d.event}</td>
              <td className="ui-col-h-center"><span className={`ui-pill ${DELIVERY_PILL[d.status] || 'ui-pill-neutral'}`}>{d.status.toLowerCase()}</span></td>
              <td className="tabular-nums">{d.attempts}{d.nextAttemptAt && d.status === 'PENDING' ? <span className="ui-caption block">next {ago(d.nextAttemptAt)}</span> : null}</td>
              <td className="ui-col-meta" style={d.lastError ? { color: 'rgb(var(--neg))' } : undefined}>{d.lastError || (d.lastStatus ? `answered ${d.lastStatus}` : '—')}</td>
              <td className="text-end whitespace-nowrap">
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === d.id} onClick={() => resend(d)}>Send again</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * HR tools the company runs alongside CLOR — greytHR, Keka — connected by
 * their own credentials. Punches go out as they arrive (an outbox that
 * retries); people can be read in so the two lists match. What a tool can
 * do is what its adapter declares; the screen offers nothing more.
 */
function HrTools() {
  const [adapters, setAdapters] = useState([]);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState(null);
  const load = useCallback(() => listHrConnections().then(setRows).catch(() => setRows([])), []);
  useEffect(() => {
    listHrAdapters().then(setAdapters).catch(() => {});
    load();
  }, [load]);
  const adapter = (id) => adapters.find((a) => a.id === id);

  const save = async (e) => {
    e.preventDefault();
    setBusy('save');
    try {
      const body = { adapter: form.adapter, name: form.name, fields: form.fields, enabled: form.enabled, pushPunches: form.pushPunches, pullEmployees: form.pullEmployees, createEmployees: form.createEmployees };
      if (form.id) await updateHrConnection(form.id, body);
      else await createHrConnection(body);
      notify.success(form.id ? 'Saved.' : 'Connected. Test it, then switch it on.');
      setForm(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  const act = async (id, fn, label) => {
    setBusy(id + label);
    try {
      const r = await fn(id);
      if (label === 'test') (r.ok ? notify.success : notify.error)(r.message);
      else if (label === 'pull') notify.success(`Read ${r.pulled}, matched ${r.matched}${r.created ? `, added ${r.created}` : ''}.`);
      else if (label === 'flush') notify.success(`${r.sent} sent.`);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Failed.'));
    } finally {
      setBusy('');
    }
  };
  const remove = async (c) => {
    if (!(await confirmDialog({ title: `Disconnect ${c.name}?`, message: 'Nothing already sent is withdrawn; waiting punches are dropped.', confirmLabel: 'Disconnect' }))) return;
    await deleteHrConnection(c.id).catch((e) => notify.error(String(e?.message || 'Not removed.')));
    load();
  };
  const startNew = (a) => setForm({ adapter: a.id, name: a.label, fields: {}, enabled: false, pushPunches: a.capabilities.includes('pushPunches'), pullEmployees: false, createEmployees: false });
  const edit = (c) => setForm({ id: c.id, adapter: c.adapter, name: c.name, fields: { ...c.config }, enabled: c.enabled, pushPunches: c.pushPunches, pullEmployees: c.pullEmployees, createEmployees: c.createEmployees, secretsSet: c.secretsSet });
  const showLog = async (c) => setLog({ c, ...(await hrConnectionLog(c.id).catch(() => ({ log: [], failed: [] }))) });

  return (
    <section className="ui-card space-y-4 p-5" aria-labelledby="hr-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hr-h" className="ui-t-sec flex items-center gap-2"><Plug size={16} aria-hidden="true" /> HR tools</h2>
        {!form ? (
          <div className="flex flex-wrap gap-2">
            {adapters.map((a) => <button key={a.id} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => startNew(a)}><Plus size={14} aria-hidden="true" /> {a.label}</button>)}
          </div>
        ) : null}
      </div>
      <p className="ui-caption">Punches reach the tool as they arrive, with retries; people can be read in so the two lists match. Each tool’s own credentials, kept encrypted.</p>

      {!rows ? <SkeletonCard lines={3} /> : rows.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="font-medium">{c.name} <span className="ui-caption font-normal">· {c.adapterLabel}</span></div>
                <div className="ui-caption">
                  {c.pushPunches ? 'punches out' : ''}{c.pushPunches && c.pullEmployees ? ' · ' : ''}{c.pullEmployees ? `people in${c.createEmployees ? ' (adding new)' : ''}` : ''}
                  {c.outbox?.PENDING ? ` · ${c.outbox.PENDING} waiting` : ''}{c.outbox?.FAILED ? ` · ${c.outbox.FAILED} failed` : ''}
                  {c.lastRunAt ? ` · last run ${new Date(c.lastRunAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                </div>
                {c.lastSummary && !c.lastError ? <div className="ui-caption">{c.lastSummary}</div> : null}
                {c.lastError ? <div className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{c.lastError}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`ui-pill ${c.enabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{c.enabled ? 'On' : 'Off'}</span>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => act(c.id, testHrConnection, 'test')}>Test</button>
                {c.capabilities.includes('pullEmployees') ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => act(c.id, pullHrConnection, 'pull')}>Read people now</button> : null}
                {c.outbox?.PENDING || c.outbox?.FAILED ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => act(c.id, flushHrConnection, 'flush')}>Send now</button> : null}
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => updateHrConnection(c.id, { enabled: !c.enabled }).then(load).catch((e) => notify.error(String(e?.message || 'Not changed.')))}>{c.enabled ? 'Switch off' : 'Switch on'}</button>
                <button type="button" className="ui-link text-sm" onClick={() => showLog(c)}>Log</button>
                <button type="button" className="ui-link text-sm" onClick={() => edit(c)}>Edit</button>
                <button type="button" className="ui-link text-sm" onClick={() => remove(c)}>Disconnect</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ui-caption">Nothing connected yet.</p>}

      {form ? (
        <form onSubmit={save} className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }} aria-label={form.id ? 'Edit connection' : 'New connection'}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="ui-t-sec">{adapter(form.adapter)?.label || form.adapter}</h3>
            {adapter(form.adapter)?.docsUrl ? <a className="ui-link text-sm" href={adapter(form.adapter).docsUrl} target="_blank" rel="noreferrer">How to get the keys</a> : null}
          </div>
          <p className="ui-caption">{adapter(form.adapter)?.blurb}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block"><span className="ui-label">Shown as</span><input className="ui-input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            {(adapter(form.adapter)?.fields || []).map((f) => (
              <label key={f.key} className={`block ${f.key === 'privateKey' ? 'md:col-span-2' : ''}`}>
                <span className="ui-label">{f.label}{f.required ? '' : ' (optional)'}</span>
                {f.key === 'privateKey' ? (
                  <textarea className="ui-input w-full ui-mono text-xs" rows={4} placeholder={form.secretsSet?.includes(f.key) ? 'Stored — paste to replace' : '-----BEGIN PRIVATE KEY-----'} value={form.fields[f.key] || ''} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.key]: e.target.value } })} />
                ) : (
                  <input type={f.secret ? 'password' : 'text'} className="ui-input w-full" placeholder={f.secret && form.secretsSet?.includes(f.key) ? 'Stored — type to replace' : f.placeholder || ''} value={form.fields[f.key] || ''} autoComplete="off" onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.key]: e.target.value } })} />
                )}
                {f.help ? <span className="ui-caption">{f.help}</span> : null}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {adapter(form.adapter)?.capabilities.includes('pushPunches') ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.pushPunches} onChange={(e) => setForm({ ...form, pushPunches: e.target.checked })} /> Send punches as they arrive</label> : null}
            {adapter(form.adapter)?.capabilities.includes('pullEmployees') ? (
              <>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.pullEmployees} onChange={(e) => setForm({ ...form, pullEmployees: e.target.checked })} /> Read its people hourly</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.createEmployees} onChange={(e) => setForm({ ...form, createEmployees: e.target.checked })} /> Add people CLOR does not have</label>
              </>
            ) : null}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Switched on</label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : form.id ? 'Save' : 'Connect'}</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {log ? (
        <div className="rounded-lg p-4 space-y-2" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
          <div className="flex items-center justify-between"><h3 className="ui-t-sec">{log.c.name} — recent runs</h3><button type="button" className="ui-link text-sm" onClick={() => setLog(null)}>Close</button></div>
          {!log.log.length ? <p className="ui-caption">No runs yet.</p> : (
            <ul className="text-sm space-y-1">
              {log.log.map((l) => <li key={l.id}><span className="ui-caption">{new Date(l.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {l.kind}</span> <span style={l.ok ? undefined : { color: 'rgb(var(--neg))' }}>{l.detail}</span></li>)}
            </ul>
          )}
          {log.failed.length ? <p className="ui-caption">{log.failed.length} punch{log.failed.length === 1 ? '' : 'es'} gave up after retries — first: {log.failed[0].key} · {log.failed[0].lastError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
