import React, { useEffect, useState } from 'react';
import { ChevronRight } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';

import { accountAudit, listInvitations, memberDirectory } from '@platform/admin/account';
import { getMySessions, getPolicy, getProviders } from '@platform/admin/security';
import { listCredentials } from '@platform/admin/credentials';
import { ACTION_WORDS } from './AccountActivity';
import { Avatar, DeviceMark, Empty, ICON, PageHead, Panel, Stat, ago, device, ipText } from './wsKit';

const cap = (t) => String(t || '').replace(/^./, (c) => c.toUpperCase());
import './workspace.css';
import './ws-security.css';

/* The colour icons the empty lists show. */
const LOG_ICON = emoji('scroll');
/* Each kind of access change in its own colour and mark (owner, 19 Nov 2026): sent blue, joined green,
   taken away red, put back or changed amber; anything else grey. */
const CHANGE_LOOK = {
  INVITATION_SENT: ['info', 'mail'],
  INVITATION_RESENT: ['info', 'mail'],
  INVITATION_ACCEPTED: ['ok', 'invite'],
  INVITATION_REVOKED: ['off', 'mail'],
  MEMBER_SUSPENDED: ['danger', 'warning'],
  MEMBER_REMOVED_FROM_COMPANY: ['danger', 'person'],
  ACCESS_DENIED: ['danger', 'security'],
  MEMBER_REINSTATED: ['ok', 'secure'],
  ACCOUNT_ROLE_CHANGE: ['warn', 'secure'],
  MEMBER_SIGNED_OUT: ['warn', 'security'],
};
const PEOPLE_ICON = emoji('busts-in-silhouette');

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
    <div className="ws ws-flat">
      <div className="ws-inner">
        <PageHead
          crumbs={['Users & access', 'Access overview']}
          title="Access"
          description="Who is in the account, who is waiting to join, and who can administer it."
          actions={may.has('invitations') ? <button type="button" className="ws-btn ws-btn--primary" onClick={() => openScreen('invitations')}><ICON.invite size={18} /> Invite people</button> : null}
        />
        {dir === null ? <p role="alert" className="text-sm">Visible to owners and administrators.</p> : null}
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
            <Panel title="Recent access changes" action={may.has('accountActivity') ? <button type="button" className="ws-row-link" onClick={() => openScreen('accountActivity')}>View all <ChevronRight size={14} aria-hidden="true" /></button> : null}>
              {changes.length ? (
                <ul className="ws-list">
                  {changes.map((e) => (
                    <li key={e.id}>
                      <div className="ws-item">
                        {(() => {
                          const [tone, glyph] = CHANGE_LOOK[e.action] || ['off', 'history'];
                          const Glyph = ICON[glyph] || ICON.history;
                          return <span className="ws-change-mark" data-tone={tone} aria-hidden="true"><Glyph size={16} /></span>;
                        })()}
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
                <Empty icon={LOG_ICON} compact>No access changes recorded yet.</Empty>
              )}
            </Panel>
          </div>
          <aside className="ws-side">
            <Panel title="Who can administer" action={may.has('members') ? <button type="button" className="ws-row-link" onClick={() => openScreen('members')}>Members <ChevronRight size={14} aria-hidden="true" /></button> : null}>
              {privileged.length ? (
                <ul className="ws-list">
                  {privileged.map((m) => (
                    <li key={m.userId}>
                      <div className="ws-item">
                        <Avatar name={m.name || m.email} size="lg" />
                        <span className="ws-item-text">
                          <span className="ws-item-title">{m.name || m.email}</span>
                          <span className="ws-item-sub">{m.accountRole === 'OWNER' ? 'Owner' : m.accountRole === 'ADMIN' ? 'Administrator' : 'Company admin'}</span>
                        </span>
                        <span className="ws-state" data-tone={m.authenticator ? 'ok' : 'warn'}>{m.authenticator ? 'Authenticator on' : 'No authenticator'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                dir === null ? <p className="ws-card-blurb">Only the account’s owners and administrators can see this.</p> : <Empty icon={PEOPLE_ICON} compact>Nobody yet.</Empty>
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
        <PageHead crumbs={['Security', 'Security overview']} title="Security overview" description="How people sign in, who can change access, and the keys other systems hold, at a glance." />
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
                <dl className="ws-rows">
                  <div><dt>Passwords</dt><dd>{cap(policy?.passwordRules || `At least ${p.passwordMinLength} characters`)}</dd></div>
                  <div><dt>Lockout</dt><dd>After {p.maxFailedLogins} failed attempts, for {p.lockoutMinutes} minutes</dd></div>
                  <div><dt>Sessions</dt><dd>Signed in for up to {p.sessionDays} days</dd></div>
                  <div><dt>Who may be invited</dt><dd>{p.allowedEmailDomains ? `Addresses at ${p.allowedEmailDomains}` : 'Any email address'}</dd></div>
                </dl>
              </Panel>
            ) : null}
            <Panel title="Refused recently" action={may.has('accountActivity') ? <button type="button" className="ws-link" onClick={() => openScreen('accountActivity')}>Audit log <ChevronRight size={16} aria-hidden="true" /></button> : null}>
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
                refused === null ? <p className="ws-card-blurb">Only the account’s owners and administrators can see refusals.</p> : <p className="ws-quiet-ok"><span className="ws-state" data-tone="ok">All clear</span>Nothing refused recently.</p>
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
                        <DeviceMark ua={x.userAgent} />
                        <span className="ws-item-text">
                          <span className="ws-item-title">{device(x.userAgent)}</span>
                          <span className="ws-item-sub">{x.ip ? `${ipText(x.ip)} · ` : ''}last used {ago(x.lastSeenAt || x.createdAt)}</span>
                        </span>
                        {x.current ? <span className="ws-tag ws-tag--workspace">This device</span> : null}
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
        <PageHead crumbs={['Settings', 'Data']} title="Data" description="Export this company’s records, and close it when it is done with." />
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
                <p className="ws-item-sub">You don’t have export permission.</p>
              )}
            </Panel>
            {may.has('close') ? (
              <section className="ws-danger" aria-labelledby="ws-danger-title">
                <h2 id="ws-danger-title">Danger zone: close {tenant?.name || 'this company'}</h2>
                <p className="text-sm">
                  Deletes every record of this company after a notice period.
                </p>
                <div>
                  <button type="button" className="ws-btn ws-btn--danger-quiet" onClick={() => openScreen('close')}>
                    Review closing this company
                  </button>
                </div>
              </section>
            ) : null}
          </div>
          <aside className="ws-side">
            <Panel title="How long data is kept">
              <p className="ws-card-blurb">Kept while the company is open.</p>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
