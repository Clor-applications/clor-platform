import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { accountAudit, listInvitations, memberDirectory } from '@platform/admin/account';
import { getMySessions, getPolicy, getProviders } from '@platform/admin/security';
import { listCredentials } from '@platform/admin/credentials';
import { ACTION_WORDS } from './AccountActivity';
import { ICON, PageHead, Panel, Stat, ago, device } from './wsKit';
import './workspace.css';

/**
 * The landing pages of the Workspace's modules (redesign W-R3/R6/R7/R9):
 * opening Access, Security or Data on the rail lands on a page about that
 * module — never the Overview left behind. Each shows real state from the
 * server and the way into the module's pages; a figure that cannot be read
 * is left out, not drawn as zero.
 */

const useLoad = (fn, deps = []) => {
  const [v, setV] = useState(undefined);
  useEffect(() => {
    let live = true;
    fn()
      .then((r) => live && setV(r))
      .catch(() => live && setV(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
};

/** A short list of a module's pages: a row each, with what it is for. */
function Destinations({ items, openScreen, may }) {
  const shown = items.filter(([key]) => may.has(key));
  if (!shown.length) return null;
  return (
    <ul className="ws-list">
      {shown.map(([key, Icon, title, sub]) => (
        <li key={key}>
          <button type="button" className="ws-item" onClick={() => openScreen?.(key)}>
            <span className="ws-tile" aria-hidden="true"><Icon size={18} /></span>
            <span className="ws-item-text">
              <span className="ws-item-title">{title}</span>
              <span className="ws-item-sub">{sub}</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

const ACCESS_ACTIONS = new Set(['ACCOUNT_ROLE_CHANGE', 'INVITATION_SENT', 'INVITATION_ACCEPTED', 'INVITATION_REVOKED', 'MEMBER_SUSPENDED', 'MEMBER_REINSTATED', 'MEMBER_REMOVED_FROM_COMPANY', 'MEMBER_SIGNED_OUT']);

/** Access → Overview: who is in, who is waiting, who holds power, what changed. */
export function AccessHome({ navItems = [], openScreen }) {
  const may = new Set(navItems.map((n) => n.key));
  const dir = useLoad(() => memberDirectory());
  const inv = useLoad(() => listInvitations());
  const audit = useLoad(() => accountAudit({ limit: 20 }));
  const members = dir?.members || [];
  const active = members.filter((m) => m.status === 'ACTIVE');
  const privileged = active.filter((m) => m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || m.companies.some((c) => c.isAdmin));
  const noApp = active.filter((m) => m.companies.every((c) => !c.apps.length));
  const pending = (inv?.invitations || []).filter((i) => i.status === 'PENDING').length;
  const changes = (audit?.events || []).filter((e) => ACCESS_ACTIONS.has(e.action)).slice(0, 6);

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Overview']}
          title="Access"
          actions={may.has('invitations') ? <button type="button" className="ws-btn ws-btn--primary" onClick={() => openScreen('invitations')}><ICON.invite size={18} /> Invite people</button> : null}
        />
        {dir === null ? <p role="alert" className="text-sm">Only the account’s owners and administrators can see who has access.</p> : null}
        {dir ? (
          <div className="ws-stats">
            <Stat icon={ICON.people} label="Active members" value={active.length} note={`${members.length - active.length} suspended`} onOpen={may.has('members') ? () => openScreen('members') : null} />
            <Stat icon={ICON.invite} tone="brand" label="Pending invitations" value={inv ? pending : '—'} note="Waiting to be accepted" onOpen={may.has('invitations') ? () => openScreen('invitations') : null} />
            <Stat icon={ICON.secure} label="Can administer" value={privileged.length} note={`${privileged.filter((m) => !m.authenticator).length} without an authenticator`} onOpen={may.has('members') ? () => openScreen('members') : null} />
            <Stat icon={ICON.warning} tone={noApp.length ? 'warn' : null} label="No app access" value={noApp.length} note="In a company, but no role opens an app" />
          </div>
        ) : null}
        <div className="ws-layout">
          <div className="ws-main">
            <Panel title="Recent access changes" action={may.has('accountActivity') ? <button type="button" className="ws-link" onClick={() => openScreen('accountActivity')}>View all <ChevronRight size={16} aria-hidden="true" /></button> : null}>
              {changes.length ? (
                <ul className="ws-list">
                  {changes.map((e) => (
                    <li key={e.id}>
                      <div className="ws-item">
                        <span className="ws-tile" aria-hidden="true"><ICON.history size={18} /></span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{ACTION_WORDS[e.action] || e.action}{e.targetName ? `: ${e.targetName}` : ''}</span>
                          <span className="ws-item-sub">{e.actor?.name || 'Someone'}</span>
                        </span>
                        <span className="ws-item-end">{ago(e.at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-blurb">No access changes recorded yet.</p>
              )}
            </Panel>
          </div>
          <aside className="ws-side">
            <Panel title="Who can administer" action={may.has('members') ? <button type="button" className="ws-link" onClick={() => openScreen('members')}>Members <ChevronRight size={16} aria-hidden="true" /></button> : null}>
              {privileged.length ? (
                <ul className="ws-list">
                  {privileged.map((m) => (
                    <li key={m.userId}>
                      <div className="ws-item">
                        <span className={`ws-tile${m.authenticator ? '' : ' ws-tile--warn'}`} aria-hidden="true">{m.authenticator ? <ICON.secure size={18} /> : <ICON.warning size={18} />}</span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{m.name || m.email}</span>
                          <span className="ws-item-sub">
                            {m.accountRole === 'OWNER' ? 'Account owner' : m.accountRole === 'ADMIN' ? 'Account administrator' : 'Company administrator'} · {m.authenticator ? 'authenticator on' : 'no authenticator'}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-blurb">{dir === null ? 'Only the account’s owners and administrators can see this.' : 'Nobody yet.'}</p>
              )}
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Security → Overview: the sign-in rules in force, privileged people without an authenticator, and what was refused. */
export function SecurityHome({ navItems = [], openScreen }) {
  const may = new Set(navItems.map((n) => n.key));
  const policy = useLoad(() => getPolicy());
  const providers = useLoad(() => getProviders());
  const creds = useLoad(() => listCredentials());
  const dir = useLoad(() => memberDirectory());
  const refused = useLoad(() => accountAudit({ result: 'DENIED', limit: 5 }));
  const p = policy?.policy;
  const sso = providers?.providers || [];
  const ssoOn = sso.filter((x) => x.enabled).length;
  /* The server leaves revoked credentials out of this list unless asked. */
  const live = creds?.credentials || [];
  const sessions = useLoad(() => getMySessions());
  const privilegedNo2fa = (dir?.members || []).filter((m) => m.status === 'ACTIVE' && !m.authenticator && (m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || m.companies.some((c) => c.isAdmin)));

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Security', 'Overview']} title="Security" />
        <div className="ws-stats">
          {p ? (
            <Stat icon={ICON.secure} label="Authenticator for admins" value={p.requireAdminTwoFactor ? 'Required' : 'Optional'} note={p.requirePayrollStepUp ? 'Payroll actions ask for a code' : 'Payroll actions do not ask for a code'} onOpen={may.has('security') ? () => openScreen('security') : null} />
          ) : null}
          {dir ? <Stat icon={ICON.warning} tone={privilegedNo2fa.length ? 'warn' : null} label="Admins without an authenticator" value={privilegedNo2fa.length} note="Can change who has access" onOpen={may.has('members') ? () => openScreen('members') : null} /> : null}
          {providers ? <Stat icon={ICON.team} label="Single sign-on" value={ssoOn ? `${ssoOn} on` : 'Off'} note={`${sso.length} provider${sso.length === 1 ? '' : 's'} set up`} onOpen={may.has('sso') ? () => openScreen('sso') : null} /> : null}
          {creds ? <Stat icon={ICON.settings} label="Keys and tokens" value={live.length} note="API keys, SCIM, devices still valid" onOpen={may.has('credentials') ? () => openScreen('credentials') : null} /> : null}
        </div>
        <div className="ws-layout">
          <div className="ws-main">
            {p ? (
              <Panel title="Sign-in rules in force">
                <dl className="grid gap-2 text-sm" style={{ gridTemplateColumns: 'max-content 1fr', columnGap: 24 }}>
                  <dt className="ws-item-sub">Passwords</dt>
                  <dd>{policy?.passwordRules || `At least ${p.passwordMinLength} characters`}</dd>
                  <dt className="ws-item-sub">Lockout</dt>
                  <dd>After {p.maxFailedLogins} failed attempts, for {p.lockoutMinutes} minutes</dd>
                  <dt className="ws-item-sub">Sessions</dt>
                  <dd>Signed in for up to {p.sessionDays} days</dd>
                  <dt className="ws-item-sub">Who may be invited</dt>
                  <dd>{p.allowedEmailDomains ? `Addresses at ${p.allowedEmailDomains}` : 'Any email address'}</dd>
                </dl>
              </Panel>
            ) : null}
            <Panel title="Refused recently" action={may.has('accountActivity') ? <button type="button" className="ws-link" onClick={() => openScreen('accountActivity')}>Account activity <ChevronRight size={16} aria-hidden="true" /></button> : null}>
              {refused?.events?.length ? (
                <ul className="ws-list">
                  {refused.events.map((e) => (
                    <li key={e.id}>
                      <div className="ws-item">
                        <span className="ws-tile ws-tile--danger" aria-hidden="true"><ICON.warning size={18} /></span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{ACTION_WORDS[e.action] || e.action}</span>
                          <span className="ws-item-sub">{e.actor?.name || 'Someone'}{e.message ? ` · ${e.message}` : ''}</span>
                        </span>
                        <span className="ws-item-end">{ago(e.at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-blurb">{refused === null ? 'Only the account’s owners and administrators can see refusals.' : 'Nothing refused recently.'}</p>
              )}
            </Panel>
          </div>
          <aside className="ws-side">
            <Panel title="Your sessions" action={may.has('security') ? <button type="button" className="ws-link" onClick={() => openScreen('security')}>Manage <ChevronRight size={16} aria-hidden="true" /></button> : null}>
              {sessions?.sessions?.length ? (
                <ul className="ws-list">
                  {sessions.sessions.slice(0, 5).map((x) => (
                    <li key={x.id}>
                      <div className="ws-item">
                        <span className="ws-tile" aria-hidden="true"><ICON.secure size={18} /></span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{device(x.userAgent)}{x.ip ? ` · ${x.ip}` : ''}</span>
                          <span className="ws-item-sub">Last used {ago(x.lastSeenAt || x.createdAt)}</span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ws-card-blurb">{sessions === null ? 'Could not read your sessions.' : 'Only this one.'}</p>
              )}
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Data: exporting the company's data, and — apart, in a danger zone — closing the company. */
export function DataHome({ tenant, navItems = [], openScreen }) {
  const may = new Set(navItems.map((n) => n.key));
  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Data', 'Overview']} title="Data" />
        <div className="ws-layout">
          <div className="ws-main">
            <Panel title="Export">
              <p className="ws-card-blurb">Books and documents as a file you keep.</p>
              {may.has('export') ? (
                <div>
                  <button type="button" className="ws-btn ws-btn--primary" onClick={() => openScreen('export')}>
                    <ICON.data size={18} /> Export this company’s data
                  </button>
                </div>
              ) : (
                <p className="ws-item-sub">Exporting needs the “export Company data (Settings)” permission.</p>
              )}
            </Panel>
            {may.has('close') ? (
              <section className="ws-danger" aria-labelledby="ws-danger-title">
                <h2 id="ws-danger-title">Danger zone: close {tenant?.name || 'this company'}</h2>
                <p className="text-sm">
                  Every record of this company is deleted for good after a notice period. Other companies are not affected.
                </p>
                <div>
                  <button type="button" className="ws-btn ws-btn--danger" onClick={() => openScreen('close')}>
                    Review closing this company
                  </button>
                </div>
              </section>
            ) : null}
          </div>
          <aside className="ws-side">
            <Panel title="How long data is kept">
              <p className="ws-card-blurb">Kept while the company is open. Deleted after a closure; backups expire 7 days later.</p>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
