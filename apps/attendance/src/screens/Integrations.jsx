import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Webhook } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  createApiKey,
  createWebhook,
  deleteWebhook,
  listApiKeys,
  listWebhooks,
  publicApiBase,
  revokeApiKey,
  rotateApiKey,
  testWebhook,
  updateWebhook,
} from '../api/attendance';

const SCOPE_LABEL = {
  'attendance:read': 'Read attendance (days, punches, month summary)',
  'employees:read': 'Read employees',
  'punches:write': 'Send punches (other readers, turnstiles, apps)',
};
const EVENT_LABEL = { punch: 'Punches as they arrive', day: 'Days as they are worked out or changed' };
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
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-[rgb(var(--surface-sunken))] px-2 py-1 font-mono text-xs">{value}</code>
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
  const [hooks, setHooks] = useState(null);
  const [shown, setShown] = useState(null);
  const [keyForm, setKeyForm] = useState({ name: '', scopes: ['attendance:read'], allowedIps: '' });
  const [hookForm, setHookForm] = useState({ name: '', url: '', events: ['day'] });
  const base = publicApiBase();

  const load = useCallback(() => {
    listApiKeys().then((r) => setKeys(r?.keys || [])).catch((e) => notify.error(String(e?.message || 'Could not load keys.')));
    listWebhooks().then((r) => setHooks(r?.webhooks || [])).catch(() => setHooks([]));
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
        {!keys ? (
          <SkeletonCard lines={2} />
        ) : keys.length ? (
          <div className="overflow-x-auto ui-table-scroll">
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
                    <td className="font-mono text-xs">{k.tokenPrefix}…</td>
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
            {Object.entries(EVENT_LABEL).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={hookForm.events.includes(k)} onChange={() => setHookForm({ ...hookForm, events: toggle(hookForm.events, k) })} /> {label}
              </label>
            ))}
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
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-muted text-sm">No webhooks yet.</p>
        )}
        <p className="ui-caption">
          Each call is a POST with JSON <code className="font-mono">{'{ event, orgId, sentAt, data }'}</code> and the header <code className="font-mono">X-Clor-Signature: sha256=…</code> — an HMAC-SHA256 of the body with the webhook’s secret. Check it before trusting the call.
        </p>
      </section>

      <section className="ui-card space-y-3 p-5 text-sm" aria-labelledby="api-h">
        <h2 id="api-h" className="ui-t-sec">The API</h2>
        <p>Base address <code className="font-mono font-semibold">{base}</code>. Send the key as <code className="font-mono">Authorization: Bearer clor_…</code>. Times are Indian Standard Time; at most 92 days per call, 120 calls a minute per key.</p>
        <table className="ui-table w-full text-xs">
          <tbody>
            {[
              ['GET', '/ping', '—', 'Check the key'],
              ['GET', '/employees', 'employees:read', 'Everyone, with their Reader ID'],
              ['GET', '/attendance/days?from=YYYY-MM-DD&to=YYYY-MM-DD', 'attendance:read', 'Each person’s days: in, out, worked, late, overtime, status'],
              ['GET', '/attendance/punches?from=…&to=…', 'attendance:read', 'Every punch as received'],
              ['GET', '/attendance/summary?month=YYYY-MM', 'attendance:read', 'Payable and loss-of-pay days'],
              ['POST', '/attendance/punches', 'punches:write', 'Up to 500 punches: { "punches": [{ "employee_code", "timestamp": "YYYY-MM-DD HH:mm:ss", "direction": "in" | "out" }] }'],
            ].map(([m, path, scope, what]) => (
              <tr key={path}>
                <td className="font-mono">{m}</td>
                <td className="font-mono">{path}</td>
                <td className="font-mono ui-col-meta">{scope}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="overflow-x-auto rounded bg-[rgb(var(--surface-sunken))] p-3 text-xs">{`curl -H "Authorization: Bearer clor_…" "${base}/attendance/days?from=2026-10-01&to=2026-10-31"`}</pre>
      </section>
    </div>
  );
}
