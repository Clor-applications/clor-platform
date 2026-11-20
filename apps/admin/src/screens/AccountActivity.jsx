import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search, ShieldAlert } from '@ui/components/ui/lineIcons';
import { emoji } from '@ui/components/ui/emoji';

import { exportRows } from '@ui/components/ListToolbar';
import { accountAudit } from '@platform/admin/account';
import { enumWords, errorWords } from '@ui/utils/errorWords';
import { Avatar, Empty, FilterSelect, LoadError, Loading, PageHead, StatusPill } from './wsKit';
import './workspace.css';
import './ws-security.css';

/* The colour icon an empty list shows: the one its menu item wears. */
const EMPTY_ICON = emoji('scroll');

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
      <FilterSelect label="Date" value={span} options={DATE_SPANS} onChange={onSpan} />
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
/* Each kind of change in its own colour, as on Access overview: sent blue, joined or put back green,
   changed amber, taken away or refused red. */
export const ACTION_TONE = {
  INVITATION_SENT: '28 84 160',
  INVITATION_RESENT: '28 84 160',
  INVITATION_ACCEPTED: '21 128 61',
  MEMBER_REINSTATED: '21 128 61',
  ACCOUNT_ROLE_CHANGE: '180 83 9',
  MEMBER_SIGNED_OUT: '180 83 9',
  ACCOUNT_RENAMED: '180 83 9',
  MEMBER_SUSPENDED: '185 28 28',
  MEMBER_REMOVED_FROM_COMPANY: '185 28 28',
  ACCESS_DENIED: '185 28 28',
};
/* The metadata keys a person can read, in words; anything else stays out of the page. */
const META_LABELS = { orgName: 'Company', companyName: 'Company', company: 'Company', email: 'Email', role: 'Role', roleName: 'Role', from: 'From', to: 'To', previousRole: 'Was', newRole: 'Now', name: 'Name', reason: 'Reason', app: 'App', plan: 'Plan' };
export const metaRows = (meta) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const seen = new Set();
  return Object.entries(meta)
    .filter(([k, v]) => META_LABELS[k] && (typeof v === 'string' || typeof v === 'number') && String(v).trim())
    .map(([k, v]) => [META_LABELS[k], /^[A-Z][A-Z0-9_]+$/.test(String(v)) ? enumWords(v) : String(v)])
    .filter(([label, v]) => !seen.has(`${label}:${v}`) && seen.add(`${label}:${v}`));
};
export const actionText = (a) => ACTION_WORDS[a] || (a ? enumWords(a) : 'Made a change');

const scopeOf = (e) => e?.metadata?.orgName || e?.metadata?.companyName || e?.metadata?.company || 'Admin center';
const detailOf = (e) => [e.targetName, e.message && e.message !== ACTION_WORDS[e.action] ? e.message : ''].filter(Boolean).join(' · ') || '—';

