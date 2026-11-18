import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RotateCw, Send, XCircle } from '@ui/components/ui/lineIcons';

import { createInvitation, listInvitations, resendInvitation, revokeInvitation } from '@platform/admin/account';
import { listRoles } from '@platform/admin/admin';
import { ICON, Loading, PageHead, Stat, WsDrawer } from './wsKit';
import './workspace.css';

/**
 * Workspace → Invitations (W-3).
 *
 * Inviting replaces "an administrator types a password for somebody else":
 * the person gets a link and chooses their own. The form says in plain words
 * what the person will get before it is sent (the access preview), and the
 * list shows every invitation's state with resend and revoke.
 *
 * The server decides everything shown here: who may invite (owners and
 * administrators), which roles may be given (never owner), and whether the
 * companies are the account's. This screen only asks and reports.
 */

const ROLES = [
  ['MEMBER', 'Member', 'Access comes from company roles.'],
  ['ADMIN', 'Administrator', 'Adds companies and invites people.'],
  ['BILLING_ADMIN', 'Billing admin', 'Can see the account, its plan and billing.'],
];
const ROLE_LABEL = Object.fromEntries(ROLES.map(([k, l]) => [k, l]));
const STATUS = {
  PENDING: ['Waiting', 'ws-pill ws-pill--warn'],
  ACCEPTED: ['Joined', 'ws-pill ws-pill--ok'],
  REVOKED: ['Withdrawn', 'ws-pill ws-pill--neutral'],
  EXPIRED: ['Expired', 'ws-pill ws-pill--neutral'],
};
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The sentence the inviter reads before sending — the spec's "access preview". */
export function accessPreview({ role, companyNames, companyRole = null }) {
  const where = companyNames.length ? companyNames.join(', ') : 'no company yet';
  const first = `Joins as ${String(ROLE_LABEL[role] || 'Member').toLowerCase()} in ${where}.`;
  /* With a role chosen the sentence says what they can do on day one; without, that somebody still has to give one. */
  return companyRole ? `${first} Works as ${companyRole.name} in ${companyRole.company} from the first sign-in.` : `${first} App access comes from roles.`;
}

