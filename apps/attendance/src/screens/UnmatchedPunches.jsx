import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Fingerprint, Link2, MapPin } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listEmployees, listUnmatchedPunches, matchPunches } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Punches from reader user IDs that match no employee (by Reader ID or
 * employee code), one line per ID per site. Matching one sets that person's
 * Reader ID — company-wide, or only at that site when another site uses the
 * same number for someone else — so their past punches become days and their
 * next ones match on their own.
 */
const keyOf = (r) => `${r.areaId || ''}|${r.pin}`;
const COLUMNS = {
  pin: (r) => r.pin,
  site: (r) => r.areaName || 'No site',
  name: (r) => r.readerName,
  first: (r) => String(r.first || '').slice(0, 10),
  last: (r) => String(r.last || '').slice(0, 10),
};
export default function UnmatchedPunches() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [people, setPeople] = useState([]);
  const [choice, setChoice] = useState({});
  const [siteOnly, setSiteOnly] = useState({});

  const load = useCallback(() => {
    listUnmatchedPunches().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load punches.')));
  }, []);
  useEffect(() => {
    load();
    listEmployees().then(setPeople).catch(() => setPeople([]));
  }, [load]);

  const search = useListSearch(rows || [], ['pin', 'areaName', 'readerName']);
  const filters = useColumnFilters();
  const shown = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const list = rows || [];
    return {
      ids: list.length,
      punches: list.reduce((a, r) => a + Number(r.punches || 0), 0),
      sites: new Set(list.map((r) => r.areaId).filter(Boolean)).size,
    };
  }, [rows]);

  const match = async (row) => {
    const k = keyOf(row);
    try {
      const r = await matchPunches(row.pin, choice[k], row.areaId && siteOnly[k] ? row.areaId : null);
      notify.success(`${r.matched} ${r.matched === 1 ? 'punch' : 'punches'} matched; ${r.days} ${r.days === 1 ? 'day' : 'days'} worked out.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not matched.'));
    }
  };

  return (
    <DocumentListShell
      entity="reader"
      title="Unmatched punches"
      description="Reader user IDs that match no employee. Choose who each one is."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search reader IDs…', label: 'Search unmatched punches' }}
      cards={[
        { label: 'Reader IDs', value: figures.ids, count: true, tone: 'outstanding', Icon: Fingerprint },
        { label: 'Punches waiting', value: figures.punches, count: true, tone: 'partial', Icon: Clock },
        { label: 'Sites', value: figures.sites, count: true, tone: 'sent', Icon: MapPin },
      ]}
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Reader ID" col="pin" state={filters} />
                <ColumnHeader label="Site" col="site" state={filters} />
                <ColumnHeader label="Name on reader" col="name" state={filters}  className="ui-col-grow" />
                <th scope="col" className="ui-num">Punches</th>
                <ColumnHeader label="First" col="first" state={filters} type="date" />
                <ColumnHeader label="Last" col="last" state={filters} type="date" />
                <th scope="col">Employee</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!shown.length ? (
                <tr>
                  <td colSpan={7}>
                    {rows.length ? (
                      <EmptyState kind="filtered" totalCount={rows.length} title="No reader IDs match" description="Nothing matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Fingerprint}
                        title="Every punch is matched"
                        description="Reader user IDs that match no employee list here. Choose who each one is; their past punches become days and their next ones match on their own."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={keyOf(r)}>
                    <td className="ui-mono">{r.pin}</td>
                    <td>{r.areaName || <span className="ui-caption">No site</span>}</td>
                    <td className="ui-col-entity">{r.readerName || '—'}</td>
                    <td className="ui-num">{r.punches}</td>
                    <td className="ui-col-date whitespace-nowrap">{r.first}</td>
                    <td className="ui-col-date whitespace-nowrap">{r.last}</td>
                    <td className="ui-col-meta">
                      <span className="flex flex-wrap items-center gap-2">
                        <select
                          className="ui-select ui-ctl-compact !w-auto"
                          aria-label={`Employee for reader ID ${r.pin}`}
                          value={choice[keyOf(r)] || ''}
                          onChange={(e) => setChoice({ ...choice, [keyOf(r)]: e.target.value })}
                        >
                          <option value="">Choose…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
                        </select>
                        {r.areaId ? (
                          <select className="ui-select ui-ctl-compact !w-auto" aria-label={`Where reader ID ${r.pin} is theirs`} value={siteOnly[keyOf(r)] ? 'site' : 'all'} onChange={(e) => setSiteOnly({ ...siteOnly, [keyOf(r)]: e.target.value === 'site' })}>
                            <option value="all">Their ID everywhere</option>
                            <option value="site">Only at {r.areaName}</option>
                          </select>
                        ) : null}
                        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Match reader ID ${r.pin}`} disabled={!choice[keyOf(r)]} onClick={() => match(r)}>
                          <Link2 size={14} aria-hidden="true" /> Match
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}
