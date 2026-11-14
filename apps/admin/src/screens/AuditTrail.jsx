import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search } from '@ui/components/ui/lineIcons';

import { exportRows } from '@ui/components/ListToolbar';
import { listAudit, listAuditFacets } from '@platform/admin/audit';
import { hasApp } from '@platform/context';
import { AppTag, Avatar, PageHead } from './wsKit';
import { DateFilter, shortWhen, spanFrom } from './AccountActivity';
import './workspace.css';
import './ws-security.css';

/*
 * One trail for the company (ADR-010), with each app's share a tab away: an
 * app's own link opens it on that app (?for=attendance). The server sorts the
 * entries (routes/audit.ts APP_WHERE); only the apps this company uses show.
 */
const AUDIT_APPS = [
  { id: 'company', label: 'Company' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'attendance', label: 'People & Attendance' },
  { id: 'payroll', label: 'Payroll' },
];
/* Which app an entry belongs to, as the server sorts them (routes/audit.ts APP_WHERE). */
const PEOPLE_NAMED = new Set(['Employee', 'PeopleRecord', 'LeaveSettings', 'LeaveAdjustment', 'LeaveAllocation', 'LeaveRequest', 'LeaveType', 'LeaveYearEnd', 'AttendanceRequest', 'AttendanceSettings', 'OvertimeRequest', 'DevicePunch', 'HolidayPick', 'ApprovalStandIn', 'WorkingWeek']);
const COMPANY_NAMED = new Set(['Company', 'User', 'Role', 'UserPermission', 'Features', 'DataProtection', 'Branch', 'Subscription', 'Credential', 'ApprovalRule', 'SSO', 'Security', 'OutsideAccess', 'SupportGrant']);
export const appOfEntity = (entity) => {
  const e = String(entity || '');
  if (/^PEOPLE_/.test(e)) return 'people';
  if (/^ATTENDANCE_/.test(e) || PEOPLE_NAMED.has(e)) return 'attendance';
  if (/^PAYROLL_/.test(e)) return 'payroll';
  if (COMPANY_NAMED.has(e)) return 'workspace';
  return 'accounting';
};
const APP_WORDS = { people: 'People', attendance: 'Attendance', payroll: 'Payroll', workspace: 'Workspace', accounting: 'Accounting' };
const offered = () => AUDIT_APPS.filter((a) => a.id === 'company' || hasApp(a.id) || (a.id === 'attendance' && hasApp('people')));

/**
 * Workspace → Home → Activity (R&D WS-05): who changed what, and when.
 *
 * The trail has been written since the invoice routes were built and could not
 * be read anywhere — an accounting product that records every edit and shows
 * nobody is not keeping an audit trail, it is filling a table.
 *
 * Read-only, and that is the feature. Nothing on this screen edits or removes
 * an entry, because a trail its own product can rewrite is evidence of nothing.
 */

const ENTITY_LABEL = {
  INVOICE: 'Invoice',
  USER: 'User',
  ROLE: 'Role',
  PERMISSION: 'Permission',
  FEATURE: 'Feature setting',
  Features: 'Feature setting',
  /* People's registers (jobs, cases, assets…) are logged as one entity; the message names which. */
  PeopleRecord: 'HR registers',
  /* Time & Leave's field punch review logs the punch by its table name. */
  DevicePunch: 'Field punch',
  ATTENDANCE_PHONE_PUNCHE: 'Phone punch',
};

/*
 * Say what a record is in words. People, Attendance and Payroll log by
 * resource (ATTENDANCE_SHIFT_ASSIGNMENT); this reads it as "Shift assignment",
 * the way Attendance's own log screen did before the trails became one
 * (ADR-010). The log names a resource by dropping a URL's plural "s", which
 * also clips "access".
 */
const entityLabel = (entity) => {
  if (ENTITY_LABEL[entity]) return ENTITY_LABEL[entity];
  const words = String(entity || '')
    .replace(/^(ATTENDANCE|PEOPLE|PAYROLL)_/, '')
    .replace(/_/g, ' ')
    /* Records logged by name (LeaveRequest) read as words too. */
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\bacces\b/g, 'access');
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};

