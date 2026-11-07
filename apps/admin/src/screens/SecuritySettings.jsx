import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, KeyRound, LogOut, Save } from 'lucide-react';

import {
  changePassword,
  getAuthEvents,
  getMySessions,
  getPolicy,
  getProviders,
  revokeMySessions,
  savePolicy,
} from '@platform/admin/security';
import AuthenticatorCard from '@ui/profile/AuthenticatorCard';
import { ICON, PageHead, Panel, ago, device } from './wsKit';
import './workspace.css';

/**
 * Workspace → Security → Sign-in and sessions (redesign W-R7).
 *
 * The company's sign-in rules on the left, saved by the one primary action;
 * the sign-in methods in force, the administrator's own sessions and password
 * on the right; the sign-in log underneath. Providers are added and removed
 * under Single sign-on, which owns them — this page lists them.
 */
const NUMBERS = [
  { key: 'maxFailedLogins', label: 'Failed attempts before lockout', min: 3, max: 50 },
  { key: 'lockoutMinutes', label: 'Lockout duration (minutes)', min: 1, max: 1440 },
  { key: 'sessionDays', label: 'Stay signed in for (days)', min: 1, max: 30 },
  { key: 'accessTokenMinutes', label: 'Access token lifetime (minutes)', min: 5, max: 1440 },
];
const PASSWORD_RULES = [
  { key: 'passwordRequireMixedCase', label: 'Mix upper and lower case' },
  { key: 'passwordRequireNumber', label: 'Contain a number' },
  { key: 'passwordRequireSymbol', label: 'Contain a symbol' },
];
const GATES = [
  { key: 'requireVerifiedEmail', label: 'Require a confirmed email address' },
  { key: 'requireAdminTwoFactor', label: 'Owners and admins need an authenticator app' },
  { key: 'requirePayrollStepUp', label: 'Ask for an authenticator code before approving payments and pay runs' },
];
const EMPTY_PW = { current: '', next: '', confirm: '' };
const people = (n) => (n === 1 ? '1 person' : `${n} people`);
/* Who the saved rules now keep out (#4), said once rather than discovered by them. */
const savedNote = (keptOut) => {
  const parts = ['Sign-in rules saved.'];
  if (keptOut?.unconfirmed) parts.push(`${people(keptOut.unconfirmed)} must confirm their email before they can open this company.`);
  if (keptOut?.outsideDomains) parts.push(`${people(keptOut.outsideDomains)} with an address outside the allowed domains can no longer open it.`);
  return parts.join(' ');
};
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const eventTone = (t) => (/SUCCESS|VERIFIED|CHANGED/.test(t) ? 'ws-pill ws-pill--ok' : 'ws-pill');
/* No danger pill in the kit yet: a failure or lockout borrows the Workspace danger tokens. */
const DANGER = { color: 'rgb(var(--ws-danger))', background: 'rgb(var(--ws-danger-soft))' };
const eventWords = (t) => String(t || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Check({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer text-sm" style={{ lineHeight: 1.45 }}>
      <input type="checkbox" className="ui-checkbox mt-0.5" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

export const SecuritySettings = ({ openScreen }) => {
  const [policy, setPolicy] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [methods, setMethods] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [events, setEvents] = useState(null);
  const [pw, setPw] = useState(EMPTY_PW);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    getPolicy()
      .then((p) => {
        if (cancelled) return;
        setPolicy(p?.policy || null);
        setBaseline(p?.policy || null);
      })
      .catch((e) => !cancelled && setError(String(e?.message || e)));
    getProviders().then((d) => !cancelled && setMethods(d)).catch(() => !cancelled && setMethods({ providers: [] }));
    getMySessions().then((d) => !cancelled && setSessions(d?.sessions || [])).catch(() => !cancelled && setSessions([]));
    getAuthEvents().then((d) => !cancelled && setEvents(d?.events || [])).catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(policy) !== JSON.stringify(baseline), [policy, baseline]);
  const setField = (patch) => setPolicy((p) => ({ ...p, ...patch }));

  const run = async (key, fn, note) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const said = await fn();
      if (said || note) setNotice(said || note);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };

  const save = (e) => {
    e.preventDefault();
    run('policy', async () => {
      const r = await savePolicy(policy);
      setBaseline(r?.policy || policy);
      return savedNote(r?.keptOut);
    }, 'Sign-in rules saved.');
  };

  const changePw = () => {
    if (pw.next !== pw.confirm) {
      setError('The new passwords do not match');
      return;
    }
    run('pw', async () => {
      await changePassword(pw.current, pw.next);
      setPw(EMPTY_PW);
    }, 'Password changed — other devices were signed out.');
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Sign-in and sessions']}
          title="Sign-in and sessions"
          meta={dirty ? 'Unsaved changes' : notice || null}
          actions={
            policy ? (
              <button type="submit" form="security-policy" className="ws-btn ws-btn--primary" disabled={!dirty || busy === 'policy'}>
                <Save size={16} aria-hidden="true" /> {busy === 'policy' ? 'Saving…' : 'Save rules'}
              </button>
            ) : null
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {notice && !dirty ? <p role="status" className="sr-only">{notice}</p> : null}

        <div className="ws-layout">
          {!policy ? (
            <p className="ws-card-blurb">{error ? '' : 'Loading the sign-in rules…'}</p>
          ) : (
            <form id="security-policy" onSubmit={save} className="grid gap-5 min-w-0">
              <Panel title="Lockout and sessions">
                <div className="grid gap-4 sm:grid-cols-2">
                  {NUMBERS.map((f) => (
                    <label key={f.key} className="grid gap-1">
                      <span className="text-sm font-medium">{f.label}</span>
                      <input type="number" className="ui-input" min={f.min} max={f.max} value={policy[f.key]} onChange={(e) => setField({ [f.key]: Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
              </Panel>

              <Panel title="Passwords">
                <label className="grid gap-1" style={{ maxWidth: 260 }}>
                  <span className="text-sm font-medium">Minimum length</span>
                  <input type="number" className="ui-input" min={8} max={64} value={policy.passwordMinLength} onChange={(e) => setField({ passwordMinLength: Number(e.target.value) })} />
                </label>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium mb-1">A password must</legend>
                  {PASSWORD_RULES.map((f) => (
                    <Check key={f.key} checked={Boolean(policy[f.key])} onChange={(e) => setField({ [f.key]: e.target.checked })}>{f.label}</Check>
                  ))}
                </fieldset>
              </Panel>

              <Panel title="Who may sign in">
                <label className="grid gap-1">
                  <span className="text-sm font-medium">Allowed email domains</span>
                  <input className="ui-input" value={policy.allowedEmailDomains || ''} onChange={(e) => setField({ allowedEmailDomains: e.target.value })} placeholder="yourcompany.com, group.com" />
                  <span className="ui-caption">Only addresses at these domains can be invited, added or open this company. Blank: any address.</span>
                </label>
                <div className="grid gap-2">
                  {GATES.map((f) => (
                    <Check key={f.key} checked={Boolean(policy[f.key])} onChange={(e) => setField({ [f.key]: e.target.checked })}>{f.label}</Check>
                  ))}
                </div>
              </Panel>

              {/* A-13: separation of duties. Approving something about yourself is never allowed, whatever this says. */}
              <Panel title="Approving your own work">
                <label className="grid gap-1">
                  <span className="sr-only">Who may approve their own work</span>
                  <select id="policy-maker-checker" className="ui-select" value={policy.makerChecker || 'AUTO'} onChange={(e) => setField({ makerChecker: e.target.value })} aria-label="Who may approve their own work">
                    <option value="AUTO">Somebody else, whenever somebody else can (recommended)</option>
                    <option value="STRICT">Always a second person</option>
                    <option value="ALLOW">The same person may prepare and approve</option>
                  </select>
                </label>
                <p className="ws-card-blurb">
                  Pay runs, salary revisions, adjustments, tax declarations, bank changes and leave. With the first choice a company with one administrator can still run payroll;
                  every approval of one&rsquo;s own work is written to the audit trail. Nobody ever approves their own salary, bank account or tax declaration.
                </p>
              </Panel>
            </form>
          )}

          <aside className="ws-side">
            <Panel
              title="Sign-in methods"
              action={openScreen ? <button type="button" className="ws-link" onClick={() => openScreen('sso')}>Single sign-on <ChevronRight size={16} aria-hidden="true" /></button> : null}
            >
              <ul className="ws-list">
                <li>
                  <div className="ws-item">
                    <span className="ws-tile ws-tile--sm" aria-hidden="true"><KeyRound size={14} /></span>
                    <span className="ws-item-text">
                      <span className="ws-item-title">{methods?.local?.name || 'Email and password'}</span>
                      <span className="ws-item-sub">Always available</span>
                    </span>
                    <span className="ws-pill ws-pill--ok">Active</span>
                  </div>
                </li>
                {(methods?.providers || []).map((p) => (
                  <li key={p.id}>
                    <div className="ws-item">
                      <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.secure size={14} /></span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{p.name}</span>
                        <span className="ws-item-sub">{p.kind}{p.emailDomains ? ` · ${p.emailDomains}` : ''}</span>
                      </span>
                      <span className={p.enabled ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--off'}>{p.enabled ? 'On' : 'Off'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              title="Your sessions"
              action={
                <button
                  type="button"
                  className="ws-btn ws-btn--quiet ws-btn--small"
                  disabled={busy === 'revoke'}
                  onClick={() => run('revoke', async () => {
                    await revokeMySessions();
                    setSessions([]);
                  }, 'All other devices signed out.')}
                >
                  <LogOut size={14} aria-hidden="true" /> Sign out everywhere
                </button>
              }
            >
              {sessions === null ? (
                <p className="ws-card-blurb">Loading…</p>
              ) : sessions.length ? (
                <ul className="ws-list">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <div className="ws-item">
                        <span className="ws-item-text">
                          <span className="ws-item-title truncate" title={s.userAgent || ''}>{device(s.userAgent)}</span>
                          <span className="ws-item-sub">{s.ip || 'No address'} · signed in {stamp(s.createdAt)}</span>
                        </span>
                        <span className="ws-item-end">{ago(s.lastSeenAt || s.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-blurb">No other active sessions.</p>
              )}
            </Panel>

            <Panel title="Your password">
              <div className="grid gap-2">
                <input type="password" className="ui-input" aria-label="Current password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
                <input type="password" className="ui-input" aria-label="New password" placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
                <input type="password" className="ui-input" aria-label="Confirm new password" placeholder="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
              </div>
              <div>
                <button type="button" className="ws-btn ws-btn--quiet" disabled={!pw.current || !pw.next || busy === 'pw'} onClick={changePw}>
                  <KeyRound size={16} aria-hidden="true" /> {busy === 'pw' ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </Panel>

            {/* Its own card: the authenticator set-up carries its own surface. */}
            <AuthenticatorCard />
          </aside>
        </div>

        <section className="grid gap-3" aria-labelledby="ws-signin-log">
          <div className="ws-panel-head">
            <h2 id="ws-signin-log" className="ws-panel-title">Sign-in activity</h2>
            {events?.length ? <span className="ws-head-meta">{events.length} recent</span> : null}
          </div>
          {events === null ? (
            <p className="ws-card-blurb">Loading…</p>
          ) : events.length ? (
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Recent sign-in activity</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Who</th>
                    <th scope="col">Address</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{stamp(e.createdAt)}</td>
                      <td><span className={eventTone(e.eventType)} style={/FAILED|LOCKED/.test(e.eventType) ? DANGER : undefined}>{eventWords(e.eventType)}</span></td>
                      <td>{e.userName || e.userEmail || '—'}</td>
                      <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{e.ip || '—'}</td>
                      <td className="ws-head-meta" style={{ whiteSpace: 'normal' }}>{e.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ws-setup"><p className="ws-card-blurb">No sign-ins yet.</p></div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SecuritySettings;
