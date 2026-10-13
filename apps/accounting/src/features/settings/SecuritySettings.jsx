import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Monitor, Plus, Save, Shield, Trash2 } from 'lucide-react';

import {
  changePassword,
  createProvider,
  deleteProvider,
  getAuthEvents,
  getMySessions,
  getPolicy,
  getProviders,
  revokeMySessions,
  savePolicy,
} from '../../api/security';
import { EmptyState, Spinner, StatusPill, SkeletonCard } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from './SettingsScreenHeader';

const TABS = [
  { key: 'signin', label: 'Sign-in methods' },
  { key: 'policy', label: 'Policy' },
  { key: 'devices', label: 'My account' },
  { key: 'log', label: 'Activity' },
];

const blankProvider = {
  kind: 'OIDC',
  name: '',
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  discoveryUrl: '',
  scopes: 'openid email profile',
  entryPoint: '',
  entityId: '',
  certificate: '',
  emailDomains: '',
  autoProvision: false,
};

/** Security administration: sign-in methods, policy, own devices, activity. */
export const SecuritySettings = () => {
  const [tab, setTab] = useState('signin');

  const [policy, setPolicy] = useState(null);
  const [policyBaseline, setPolicyBaseline] = useState(null);
  const [providers, setProviders] = useState([]);
  const [localMethod, setLocalMethod] = useState(null);
  const [draft, setDraft] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadProviders = () =>
    getProviders().then((d) => {
      setProviders(d?.providers || []);
      setLocalMethod(d?.local || null);
    });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPolicy(), loadProviders()])
      .then(([p]) => {
        if (cancelled) return;
        setPolicy(p?.policy || null);
        setPolicyBaseline(p?.policy || null);
      })
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab === 'devices') getMySessions().then((d) => setSessions(d?.sessions || [])).catch(() => {});
    if (tab === 'log') getAuthEvents().then((d) => setEvents(d?.events || [])).catch(() => {});
  }, [tab]);

  const policyDirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(policyBaseline),
    [policy, policyBaseline]
  );

  const run = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const r = await fn();
      if (note) setNotice(typeof note === 'function' ? note(r) : note);
      return r;
    } catch (e) {
      setError(String(e?.message || e));
      return null;
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <SkeletonCard lines={4} />
    );
  }

  const setPolicyField = (patch) => setPolicy((p) => ({ ...p, ...patch }));

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Security"
              actions={
          notice ? (
            <span className="ui-pill ui-pill-pos" role="status">
              <Check size={11} aria-hidden="true" /> {notice}
            </span>
          ) : null
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`ui-btn ${tab === t.key ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'signin' ? (
        <div className="space-y-3">
          <div className="ui-card p-4 flex items-start gap-3">
            <KeyRound size={16} className="ui-subtle mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="ui-title text-sm">{localMethod?.name || 'Email and password'}</span>
                <span className="ui-pill ui-pill-pos">Active</span>
              </div>
              <div className="ui-muted text-xs mt-0.5">
                Always available. Password rules and lockout are set on the Policy tab.
              </div>
            </div>
          </div>

          {providers.map((p) => (
            <div key={p.id} className="ui-card p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="ui-title text-sm">{p.name}</span>
                  <span className="ui-pill ui-pill-neutral">{p.kind}</span>
                  <span className="ui-pill ui-pill-warn">Configured, not yet active</span>
                </div>
                <div className="ui-muted text-xs mt-0.5">
                  {p.kind === 'OIDC' ? p.issuer || p.discoveryUrl : p.entryPoint}
                  {p.emailDomains ? ` · ${p.emailDomains}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() =>
                  run('del', async () => {
                    await deleteProvider(p.id);
                    await loadProviders();
                  }, 'Removed')
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}

          {draft ? (
            <div className="ui-card p-4 space-y-3">
              <div className="ui-title text-sm">New sign-in method</div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="ui-label" htmlFor="p-kind">Type</label>
                  <select
                    id="p-kind"
                    className="ui-select"
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  >
                    <option value="OIDC">OpenID Connect (Google, Microsoft, Okta)</option>
                    <option value="SAML">SAML 2.0 (Azure AD, ADFS, Okta)</option>
                  </select>
                </div>
                <div>
                  <label className="ui-label" htmlFor="p-name">Display name</label>
                  <input
                    id="p-name"
                    className="ui-input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Sign in with Microsoft"
                  />
                </div>

                {draft.kind === 'OIDC' ? (
                  <>
                    <div className="sm:col-span-2">
                      <label className="ui-label" htmlFor="p-disc">Discovery URL</label>
                      <input
                        id="p-disc"
                        className="ui-input"
                        value={draft.discoveryUrl}
                        onChange={(e) => setDraft({ ...draft, discoveryUrl: e.target.value })}
                        placeholder="https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration"
                      />
                    </div>
                    <div>
                      <label className="ui-label" htmlFor="p-client">Client ID</label>
                      <input
                        id="p-client"
                        className="ui-input"
                        value={draft.clientId}
                        onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="ui-label" htmlFor="p-secret">Client secret</label>
                      <input
                        id="p-secret"
                        type="password"
                        className="ui-input"
                        value={draft.clientSecret}
                        onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })}
                        autoComplete="new-password"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sm:col-span-2">
                      <label className="ui-label" htmlFor="p-entry">Sign-in URL</label>
                      <input
                        id="p-entry"
                        className="ui-input"
                        value={draft.entryPoint}
                        onChange={(e) => setDraft({ ...draft, entryPoint: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="ui-label" htmlFor="p-entity">Entity ID</label>
                      <input
                        id="p-entity"
                        className="ui-input"
                        value={draft.entityId}
                        onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="ui-label" htmlFor="p-cert">Signing certificate</label>
                      <textarea
                        id="p-cert"
                        className="ui-input"
                        rows={3}
                        value={draft.certificate}
                        onChange={(e) => setDraft({ ...draft, certificate: e.target.value })}
                        placeholder="-----BEGIN CERTIFICATE-----"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="ui-label" htmlFor="p-domains">Restrict to email domains</label>
                  <input
                    id="p-domains"
                    className="ui-input"
                    value={draft.emailDomains}
                    onChange={(e) => setDraft({ ...draft, emailDomains: e.target.value })}
                    placeholder="yourcompany.com"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={draft.autoProvision}
                      onChange={(e) => setDraft({ ...draft, autoProvision: e.target.checked })}
                    />
                    <span className="text-sm">Create users on first sign-in</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  disabled={busy === 'provider'}
                  onClick={() =>
                    run(
                      'provider',
                      async () => {
                        await createProvider(draft);
                        await loadProviders();
                        setDraft(null);
                      },
                      'Sign-in method saved'
                    )
                  }
                >
                  {busy === 'provider' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save
                </button>
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setDraft({ ...blankProvider })}>
              <Plus size={16} aria-hidden="true" /> Add a sign-in method
            </button>
          )}

          <p className="ui-subtle text-xs">
            Single sign-on can be configured here, but the sign-in handshake itself is not built yet, so a saved
            provider cannot authenticate anyone. It is stored so the details are ready when that ships.
          </p>
        </div>
      ) : null}

      {tab === 'policy' && policy ? (
        <div className="ui-card p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'maxFailedLogins', label: 'Failed attempts before lockout', min: 3, max: 50 },
              { key: 'lockoutMinutes', label: 'Lockout duration (minutes)', min: 1, max: 1440 },
              { key: 'sessionDays', label: 'Stay signed in for (days)', min: 1, max: 365 },
              { key: 'accessTokenMinutes', label: 'Access token lifetime (minutes)', min: 5, max: 1440 },
              { key: 'passwordMinLength', label: 'Minimum password length', min: 8, max: 64 },
            ].map((f) => (
              <div key={f.key}>
                <label className="ui-label" htmlFor={`pol-${f.key}`}>
                  {f.label}
                </label>
                <input
                  id={`pol-${f.key}`}
                  type="number"
                  className="ui-input"
                  min={f.min}
                  max={f.max}
                  value={policy[f.key]}
                  onChange={(e) => setPolicyField({ [f.key]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div>
              <label className="ui-label" htmlFor="pol-domains">
                Restrict new users to domains
              </label>
              <input
                id="pol-domains"
                className="ui-input"
                value={policy.allowedEmailDomains || ''}
                onChange={(e) => setPolicyField({ allowedEmailDomains: e.target.value })}
                placeholder="yourcompany.com, group.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            {[
              { key: 'passwordRequireMixedCase', label: 'Password must mix upper and lower case' },
              { key: 'passwordRequireNumber', label: 'Password must contain a number' },
              { key: 'passwordRequireSymbol', label: 'Password must contain a symbol' },
              { key: 'requireVerifiedEmail', label: 'Require a confirmed email address' },
            ].map((f) => (
              <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(policy[f.key])}
                  onChange={(e) => setPolicyField({ [f.key]: e.target.checked })}
                />
                <span className="text-sm">{f.label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!policyDirty || busy === 'policy'}
              onClick={() =>
                run(
                  'policy',
                  async () => {
                    const r = await savePolicy(policy);
                    setPolicyBaseline(r?.policy || policy);
                  },
                  'Policy saved'
                )
              }
            >
              {busy === 'policy' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save policy
            </button>
            {policyDirty ? <span className="ui-pill ui-pill-warn">Unsaved changes</span> : null}
          </div>
        </div>
      ) : null}

      {tab === 'devices' ? (
        <div className="space-y-3">
          <div className="ui-card p-4 space-y-3">
            <div className="ui-title text-sm">Change your password</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="password"
                className="ui-input"
                placeholder="Current password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
              <input
                type="password"
                className="ui-input"
                placeholder="New password"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                autoComplete="new-password"
              />
              <input
                type="password"
                className="ui-input"
                placeholder="Confirm new password"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                autoComplete="new-password"
              />
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!pw.current || !pw.next || busy === 'pw'}
              onClick={() => {
                if (pw.next !== pw.confirm) {
                  setError('The new passwords do not match');
                  return;
                }
                run(
                  'pw',
                  async () => {
                    await changePassword(pw.current, pw.next);
                    setPw({ current: '', next: '', confirm: '' });
                  },
                  'Password changed — other devices were signed out'
                );
              }}
            >
              {busy === 'pw' ? <Spinner /> : <KeyRound size={16} aria-hidden="true" />} Change password
            </button>
          </div>

          <div className="ui-card overflow-hidden">
            <div
              className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgb(var(--border))' }}
            >
              <span className="ui-title text-sm">Signed-in devices</span>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() =>
                  run(
                    'revoke',
                    async () => {
                      await revokeMySessions();
                      setSessions([]);
                    },
                    'All other devices signed out'
                  )
                }
              >
                Sign out everywhere
              </button>
            </div>
            {sessions.length === 0 ? (
              <EmptyState icon={Monitor} title="No active sessions" description="Nothing to show." />
            ) : (
              <div className="overflow-x-auto">
                <table className="ui-table ui-table-wide">
                  <thead>
                    <tr>
                      <th scope="col">Device</th>
                      <th scope="col">IP</th>
                      <th scope="col">Signed in</th>
                      <th scope="col">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="ui-col-meta max-w-md truncate">{s.userAgent || 'Unknown device'}</td>
                        <td className="ui-col-meta ui-mono text-xs">{s.ip || '—'}</td>
                        <td className="ui-col-date">{new Date(s.createdAt).toLocaleString()}</td>
                        <td className="ui-col-date">{new Date(s.lastSeenAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'log' ? (
        <div className="ui-card overflow-hidden">
          {events.length === 0 ? (
            <EmptyState icon={Shield} title="Nothing recorded yet" description="Sign-in activity will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Who</th>
                    <th scope="col">IP</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="ui-col-date">{new Date(e.createdAt).toLocaleString()}</td>
                      <td>
                        <StatusPill
                          status={
                            /FAILED|LOCKED/.test(e.eventType)
                              ? 'Failed'
                              : /SUCCESS|VERIFIED|CHANGED/.test(e.eventType)
                              ? 'Paid'
                              : e.eventType
                          }
                        />
                        <span className="ui-mono text-xs ml-2">{e.eventType}</span>
                      </td>
                      <td className="ui-col-meta">{e.userName || e.userEmail || '—'}</td>
                      <td className="ui-col-meta ui-mono text-xs">{e.ip || '—'}</td>
                      <td className="ui-col-meta ui-muted text-xs">{e.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default SecuritySettings;
