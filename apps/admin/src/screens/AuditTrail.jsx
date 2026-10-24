import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';

import { PageHeader, EmptyState } from '@ui/components/ui/Primitives';
import { listAudit, listAuditFacets } from '@platform/admin/audit';
import { hasApp } from '@platform/context';

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

const ACTION_TONE = {
  CREATE: 'pos',
  UPDATE: 'warn',
  STATUS: 'warn',
  DELETE: 'neg',
};

const ActionPill = ({ action }) => {
  const tone = ACTION_TONE[action] || 'warn';
  return (
    <span
      className="inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium align-middle"
      style={{ background: `rgb(var(--${tone}-soft))`, color: `rgb(var(--${tone}-ink))` }}
      title={action}
    >
      {String(action || '').replace(/_/g, ' ')}
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
        <div key={field} className="ui-caption">
          <span className="ui-muted">{field}</span>{' '}
          {v && typeof v === 'object' && 'from' in v ? (
            <>
              <span className="ui-mono">{String(v.from ?? '—')}</span>
              <span className="ui-muted"> → </span>
              <span className="ui-mono">{String(v.to ?? '—')}</span>
            </>
          ) : (
            <span className="ui-mono">{short(valueText(v))}</span>
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          entity="report"
          title="Audit Trail"
        />
        <button type="button" onClick={() => load()} className="ui-btn ui-btn-secondary" disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Whose changes">
        {[{ id: '', label: 'Everything' }, ...offered()].map((a) => (
          <button
            key={a.id || 'all'}
            type="button"
            role="tab"
            aria-selected={filters.app === a.id}
            onClick={() => setFilters((p) => ({ ...p, app: a.id }))}
            className={`ui-btn ${filters.app === a.id ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="ui-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="ui-label" htmlFor="audit-entity">
            Record
          </label>
          <select id="audit-entity" value={filters.entity} onChange={set('entity')} className="ui-select">
            <option value="">All</option>
            {facets.entities.map((e) => (
              <option key={e} value={e}>
                {entityLabel(e)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="audit-action">
            Action
          </label>
          <select id="audit-action" value={filters.action} onChange={set('action')} className="ui-select">
            <option value="">All</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="audit-from">
            From
          </label>
          <input id="audit-from" type="date" value={filters.from} onChange={set('from')} className="ui-input" />
        </div>
        <div>
          <label className="ui-label" htmlFor="audit-to">
            To
          </label>
          <input id="audit-to" type="date" value={filters.to} onChange={set('to')} className="ui-input" />
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="ui-label" htmlFor="audit-q">
            Contains
          </label>
          <input
            id="audit-q"
            type="text"
            value={filters.q}
            onChange={set('q')}
            className="ui-input w-full"
            placeholder="Invoice number, name…"
          />
        </div>
      </div>

      {failed ? (
        <div className="ui-card p-4 text-sm" style={{ color: 'rgb(var(--neg-ink))' }}>
          The trail could not be read: {failed}
        </div>
      ) : null}

      {!entries.length && !loading ? (
        <div className="ui-card">
          <EmptyState
            icon={History}
      title="Nothing recorded yet"
            description="Edits, status changes and deletions appear here as they happen."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, rows]) => (
            <div key={day}>
              <div className="ui-label mb-2">{day}</div>
              <div className="ui-card divide-y">
                {rows.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-28 shrink-0 ui-caption ui-muted">{when(e.at)}</div>
                    <div className="w-24 shrink-0">
                      <ActionPill action={e.action} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{e.message || `${entityLabel(e.entity)} ${e.action}`}</div>
                      <Changes metadata={e.metadata} />
                    </div>
                    <div className="w-44 shrink-0 text-right">
                      <div className="text-sm">{e.by?.name || 'Unknown user'}</div>
                      <div className="ui-caption ui-muted truncate">{e.by?.email || ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {cursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => load({ cursor })}
                className="ui-btn ui-btn-secondary"
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load older entries'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
