import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Plus, Search, ShieldAlert, UserX } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';
import { requestOpenScreen } from '@platform/context';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { lastSignedInLine } from '@ui/picks/round60';
import { memberAccess, memberDirectory, reinstateMember, removeMemberFromCompany, setAccountRole, signOutMember, suspendMember } from '@platform/admin/account';
import { AppMark, AppTag, Avatar, Empty, FilterSelect, LoadError, Loading, PageHead, StatusPill, WsDrawer } from './wsKit';
import { CountLine } from '@ui/components/ui/CountLine';
import './workspace.css';
import './ws-access.css';
import './ws-security.css';
import { errorWords } from '@ui/utils/errorWords';
import { SelectField } from '@ui/components/ui/SelectField';

/* The colour icon an empty list shows: the one its menu item wears. */
const EMPTY_ICON = emoji('busts-in-silhouette');

/**
 * Workspace → Members (W-4): everyone in the account, with what they can
 * reach, and the separate things an administrator can do about it.
 *
 * The list is the server's computed effective access (the same resolution
 * every request uses), not the roles somebody remembers choosing. The detail
 * drawer answers the spec's questions: which companies, which apps, which
 * roles and why (given directly — by whom, when — or through a profile), and
 * which permissions are sensitive.
 *
 * Suspend (every company of the account), remove from one company, and the
 * account role are separate acts with separate reach. Deleting a person's
 * login is not offered. Every rule is the server's; a refusal is shown as it
 * says it.
 */

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };
const APP_LABEL = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance' };
const STATUS = { ACTIVE: { tone: 'ok', label: 'Active' }, SUSPENDED: { tone: 'danger', label: 'Suspended' }, INVITED: { tone: 'neutral', label: 'Invited' } };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');

/** The directory rows that pass the filters. */
/** W-7.1: who holds power here — an account owner or administrator, or an administrator of a company. */
export const isPrivileged = (m) => m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || m.companies.some((c) => c.isAdmin);

export function filterMembers(members, { q = '', status = '', companyId = '', app = '', role = '', risk = '', auth = '' }) {
  const needle = q.trim().toLowerCase();
  return members.filter((m) => {
    if (risk === 'privileged' && !isPrivileged(m)) return false;
    if (risk === 'no2fa' && !(isPrivileged(m) && !m.authenticator && m.status === 'ACTIVE')) return false;
    if (needle && !`${m.name || ''} ${m.email || ''}`.toLowerCase().includes(needle)) return false;
    if (status && m.status !== status) return false;
    /* Anybody without an authenticator, not only administrators: the company's rule asks it of admins, but an owner wants to see everyone. */
    if (auth === 'none' && m.authenticator) return false;
    if (auth === 'on' && !m.authenticator) return false;
    if (role && m.accountRole !== role) return false;
    if (companyId && !m.companies.some((c) => c.orgId === companyId)) return false;
    if (app && !m.companies.some((c) => (companyId ? c.orgId === companyId : true) && c.apps.includes(app))) return false;
    return true;
  });
}

/* What a link may ask this page to show: Home's "Review members" opens the admins without an authenticator, search opens one person. */
const RISKS = ['privileged', 'no2fa'];
const STATUSES = ['ACTIVE', 'SUSPENDED'];

