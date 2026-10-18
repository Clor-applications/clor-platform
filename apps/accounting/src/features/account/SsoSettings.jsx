import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { orgId as platformOrgId } from '@platform/context';
import { createProvider, deleteProvider, getProviders, updateProvider } from '../../api/security';
import { listRoles } from '../../api/admin';

/**
 * Single sign-on, per company.
 *
 * An OpenID Connect provider (Google Workspace, Microsoft Entra, Okta,
 * Keycloak…) is configured here; from then on an e-mail at one of the domains
 * named is offered "Continue with <provider>" on the sign-in screen, and the
 * API runs the code flow (server/src/routes/sso.ts). The provider says who
 * somebody is; roles and company access stay here. SAML can be stored but is
 * not yet spoken, and the status says so rather than implying otherwise.
 */
const EMPTY = { kind: 'OIDC', name: '', discoveryUrl: '', issuer: '', clientId: '', clientSecret: '', scopes: 'openid email profile', emailDomains: '', autoProvision: true, defaultRoleId: '', enabled: false };

const STATUS = {
  ACTIVE: ['Active', 'ui-pill-pos'],
  DISABLED: ['Switched off', 'ui-pill-neutral'],
  CONFIGURED_NOT_ACTIVE: ['Stored — SAML sign-in not yet available', 'ui-pill-warn'],
};

