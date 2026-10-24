import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';

import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { orgId as platformOrgId, requestOpenApp } from '@platform/context';
import { STATUS as CREDENTIAL_STATUS } from './credentialsModel';
import { createProvider, createScimToken, deleteProvider, getProviders, getScim, revokeScimToken, updateProvider, verifyProviderDomains } from '@platform/admin/security';
import { listRoles } from '@platform/admin/admin';
import { ICON, PageHead, Panel } from './wsKit';
import './workspace.css';

/**
 * Workspace → Security → Single sign-on (redesign W-R7).
 *
 * An OpenID Connect provider (Google Workspace, Microsoft Entra, Okta,
 * Keycloak…) is configured here; from then on an e-mail at one of the domains
 * named is offered "Continue with <provider>" on the sign-in screen, and the
 * API runs the code flow (server/src/routes/sso.ts). The provider says who
 * somebody is; roles and company access stay here. SAML 2.0 providers go the
 * same way: CLOR is the service provider, with its reply URL and identifier
 * shown on the row for the administrator to enter at the provider. Directory
 * sync (SCIM) tokens are made here and managed with every other credential.
 */
const EMPTY = { kind: 'OIDC', name: '', discoveryUrl: '', issuer: '', clientId: '', clientSecret: '', scopes: 'openid email profile', emailDomains: '', autoProvision: true, defaultRoleId: '', enabled: false };