export default function Invitations({ tenant, companies = [] }) {
  const accountCompanies = useMemo(() => (companies.length ? companies : tenant ? [tenant] : []), [companies, tenant]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [picked, setPicked] = useState(() => new Set(tenant?.id ? [tenant.id] : []));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [inviting, setInviting] = useState(false);
  /*
   * The role they start with in the company being worked in. Without one the person joined able to
   * open nothing, and an administrator then had to find them under Company users to finish the job.
   * Roles belong to a company and are read for the open one only, so the choice is offered for it;
   * a role in another company is given from that company. null: not read, or not this person's to give.
   */
  const [roles, setRoles] = useState(null);
  const [roleId, setRoleId] = useState('');
  useEffect(() => {
    if (!inviting || roles || !tenant?.id) return;
    listRoles(tenant.id)
      .then((r) => setRoles(Array.isArray(r?.roles) ? r.roles : []))
      .catch(() => setRoles([]));
  }, [inviting, roles, tenant?.id]);

  const load = useCallback(() => {
    listInvitations()
      .then((r) => setRows(r?.invitations || []))
      .catch((e) => {
        setRows([]);
        setError(String(e?.message || 'Could not load invitations.'));
      });
  }, []);
  useEffect(load, [load]);

  const companyNames = accountCompanies.filter((c) => picked.has(c.id)).map((c) => c.name);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && picked.size > 0;

  const send = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await createInvitation({ email: email.trim(), accountRole: role, grants: [...picked].map((orgId) => ({ orgId, ...(orgId === tenant?.id && roleId ? { roleIds: [roleId] } : {}) })) });
      setNotice(r?.seatWarning ? `Invitation sent to ${email.trim()}. Note: ${r.seatWarning}` : `Invitation sent to ${email.trim()}.`);
      setEmail('');
      setRoleId('');
      setInviting(false);
      load();
    } catch (err) {
      setError(String(err?.message || 'Could not send the invitation.'));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, id, done) => {
    setError('');
    setNotice('');
    try {
      await fn(id);
      setNotice(done);
      load();
    } catch (err) {
      setError(String(err?.message || 'That did not work.'));
    }
  };

  const count = (st) => (rows || []).filter((r) => r.status === st).length;
  /* Round 60 pendinginvites A: everyone who has not joined yet, one list, sent again one by one or all at once. */
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const notJoined = (rows || []).filter((r) => r.status === 'PENDING' || r.status === 'EXPIRED');
  const shown = onlyWaiting ? notJoined : rows || [];
  const [sendingAll, setSendingAll] = useState(false);
  const sendAll = async () => {
    if (!notJoined.length || sendingAll) return;
    setSendingAll(true);
    setError('');
    setNotice('');
    let sent = 0;
    const failed = [];
    for (const r of notJoined) {
      try {
        await resendInvitation(r.id);
        sent += 1;
      } catch {
        failed.push(r.email);
      }
    }
    setSendingAll(false);
    if (sent) setNotice(`Sent again to ${sent === 1 ? 'one person' : `${sent} people`}.`);
    if (failed.length) setError(`Not sent to ${failed.join(', ')}. Try them one by one.`);
    load();
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Users & access', 'Invitations']} scope="account"
          title="Invitations"
          description="People invited to this account. They choose their own password; a link lasts 7 days."
          actions={
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => { setInviting(true); setNotice(''); setError(''); }}>
              <Plus size={16} aria-hidden="true" /> Invite people
            </button>
          }
        />

        {rows?.length ? (
          <div className="ws-stats">
            <Stat icon={ICON.mail} label="Waiting" value={count('PENDING')} note="Link not used yet" />
            <Stat icon={ICON.people} label="Joined" value={count('ACCEPTED')} />
            <Stat icon={ICON.warning} tone={count('EXPIRED') ? 'warn' : null} label="Expired" value={count('EXPIRED')} note={count('EXPIRED') ? 'Resend to try again' : undefined} />
          </div>
        ) : null}

        {notJoined.length ? (
          <div className="ui-not-joined" role="group" aria-label="People who have not joined">
            <button type="button" className={`ui-chip-toggle${onlyWaiting ? ' is-on' : ''}`} aria-pressed={onlyWaiting} onClick={() => setOnlyWaiting((v) => !v)}>
              Not joined yet <span className="tabular-nums">{notJoined.length}</span>
            </button>
            <button type="button" className="ws-btn ws-btn--small" disabled={sendingAll} onClick={sendAll}>
              <Send size={14} aria-hidden="true" /> {sendingAll ? 'Sending…' : notJoined.length === 1 ? 'Send again' : `Send again to all ${notJoined.length}`}
            </button>
          </div>
        ) : null}

        {notice ? <p role="status" className="ws-notice">{notice}</p> : null}
        {error && !inviting ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {rows === null ? (
          <Loading shape="rows" label="Loading…" />
        ) : rows.length === 0 ? (
          <div className="ws-empty">
            <span className="ws-tile" aria-hidden="true"><ICON.mail size={20} /></span>
            <p>No invitations yet.</p>
            <button type="button" className="ws-btn" onClick={() => { setInviting(true); setNotice(''); setError(''); }}>Invite the first person</button>
          </div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Invitations sent</caption>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Account role</th>
                  <th>Status</th>
                  <th>When</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const [label, pill] = STATUS[r.status] || [r.status, 'ws-pill'];
                  const open = r.status === 'PENDING' || r.status === 'EXPIRED';
                  return (
                    <tr key={r.id}>
                      <td><strong style={{ fontWeight: 600 }}>{r.email}</strong></td>
                      <td>{ROLE_LABEL[r.accountRole] || r.accountRole}</td>
                      <td><span className={pill}>{label}</span></td>
                      <td>{r.status === 'ACCEPTED' ? `Joined ${day(r.acceptedAt)}` : r.status === 'PENDING' ? <>{r.lastSentAt ? <span className="block">Invited {day(r.lastSentAt)}</span> : null}<span className="ws-cell-sub">Expires {day(r.expiresAt)}</span></> : `Sent ${day(r.lastSentAt)}`}</td>
                      <td className="num">
                        {open ? (
                          <span className="inline-flex gap-2">
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => act(resendInvitation, r.id, `Sent again to ${r.email}.`)}>
                              <RotateCw size={14} aria-hidden="true" /> Resend
                            </button>
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => act(revokeInvitation, r.id, `Withdrew the invitation to ${r.email}.`)}>
                              <XCircle size={14} aria-hidden="true" /> Withdraw
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WsDrawer
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite people"
        description="They choose their own password. The link expires in 7 days."
        actions={
          <>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setInviting(false)}>Cancel</button>
            <button type="submit" form="ws-invite" className="ws-btn ws-btn--primary" disabled={!valid || busy}>
              <Send size={16} aria-hidden="true" /> {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </>
        }
      >
        <form id="ws-invite" className="grid gap-5" onSubmit={send}>
          {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
          <label className="grid">
            <span>Email address</span>
            <input className="ui-input" type="email" autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.in" required />
          </label>
          <div className="grid">
            <label htmlFor="ws-invite-role" className="text-sm">Account role</label>
            <select id="ws-invite-role" className="ui-select" value={role} onChange={(e) => setRole(e.target.value)} aria-describedby="ws-invite-role-help">
              {ROLES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
            <span id="ws-invite-role-help" className="ui-caption">{ROLES.find(([k]) => k === role)?.[2]}</span>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium" style={{ marginBottom: 6 }}>Companies</legend>
            {accountCompanies.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          {roles?.length && tenant?.id && picked.has(tenant.id) ? (
            <div className="grid">
              <label htmlFor="ws-invite-company-role" className="text-sm">Role in {tenant.name}</label>
              <select id="ws-invite-company-role" className="ui-select" value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-describedby="ws-invite-company-role-help">
                <option value="">No role yet</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <span id="ws-invite-company-role-help" className="ui-caption">
                {roleId ? 'The role decides which apps and screens they can open.' : 'Without a role they can sign in but open no app until somebody gives one.'}
                {picked.size > 1 ? ' A role in another company is given from that company.' : ''}
              </span>
            </div>
          ) : null}
          <p className="ws-notice" aria-live="polite">{accessPreview({ role, companyNames, companyRole: roleId && picked.has(tenant?.id) ? { name: roles?.find((r) => r.id === roleId)?.name || 'the chosen role', company: tenant?.name || 'this company' } : null })}</p>
        </form>
      </WsDrawer>
    </div>
  );
}
