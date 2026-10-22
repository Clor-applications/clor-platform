import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import { getAuditFacets, listAuditLog, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Settings → Audit Logs: who changed what in People and Attendance, and when.
 * Read-only, like the log itself (server: routes/audit.ts). Searched and
 * filtered on the server, a page at a time, newest first.
 */
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
/* ATTENDANCE_SHIFT_ASSIGNMENT → Shift assignment; Employee → Employee. */
const area = (entity) => {
  /* People's registers (jobs, cases, assets…) are logged as one entity; the message names which. */
  if (entity === 'PeopleRecord') return 'HR registers';
  /* The log names the resource by dropping a plural "s" from the URL, which also clips "access". */
  const s = String(entity || '').replace(/^(ATTENDANCE|PEOPLE)_/, '').replace(/_/g, ' ').toLowerCase().replace(/\bacces\b/g, 'access');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
const actionLabel = (a) => {
  const s = String(a || '').replace(/_/g, ' ').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
/* An entry the server logged without a phrase reads "DELETE attendance/holidays/:id"; say it in words. */
const VERB = { CREATE: 'Added', UPDATE: 'Changed', DELETE: 'Deleted' };
const what = (r) => {
  if (!/^(POST|PUT|PATCH|DELETE) \S+$/.test(r.message || '')) return r.message;
  const noun = area(r.entity).toLowerCase();
  return VERB[r.action] ? `${VERB[r.action]} ${noun}` : `${area(r.entity)}: ${actionLabel(r.action).toLowerCase()}`;
};
const monthAgo = () => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
};

const EXPORT_COLUMNS = [
  { key: 'at', label: 'When', value: (r) => when(r.at) },
  { key: 'by', label: 'Who', value: (r) => r.by?.name || r.by?.email || '' },
  { key: 'message', label: 'What', value: (r) => what(r) },
  { key: 'entity', label: 'Area', value: (r) => area(r.entity) },
  { key: 'action', label: 'Action', value: (r) => actionLabel(r.action) },
  { key: 'entityId', label: 'Record' },
];

export default function AuditLogs() {
  const [filters, setFilters] = useState({ q: '', from: monthAgo(), to: todayIst(), action: '', entity: '' });
  const [typed, setTyped] = useState('');
  const [facets, setFacets] = useState({ entities: [], actions: [] });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    getAuditFacets().then((f) => setFacets({ entities: f?.entities || [], actions: f?.actions || [] })).catch(() => undefined);
  }, []);
  /* The search goes to the server once typing pauses. */
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === typed ? f : { ...f, q: typed })), 350);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(() => {
    let live = true;
    listAuditLog({ ...filters, limit: 100 })
      .then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) setError(String(e?.message || 'Could not load the audit log.')); });
    return () => { live = false; };
  }, [filters]);
  useEffect(() => load(), [load]);

  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setMore(true);
    try {
      const next = await listAuditLog({ ...filters, limit: 100, cursor: data.nextCursor });
      setData((d) => ({ entries: [...d.entries, ...next.entries], nextCursor: next.nextCursor }));
    } catch (e) {
      setError(String(e?.message || 'Could not load more.'));
    } finally {
      setMore(false);
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const rows = data?.entries || [];

  return (
    <DocumentListShell
      entity="report"
      title="Audit Logs"
      description="Who changed what in People and Attendance, and when. Nothing here can be edited or deleted."
      compact
      tight
      search={{ value: typed, onChange: setTyped, placeholder: 'Search what was done…', label: 'Search the audit log' }}
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Audit Logs', fileName: 'Audit log', label: 'entry/entries', columns: EXPORT_COLUMNS, rows });
      }}
      headerExtras={
        <span className="flex flex-wrap items-center gap-2">
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.from} max={filters.to} onChange={set('from')} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={filters.to} min={filters.from} max={todayIst()} onChange={set('to')} aria-label="To" />
          <select className="ui-select ui-ctl-compact !w-auto" value={filters.entity} onChange={set('entity')} aria-label="Area">
            <option value="">All areas</option>
            {facets.entities.map((e) => <option key={e} value={e}>{area(e)}</option>)}
          </select>
          <select className="ui-select ui-ctl-compact !w-auto" value={filters.action} onChange={set('action')} aria-label="Action">
            <option value="">All actions</option>
            {facets.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </span>
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th className="ui-col-grow">What</th>
                  <th>Area</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon={ScrollText} title="No entries" description="Nothing was changed in these dates, or nothing matches the search and filters." />
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-date whitespace-nowrap">{when(r.at)}</td>
                      <td>{r.by?.name || r.by?.email || '—'}</td>
                      <td className="ui-col-grow whitespace-normal">
                        {what(r)}
                        {r.metadata?.body && Object.keys(r.metadata.body).length ? (
                          <details className="mt-1">
                            <summary className="ui-caption cursor-pointer">Details</summary>
                            <pre className="ui-caption whitespace-pre-wrap break-all">{JSON.stringify(r.metadata.body, null, 2)}</pre>
                          </details>
                        ) : null}
                      </td>
                      <td>{area(r.entity)}</td>
                      <td>{actionLabel(r.action)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {data.nextCursor ? (
            <div className="flex justify-center p-3">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={more} onClick={loadMore}>{more ? 'Loading…' : 'Show older entries'}</button>
            </div>
          ) : null}
        </>
      )}
    </DocumentListShell>
  );
}
