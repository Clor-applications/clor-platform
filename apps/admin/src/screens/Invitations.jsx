import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RotateCw, Send, XCircle } from 'lucide-react';

import { createInvitation, listInvitations, resendInvitation, revokeInvitation } from '@platform/admin/account';
import { ICON, PageHead, Stat, WsDrawer } from './wsKit';
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
  PENDING: ['Waiting', 'ws-pill ws-pill--off'],
  ACCEPTED: ['Joined', 'ws-pill ws-pill--ok'],
  REVOKED: ['Withdrawn', 'ws-pill'],
  EXPIRED: ['Expired', 'ws-pill'],
};
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The sentence the inviter reads before sending — the spec's "access preview". */
export function accessPreview({ role, companyNames }) {
  const where = companyNames.length ? companyNames.join(', ') : 'no company yet';
  return `Joins as ${String(ROLE_LABEL[role] || 'Member').toLowerCase()} in ${where}. App access comes from roles.`;
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
      const r = await createInvitation({ email: email.trim(), accountRole: role, grants: [...picked].map((orgId) => ({ orgId })) });
      setNotice(r?.seatWarning ? `Invitation sent to ${email.trim()}. Note: ${r.seatWarning}` : `Invitation sent to ${email.trim()}.`);
      setEmail('');
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

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Access', 'Invitations']} scope="account"
          title="Invitations"
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

        {notice ? <p role="status" className="ws-notice">{notice}</p> : null}
        {error && !inviting ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {rows === null ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="ws-empty">
            <span className="ws-tile" aria-hidden="true"><ICON.mail size={20} /></span>
            <p>No invitations yet.</p>
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
                {rows.map((r) => {
                  const [label, pill] = STATUS[r.status] || [r.status, 'ws-pill'];
                  const open = r.status === 'PENDING' || r.status === 'EXPIRED';
                  return (
                    <tr key={r.id}>
                      <td><strong style={{ fontWeight: 600 }}>{r.email}</strong></td>
                      <td>{ROLE_LABEL[r.accountRole] || r.accountRole}</td>
                      <td><span className={pill}>{label}</span></td>
                      <td>{r.status === 'ACCEPTED' ? `Joined ${day(r.acceptedAt)}` : r.status === 'PENDING' ? `Expires ${day(r.expiresAt)}` : `Sent ${day(r.lastSentAt)}`}</td>
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
          <p className="ws-notice" aria-live="polite">{accessPreview({ role, companyNames })}</p>
        </form>
      </WsDrawer>
    </div>
  );
}
