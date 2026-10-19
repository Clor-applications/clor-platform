import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plug, Plus, Server, Webhook } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  createApiKey,
  createHrConnection,
  deleteHrConnection,
  flushHrConnection,
  createAgent,
  deleteAgent,
  listAgentJobs,
  listAgents,
  rotateAgentToken,
  updateAgent,
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
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Integrations" description="Let other systems read attendance or send punches, and have CLOR tell them when things happen." />
      {shown ? <ShownOnce label={shown.label} value={shown.value} onDone={() => setShown(null)} /> : null}

      <HrTools />

      <Connectors onShown={setShown} />

      <section className="ui-card space-y-4 p-4" aria-labelledby="keys-h">
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

      <section className="ui-card space-y-4 p-4" aria-labelledby="hooks-h">
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

      <section className="ui-card space-y-3 p-4 text-sm" aria-labelledby="api-h">
        <h2 id="api-h" className="ui-t-sec">The API</h2>
        <p>Base address <code className="ui-mono font-semibold">{base}</code>. Send the key as <code className="ui-mono">Authorization: Bearer clor_…</code>. Times are Indian Standard Time; at most 92 days per call, 120 calls a minute per key. Full reference: <a className="ui-link" href={`${base}/docs`} target="_blank" rel="noreferrer">{base}/docs</a> · <a className="ui-link" href={`${base}/openapi.json`} target="_blank" rel="noreferrer">openapi.json</a>. Lists take <code className="ui-mono">updated_since</code> + <code className="ui-mono">cursor</code> to sync only what changed; writes may carry an <code className="ui-mono">Idempotency-Key</code> header so a retry is never a second record.</p>
        <div className="overflow-x-auto ui-table-scroll">
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
              <tr key={`${m} ${path}`}>
                <td className="ui-mono">{m}</td>
                <td className="ui-mono">{path}</td>
                <td className="ui-mono ui-col-meta">{scope}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
/**
 * On-site connectors: a small service the company runs on its own network
 * for what the cloud cannot reach — readers on the LAN, Tally's HTTP port,
 * Active Directory. Made here with a token shown once; it fetches its work.
 */
const EMPTY_AGENT = { name: '', pollSeconds: 60, tallyOn: false, tally: { host: '', port: 9000, company: '' }, ldapOn: false, ldap: { url: '', bindDn: '', bindPassword: '', baseDn: '', filter: '', emailAttr: 'mail', deactivateMissing: false } };