export default function Members({ params, tenant, openScreen, switchCompany }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* A list that did not load says so and offers a retry: an empty list here invited re-inviting people who are already in. */
  const [loadError, setLoadError] = useState('');
  /* Which member action is out ('role', 'signout', 'suspend', 'reinstate', 'remove'): one at a time, so nothing is sent twice. */
  const [busy, setBusy] = useState('');
  const [filters, setFilters] = useState(() => ({
    q: typeof params?.q === 'string' ? params.q : '',
    status: STATUSES.includes(params?.status) ? params.status : '',
    companyId: '',
    app: '',
    role: '',
    risk: RISKS.includes(params?.risk) ? params.risk : '',
    auth: '',
  }));
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailCompany, setDetailCompany] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    memberDirectory()
      .then((d) => {
        setData(d);
        setLoadError('');
      })
      .catch((e) => {
        setLoadError(errorWords(e, 'load the members'));
      });
  }, []);
  useEffect(load, [load]);

  /* Opening a person loads their access; closing forgets it. */
  const openMember = (userId) => {
    setOpenId(userId);
    setDetail(null);
    setDetailCompany('');
    setError('');
    setNotice('');
    memberAccess(userId)
      .then(setDetail)
      .catch((e) => setDetail({ error: errorWords(e, 'load this person’s access') }));
  };

  /* A link to one person (search, or another page) opens their access once the list is in. */
  const wanted = typeof params?.member === 'string' ? params.member : '';
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (!wanted || openedFromLink.current || !data?.members?.some((m) => m.userId === wanted)) return;
    openedFromLink.current = true;
    openMember(wanted);
    // Once, when the list arrives: openMember is made anew each render and must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, data]);

  const rows = useMemo(() => (data ? filterMembers(data.members, filters) : []), [data, filters]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pick = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  const act = async (key, fn, done) => {
    if (busy) return;
    setError('');
    setNotice('');
    setBusy(key);
    try {
      await fn();
      setNotice(done);
      notify.success(done);
      load();
      if (openId) memberAccess(openId).then(setDetail).catch(() => {});
    } catch (e) {
      setError(errorWords(e, 'make the change'));
    } finally {
      setBusy('');
    }
  };

  const companyCount = data?.companies?.length || 0;
  const exportCsv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Email', 'Account role', 'Status', 'Companies', 'Apps', 'Roles'].map(q).join(',')];
    for (const m of rows) {
      lines.push([
        m.name || '',
        m.email || '',
        ROLE_LABEL[m.accountRole] || m.accountRole,
        STATUS[m.status]?.label || m.status,
        m.companies.map((c) => c.name).join('; '),
        [...new Set(m.companies.flatMap((c) => c.apps))].map((x) => APP_LABEL[x] || x).join('; '),
        [...new Set(m.companies.flatMap((c) => c.roles || []))].join('; '),
      ].map(q).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const shown = detail && !detail.error ? detail.companies.find((c) => c.orgId === detailCompany) || detail.companies[0] || null : null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Users & access', 'Members']}
          scope="account"
          title="Members"
          description="Everyone who can sign in to this account: staff, your accountant and devices."
          actions={
            <>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={exportCsv} disabled={!rows.length}>
                Export
              </button>
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => requestOpenScreen('invitations')}>
                <Plus size={16} aria-hidden="true" /> Invite people
              </button>
            </>
          }
        />

        {data?.members?.length ? (
          (() => {
            const privileged = data.members.filter(isPrivileged);
            const exposed = privileged.filter((m) => !m.authenticator && m.status === 'ACTIVE');
            const suspended = data.members.filter((m) => m.status === 'SUSPENDED').length;
            const toggle = (risk) => setFilters((f) => ({ ...f, risk: f.risk === risk ? '' : risk }));
            return (
              <CountLine label="Member figures" items={[
                { key: 'members', label: data.members.length === 1 ? 'member' : 'members', value: data.members.length },
                { key: 'privileged', label: 'can administer', value: privileged.length, onClick: () => toggle('privileged'), active: filters.risk === 'privileged' },
                { key: 'no2fa', label: exposed.length === 1 ? 'admin without an authenticator' : 'admins without an authenticator', value: exposed.length, tone: 'warn', onClick: () => toggle('no2fa'), active: filters.risk === 'no2fa' },
                { key: 'suspended', label: 'suspended', value: suspended },
              ]} />
            );
          })()
        ) : null}

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <span className="sr-only">Search by name or email</span>
            <Search size={16} aria-hidden="true" />
            <input className="ui-input" value={filters.q} onChange={set('q')} placeholder="Search by name or email" />
          </label>
          {/* Menus, not native selects: a native list opened as a tall sheet in the middle of the page. */}
          <FilterSelect label="Company" value={filters.companyId} onChange={pick('companyId')} options={[['', 'All'], ...(data?.companies || []).map((c) => [c.orgId, c.name])]} />
          <FilterSelect label="App" value={filters.app} onChange={pick('app')} options={[['', 'All'], ...Object.entries(APP_LABEL)]} />
          <FilterSelect label="Access" ariaLabel="Account role" value={filters.role} onChange={pick('role')} options={[['', 'All'], ...Object.entries(ROLE_LABEL)]} />
          <FilterSelect label="Status" value={filters.status} onChange={pick('status')} width="11rem" options={[['', 'All'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended']]} />
          <FilterSelect label="Authenticator" value={filters.auth} onChange={pick('auth')} options={[['', 'All'], ['none', 'No authenticator'], ['on', 'Has authenticator']]} />
        </div>

        {/* An action's result shows where it was taken: inside the panel while one is open, here otherwise. */}
        {!openId && notice ? <p role="status" className="text-sm">{notice}</p> : null}
        {!openId && error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {loadError && data === null ? (
          <LoadError onRetry={() => { setLoadError(''); load(); }}>{loadError}</LoadError>
        ) : data === null ? (
          <Loading shape="rows" rows={3} label="Loading members…" />
        ) : rows.length === 0 ? (
          <Empty icon={EMPTY_ICON} compact action={data.members.length ? null : { label: 'Invite people', onClick: () => requestOpenScreen('invitations') }}>
            {data.members.length ? 'Nobody matches these filters.' : 'Nobody is in the account yet.'}
          </Empty>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table ws-members">
              <caption className="sr-only">Members of this account</caption>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Access</th>
                  <th>Roles</th>
                  <th>Sign-in</th>
                  <th>Status</th>
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const roles = [];
                  for (const c of m.companies) {
                    for (const r of c.roles || []) {
                      const name = typeof r === 'string' ? r : r?.name;
                      if (name && !roles.some((x) => x.name === name)) roles.push({ name, app: c.apps.length === 1 ? c.apps[0] : null });
                    }
                  }
                  const st = STATUS[m.status] || { tone: 'neutral', label: m.status };
                  return (
                    <tr key={m.userId} data-selected={openId === m.userId || undefined} onClick={() => openMember(m.userId)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span className="flex items-center gap-3" style={{ minWidth: 0 }}>
                          <Avatar name={m.name || m.email} size="lg" ink={m.accountRole === 'OWNER'} />
                          <button type="button" className="ws-member-name" onClick={(e) => { e.stopPropagation(); openMember(m.userId); }}>
                            <span className="ws-cell-main">{m.name || m.email}</span>
                            <span className="ws-cell-sub">{m.email}</span>
                          </button>
                        </span>
                      </td>
                      <td>
                        <span className="ws-cell-main" style={{ fontWeight: 500 }}>{ROLE_LABEL[m.accountRole] || m.accountRole}</span>
                        <span className="ws-cell-sub">
                          {!m.companies.length ? 'In no company' : companyCount && m.companies.length >= companyCount ? (companyCount === 1 ? 'The company' : `All ${companyCount} companies`) : `${m.companies.length} of ${companyCount || m.companies.length} companies`}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {m.accountRole === 'OWNER' && !roles.length ? (
                          <span className="ws-tag ws-tag--workspace">Full access</span>
                        ) : roles.length ? (
                          <span className="ws-tags">
                            {roles.slice(0, 3).map((r) => (r.app ? <AppTag key={r.name} app={r.app}>{r.name}</AppTag> : <span key={r.name} className="ws-tag ws-tag--workspace">{r.name}</span>))}
                            {roles.length > 3 ? <span className="ws-cell-sub">+{roles.length - 3} more</span> : null}
                          </span>
                        ) : (
                          /* Signs in but opens nothing: amber, as on Company users' "Without a role". */
                          <span className="ws-state" data-tone="warn">No role</span>
                        )}
                      </td>
                      {/* Who signs in with an authenticator and when they last did: it was only inside each person's panel. */}
                      <td>
                        <span className="ws-cell-main">{m.authenticator ? 'Authenticator on' : 'No authenticator'}</span>
                        {/* Round 60 lastsignin A: Today, 3 days ago, Never, to spot seats nobody uses. */}
                        <span className="ws-cell-sub">{lastSignedInLine(m.lastSignInAt)}</span>
                      </td>
                      <td><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                      <td className="num"><ArrowUpRight size={16} aria-hidden="true" className="ws-chev" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WsDrawer open={Boolean(openId)} onClose={() => { setOpenId(''); setDetail(null); setNotice(''); setError(''); }} title={detail?.name || detail?.email || 'Member'} description={detail?.email || ''}>
        {!detail ? (
          <Loading shape="card" label="Loading this person’s access…" />
        ) : detail.error ? (
          <LoadError onRetry={() => openMember(openId)}>{detail.error}</LoadError>
        ) : (
          <div className="ws-member-panel">
            {/* Account role and company side by side, each as wide as its words (owner, 19 Nov 2026). */}
            <div className="ws-member-fields">
            <div className="grid gap-2">
              <label htmlFor="ws-member-role" className="ws-kicker">Account role</label>
              <select
                id="ws-member-role"
                className="ui-select"
                value={detail.accountRole}
                disabled={Boolean(busy)}
                aria-busy={busy === 'role' || undefined}
                onChange={async (e) => {
                  const next = e.target.value;
                  /* The select saved on change, so one slip of the mouse made somebody an owner. Asked first, in words. */
                  const up = next === 'OWNER' || next === 'ADMIN';
                  const ok = await confirmDialog({
                    title: `Change ${detail.name || detail.email || 'this person'}’s account role to ${ROLE_LABEL[next] || next}?`,
                    message: up ? 'They will be able to change who has access to this account.' : 'Their access to account settings changes at once.',
                    confirmLabel: 'Change role',
                    tone: next === 'OWNER' ? 'danger' : 'neutral',
                  });
                  if (!ok) return;
                  act('role', () => setAccountRole(detail.userId, next), `Account role changed to ${ROLE_LABEL[next]}.`);
                }}
              >
                {Object.entries(ROLE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>

            {detail.companies.length > 1 ? (
              <div className="grid gap-2">
                <label htmlFor="ws-member-company" className="ws-kicker">Company</label>
                <SelectField id="ws-member-company" className="ui-select" value={shown?.orgId || ''} onChange={(e) => setDetailCompany(e.target.value)}>
                  {detail.companies.map((c) => (
                    <option key={c.orgId} value={c.orgId}>{c.name}</option>
                  ))}
                </SelectField>
              </div>
            ) : null}
            </div>
            {detail.companies.length === 0 ? <p className="ui-caption">Not in any company of this account.</p> : null}
            {shown ? (
              <section className="ws-member-company" aria-label={shown.name}>
                <div className="flex items-center gap-2">
                  <h3 className="ws-member-company-name">{shown.name}</h3>
                  {shown.isAdmin ? <span className="ws-tag ws-tag--workspace">Company admin</span> : null}
                </div>
                <p className="ws-kicker">Apps</p>
                {shown.apps.length ? (
                  <ul className="ws-member-apps" aria-label={`Apps: ${shown.apps.map((a) => APP_LABEL[a] || a).join(', ')}`}>
                    {shown.apps.map((a) => (
                      <li key={a}>
                        <AppMark app={a} size={24} />
                        <span>{APP_LABEL[a] || a}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ui-caption">No app: no role here opens one.</p>
                )}
                <p className="sr-only">Apps: {shown.apps.length ? shown.apps.map((a) => APP_LABEL[a] || a).join(', ') : 'none'}</p>
                <p className="ws-kicker">Roles</p>
                <ul className="ws-member-roles">
                  {shown.roles.map((r) => (
                    <li key={r.name}>
                      <span>{shown.apps.length === 1 ? <AppTag app={shown.apps[0]}>{r.name}</AppTag> : <span className="ws-tag ws-tag--workspace">{r.name}</span>}</span>
                      <span className="ui-caption">
                        {r.via === 'direct' ? `given${r.grantedBy ? ` by ${r.grantedBy}` : ''}${r.grantedAt ? ` on ${day(r.grantedAt)}` : ''}` : 'through a role profile'}
                      </span>
                    </li>
                  ))}
                  {shown.roles.length === 0 ? <li className="ui-caption">No role here.</li> : null}
                </ul>
                {/* The roles above, as what they let this person do: read from the same permissions the server checks. */}
                {shown.words?.length ? (
                  <>
                    <p className="ws-kicker">What they can do</p>
                    <dl className="ws-member-words">
                      {shown.words.map((w) => (
                        <div key={w.app}>
                          <dt>{w.label}</dt>
                          <dd>
                            {w.lines.map((line) => (
                              <span key={line}>{line}.</span>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : null}
                {/*
                  Roles are changed in the company they belong to. This page showed them and stopped: the
                  administrator then went looking for the same person again under Company users.
                */}
                {tenant?.id && shown.orgId === tenant.id && openScreen ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ws-btn ws-btn--small" onClick={() => openScreen('users', { user: detail.userId })}>
                      Change role here
                    </button>
                    {detail.status !== 'SUSPENDED' ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openScreen('users', { user: detail.userId, do: 'leave' })}>
                        Mark as left
                      </button>
                    ) : null}
                  </div>
                ) : tenant?.id && shown.orgId !== tenant.id ? (
                  <p className="ui-caption">
                    Roles in {shown.name} are changed from that company.{' '}
                    {switchCompany ? <button type="button" className="ws-row-link" onClick={() => switchCompany(shown.orgId)}>Switch to {shown.name}</button> : null}
                  </p>
                ) : null}
                {shown.sensitive.length ? (
                  <p className="ws-member-sensitive">
                    <ShieldAlert size={16} aria-hidden="true" className="shrink-0" /> Can reach sensitive data: {shown.sensitive.length} permission{shown.sensitive.length === 1 ? '' : 's'} on payroll, people, salary, bank or documents.
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* What only this person holds or started: read before they are marked as left, suspended or removed. */}
            <section className="ws-member-handover" aria-label="Before they leave">
              <p className="ws-kicker">Before they leave</p>
              {detail.handover?.length ? (
                <ul>
                  {detail.handover.map((h) => {
                    const here = !h.orgId || h.orgId === tenant?.id;
                    return (
                      <li key={h.key}>
                        <span>{h.text}</span>{' '}
                        {openScreen && here ? (
                          <button type="button" className="ws-row-link" onClick={() => openScreen(h.screen)}>Open</button>
                        ) : switchCompany && h.orgId ? (
                          <button type="button" className="ws-row-link" onClick={() => switchCompany(h.orgId)}>Switch company</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="ui-caption">Nothing to hand over: nothing here depends on this person alone.</p>
              )}
            </section>

            <dl className="ws-member-facts">
              <div>
                <dt>Status</dt>
                <dd>{detail.status === 'SUSPENDED' ? <span className="ws-state" data-tone="danger">Suspended in this account</span> : <span className="ws-state" data-tone="ok">Active</span>}</dd>
              </div>
              <div>
                <dt>Sign-in</dt>
                <dd>
                  <span className="ws-state" data-tone={detail.authenticator ? 'ok' : 'warn'}>Authenticator {detail.authenticator ? 'on' : 'off'}</span>
                  <span className="ws-cell-sub">Last signed in {detail.lastSignInAt ? day(detail.lastSignInAt) : 'never'}</span>
                </dd>
              </div>
              <div>
                <dt>Branches</dt>
                <dd>{shown?.branches?.length ? shown.branches.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{day(detail.memberSince)}</dd>
              </div>
            </dl>

            {/* The result of an action taken here, inside the panel: under the drawer's scrim the page's own line could not be seen. */}
            {notice ? <p role="status" className="ws-member-result text-sm">{notice}</p> : null}
            {error ? <p role="alert" className="ws-member-result text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

            <div className="ws-member-actions">
              <button
                type="button"
                className="ws-row-link"
                disabled={Boolean(busy)}
                aria-busy={busy === 'signout' || undefined}
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Sign out everywhere?', message: 'Ends every session now. They can sign in again.', confirmLabel: 'Sign out everywhere', tone: 'neutral' }))) return;
                  act('signout', () => signOutMember(detail.userId), 'Signed out of every session.');
                }}
              >
                {busy === 'signout' ? 'Signing out…' : 'Sign out everywhere'}
              </button>
              {detail.status === 'SUSPENDED' ? (
                <button type="button" className="ws-row-link" disabled={Boolean(busy)} aria-busy={busy === 'reinstate' || undefined} onClick={() => act('reinstate', () => reinstateMember(detail.userId), 'Reinstated: their roles work again.')}>
                  {busy === 'reinstate' ? 'Reinstating…' : 'Reinstate in the account'}
                </button>
              ) : (
                <button
                  type="button"
                  className="ws-row-link ws-row-link--danger"
                  disabled={Boolean(busy)}
                  aria-busy={busy === 'suspend' || undefined}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Suspend ${detail.name || detail.email || 'this person'} in the account?`, message: 'They lose access to every company until reinstated. Their records stay.', confirmLabel: 'Suspend in the account', tone: 'danger' }))) return;
                    act('suspend', () => suspendMember(detail.userId), 'Suspended in every company of the account.');
                  }}
                >
                  <UserX size={16} aria-hidden="true" /> {busy === 'suspend' ? 'Suspending…' : 'Suspend in the account'}
                </button>
              )}
              {shown ? (
                <button
                  type="button"
                  className="ws-row-link ws-row-link--danger"
                  disabled={Boolean(busy)}
                  aria-busy={busy === 'remove' || undefined}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Remove from ${shown.name}?`, message: 'They lose access to this company only.', confirmLabel: 'Remove from company', tone: 'danger' }))) return;
                    act('remove', () => removeMemberFromCompany(detail.userId, shown.orgId), `Removed from ${shown.name}.`);
                  }}
                >
                  {busy === 'remove' ? 'Removing…' : `Remove from ${shown.name}`}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </WsDrawer>
    </div>
  );
}
