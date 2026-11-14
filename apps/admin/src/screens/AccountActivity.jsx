import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Search, ShieldAlert } from '@ui/components/ui/lineIcons';

import { exportRows } from '@ui/components/ListToolbar';
import { accountAudit } from '@platform/admin/account';
import { PageHead, StatusPill } from './wsKit';
import './workspace.css';
import './ws-security.css';

/**
 * Workspace → Security → Audit log (W-7.2; R&D WS-13): what was done to the
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
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "Today 10:14", "Yesterday 17:02", else "12 Nov 18:30": the design's short when. */
export const shortWhen = (d) => {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const time = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (isoDay(t) === isoDay(today)) return `Today ${time}`;
  if (isoDay(t) === isoDay(yesterday)) return `Yesterday ${time}`;
  return `${t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', ...(t.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })} ${time}`;
};

/** The date filter as the design draws it: a few spans, and your own dates. Sets `from`/`to` (yyyy-mm-dd). */
export const DATE_SPANS = [
  ['', 'Any time'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['custom', 'Choose dates'],
];
export const spanFrom = (span) => (/^\d+$/.test(span) ? isoDay(new Date(Date.now() - (Number(span) - 1) * 86_400_000)) : '');

export function DateFilter({ span, from, to, onSpan, onFrom, onTo }) {
  return (
    <>
      <select className="ui-select" aria-label="Date" value={span} onChange={(e) => onSpan(e.target.value)}>
        {DATE_SPANS.map(([v, l]) => (
          <option key={v || 'any'} value={v}>{`Date: ${l}`}</option>
        ))}
      </select>
      {span === 'custom' ? (
        <>
          <input type="date" className="ui-input" aria-label="From" value={from} onChange={onFrom} />
          <input type="date" className="ui-input" aria-label="To" value={to} onChange={onTo} />
        </>
      ) : null}
    </>
  );
}

/** Which company an event was about, when it says; otherwise it was the workspace itself. */
const scopeOf = (e) => e?.metadata?.orgName || e?.metadata?.companyName || e?.metadata?.company || 'Workspace';
const detailOf = (e) => [e.targetName, e.message && e.message !== ACTION_WORDS[e.action] ? e.message : ''].filter(Boolean).join(' · ') || '—';

export default function AccountActivity() {
  const [filters, setFilters] = useState({ action: '', result: '', from: '', to: '', actor: '' });
  const [span, setSpan] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  /* People seen so far, for the Person filter: the server filters on the one chosen. */
  const [people, setPeople] = useState([]);

  const load = useCallback((f, cursor) => {
    accountAudit({ ...f, cursor: cursor || '' })
      .then((r) => {
        /* An older page is appended; an event already shown is not shown twice. */
        setEvents((prev) => {
          if (!cursor) return r?.events || [];
          const seen = new Set((prev || []).map((e) => e.id));
          return [...(prev || []), ...(r?.events || []).filter((e) => !seen.has(e.id))];
        });
        setPeople((prev) => {
          const m = new Map(prev.map((p) => [p.id, p.name]));
          for (const e of r?.events || []) if (e.actor?.id && !m.has(e.actor.id)) m.set(e.actor.id, e.actor.name || 'Someone');
          return [...m.entries()].map(([id, name]) => ({ id, name }));
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
  const chooseSpan = (v) => {
    setSpan(v);
    if (v !== 'custom') setFilters((f) => ({ ...f, from: spanFrom(v), to: '' }));
  };

  /* Search reads what is loaded: the server filters by kind, result, person and dates. */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!events || !needle) return events;
    return events.filter((e) => [ACTION_WORDS[e.action] || e.action, e.actor?.name, e.targetName, e.message, scopeOf(e)].join(' ').toLowerCase().includes(needle));
  }, [events, q]);
  const filtered = Boolean(filters.action || filters.result || filters.from || filters.to || filters.actor || q);

  const download = () =>
    exportRows({
      fileName: 'Audit log',
      label: 'events',
      columns: [
        { key: 'when', label: 'When' },
        { key: 'who', label: 'Who' },
        { key: 'action', label: 'Action' },
        { key: 'result', label: 'Result' },
        { key: 'detail', label: 'Detail' },
        { key: 'scope', label: 'Scope' },
      ],
      rows: (shown || []).map((e) => ({
        when: when(e.at),
        who: e.actor?.name || 'Someone',
        action: ACTION_WORDS[e.action] || e.action,
        result: e.result === 'DENIED' ? 'Refused' : 'Done',
        detail: detailOf(e),
        scope: scopeOf(e),
      })),
    });

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Audit log']}
          scope="account"
          title="Audit log"
          description="Changes to members, roles, plan and security, and every change that was refused. Each app also keeps its own detailed log under Activity."
          actions={
            <button type="button" className="ws-btn ws-btn--quiet" onClick={download} disabled={!shown?.length}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
          }
        />

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search</span>
            <input type="search" className="ui-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="ui-select" aria-label="Person" value={filters.actor} onChange={set('actor')}>
            <option value="">Person: Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="What happened" value={filters.action} onChange={set('action')}>
            <option value="">Action: All</option>
            {Object.entries(ACTION_WORDS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className="ui-select" aria-label="Result" value={filters.result} onChange={set('result')}>
            <option value="">Result: Done or refused</option>
            <option value="OK">Done</option>
            <option value="DENIED">Refused</option>
          </select>
          <DateFilter span={span} from={filters.from} to={filters.to} onSpan={chooseSpan} onFrom={set('from')} onTo={set('to')} />
        </div>

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {shown === null ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="ws-card-blurb">Nothing here{filtered ? ' for these filters' : ' yet'}.</p>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table ws-sec-table" aria-label="Audit log, newest first">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Detail</th>
                  <th scope="col">Scope</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <React.Fragment key={e.id}>
                    <tr data-selected={open === e.id || undefined}>
                      <td className="ws-sec-when">
                        <time dateTime={e.at} title={when(e.at)}>{shortWhen(e.at)}</time>
                      </td>
                      <td>
                        <span className="ws-sec-who">
                          <strong>{e.actor?.name || 'Someone'}</strong>
                        </span>
                      </td>
                      <td>
                        <span className="ws-sec-action">
                          <button type="button" className="ws-tag ws-sec-tagbtn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? '' : e.id)}>
                            {e.result === 'DENIED' ? <ShieldAlert size={14} aria-hidden="true" /> : null}
                            {ACTION_WORDS[e.action] || e.action}
                          </button>
                          {e.result === 'DENIED' ? <StatusPill tone="danger">Refused</StatusPill> : null}
                        </span>
                      </td>
                      <td className="ws-sec-wrap">{detailOf(e)}</td>
                      <td>{scopeOf(e)}</td>
                    </tr>
                    {open === e.id ? (
                      <tr className="ws-sec-detail">
                        <td colSpan={5}>
                          <dl>
                            <dt>When</dt>
                            <dd>{when(e.at)}</dd>
                            {e.message ? (<><dt>What</dt><dd>{e.message}</dd></>) : null}
                            {e.metadata ? (<><dt>Details</dt><dd className="ui-mono break-all">{JSON.stringify(e.metadata)}</dd></>) : null}
                            {e.requestId ? (<><dt>Request</dt><dd className="ui-mono">{e.requestId}</dd></>) : null}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next ? (
          <button type="button" className="ws-btn ws-btn--quiet" style={{ justifySelf: 'start' }} onClick={() => load(filters, next)}>
            Show older
          </button>
        ) : null}
        <p className="ws-foot-note">What CLOR support asks to see, and every look it is let in for, is recorded under Activity with who approved it.</p>
      </div>
    </div>
  );
}