export default function AccountActivity() {
  const [filters, setFilters] = useState({ action: '', result: '', from: '', to: '', actor: '' });
  const [span, setSpan] = useState('');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  /* The first page did not load: said with a retry, never as "Nothing here yet". */
  const [loadError, setLoadError] = useState('');
  /* "Show older" is out: the button waits, so the same page is not asked for twice. */
  const [older, setOlder] = useState(false);
  /* Search filters what is loaded, 250ms after the last key (PlanChange's pattern), not on every key. */
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [q]);
  /* Each new filter set numbers its request; a reply to an older one is dropped, so a slow answer never overwrites a newer list. */
  const seq = useRef(0);
  const [open, setOpen] = useState('');
  /* People seen so far, for the Person filter: the server filters on the one chosen. */
  const [people, setPeople] = useState([]);

  const load = useCallback((f, cursor) => {
    const mine = cursor ? seq.current : ++seq.current;
    accountAudit({ ...f, cursor: cursor || '' })
      .then((r) => {
        if (mine !== seq.current) return;
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
        setLoadError('');
        setOlder(false);
      })
      .catch((e) => {
        if (mine !== seq.current) return;
        setOlder(false);
        if (cursor) setError(errorWords(e, 'load older events'));
        else {
          setEvents(null);
          setLoadError(errorWords(e, 'load the audit log'));
        }
      });
  }, []);
  useEffect(() => load(filters), [filters, load]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pick = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));
  const chooseSpan = (v) => {
    setSpan(v);
    if (v !== 'custom') setFilters((f) => ({ ...f, from: spanFrom(v), to: '' }));
  };

  /* Search reads what is loaded: the server filters by kind, result, person and dates. */
  const shown = useMemo(() => {
    if (!events || !needle) return events;
    return events.filter((e) => [actionText(e.action), e.actor?.name, e.targetName, e.message, scopeOf(e)].join(' ').toLowerCase().includes(needle));
  }, [events, needle]);
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
        action: actionText(e.action),
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
            <input type="search" className="ui-input" placeholder="Search by person, action or detail" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {/* Menus, not native selects (owner, 19 Nov 2026). */}
          <FilterSelect label="Person" value={filters.actor} onChange={pick('actor')} options={[['', 'Anyone'], ...people.map((p) => [p.id, p.name])]} />
          <FilterSelect label="Action" ariaLabel="What happened" value={filters.action} onChange={pick('action')} width="16rem" options={[['', 'All'], ...Object.entries(ACTION_WORDS)]} />
          <FilterSelect label="Result" value={filters.result} onChange={pick('result')} width="12rem" options={[['', 'Done or refused'], ['OK', 'Done'], ['DENIED', 'Refused']]} />
          <DateFilter span={span} from={filters.from} to={filters.to} onSpan={chooseSpan} onFrom={set('from')} onTo={set('to')} />
        </div>

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        {shown === null && loadError ? (
          <LoadError onRetry={() => { setLoadError(''); load(filters); }}>{loadError}</LoadError>
        ) : shown === null ? (
          <Loading shape="rows" label="Loading the audit log…" />
        ) : shown.length === 0 ? (
          <Empty icon={EMPTY_ICON} compact>Nothing here{filtered ? ' for these filters' : ' yet'}.</Empty>
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
                          <Avatar name={e.actor?.name || 'Someone'} />
                          <strong>{e.actor?.name || 'Someone'}</strong>
                        </span>
                      </td>
                      <td>
                        <span className="ws-sec-action">
                          <button type="button" className="ws-tag ws-sec-tagbtn" style={{ '--tag': ACTION_TONE[e.result === 'DENIED' ? 'ACCESS_DENIED' : e.action] || '92 90 84' }} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? '' : e.id)}>
                            {e.result === 'DENIED' ? <ShieldAlert size={14} aria-hidden="true" /> : null}
                            {actionText(e.action)}
                          </button>
                          {e.result === 'DENIED' ? <StatusPill tone="danger">Refused</StatusPill> : null}
                        </span>
                      </td>
                      <td className="ws-sec-wrap">{detailOf(e)}</td>
                      <td>{scopeOf(e) === 'Admin center' ? <span className="ws-tag ws-tag--workspace">Admin center</span> : scopeOf(e)}</td>
                    </tr>
                    {open === e.id ? (
                      <tr className="ws-sec-detail">
                        <td colSpan={5}>
                          <dl>
                            <dt>When</dt>
                            <dd>{when(e.at)}</dd>
                            {e.message ? (<><dt>What</dt><dd>{e.message}</dd></>) : null}
                            {metaRows(e.metadata).map(([label, v]) => (<React.Fragment key={`${label}:${v}`}><dt>{label}</dt><dd>{v}</dd></React.Fragment>))}
                            {e.requestId ? (<><dt>Error code</dt><dd className="ui-mono">{e.requestId}</dd></>) : null}
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
          <button type="button" className="ws-btn ws-btn--quiet" style={{ justifySelf: 'start' }} disabled={older} aria-busy={older || undefined} onClick={() => { if (older) return; setOlder(true); load(filters, next); }}>
            {older ? 'Loading older…' : 'Show older'}
          </button>
        ) : null}
        <p className="ws-foot-note">What CLOR support asks to see, and every look it is let in for, is recorded under Activity with who approved it.</p>
      </div>
    </div>
  );
}
