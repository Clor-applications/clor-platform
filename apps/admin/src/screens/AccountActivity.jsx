import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { accountAudit } from '@platform/admin/account';
import './workspace.css';

/**
 * Workspace → Security → Account activity (W-7.2): what was done to the
 * account itself — account roles, invitations, suspensions, removals — and
 * every account-level change that was refused. The company's own audit trail
 * (documents, settings) stays under Audit trail; this is the level above it.
 * Newest first; the server scopes it to this account and its administrators.
 */
export const ACTION_WORDS = {
  ACCOUNT_ROLE_CHANGE: 'Account role changed',
  INVITATION_SENT: 'Invitation sent',
  INVITATION_RESENT: 'Invitation sent again',
  INVITATION_REVOKED: 'Invitation withdrawn',
  INVITATION_ACCEPTED: 'Invitation accepted',
  MEMBER_SUSPENDED: 'Suspended in the account',
  MEMBER_REINSTATED: 'Reinstated in the account',
  MEMBER_REMOVED_FROM_COMPANY: 'Removed from a company',
  MEMBER_SIGNED_OUT: 'Signed out everywhere',
  ACCOUNT_RENAMED: 'Account renamed',
  ACCESS_DENIED: 'Refused: needs an account role',
};
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AccountActivity() {
  const [filters, setFilters] = useState({ action: '', result: '', from: '', to: '' });
  const [events, setEvents] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');

  const load = useCallback((f, cursor) => {
    accountAudit({ ...f, cursor: cursor || '' })
      .then((r) => {
        /* An older page is appended; an event already shown is not shown twice. */
        setEvents((prev) => {
          if (!cursor) return r?.events || [];
          const seen = new Set((prev || []).map((e) => e.id));
          return [...(prev || []), ...(r?.events || []).filter((e) => !seen.has(e.id))];
        });
        setNext(r?.next || null);
        setError('');
      })
      .catch((e) => {
        setEvents((prev) => prev || []);
        setError(String(e?.message || 'Could not load the account’s activity.'));
      });
  }, []);
  useEffect(() => load(filters), [filters, load]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="ws">
      <div className="ws-inner">
        <header className="ws-head">
          <div>
            <h1 className="ws-title">Account activity</h1>
          </div>
        </header>

        <div className="flex flex-wrap gap-2 items-end" role="search">
          <select className="ui-select" aria-label="What happened" value={filters.action} onChange={set('action')} style={{ width: 'auto' }}>
            <option value="">Everything</option>
            {Object.entries(ACTION_WORDS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="Result" value={filters.result} onChange={set('result')} style={{ width: 'auto' }}>
            <option value="">Done or refused</option>
            <option value="OK">Done</option>
            <option value="DENIED">Refused</option>
          </select>
          <label className="grid gap-1 text-sm">
            <span>From</span>
            <input type="date" className="ui-input" value={filters.from} onChange={set('from')} />
          </label>
          <label className="grid gap-1 text-sm">
            <span>To</span>
            <input type="date" className="ui-input" value={filters.to} onChange={set('to')} />
          </label>
        </div>

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {events === null ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : events.length === 0 ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">Nothing here{filters.action || filters.result || filters.from || filters.to ? ' for these filters' : ' yet'}.</p>
          </div>
        ) : (
          <ol className="ws-group" style={{ padding: 0 }} aria-label="Account activity, newest first">
            {events.map((e) => (
              <li key={e.id} style={{ borderBottom: '1px solid rgb(var(--ws-line))' }}>
                <button type="button" className="ws-row" style={{ minHeight: 52, padding: '8px 16px' }} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? '' : e.id)}>
                  {e.result === 'DENIED' ? <ShieldAlert size={16} aria-hidden="true" /> : null}
                  <span className="grid" style={{ flex: 1, minWidth: 0 }}>
                    <span className="font-medium">
                      {ACTION_WORDS[e.action] || e.action}
                      {e.targetName ? `: ${e.targetName}` : ''}
                    </span>
                    <span className="ws-card-blurb" style={{ marginTop: 0 }}>
                      {e.actor?.name || 'Someone'} · {when(e.at)}
                    </span>
                  </span>
                  <span className={e.result === 'DENIED' ? 'ws-pill' : 'ws-pill ws-pill--ok'}>{e.result === 'DENIED' ? 'Refused' : 'Done'}</span>
                </button>
                {open === e.id ? (
                  <dl className="grid gap-1 text-sm" style={{ padding: '0 16px 12px 16px', gridTemplateColumns: 'max-content 1fr', columnGap: 16 }}>
                    {e.message ? (<><dt className="ui-muted">What</dt><dd>{e.message}</dd></>) : null}
                    {e.metadata ? (<><dt className="ui-muted">Details</dt><dd className="ui-mono break-all">{JSON.stringify(e.metadata)}</dd></>) : null}
                    {e.requestId ? (<><dt className="ui-muted">Request</dt><dd className="ui-mono">{e.requestId}</dd></>) : null}
                  </dl>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {next ? (
          <button type="button" className="ws-btn ws-btn--quiet" style={{ justifySelf: 'start' }} onClick={() => load(filters, next)}>
            Show older
          </button>
        ) : null}
      </div>
    </div>
  );
}
