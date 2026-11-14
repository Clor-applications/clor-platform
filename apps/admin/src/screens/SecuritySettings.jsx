import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, KeyRound, LogOut, Save } from '@ui/components/ui/lineIcons';

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
import { ICON, PageHead, Panel, StatusPill, ago, device } from './wsKit';
import './workspace.css';
import './ws-security.css';

/**
 * Workspace → Security → Sessions (redesign W-R7; R&D WS-12).
 *
 * Your signed-in devices first, with the sign-in log; under them the company's
 * sign-in rules, saved by the one primary action.
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
const eventTone = (t) => (/FAILED|LOCKED/.test(t) ? 'danger' : /SUCCESS|VERIFIED|CHANGED/.test(t) ? 'ok' : 'neutral');
const eventWords = (t) => String(t || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** A section on the page under one hairline (no card): a title, then its body. */
function Section({ title, id, action, children }) {
  return (
    <section className="ws-sec-section" aria-labelledby={id}>
      <div className="ws-sec-section-head">
        <h2 id={id} className="ws-h2">{title}</h2>
        {action || null}
      </div>
      <div className="ws-sec-body">{children}</div>
    </section>
  );
}

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

  /* Lockouts in the recent log: said once, above the rules, so nobody has to read the table to find them. */
  const lockouts = (events || []).filter((e) => /LOCKED/.test(String(e.eventType || '')));
  const signOutOthers = () =>
    run('revoke', async () => {
      await revokeMySessions();
      /* The device in hand stays signed in; read back what is left. */
      const d = await getMySessions().catch(() => null);
      setSessions(d?.sessions || []);
    }, 'All your other devices are signed out.');

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Sessions']}
          title="Sessions"
          description="Where you are signed in, and the sign-in rules. Sign out anything you do not recognise."
          meta={dirty ? 'Unsaved changes' : notice || null}
          actions={
            <>
              <button type="button" className="ws-btn ws-btn--danger-quiet" disabled={busy === 'revoke'} onClick={signOutOthers}>
                <LogOut size={16} aria-hidden="true" /> {busy === 'revoke' ? 'Signing out…' : 'Sign out everywhere else'}
              </button>
              {policy ? (
                <button type="submit" form="security-policy" className="ws-btn ws-btn--primary" disabled={!dirty || busy === 'policy'}>
                  <Save size={16} aria-hidden="true" /> {busy === 'policy' ? 'Saving…' : 'Save rules'}
                </button>
              ) : null}
            </>
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        {notice && !dirty ? <p role="status" className="sr-only">{notice}</p> : null}

        <section className="ws-sec-section" aria-labelledby="ws-sessions-title">
          <div className="ws-sec-section-head">
            <h2 id="ws-sessions-title" className="ws-h2">Your devices</h2>
            {sessions?.length ? <span className="ws-head-meta">{sessions.length} signed in</span> : null}
          </div>
          {sessions === null ? (
            <p className="ws-card-blurb">Loading…</p>
          ) : sessions.length ? (
            <div className="ws-table-wrap">
              <table className="ws-table ws-sec-table">
                <caption className="sr-only">Your signed-in devices</caption>
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Address</th>
                    <th scope="col">Signed in</th>
                    <th scope="col" className="num">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="ws-sec-who">
                          <span title={s.userAgent || ''}>{device(s.userAgent)}</span>
                          {s.current ? <span className="ws-tag">This device</span> : null}
                        </span>
                      </td>
                      <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{s.ip || 'No address'}</td>
                      <td>{stamp(s.createdAt)}</td>
                      <td className="num">{ago(s.lastSeenAt || s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ws-card-blurb">No other active sessions.</p>
          )}
        </section>

        {lockouts.length ? (
          <div className="ws-band" data-tone="warn" role="note">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>
              <strong>{lockouts.length === 1 ? 'An account was locked' : `${lockouts.length} accounts were locked`}</strong> after failed sign-ins recently
              {lockouts[0].userEmail || lockouts[0].userName ? ` (${lockouts[0].userName || lockouts[0].userEmail}${lockouts.length > 1 ? ' and others' : ''})` : ''}. If that was not them, reset the password and sign them out in Members.
            </span>
          </div>
        ) : null}

        <section className="ws-sec-section" aria-labelledby="ws-signin-log">
          <div className="ws-sec-section-head">
            <h2 id="ws-signin-log" className="ws-h2">Sign-in activity</h2>
            {events?.length ? <span className="ws-head-meta">{events.length} recent</span> : null}
          </div>
          {events === null ? (
            <p className="ws-card-blurb">Loading…</p>
          ) : events.length ? (
            <div className="ws-table-wrap">
              <table className="ws-table ws-sec-table">
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
                      <td className="ws-sec-when">{stamp(e.createdAt)}</td>
                      <td><StatusPill tone={eventTone(e.eventType)}>{eventWords(e.eventType)}</StatusPill></td>
                      <td>{e.userName || e.userEmail || '—'}</td>
                      <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{e.ip || '—'}</td>
                      <td className="ws-sec-wrap ws-head-meta">{e.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ws-card-blurb">No sign-ins yet.</p>
          )}
        </section>

        <div className="ws-layout">
          {!policy ? (
            <p className="ws-card-blurb">{error ? '' : 'Loading the sign-in rules…'}</p>
          ) : (
            <form id="security-policy" onSubmit={save} className="ws-main">
              <Section title="Lockout and sessions" id="ws-rules-lockout">
                <div className="grid gap-4 sm:grid-cols-2">
                  {NUMBERS.map((f) => (
                    <label key={f.key} className="grid gap-1">
                      <span className="text-sm font-medium">{f.label}</span>
                      <input type="number" className="ui-input" min={f.min} max={f.max} value={policy[f.key]} onChange={(e) => setField({ [f.key]: Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
              </Section>

              <Section title="Passwords" id="ws-rules-passwords">
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
              </Section>

              <Section title="Who may sign in" id="ws-rules-who">
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
              </Section>

              {/* A-13: separation of duties. Approving something about yourself is never allowed, whatever this says. */}
              <Section title="Approving your own work" id="ws-rules-maker">
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
              </Section>
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
                    <StatusPill tone="ok">Active</StatusPill>
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
                      <StatusPill tone={p.enabled ? 'ok' : 'neutral'}>{p.enabled ? 'On' : 'Off'}</StatusPill>
                    </div>
                  </li>
                ))}
              </ul>
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
      </div>
    </div>
  );
};

export default SecuritySettings;