/* An action's pill: made is good news, removed is the one to notice, every other change is plain. Always in words. */
const ACTION_STYLE = {
  CREATE: { className: 'ws-pill ws-pill--ok' },
  DELETE: { className: 'ws-pill ws-pill--danger' },
};
const actionWords = (a) => String(a || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

const ActionPill = ({ action }) => {
  const look = ACTION_STYLE[action] || { className: 'ws-pill' };
  return (
    <span className={look.className} style={look.style} title={action}>
      {actionWords(action)}
    </span>
  );
};

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * The per-field diff the invoice routes record.
 *
 * "Edited" is not an audit entry; `total 12,000 → 1,200` is. Anything that is
 * not a diff — a create, a delete — prints as the values it recorded.
 */
/* A record id (cuid/uuid) says nothing to a reader; a file's contents even less. */
const isId = (v) => typeof v === 'string' && (/^c[a-z0-9]{20,}$/.test(v) || /^[0-9a-f-]{32,36}$/i.test(v));
const isFile = (v) => typeof v === 'string' && v.startsWith('data:');

/** A recorded value as words: lists joined, records as `field: value`, ids and files named rather than printed. */
const valueText = (v, depth = 0) => {
  if (v === null || v === undefined || v === '') return '—';
  if (isFile(v)) return 'a file';
  if (isId(v)) return 'a record';
  if (Array.isArray(v)) return v.map((x) => valueText(x, depth + 1)).join(', ') || '—';
  if (typeof v === 'object') {
    if (depth > 1) return '…';
    return Object.entries(v).map(([k, x]) => `${fieldWords(k)}: ${valueText(x, depth + 1)}`).join(' · ') || '—';
  }
  return String(v);
};
const short = (t) => (t.length > 140 ? `${t.slice(0, 140)}…` : t);

/** `employeeId` → "Employee", `dateOfJoining` → "Date of joining". */
const fieldWords = (k) => {
  const w = String(k).replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : '';
};

/*
 * The general recorder names a request ("POST payroll/loans"); say it as the
 * change it made. Messages written by the routes themselves pass through.
 */
const VERB = { POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Removed' };
export const messageWords = (message, entity, action) => {
  const m = String(message || '').match(/^(POST|PUT|PATCH|DELETE)\s+\/?([\w/-]+)/);
  if (m) {
    const last = m[2].split('/').filter((x) => x && !isId(x) && !/^\d+$/.test(x)).pop() || entity || 'record';
    const noun = last.replace(/-/g, ' ').replace(/ies$/, 'y').replace(/s$/, '');
    return `${VERB[m[1]]} ${noun.replace(/^payroll /, '')}`.replace(/^(\w+) (\w)/, (_, v, c) => `${v} ${c.toLowerCase()}`);
  }
  return message || `${entityLabel(entity)} ${actionWords(action).toLowerCase()}`;
};

/**
 * What changed. A diff reads `Total 12,000 → 1,200`; anything else — what a
 * create or delete recorded — sits behind "Details", in words.
 */
const Changes = ({ metadata }) => {
  if (!metadata || typeof metadata !== 'object') return null;
  const changes = metadata.changes && typeof metadata.changes === 'object' ? metadata.changes : null;
  /* The recorder's own bookkeeping (the path it matched, the ids already on the row) says nothing a reader needs. */
  const entries = Object.entries(changes || metadata).filter(([k]) => k !== 'path' && k !== 'ids');
  if (!entries.length) return null;
  const diffs = entries.filter(([, v]) => v && typeof v === 'object' && 'from' in v);
  const rest = entries.filter(([, v]) => !(v && typeof v === 'object' && 'from' in v));
  return (
    <div className="ws-audit-detail">
      {diffs.length ? (
        <ul className="ws-audit-diffs">
          {diffs.map(([field, v]) => (
            <li key={field}>
              <span className="ws-audit-field">{fieldWords(field)}</span>
              <span className="ws-audit-from">{short(valueText(v.from))}</span>
              <span aria-label="changed to">→</span>
              <span className="ws-audit-to">{short(valueText(v.to))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length ? (
        <details className="ws-audit-more">
          <summary>Details</summary>
          <dl>
            {rest.flatMap(([field, v]) =>
              v && typeof v === 'object' && !Array.isArray(v)
                ? Object.entries(v).map(([k, x]) => [`${field}.${k}`, fieldWords(k), x])
                : [[field, fieldWords(field), v]]
            ).map(([key, label, x]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{short(valueText(x))}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
};

/** A nested setting's path, "lateMarks.graceMinutes", as "Late marks · Grace minutes". */
const pathWords = (k) => String(k).split('.').map(fieldWords).join(' · ');
/** A masked value is said so, never printed as "[hidden]". */
const changedValue = (v) => (v === '[hidden]' ? 'hidden' : short(valueText(v)));

/**
 * The record's before and after values (the audit entry's `changes`, written for roles, sign-in, company
 * settings, People and Attendance). Folded under a line that says how many fields changed; opened, one row
 * per field: "Field  old → new". Masked fields (secrets, Aadhaar, PAN, bank numbers) read "hidden".
 */
export const FieldChanges = ({ changes }) => {
  const rows = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.entries(changes).filter(([, v]) => v && typeof v === 'object' && 'from' in v) : [];
  if (!rows.length) return null;
  return (
    <details className="ws-audit-more">
      <summary>{rows.length === 1 ? `1 field changed: ${pathWords(rows[0][0])}` : `${rows.length} fields changed`}</summary>
      <ul className="ws-audit-diffs" aria-label="Before and after">
        {rows.map(([field, v]) => (
          <li key={field}>
            <span className="ws-audit-field">{pathWords(field)}</span>
            <span className="ws-audit-from">{changedValue(v.from)}</span>
            <span aria-label="changed to">→</span>
            <span className="ws-audit-to">{changedValue(v.to)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
};

export default function AuditTrail({ tenant } = {}) {
  const [entries, setEntries] = useState([]);
  const [facets, setFacets] = useState({ entities: [], actions: [] });
  const [filters, setFilters] = useState(() => {
    let app = '';
    try {
      const asked = new URLSearchParams(window.location.search).get('for');
      app = AUDIT_APPS.some((a) => a.id === asked) ? asked : asked === 'people' ? 'attendance' : '';
    } catch {
      /* no address */
    }
    return { app, entity: '', action: '', from: '', to: '', q: '', userId: '' };
  });
  const [span, setSpan] = useState('');
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');

  const load = useCallback(
    async (opts = {}) => {
      setLoading(true);
      setFailed('');
      try {
        const res = await listAudit({ ...filters, limit: 50, ...(opts.cursor ? { cursor: opts.cursor } : {}) });
        const rows = Array.isArray(res?.entries) ? res.entries : [];
        setEntries((prev) => (opts.cursor ? [...prev, ...rows] : rows));
        setCursor(res?.nextCursor || null);
      } catch (e) {
        setFailed(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listAuditFacets()
      .then((f) => setFacets({ entities: f?.entities || [], actions: f?.actions || [] }))
      .catch(() => {
        // The filters fall back to free text; the list still works.
      });
  }, []);

  const set = (k) => (e) => setFilters((p) => ({ ...p, [k]: e.target.value }));

  const chooseSpan = (v) => {
    setSpan(v);
    if (v !== 'custom') setFilters((p) => ({ ...p, from: spanFrom(v), to: '' }));
  };
  /* People seen in what is loaded, for the Person filter; the server filters on the one chosen. */
  const people = useMemo(() => {
    const m = new Map();
    for (const e of entries) if (e.by?.id && !m.has(e.by.id)) m.set(e.by.id, e.by.name || 'Unknown user');
    if (filters.userId && !m.has(filters.userId)) m.set(filters.userId, 'Chosen person');
    return [...m.entries()];
  }, [entries, filters.userId]);
  const company = tenant?.name || '';

  const download = () =>
    exportRows({
      fileName: 'Audit trail',
      label: 'entries',
      columns: [
        { key: 'when', label: 'When' },
        { key: 'app', label: 'App' },
        { key: 'action', label: 'Action' },
        { key: 'record', label: 'Record' },
        { key: 'message', label: 'What happened' },
        { key: 'by', label: 'By' },
        { key: 'email', label: 'Email' },
        { key: 'company', label: 'Company' },
      ],
      rows: entries.map((e) => ({
        when: when(e.at),
        app: APP_WORDS[appOfEntity(e.entity)],
        action: e.action,
        record: entityLabel(e.entity),
        message: messageWords(e.message, e.entity, e.action),
        by: e.by?.name || 'Unknown user',
        email: e.by?.email || '',
        company,
      })),
    });

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Home', 'Activity']}
          title="Activity"
          description={`What happened in every app${company ? ` at ${company}` : ' in this company'}: who changed what, and when. Read-only; nothing here can be edited or removed.`}
          actions={
            <>
              <button type="button" onClick={() => load()} className="ws-btn ws-btn--quiet" disabled={loading} aria-label={loading ? 'Loading' : 'Refresh'} title="Refresh">
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={download} className="ws-btn ws-btn--quiet" disabled={!entries.length}>
                <Download size={16} aria-hidden="true" /> Export
              </button>
            </>
          }
        />

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search activity</span>
            <input id="audit-q" type="search" value={filters.q} onChange={set('q')} className="ui-input" placeholder="Search activity" />
          </label>
          <select id="audit-app" aria-label="App" value={filters.app} onChange={set('app')} className="ui-select">
            {[{ id: '', label: 'All' }, ...offered()].map((a) => (
              <option key={a.id || 'all'} value={a.id}>{`App: ${a.label}`}</option>
            ))}
          </select>
          <select id="audit-person" aria-label="Person" value={filters.userId} onChange={set('userId')} className="ui-select">
            <option value="">Person: Anyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select id="audit-entity" aria-label="Record" value={filters.entity} onChange={set('entity')} className="ui-select">
            <option value="">Record: All</option>
            {facets.entities.map((e) => (
              <option key={e} value={e}>{entityLabel(e)}</option>
            ))}
          </select>
          <select id="audit-action" aria-label="Action" value={filters.action} onChange={set('action')} className="ui-select">
            <option value="">Action: All</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>{actionWords(a)}</option>
            ))}
          </select>
          <DateFilter span={span} from={filters.from} to={filters.to} onSpan={chooseSpan} onFrom={set('from')} onTo={set('to')} />
        </div>

        {failed ? (
          <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>The activity could not be read: {failed}</p>
        ) : null}

        {!entries.length && !loading ? (
          <p className="ws-card-blurb">Nothing matches these filters.</p>
        ) : !entries.length ? (
          <p className="ws-card-blurb">Loading activity…</p>
        ) : (
          <>
            <div className="ws-table-wrap">
              <table className="ws-table ws-sec-table" aria-label="Activity, newest first">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">App</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Company</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const app = appOfEntity(e.entity);
                    const who = e.by?.name || 'Unknown user';
                    return (
                      <tr key={e.id} data-action={e.action}>
                        <td className="ws-sec-when">
                          <time dateTime={e.at} title={when(e.at)}>{shortWhen(e.at)}</time>
                        </td>
                        <td>
                          <span className="ws-sec-who" title={e.by?.email || undefined}>
                            <Avatar name={who} />
                            <strong>{who}</strong>
                            {e.entity === 'SupportGrant' ? <span className="ws-tag">Staff</span> : null}
                          </span>
                        </td>
                        <td>
                          {app === 'workspace' ? <span className="ws-tag">Workspace</span> : <AppTag app={app} />}
                        </td>
                        <td className="ws-sec-wrap">
                          <span className="ws-sec-what">
                            <span>{messageWords(e.message, e.entity, e.action)}</span>
                            <ActionPill action={e.action} />
                            {e.entity ? <span className="ws-sec-record">{entityLabel(e.entity)}</span> : null}
                          </span>
                          <FieldChanges changes={e.changes} />
                          <Changes metadata={e.metadata} />
                        </td>
                        <td>{company || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <nav className="flex items-center gap-3" aria-label="Pages">
              <span className="ws-head-meta">{entries.length} {entries.length === 1 ? 'entry' : 'entries'} shown</span>
              {cursor ? (
                <button type="button" onClick={() => load({ cursor })} className="ws-btn ws-btn--quiet ws-btn--small" disabled={loading}>
                  {loading ? 'Loading…' : 'Load older entries'}
                </button>
              ) : (
                <span className="ws-head-meta">· the start of the trail</span>
              )}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
