import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, ShieldAlert, UserX } from '@ui/components/ui/lineIcons';

import { confirmDialog } from '@ui/components/ui/notify';
import { memberAccess, memberDirectory, reinstateMember, removeMemberFromCompany, setAccountRole, signOutMember, suspendMember } from '@platform/admin/account';
import { ICON, PageHead, Stat, WsDrawer } from './wsKit';
import './workspace.css';

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

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead crumbs={['Access', 'Members']} scope="account" title="Members" />

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

        <div className="flex flex-wrap gap-2 items-center" role="search">
          <label className="relative flex-1 min-w-[14rem]">
            <span className="sr-only">Search by name or email</span>
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
            <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={filters.q} onChange={set('q')} placeholder="Search name or email" />
          </label>
          <select className="ui-select" aria-label="Status" value={filters.status} onChange={set('status')} style={{ width: 'auto' }}>
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <select className="ui-select" aria-label="Account role" value={filters.role} onChange={set('role')} style={{ width: 'auto' }}>
            <option value="">Any account role</option>
            {Object.entries(ROLE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="Company" value={filters.companyId} onChange={set('companyId')} style={{ width: 'auto' }}>
            <option value="">Any company</option>
            {(data?.companies || []).map((c) => (
              <option key={c.orgId} value={c.orgId}>{c.name}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="App" value={filters.app} onChange={set('app')} style={{ width: 'auto' }}>
            <option value="">Any app</option>
            {Object.entries(APP_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>

        {notice ? <p role="status" className="text-sm">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {data === null ? (
          <p className="ws-card-blurb">Loading members…</p>
        ) : rows.length === 0 ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">{data.members.length ? 'Nobody matches these filters.' : 'Nobody is in the account yet. Invite people under Invitations.'}</p>
          </div>
        ) : (
          <ul className="ws-admin" role="list" style={{ gridTemplateColumns: '1fr', gap: 8 }}>
            {rows.map((m) => (
              <li key={m.userId}>
                <button type="button" className="ws-group ws-row" style={{ minHeight: 64, padding: '12px 16px', alignItems: 'center' }} onClick={() => openMember(m.userId)}>
                  <span className="grid" style={{ minWidth: 0, flex: 1 }}>
                    <span className="font-medium truncate">{m.name || m.email}</span>
                    <span className="ws-card-blurb truncate" style={{ marginTop: 0 }}>
                      {m.email} · {m.companies.length ? m.companies.map((c) => `${c.name}${c.apps.length ? ` (${c.apps.map((a) => APP_LABEL[a] || a).join(', ')})` : ' (no app)'}`).join('; ') : 'in no company'}
                    </span>
                  </span>
                  <span className="ws-pill ws-pill--role">{ROLE_LABEL[m.accountRole] || m.accountRole}</span>
                  {m.status === 'SUSPENDED' ? <span className="ws-pill">Suspended</span> : null}
                  <ChevronRight size={16} className="ws-chev" style={{ opacity: 1 }} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WsDrawer open={Boolean(openId)} onClose={() => { setOpenId(''); setDetail(null); }} title={detail?.name || detail?.email || 'Member'} description={detail?.email || ''}>
        {!detail ? (
          <p className="ui-caption">Loading…</p>
        ) : detail.error ? (
          <p role="alert" className="text-sm">{detail.error}</p>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="ws-member-role" className="text-sm font-medium">Account role</label>
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
              <p className="ui-caption">
                {detail.status === 'SUSPENDED' ? 'Suspended in this account. ' : ''}Member since {day(detail.memberSince)} · last signed in {day(detail.lastSignInAt)} · authenticator {detail.authenticator ? 'on' : 'off'}
              </p>
            </div>

            {detail.companies.length === 0 ? <p className="ui-caption">Not in any company of this account.</p> : null}
            {detail.companies.map((c) => (
              <section key={c.orgId} className="ui-card p-4 grid gap-2" aria-label={c.name}>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium flex-1">{c.name}</h3>
                  {c.isAdmin ? <span className="ui-pill ui-pill-info">Company admin</span> : null}
                </div>
                <p className="text-sm">Apps: {c.apps.length ? c.apps.map((a) => APP_LABEL[a] || a).join(', ') : 'none — no role opens an app'}</p>
                {c.branches.length ? <p className="ui-caption">Branches: {c.branches.join(', ')}</p> : null}
                <ul className="grid gap-1 text-sm">
                  {c.roles.map((r) => (
                    <li key={r.name}>
                      <strong>{r.name}</strong>{' '}
                      <span className="ui-caption">
                        {r.via === 'direct' ? `given${r.grantedBy ? ` by ${r.grantedBy}` : ''}${r.grantedAt ? ` on ${day(r.grantedAt)}` : ''}` : 'through a role profile'}
                      </span>
                    </li>
                  ))}
                  {c.roles.length === 0 ? <li className="ui-caption">No role here.</li> : null}
                </ul>
                {c.sensitive.length ? (
                  <p className="ui-caption flex items-start gap-1">
                    <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> Can reach sensitive data: {c.sensitive.length} permission{c.sensitive.length === 1 ? '' : 's'} on payroll, people, salary, bank or documents.
                  </p>
                ) : null}
                <div>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: `Remove from ${c.name}?`, message: 'They lose access to this company only.', confirmLabel: 'Remove from company' }))) return;
                      act(() => removeMemberFromCompany(detail.userId, c.orgId), `Removed from ${c.name}.`);
                    }}
                  >
                    Remove from {c.name}
                  </button>
                </div>
              </section>
            ))}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Sign out everywhere?', message: 'Ends every session now. They can sign in again.', confirmLabel: 'Sign out everywhere', tone: 'neutral' }))) return;
                  act(() => signOutMember(detail.userId), 'Signed out of every session.');
                }}
              >
                Sign out everywhere
              </button>
              {detail.status === 'SUSPENDED' ? (
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => act(() => reinstateMember(detail.userId), 'Reinstated: their roles work again.')}>
                  Reinstate in the account
                </button>
              ) : (
                <button
                  type="button"
                  className="ui-btn ui-btn-danger"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: 'Suspend in the account?', message: 'They lose access to every company until reinstated.', confirmLabel: 'Suspend' }))) return;
                    act(() => suspendMember(detail.userId), 'Suspended in every company of the account.');
                  }}
                >
                  <UserX size={16} aria-hidden="true" /> Suspend in the account
                </button>
              )}
            </div>
          </div>
        )}
      </WsDrawer>
    </div>
  );
}
