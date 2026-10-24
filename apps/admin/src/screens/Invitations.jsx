import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, RotateCw, Send, XCircle } from 'lucide-react';

import { createInvitation, listInvitations, resendInvitation, revokeInvitation } from '@platform/admin/account';
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
  ['MEMBER', 'Member', 'Belongs to the account. What they can do in a company comes from the roles given there.'],
  ['ADMIN', 'Administrator', 'Can add companies, invite people and change account roles — not the owners.'],
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
export function accessPreview({ email, role, companyNames, accountName }) {
  const who = email || 'This person';
  const where = companyNames.length ? companyNames.join(', ') : 'no company yet';
  return `${who} will join ${accountName || 'the account'} as ${String(ROLE_LABEL[role] || 'Member').toLowerCase()} and get into ${where}. They get no app roles until someone gives them one under Roles.`;
}

export default function Invitations({ tenant, companies = [], accountName = '' }) {
  const accountCompanies = useMemo(() => (companies.length ? companies : tenant ? [tenant] : []), [companies, tenant]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [picked, setPicked] = useState(() => new Set(tenant?.id ? [tenant.id] : []));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

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

  return (
    <div className="ws">
      <div className="ws-inner">
        <header className="ws-head">
          <div>
            <h1 className="ws-title">Invitations</h1>
            <p className="ws-lede">Invite people by email. They choose their own password; the link works once and expires in 7 days.</p>
          </div>
        </header>

        <form className="ws-setup" onSubmit={send} aria-labelledby="ws-invite-title">
          <h2 id="ws-invite-title" className="ws-h2">Invite someone</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-sm font-medium">Email address</span>
              <input className="ui-input" type="email" autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.in" required />
            </label>
            <div className="grid gap-1">
              <label htmlFor="ws-invite-role" className="text-sm font-medium">Account role</label>
              <select id="ws-invite-role" className="ui-select" value={role} onChange={(e) => setRole(e.target.value)} aria-describedby="ws-invite-role-help">
                {ROLES.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
              <span id="ws-invite-role-help" className="ws-card-blurb">{ROLES.find(([k]) => k === role)?.[2]}</span>
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium mb-1">Companies</legend>
            <div className="flex flex-wrap gap-2">
              {accountCompanies.map((c) => (
                <label key={c.id} className="ws-pill" style={{ cursor: 'pointer', padding: '6px 12px' }}>
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
            </div>
          </fieldset>
          <p className="ws-card-blurb" aria-live="polite">
            {accessPreview({ email: email.trim(), role, companyNames, accountName })}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="ws-btn ws-btn--primary" disabled={!valid || busy}>
              <Send size={16} aria-hidden="true" /> {busy ? 'Sending…' : 'Send invitation'}
            </button>
            {notice ? <span role="status" className="text-sm">{notice}</span> : null}
          </div>
          {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
        </form>

        <section className="ws-section" aria-labelledby="ws-inv-list">
          <div className="ws-section-head">
            <h2 id="ws-inv-list" className="ws-h2">Sent</h2>
          </div>
          {rows === null ? (
            <p className="ws-card-blurb">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="ws-setup" style={{ justifyItems: 'start' }}>
              <Mail size={20} aria-hidden="true" />
              <p className="ws-card-blurb">No invitations yet. Invite the first person above.</p>
            </div>
          ) : (
            <ul className="ws-admin" role="list" style={{ gridTemplateColumns: '1fr' }}>
              {rows.map((r) => {
                const [label, pill] = STATUS[r.status] || [r.status, 'ws-pill'];
                const open = r.status === 'PENDING' || r.status === 'EXPIRED';
                return (
                  <li key={r.id} className="ws-group" style={{ padding: '14px 16px' }}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{r.email}</span>
                      <span className={pill}>{label}</span>
                      <span className="ws-card-blurb" style={{ marginTop: 0 }}>
                        {ROLE_LABEL[r.accountRole] || r.accountRole} · {r.status === 'ACCEPTED' ? `joined ${day(r.acceptedAt)}` : r.status === 'PENDING' ? `expires ${day(r.expiresAt)}` : `sent ${day(r.lastSentAt)}`}
                      </span>
                      {open ? (
                        <span className="ml-auto flex gap-2">
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => act(resendInvitation, r.id, `Sent again to ${r.email}; the old link no longer works.`)}>
                            <RotateCw size={14} aria-hidden="true" /> Resend
                          </button>
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => act(revokeInvitation, r.id, `Withdrew the invitation to ${r.email}.`)}>
                            <XCircle size={14} aria-hidden="true" /> Withdraw
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
