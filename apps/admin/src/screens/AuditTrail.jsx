import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';

import { exportRows } from '@ui/components/ListToolbar';
import { listAudit, listAuditFacets } from '@platform/admin/audit';
import { hasApp } from '@platform/context';
import { PageHead } from './wsKit';
import './workspace.css';

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
const offered = () => AUDIT_APPS.filter((a) => a.id === 'company' || hasApp(a.id) || (a.id === 'attendance' && hasApp('people')));

/**
 * Who changed what, and when.
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
    .toLowerCase()
    .replace(/\bacces\b/g, 'access');
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};

/* An action's pill: made is good news, removed is the one to notice, every other change is plain. Always in words. */
const ACTION_STYLE = {
  CREATE: { className: 'ws-pill ws-pill--ok' },
  DELETE: { className: 'ws-pill', style: { color: 'rgb(var(--ws-danger))', background: 'rgb(var(--ws-danger-soft))' } },
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
/** A recorded value as words: lists joined, records as `field: value`, cut short. */
const valueText = (v, depth = 0) => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => valueText(x, depth + 1)).join(', ') || '—';
  if (typeof v === 'object') {
    if (depth > 1) return '…';
    return Object.entries(v).map(([k, x]) => `${k}: ${valueText(x, depth + 1)}`).join(' · ') || '—';
  }
  return String(v);
};
const short = (t) => (t.length > 180 ? `${t.slice(0, 180)}…` : t);

const Changes = ({ metadata }) => {
  if (!metadata || typeof metadata !== 'object') return null;
  const changes = metadata.changes && typeof metadata.changes === 'object' ? metadata.changes : null;
  /* The general recorder's own bookkeeping (the path it matched, ids already in the row) says nothing a reader needs. */
  const entries = Object.entries(changes || metadata).filter(([k, v]) => k !== 'path' && !(k === 'ids' && (!Array.isArray(v) || !v.length)));
  if (!entries.length) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {entries.map(([field, v]) => (
        <div key={field} className="ws-head-meta" style={{ whiteSpace: 'normal' }}>
          <span>{field}</span>{' '}
          {v && typeof v === 'object' && 'from' in v ? (
            <>
              <span className="ui-mono" style={{ color: 'rgb(var(--ws-ink))' }}>{String(v.from ?? '—')}</span>
              <span> → </span>
              <span className="ui-mono" style={{ color: 'rgb(var(--ws-ink))' }}>{String(v.to ?? '—')}</span>
            </>
          ) : (
            <span className="ui-mono" style={{ color: 'rgb(var(--ws-ink))' }}>{short(valueText(v))}</span>
          )}
        </div>
      ))}
    </div>
  );
};

export default function AuditTrail() {
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
    return { app, entity: '', action: '', from: '', to: '', q: '' };
  });
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

  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const e of entries) {
      const d = new Date(e.at);
      const key = Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString(undefined, { dateStyle: 'full' });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    return [...byDay.entries()];
  }, [entries]);

  const download = () =>
    exportRows({
      fileName: 'Audit trail',
      label: 'entries',
      columns: [
        { key: 'when', label: 'When' },
        { key: 'action', label: 'Action' },
        { key: 'record', label: 'Record' },
        { key: 'message', label: 'What happened' },
        { key: 'by', label: 'By' },
        { key: 'email', label: 'Email' },
      ],
      rows: entries.map((e) => ({
        when: when(e.at),
        action: e.action,
        record: entityLabel(e.entity),
        message: e.message || `${entityLabel(e.entity)} ${e.action}`,
        by: e.by?.name || 'Unknown user',
        email: e.by?.email || '',
      })),
    });

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Security', 'Audit trail']}
          title="Audit trail"
          actions={
            <>
              <button type="button" onClick={() => load()} className="ws-btn ws-btn--quiet" disabled={loading}>
                <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button" onClick={download} className="ws-btn ws-btn--primary" disabled={!entries.length}>
                <Download size={16} aria-hidden="true" /> Export shown
              </button>
            </>
          }
        />

        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Whose changes">
          {[{ id: '', label: 'Everything' }, ...offered()].map((a) => {
            const on = filters.app === a.id;
            return (
              <button
                key={a.id || 'all'}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setFilters((p) => ({ ...p, app: a.id }))}
                className="ws-btn ws-btn--quiet ws-btn--small"
                style={on ? { background: 'rgb(var(--ws-accent-soft))', borderColor: 'rgb(var(--ws-accent) / 0.35)', color: 'rgb(var(--ws-accent-hover))' } : undefined}
              >
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3" role="search">
          <label className="relative grid gap-1 flex-1 min-w-[14rem]">
            <span className="text-sm font-medium">Contains</span>
            <span className="relative">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
              <input id="audit-q" type="text" value={filters.q} onChange={set('q')} className="ui-input w-full" style={{ paddingLeft: '2.25rem' }} placeholder="Invoice number, name…" />
            </span>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Record</span>
            <select id="audit-entity" value={filters.entity} onChange={set('entity')} className="ui-select">
              <option value="">All</option>
              {facets.entities.map((e) => (
                <option key={e} value={e}>{entityLabel(e)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Action</span>
            <select id="audit-action" value={filters.action} onChange={set('action')} className="ui-select">
              <option value="">All</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>{actionWords(a)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">From</span>
            <input id="audit-from" type="date" value={filters.from} onChange={set('from')} className="ui-input" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">To</span>
            <input id="audit-to" type="date" value={filters.to} onChange={set('to')} className="ui-input" />
          </label>
        </div>

        {failed ? (
          <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>The trail could not be read: {failed}</p>
        ) : null}

        {!entries.length && !loading ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">Nothing matches these filters.</p>
          </div>
        ) : !entries.length ? (
          <p className="ws-card-blurb">Loading the trail…</p>
        ) : (
          <>
            <div className="ws-table-wrap">
              <table className="ws-table">
                <caption className="sr-only">Audit trail entries, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">What happened</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                {grouped.map(([day, rows]) => (
                  <tbody key={day}>
                    <tr>
                      <th scope="rowgroup" colSpan={4} style={{ textAlign: 'left' }}>{day}</th>
                    </tr>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td style={{ verticalAlign: 'top' }}>{when(e.at)}</td>
                        <td style={{ verticalAlign: 'top' }}><ActionPill action={e.action} /></td>
                        <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 280, maxWidth: 640, verticalAlign: 'top' }}>
                          <div>{e.message || `${entityLabel(e.entity)} ${e.action}`}</div>
                          <Changes metadata={e.metadata} />
                        </td>
                        <td style={{ verticalAlign: 'top' }}>
                          <div>{e.by?.name || 'Unknown user'}</div>
                          <div className="ws-head-meta">{e.by?.email || ''}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
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