export default function SsoSettings() {
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getProviders().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load sign-in methods.'))), []);
  useEffect(() => {
    load();
    listRoles(platformOrgId()).then((r) => setRoles(r?.roles || r || [])).catch(() => {});
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, defaultRoleId: form.defaultRoleId || null, clientSecret: form.clientSecret === '' && form.id ? undefined : form.clientSecret };
      if (form.id) await updateProvider(form.id, body);
      else await createProvider(body);
      notify.success(form.id ? 'Saved.' : 'Added. Register the redirect address at the provider, then switch it on.');
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
  const remove = async (p) => {
    if (!(await confirmDialog({ title: `Remove ${p.name}?`, message: 'People at its domains go back to passwords. Nobody is signed out.', confirmLabel: 'Remove' }))) return;
    await deleteProvider(p.id).catch((err) => notify.error(String(err?.message || 'Not removed.')));
    load();
  };
  const edit = (p) => setForm({ ...EMPTY, ...p, clientSecret: '', defaultRoleId: p.defaultRoleId || '', emailDomains: p.emailDomains || '', discoveryUrl: p.discoveryUrl || '', issuer: p.issuer || '', scopes: p.scopes || EMPTY.scopes });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (!data) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Single Sign-On"
        description="Let people at your domain sign in through your identity provider. Roles and company access stay here."
        actions={!form ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setForm({ ...EMPTY })}>Add a provider</button> : null}
      />

      <div className="ui-card p-4">
        <div className="flex items-start gap-3">
          <KeyRound size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="ui-label">Redirect address to register at the provider</div>
            <code className="ui-mono text-sm break-all">{data.redirectUri}</code>
            <p className="ui-caption mt-1">Google Workspace, Microsoft Entra, Okta and Keycloak all take this as the "authorised redirect URI" of a web application. Scopes needed: openid, email, profile.</p>
          </div>
        </div>
      </div>

      <section className="ui-card divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Sign-in methods">
        <div className="flex items-center justify-between gap-3 p-4">
          <div><div className="font-medium">{data.local.name}</div><div className="ui-caption">Always on. Everyone can use it unless a provider owns their domain.</div></div>
          <span className="ui-pill ui-pill-pos">Active</span>
        </div>
        {data.providers.map((p) => {
          const [label, pill] = STATUS[p.status] || [p.status, 'ui-pill-neutral'];
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium">{p.name} <span className="ui-caption font-normal">· {p.kind}</span></div>
                <div className="ui-caption">{p.emailDomains ? `Domains: ${p.emailDomains}` : 'No domains named — nobody is offered it'}{p.autoProvision ? ' · new people are added automatically' : ''}{p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</div>
                {p.lastError ? <div className="ui-caption" style={{ color: 'rgb(var(--neg))' }}>Last problem: {p.lastError}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <span className={`ui-pill ${pill}`}>{label}</span>
                {p.kind === 'OIDC' ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => toggle(p)}>{p.enabled ? 'Switch off' : 'Switch on'}</button> : null}
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => edit(p)}>Edit</button>
                <button type="button" className="ui-icon-btn" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            </div>
          );
        })}
      </section>

      {form ? (
        <form onSubmit={save} className="ui-card p-5 space-y-4" aria-label={form.id ? 'Edit provider' : 'New provider'}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="ui-label">Kind</span>
              <select className="ui-select w-full" value={form.kind} onChange={set('kind')} disabled={Boolean(form.id)}>
                <option value="OIDC">OpenID Connect (Google, Microsoft, Okta, Keycloak)</option>
                <option value="SAML">SAML 2.0 — stored now, sign-in later</option>
              </select>
            </label>
            <label className="block"><span className="ui-label">Name shown on the sign-in button</span><input className="ui-input w-full" required maxLength={60} value={form.name} onChange={set('name')} placeholder="e.g. Google Workspace" /></label>
            {form.kind === 'OIDC' ? (
              <>
                <label className="block md:col-span-2"><span className="ui-label">Discovery URL (or issuer)</span><input className="ui-input w-full" value={form.discoveryUrl} onChange={set('discoveryUrl')} placeholder="https://accounts.google.com/.well-known/openid-configuration" /><span className="ui-caption">Google: accounts.google.com · Microsoft: login.microsoftonline.com/&lt;tenant&gt;/v2.0 · Okta: your-org.okta.com</span></label>
                <label className="block"><span className="ui-label">Client ID</span><input className="ui-input w-full" required={form.kind === 'OIDC'} value={form.clientId} onChange={set('clientId')} /></label>
                <label className="block"><span className="ui-label">Client secret</span><input type="password" className="ui-input w-full" value={form.clientSecret} onChange={set('clientSecret')} placeholder={form.id ? 'Leave blank to keep the stored one' : ''} autoComplete="new-password" /></label>
              </>
            ) : (
              <>
                <label className="block md:col-span-2"><span className="ui-label">IdP sign-in URL (entry point)</span><input className="ui-input w-full" value={form.entryPoint || ''} onChange={set('entryPoint')} /></label>
                <label className="block"><span className="ui-label">Entity ID</span><input className="ui-input w-full" value={form.entityId || ''} onChange={set('entityId')} /></label>
                <label className="block md:col-span-2"><span className="ui-label">IdP certificate (PEM)</span><textarea className="ui-input w-full" rows={3} value={form.certificate || ''} onChange={set('certificate')} /></label>
              </>
            )}
            <label className="block"><span className="ui-label">E-mail domains this provider owns</span><input className="ui-input w-full" required value={form.emailDomains} onChange={set('emailDomains')} placeholder="yourcompany.com, yourcompany.in" /></label>
            <label className="block"><span className="ui-label">Role for people added automatically</span>
              <select className="ui-select w-full" value={form.defaultRoleId} onChange={set('defaultRoleId')}>
                <option value="">No role (view nothing until assigned)</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoProvision} onChange={set('autoProvision')} /> Add people from these domains automatically on first sign-in (otherwise they must be invited first)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Switched on</label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save' : 'Add provider'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="ui-card p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <p className="text-sm ui-muted max-w-2xl">The provider vouches for the e-mail; this company vouches for the person. A sign-in is accepted only for a verified e-mail at a domain named above, and only for an existing user — or a new one when "add automatically" is on. Passwords keep working alongside; switch the provider off to fall back at any time.</p>
        </div>
      </div>
    </div>
  );
}
