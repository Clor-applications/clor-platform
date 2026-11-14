import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, ShieldAlert, UserX } from '@ui/components/ui/lineIcons';
import { requestOpenScreen } from '@platform/context';

import { confirmDialog } from '@ui/components/ui/notify';
import { memberAccess, memberDirectory, reinstateMember, removeMemberFromCompany, setAccountRole, signOutMember, suspendMember } from '@platform/admin/account';
import { AppMark, AppTag, Avatar, ICON, PageHead, Stat, StatusPill, WsDrawer } from './wsKit';
import './workspace.css';
import './ws-access.css';

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
const APP_LABEL = { accounting: 'Accounting', payroll: 'Payroll', people: 'People', attendance: 'Attendance' };
const STATUS = { ACTIVE: { tone: 'ok', label: 'Active' }, SUSPENDED: { tone: 'danger', label: 'Suspended' }, INVITED: { tone: 'neutral', label: 'Invited' } };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');

/** The directory rows that pass the filters. */
/** W-7.1: who holds power here — an account owner or administrator, or an administrator of a company. */
export const isPrivileged = (m) => m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || m.companies.some((c) => c.isAdmin);

export function filterMembers(members, { q = '', status = '', companyId = '', app = '', role = '', risk = '' }) {
  const needle = q.trim().toLowerCase();
  return members.filter((m) => {
    if (risk === 'privileged' && !isPrivileged(m)) return false;
    if (risk === 'no2fa' && !(isPrivileged(m) && !m.authenticator && m.status === 'ACTIVE')) return false;
    if (needle && !`${m.name || ''} ${m.email || ''}`.toLowerCase().includes(needle)) return false;
    if (status && m.status !== status) return false;
    if (role && m.accountRole !== role) return false;
    if (companyId && !m.companies.some((c) => c.orgId === companyId)) return false;
    if (app && !m.companies.some((c) => (companyId ? c.orgId === companyId : true) && c.apps.includes(app))) return false;
    return true;
  });
}