function Connectors({ onShown }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState(null);
  const load = useCallback(() => listAgents().then(setData).catch(() => setData({ agents: [], baseUrl: '', downloadUrl: '' })), []);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setT = (k) => (e) => setForm((f) => ({ ...f, tally: { ...f.tally, [k]: e.target.value } }));
  const setL = (k) => (e) => setForm((f) => ({ ...f, ldap: { ...f.ldap, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }));
  const body = () => ({
    name: form.name,
    pollSeconds: Number(form.pollSeconds) || 60,
    tally: form.tallyOn && form.tally.host ? { host: form.tally.host, port: Number(form.tally.port) || 9000, company: form.tally.company || undefined } : null,
    ldap: form.ldapOn && form.ldap.url ? { url: form.ldap.url, bindDn: form.ldap.bindDn, bindPassword: form.ldap.bindPassword || undefined, baseDn: form.ldap.baseDn, filter: form.ldap.filter || undefined, emailAttr: form.ldap.emailAttr || undefined, deactivateMissing: Boolean(form.ldap.deactivateMissing) } : null,
  });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.id) {
        await updateAgent(form.id, body());
        notify.success('Connector saved. It picks the change up on its next round.');
      } else {
        const r = await createAgent(body());
        onShown({ label: `Token for “${r.agent.name}” — run the connector with it`, value: r.token });
      }
      setForm(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const edit = (a) => setForm({ id: a.id, name: a.name, pollSeconds: a.pollSeconds || 60, tallyOn: Boolean(a.tally), tally: { host: a.tally?.host || '', port: a.tally?.port || 9000, company: a.tally?.company || '' }, ldapOn: Boolean(a.ldap), ldap: { ...EMPTY_AGENT.ldap, ...(a.ldap || {}), bindPassword: '' } });
  const rotate = async (a) => {
    if (!(await confirmDialog({ title: `New token for ${a.name}?`, message: 'The running connector stops at once until it is restarted with the new token.', confirmLabel: 'New token' }))) return;
    try {
      const r = await rotateAgentToken(a.id);
      onShown({ label: `New token for “${a.name}”`, value: r.token });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not rotated.'));
    }
  };
  const remove = async (a) => {
    if (!(await confirmDialog({ title: `Remove ${a.name}?`, message: 'Its readers go back to being pulled by CLOR directly (which only works if they are reachable from the internet).', confirmLabel: 'Remove' }))) return;
    await deleteAgent(a.id).catch((err) => notify.error(String(err?.message || 'Not removed.')));
    load();
  };
  const showJobs = async (a) => {
    try {
      setJobs({ agent: a, rows: (await listAgentJobs(a.id)).jobs });
    } catch (err) {
      notify.error(String(err?.message || 'Could not load.'));
    }
  };

  return (
    <section className="ui-card space-y-4 p-4" aria-labelledby="agents-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="agents-h" className="ui-t-sec flex items-center gap-2"><Server size={16} aria-hidden="true" /> On-site connectors</h2>
        {!form ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setForm({ ...EMPTY_AGENT })}><Plus size={14} aria-hidden="true" /> Add a connector</button> : null}
      </div>
      <p className="ui-caption max-w-3xl">A small program on a computer in your office, for what CLOR cannot reach from the internet: readers on the office network, Tally’s HTTP port, and Active Directory. It only ever calls out to CLOR over HTTPS. <a className="ui-link" href="/docs/connector" target="_blank" rel="noreferrer">Guide</a></p>

      {!data ? <SkeletonCard lines={3} /> : data.agents.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {data.agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="font-medium">{a.name} <span className="ui-caption font-normal">· <code className="ui-mono">{a.tokenPrefix}…</code>{a.hostname ? ` · ${a.hostname}` : ''}{a.version ? ` · v${a.version}` : ''}</span></div>
                <div className="ui-caption">
                  {a.readers.length ? `${a.readers.length} reader${a.readers.length === 1 ? '' : 's'}` : 'no readers assigned'}
                  {a.tally ? ` · Tally at ${a.tally.host}:${a.tally.port || 9000}` : ''}
                  {a.ldap ? ` · directory ${a.ldap.url}${a.scimPending ? ' (SCIM token waiting for its first poll)' : ''}` : ''}
                  {a.jobs?.PENDING ? ` · ${a.jobs.PENDING} job${a.jobs.PENDING === 1 ? '' : 's'} waiting` : ''}
                  {a.jobs?.FAILED ? ` · ${a.jobs.FAILED} failed` : ''}
                </div>
                {a.lastSummary ? <div className="ui-caption">Last round: {a.lastSummary}</div> : null}
                {a.lastError ? <div className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>{a.lastError}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`ui-pill ${!a.isActive ? 'ui-pill-neutral' : a.online ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{!a.isActive ? 'off' : a.online ? 'online' : a.lastSeenAt ? `last seen ${ago(a.lastSeenAt)}` : 'never connected'}</span>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => edit(a)}>Edit</button>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => showJobs(a)}>Jobs</button>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => rotate(a)}>New token</button>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => remove(a)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {jobs ? (
        <div className="ui-card p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Jobs for {jobs.agent.name}</span><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setJobs(null)}>Close</button></div>
          {jobs.rows.length ? (
            <ul className="mt-2 divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {jobs.rows.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{j.label} <span className="ui-caption">· {ago(j.createdAt)}{j.result ? ` · ${j.result}` : ''}</span></span>
                  <span className={`ui-pill ${j.status === 'DONE' ? 'ui-pill-pos' : j.status === 'FAILED' ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{j.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          ) : <p className="ui-caption mt-1">Nothing queued yet. Payroll → Pay runs → Books sends a run to Tally through a connector.</p>}
        </div>
      ) : null}

      {form ? (
        <form onSubmit={save} className="ui-card grid gap-4 p-4" aria-label={form.id ? 'Edit connector' : 'New connector'}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} placeholder="e.g. Head office server" /></label>
            <label className="block"><span className="ui-label">Checks in every (seconds)</span><input type="number" min={30} max={900} className="ui-input w-full" value={form.pollSeconds} onChange={set('pollSeconds')} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.tallyOn} onChange={set('tallyOn')} /> Posts payroll vouchers to Tally on this network</label>
          {form.tallyOn ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block"><span className="ui-label">Tally computer (host or IP) *</span><input className="ui-input w-full ui-mono" required value={form.tally.host} onChange={setT('host')} placeholder="192.168.1.20" /></label>
              <label className="block"><span className="ui-label">Port</span><input type="number" className="ui-input w-full" value={form.tally.port} onChange={setT('port')} placeholder="9000" /></label>
              <label className="block"><span className="ui-label">Company name in Tally</span><input className="ui-input w-full" value={form.tally.company} onChange={setT('company')} placeholder="As Tally shows it (blank = the open company)" /></label>
              <p className="ui-caption md:col-span-3">In Tally: F1 → Settings → Connectivity → “Enable ODBC / HTTP server” on port 9000, with the company open. Ledger names in Tally must match the account names in CLOR.</p>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.ldapOn} onChange={set('ldapOn')} /> Syncs people from Active Directory / LDAP into CLOR (over SCIM)</label>
          {form.ldapOn ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block"><span className="ui-label">Directory address *</span><input className="ui-input w-full ui-mono" required value={form.ldap.url} onChange={setL('url')} placeholder="ldaps://dc1.corp.local:636" /></label>
              <label className="block"><span className="ui-label">Search base *</span><input className="ui-input w-full ui-mono" required value={form.ldap.baseDn} onChange={setL('baseDn')} placeholder="OU=Staff,DC=corp,DC=local" /></label>
              <label className="block"><span className="ui-label">Bind user (DN or UPN) *</span><input className="ui-input w-full ui-mono" required value={form.ldap.bindDn} onChange={setL('bindDn')} placeholder="svc-clor@corp.local" autoComplete="off" /></label>
              <label className="block"><span className="ui-label">Bind password{form.id ? '' : ' *'}</span><input type="password" className="ui-input w-full" required={!form.id} value={form.ldap.bindPassword} onChange={setL('bindPassword')} placeholder={form.id ? 'Leave blank to keep the saved one' : ''} autoComplete="new-password" /></label>
              <label className="block"><span className="ui-label">Filter</span><input className="ui-input w-full ui-mono" value={form.ldap.filter} onChange={setL('filter')} placeholder="(&(objectClass=user)(mail=*))" /></label>
              <label className="block"><span className="ui-label">E-mail attribute</span><input className="ui-input w-full ui-mono" value={form.ldap.emailAttr} onChange={setL('emailAttr')} placeholder="mail" /></label>
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="ui-checkbox" checked={Boolean(form.ldap.deactivateMissing)} onChange={setL('deactivateMissing')} /> Switch off people the connector added when they leave the directory (never anyone added by hand)</label>
              <p className="ui-caption md:col-span-2">People found in the directory are added as CLOR users with no role until one is assigned; disabled accounts follow. The bind password stays on CLOR encrypted and is given only to this connector.</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save' : 'Make the connector'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer">How to install it</summary>
        <ol className="mt-2 list-decimal space-y-1 ps-5 ui-caption">
          <li>On a computer in the office that stays on (Windows, Linux or macOS), install Node.js 20 or newer from nodejs.org.</li>
          <li>Download the connector: <code className="ui-mono break-all">{data?.downloadUrl || '…/agent/v1/download'}</code> (one file, clor-agent.cjs).</li>
          <li>Install it as a service with the token shown when the connector was made: <code className="ui-mono">node clor-agent.cjs --install --token clora_…</code> (as administrator / with sudo). It registers itself to start at boot (Task Scheduler, systemd or launchd), keeps the token in <code className="ui-mono">clor-agent.json</code> beside the file, and appears as online here within a minute.</li>
          <li>To try it first without installing: <code className="ui-mono">node clor-agent.cjs --token clora_… --once</code>. It updates itself when CLOR has a newer version.</li>
          <li>Assign readers to it under Readers → open a pull reader → “Reached through”. Tally and the directory are set on the connector above.</li>
        </ol>
      </details>
    </section>
  );
}

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
    <section className="ui-card space-y-4 p-4" aria-labelledby="hr-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hr-h" className="ui-t-sec flex items-center gap-2"><Plug size={16} aria-hidden="true" /> HR tools</h2>
        {!form ? (
          <div className="flex flex-wrap gap-2">
            {adapters.map((a) => <button key={a.id} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => startNew(a)}><Plus size={14} aria-hidden="true" /> {a.label}</button>)}
          </div>
        ) : null}
      </div>
      <p className="ui-caption">Punches reach the tool as they arrive, with retries; people can be read in so the two lists match. Each tool’s own credentials, kept encrypted. <a className="ui-link" href="/docs/hr-tools" target="_blank" rel="noreferrer">Guide</a></p>

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