/* A provider's state in words; "Stored" is configured but never switched on. */
const STATUS = {
  ACTIVE: ['Active', 'ws-pill ws-pill--ok'],
  DISABLED: ['Switched off', 'ws-pill ws-pill--off'],
  CONFIGURED_NOT_ACTIVE: ['Stored', 'ws-pill'],
};
const CRED_TONE = { 'ui-pill-pos': 'ws-pill ws-pill--ok', 'ui-pill-neutral': 'ws-pill ws-pill--off', 'ui-pill-warn': 'ws-pill' };
/* `.ws` outside the page: its tokens without its page padding and ground. */
const DRAWER_WS = { padding: 0, background: 'none', minHeight: 0 };
const day = (d) => new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' });
const stamp = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function Field({ label, hint, wide, children }) {
  return (
    <label className={`grid gap-1 ${wide ? 'md:col-span-2' : ''}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </label>
  );
}

function Address({ label, value }) {
  return (
    <div className="grid gap-1">
      <span className="ws-stat-note">{label}</span>
      <code className="ui-mono text-sm break-all">{value}</code>
    </div>
  );
}

export default function SsoSettings() {
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scim, setScim] = useState(null);
  const [scimRole, setScimRole] = useState('');
  const [newToken, setNewToken] = useState('');

  const load = useCallback(() => getProviders().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load sign-in methods.'))), []);
  const loadScim = useCallback(() => getScim().then(setScim).catch(() => setScim({ baseUrl: '', tokens: [] })), []);
  useEffect(() => {
    load();
    loadScim();
    listRoles(platformOrgId()).then((r) => setRoles(r?.roles || r || [])).catch(() => {});
  }, [load, loadScim]);

  const makeToken = async () => {
    try {
      const r = await createScimToken(scimRole || null);
      setNewToken(r.token);
      loadScim();
    } catch (err) {
      notify.error(String(err?.message || 'Not made.'));
    }
  };
  const revoke = async (t) => {
    if (!(await confirmDialog({ title: 'Revoke this token?', message: 'The identity provider using it stops being able to add or remove people at once.', confirmLabel: 'Revoke' }))) return;
    await revokeScimToken(t.id).catch((err) => notify.error(String(err?.message || 'Not revoked.')));
    loadScim();
  };
  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(newToken);
      notify.success('Copied.');
    } catch {
      notify.error('Could not copy — select it and copy by hand.');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, defaultRoleId: form.defaultRoleId || null, clientSecret: form.clientSecret === '' && form.id ? undefined : form.clientSecret };
      if (form.id) await updateProvider(form.id, body);
      else await createProvider(body);
      notify.success(form.id ? 'Saved.' : 'Added. Publish the DNS TXT record shown on its row, choose Verify domains, then switch it on.');
      setForm(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (p) => {
    try {
      await updateProvider(p.id, { kind: p.kind, name: p.name, discoveryUrl: p.discoveryUrl, issuer: p.issuer, clientId: p.clientId, scopes: p.scopes, emailDomains: p.emailDomains, autoProvision: p.autoProvision, defaultRoleId: p.defaultRoleId, entryPoint: p.entryPoint, entityId: p.entityId, enabled: !p.enabled });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not changed.'));
    }
  };
  const verify = async (p) => {
    try {
      const r = await verifyProviderDomains(p.id);
      const missing = (r.results || []).filter((x) => !x.verified);
      if (missing.length) notify.error(`Not verified yet: ${missing.map((x) => `${x.domain} (${x.reason})`).join(', ')}. DNS changes can take a while to appear.`);
      else notify.success('All domains verified. You can switch it on.');
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Could not check.'));
    }
  };
  const remove = async (p) => {
    if (!(await confirmDialog({ title: `Remove ${p.name}?`, message: 'People at its domains go back to passwords. Nobody is signed out.', confirmLabel: 'Remove' }))) return;
    await deleteProvider(p.id).catch((err) => notify.error(String(err?.message || 'Not removed.')));
    load();
  };
  const edit = (p) => setForm({ ...EMPTY, ...p, clientSecret: '', defaultRoleId: p.defaultRoleId || '', emailDomains: p.emailDomains || '', discoveryUrl: p.discoveryUrl || '', issuer: p.issuer || '', scopes: p.scopes || EMPTY.scopes });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Single sign-on']}
          title="Single sign-on"
          description="Let people at your domain sign in through your identity provider. Roles and company access stay here."
          actions={
            data ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setForm({ ...EMPTY })}>
                <Plus size={16} aria-hidden="true" /> Add a provider
              </button>
            ) : null
          }
        />

        {!data ? (
          <p className="ws-card-blurb">Loading sign-in methods…</p>
        ) : (
          <div className="ws-layout">
            <div className="grid gap-5 min-w-0">
              <Panel title="Sign-in methods" action={<span className="ws-head-meta">{data.providers.length + 1} in all</span>}>
                <ul className="ws-list" aria-label="Sign-in methods">
                  <li>
                    <div className="ws-item">
                      <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.person size={14} /></span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{data.local.name}</span>
                        <span className="ws-item-sub">Always on. Everyone can use it unless a provider owns their domain.</span>
                      </span>
                      <span className="ws-pill ws-pill--ok">Active</span>
                    </div>
                  </li>
                  {data.providers.map((p) => {
                    const [label, pill] = STATUS[p.status] || [p.status, 'ws-pill'];
                    const unverified = p.domainVerification?.domains?.some((d) => !d.verified);
                    return (
                      <li key={p.id}>
                        <div className="grid gap-2" style={{ padding: '12px 0' }}>
                          <div className="ws-item" style={{ padding: 0 }}>
                            <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.secure size={14} /></span>
                            <span className="ws-item-text">
                              <span className="ws-item-title">{p.name} <span className="ws-head-meta">· {p.kind}</span></span>
                              <span className="ws-item-sub">
                                {p.emailDomains ? `Domains: ${p.emailDomains}` : 'No domains named — nobody is offered it'}
                                {p.autoProvision ? ' · new people are added automatically' : ''}
                                {p.lastUsedAt ? ` · last used ${stamp(p.lastUsedAt)}` : ''}
                              </span>
                            </span>
                            <span className={pill}>{label}</span>
                          </div>
                          <div className="grid gap-1" style={{ paddingLeft: 44 }}>
                            {p.lastError ? <p className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>Last problem: {p.lastError}</p> : null}
                            {p.domainVerification?.domains?.length ? (
                              <p className="ui-caption">Domains: {p.domainVerification.domains.map((d) => `${d.domain} ${d.verified ? '✓ verified' : '— not verified'}`).join(' · ')}</p>
                            ) : null}
                            {unverified && p.domainVerification.record ? (
                              <p className="ui-caption">
                                Prove you own them: add a DNS TXT record on each domain with the value <code className="ui-mono break-all">{p.domainVerification.record}</code>, then choose Verify. It cannot be switched on until every domain is verified.
                              </p>
                            ) : null}
                            {p.saml ? (
                              <p className="ui-caption">
                                At the provider: Reply URL / ACS <code className="ui-mono break-all">{p.saml.acsUrl}</code> · Identifier / Audience <code className="ui-mono break-all">{p.saml.spEntityId}</code> · metadata at the same address as the identifier. NameID as e-mail.
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-2 mt-1">
                              {unverified ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => verify(p)}>Verify domains</button> : null}
                              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => toggle(p)}>{p.enabled ? 'Switch off' : 'Switch on'}</button>
                              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => edit(p)}>Edit</button>
                              <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><Trash2 size={14} aria-hidden="true" /> Remove</button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <Panel title="Directory sync (SCIM 2.0)" action={<a className="ws-link" href="/docs/scim" target="_blank" rel="noreferrer">Guide</a>}>
                <p className="ws-card-blurb" style={{ marginTop: -6 }}>
                  Let Microsoft Entra, Okta, JumpCloud or Google add, update and remove people here automatically. Roles stay in CLOR; groups are not synced.
                </p>
                {scim?.baseUrl ? <Address label="Tenant URL to give the provider" value={scim.baseUrl} /> : null}
                {newToken ? (
                  <div className="grid gap-2" role="status" style={{ padding: 12, borderRadius: 8, background: 'rgb(var(--ws-warn-soft))' }}>
                    <span className="text-sm font-semibold">Secret token — shown once</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="ui-mono text-sm break-all min-w-0 flex-1">{newToken}</code>
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={copyToken}><Copy size={14} aria-hidden="true" /> Copy</button>
                    </div>
                    <span className="ui-caption">Paste it as the provider’s “Secret token” along with the tenant URL, then test the connection there.</span>
                  </div>
                ) : null}
                {(scim?.tokens || []).length ? (
                  <ul className="ws-list">
                    {scim.tokens.map((t) => {
                      const [word, tone, why] = CREDENTIAL_STATUS[t.status] || CREDENTIAL_STATUS.OWNER_OFF;
                      return (
                        <li key={t.id}>
                          <div className="ws-item">
                            <span className="ws-item-text">
                              <span className="ws-item-title"><code className="ui-mono">{t.tokenPrefix}…</code>{t.agent ? ` · for connector ${t.agent.name}` : ''}</span>
                              <span className="ws-item-sub">
                                Made {day(t.createdAt)}{t.lastUsedAt ? ` · last used ${stamp(t.lastUsedAt)}` : ' · not used yet'} · {t.expiresAt ? `expires ${day(t.expiresAt)}` : 'does not expire'}{t.defaultRoleId ? ` · role: ${roles.find((r) => r.id === t.defaultRoleId)?.name || 'set'}` : ''}
                                {why ? ` · ${why}` : ''}
                              </span>
                            </span>
                            <span className={CRED_TONE[tone] || 'ws-pill'}>{word}</span>
                          </div>
                          <div className="flex flex-wrap gap-2" style={{ paddingBottom: 10 }}>
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => requestOpenApp('admin', 'credentials')}>Manage in Credentials</button>
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => revoke(t)}>Revoke</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid gap-1">
                    <span className="text-sm font-medium">Role for people the provider adds</span>
                    <select className="ui-select" value={scimRole} onChange={(e) => setScimRole(e.target.value)}>
                      <option value="">No role (view nothing until assigned)</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="ws-btn ws-btn--quiet" onClick={makeToken}>Make a token</button>
                </div>
              </Panel>
            </div>

            <aside className="ws-side">
              <Panel title="At your provider">
                <Address label="Redirect address to register" value={data.redirectUri} />
                <p className="ws-card-blurb">
                  Google Workspace, Microsoft Entra, Okta and Keycloak all take this as the “authorised redirect URI” of a web application. Scopes needed: openid, email, profile.
                </p>
                <a className="ws-link" href="/docs/sso" target="_blank" rel="noreferrer">Set-up guide</a>
              </Panel>
              <Panel title="How it is trusted">
                <p className="ws-card-blurb">
                  The provider vouches for the e-mail; this company vouches for the person. A sign-in is accepted only for a verified e-mail at a domain named on a provider, and only for an existing user — or a new one when “add automatically” is on. Passwords keep working alongside; switch the provider off to fall back at any time.
                </p>
              </Panel>
            </aside>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit ${form.name || 'provider'}` : 'Add a provider'}
        description="The provider proves who someone is; roles and company access stay in CLOR."
      >
        {/* The drawer is portalled out of the page, so it carries the Workspace tokens with it. */}
        {form ? (
          <div className="ws" style={DRAWER_WS}>
            <form onSubmit={save} className="grid gap-4" aria-label={form.id ? 'Edit provider' : 'New provider'}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Kind" wide>
                  <select className="ui-select w-full" value={form.kind} onChange={set('kind')} disabled={Boolean(form.id)}>
                    <option value="OIDC">OpenID Connect (Google, Microsoft, Okta, Keycloak)</option>
                    <option value="SAML">SAML 2.0 (Entra enterprise app, Okta, ADFS, Google)</option>
                  </select>
                </Field>
                <Field label="Name shown on the sign-in button" wide>
                  <input className="ui-input w-full" required maxLength={60} value={form.name} onChange={set('name')} placeholder="e.g. Google Workspace" />
                </Field>
                {form.kind === 'OIDC' ? (
                  <>
                    <Field label="Discovery URL (or issuer)" wide hint="Google: accounts.google.com · Microsoft: login.microsoftonline.com/<tenant>/v2.0 · Okta: your-org.okta.com">
                      <input className="ui-input w-full" value={form.discoveryUrl} onChange={set('discoveryUrl')} placeholder="https://accounts.google.com/.well-known/openid-configuration" />
                    </Field>
                    <Field label="Client ID">
                      <input className="ui-input w-full" required value={form.clientId} onChange={set('clientId')} />
                    </Field>
                    <Field label="Client secret">
                      <input type="password" className="ui-input w-full" value={form.clientSecret} onChange={set('clientSecret')} placeholder={form.id ? 'Leave blank to keep the stored one' : ''} autoComplete="new-password" />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="IdP sign-in URL (entry point)" wide hint="Entra: the “Login URL” of the enterprise app · Okta: the “Sign on URL” · Google: the SSO URL. After adding, the row shows CLOR’s Reply URL and Identifier to enter there.">
                      <input className="ui-input w-full" value={form.entryPoint || ''} onChange={set('entryPoint')} placeholder="https://login.microsoftonline.com/<tenant>/saml2" />
                    </Field>
                    <Field label="Entity ID" wide>
                      <input className="ui-input w-full" value={form.entityId || ''} onChange={set('entityId')} />
                    </Field>
                    <Field label="IdP certificate (PEM)" wide>
                      <textarea className="ui-input w-full" rows={3} value={form.certificate || ''} onChange={set('certificate')} />
                    </Field>
                  </>
                )}
                <Field label="E-mail domains this provider owns" wide>
                  <input className="ui-input w-full" required value={form.emailDomains} onChange={set('emailDomains')} placeholder="yourcompany.com, yourcompany.in" />
                </Field>
                <Field label="Role for people added automatically" wide>
                  <select className="ui-select w-full" value={form.defaultRoleId} onChange={set('defaultRoleId')}>
                    <option value="">No role (view nothing until assigned)</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="ui-checkbox mt-0.5" checked={form.autoProvision} onChange={set('autoProvision')} /> Add people from these domains automatically on first sign-in (otherwise they must be invited first)</label>
              {form.id ? (
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="ui-checkbox mt-0.5" checked={form.enabled} onChange={set('enabled')} /> Switched on (needs every domain verified)</label>
              ) : (
                <p className="ui-caption">It is added switched off. Verify its domains, then switch it on.</p>
              )}
              <div className="flex gap-2">
                <button type="submit" className="ws-btn ws-btn--primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save' : 'Add provider'}</button>
                <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setForm(null)}>Cancel</button>
              </div>
            </form>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