export default function Members() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', companyId: '', app: '', role: '', risk: '' });
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailCompany, setDetailCompany] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    memberDirectory()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => {
        setData({ companies: [], members: [] });
        setError(String(e?.message || 'Could not load the members.'));
      });
  }, []);
  useEffect(load, [load]);

  /* Opening a person loads their access; closing forgets it. */
  const openMember = (userId) => {
    setOpenId(userId);
    setDetail(null);
    setDetailCompany('');
    memberAccess(userId)
      .then(setDetail)
      .catch((e) => setDetail({ error: String(e?.message || 'Could not load this person’s access.') }));
  };

  const rows = useMemo(() => (data ? filterMembers(data.members, filters) : []), [data, filters]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const act = async (fn, done) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      load();
      if (openId) memberAccess(openId).then(setDetail).catch(() => {});
    } catch (e) {
      setError(String(e?.message || 'That did not work.'));
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
          crumbs={['Access', 'Members']}
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
              <div className="ws-stats">
                <Stat icon={ICON.people} label="Members" value={data.members.length} />
                <Stat icon={ICON.secure} label="Can administer" value={privileged.length} note={filters.risk === 'privileged' ? 'Showing only these' : undefined} onOpen={() => toggle('privileged')} />
                <Stat icon={ICON.warning} tone={exposed.length ? 'warn' : null} label="Admins without authenticator" value={exposed.length} note={filters.risk === 'no2fa' ? 'Showing only these' : undefined} onOpen={exposed.length ? () => toggle('no2fa') : undefined} />
                <Stat icon={ICON.person} label="Suspended" value={suspended} />
              </div>
            );
          })()
        ) : null}

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <span className="sr-only">Search by name or email</span>
            <Search size={16} aria-hidden="true" />
            <input className="ui-input" value={filters.q} onChange={set('q')} placeholder="Search name or email" />
          </label>
          <select className="ui-select" aria-label="Company" value={filters.companyId} onChange={set('companyId')}>
            <option value="">Company: All</option>
            {(data?.companies || []).map((c) => (
              <option key={c.orgId} value={c.orgId}>{c.name}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="App" value={filters.app} onChange={set('app')}>
            <option value="">App: All</option>
            {Object.entries(APP_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="Account role" value={filters.role} onChange={set('role')}>
            <option value="">Access: All</option>
            {Object.entries(ROLE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="Status" value={filters.status} onChange={set('status')}>
            <option value="">Status: All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {data === null ? (
          <p className="ws-card-blurb">Loading members…</p>
        ) : rows.length === 0 ? (
          <p className="ws-card-blurb">{data.members.length ? 'Nobody matches these filters.' : 'Nobody is in the account yet. Invite people under Invitations.'}</p>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table ws-members">
              <caption className="sr-only">Members of this account</caption>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Access</th>
                  <th>Roles</th>
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
                          'Full access'
                        ) : roles.length ? (
                          <span className="ws-tags">
                            {roles.slice(0, 3).map((r) => <AppTag key={r.name} app={r.app}>{r.name}</AppTag>)}
                            {roles.length > 3 ? <span className="ws-cell-sub">+{roles.length - 3} more</span> : null}
                          </span>
                        ) : (
                          <span className="ws-cell-sub">No role</span>
                        )}
                      </td>
                      <td><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                      <td className="num"><ChevronRight size={16} aria-hidden="true" className="ws-chev" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WsDrawer open={Boolean(openId)} onClose={() => { setOpenId(''); setDetail(null); }} title={detail?.name || detail?.email || 'Member'} description={detail?.email || ''}>
        {!detail ? (
          <p className="ui-caption">Loading…</p>
        ) : detail.error ? (
          <p role="alert" className="text-sm">{detail.error}</p>
        ) : (
          <div className="ws-member-panel">
            <div className="grid gap-2">
              <label htmlFor="ws-member-role" className="ws-kicker">Account role</label>
              <select
                id="ws-member-role"
                className="ui-select"
                value={detail.accountRole}
                onChange={(e) => {
                  const next = e.target.value;
                  act(() => setAccountRole(detail.userId, next), `Account role changed to ${ROLE_LABEL[next]}.`);
                }}
              >
                {Object.entries(ROLE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>

            {detail.companies.length === 0 ? <p className="ui-caption">Not in any company of this account.</p> : null}
            {detail.companies.length > 1 ? (
              <div className="grid gap-2">
                <label htmlFor="ws-member-company" className="ws-kicker">Company</label>
                <select id="ws-member-company" className="ui-select" value={shown?.orgId || ''} onChange={(e) => setDetailCompany(e.target.value)}>
                  {detail.companies.map((c) => (
                    <option key={c.orgId} value={c.orgId}>{c.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {shown ? (
              <section className="ws-member-company" aria-label={shown.name}>
                <div className="flex items-center gap-2">
                  <h3 className="ws-member-company-name">{shown.name}</h3>
                  {shown.isAdmin ? <StatusPill tone="neutral">Company admin</StatusPill> : null}
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
                      <strong>{r.name}</strong>
                      <span className="ui-caption">
                        {r.via === 'direct' ? `given${r.grantedBy ? ` by ${r.grantedBy}` : ''}${r.grantedAt ? ` on ${day(r.grantedAt)}` : ''}` : 'through a role profile'}
                      </span>
                    </li>
                  ))}
                  {shown.roles.length === 0 ? <li className="ui-caption">No role here.</li> : null}
                </ul>
                {shown.sensitive.length ? (
                  <p className="ui-caption flex items-start gap-1">
                    <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> Can reach sensitive data: {shown.sensitive.length} permission{shown.sensitive.length === 1 ? '' : 's'} on payroll, people, salary, bank or documents.
                  </p>
                ) : null}
              </section>
            ) : null}

            <dl className="ws-member-facts">
              <div>
                <dt>Branches</dt>
                <dd>{shown?.branches?.length ? shown.branches.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{detail.status === 'SUSPENDED' ? 'Suspended in this account' : 'Active'}</dd>
              </div>
              <div>
                <dt>Sign-in</dt>
                <dd>Authenticator {detail.authenticator ? 'on' : 'off'} · last {day(detail.lastSignInAt)}</dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{day(detail.memberSince)}</dd>
              </div>
            </dl>

            <div className="ws-member-actions">
              <button
                type="button"
                className="ws-btn ws-btn--quiet"
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Sign out everywhere?', message: 'Ends every session now. They can sign in again.', confirmLabel: 'Sign out everywhere', tone: 'neutral' }))) return;
                  act(() => signOutMember(detail.userId), 'Signed out of every session.');
                }}
              >
                Sign out everywhere
              </button>
              {detail.status === 'SUSPENDED' ? (
                <button type="button" className="ws-btn ws-btn--quiet" onClick={() => act(() => reinstateMember(detail.userId), 'Reinstated: their roles work again.')}>
                  Reinstate in the account
                </button>
              ) : (
                <button
                  type="button"
                  className="ws-btn ws-btn--danger-quiet"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: 'Suspend in the account?', message: 'They lose access to every company until reinstated.', confirmLabel: 'Suspend' }))) return;
                    act(() => suspendMember(detail.userId), 'Suspended in every company of the account.');
                  }}
                >
                  <UserX size={16} aria-hidden="true" /> Suspend in the account
                </button>
              )}
              {shown ? (
                <button
                  type="button"
                  className="ws-btn ws-btn--danger-quiet"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Remove from ${shown.name}?`, message: 'They lose access to this company only.', confirmLabel: 'Remove from company' }))) return;
                    act(() => removeMemberFromCompany(detail.userId, shown.orgId), `Removed from ${shown.name}.`);
                  }}
                >
                  Remove from {shown.name}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </WsDrawer>
    </div>
  );
}
