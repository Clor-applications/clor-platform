import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
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
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Unmatched punches" description="Reader user IDs that match no employee. Choose who each one is." />
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="Every punch is matched" description="Punches from an unknown reader ID will list here." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Reader ID</th>
                  <th scope="col" className="ui-th">Site</th>
                  <th scope="col" className="ui-th">Name on reader</th>
                  <th scope="col" className="ui-th text-end">Punches</th>
                  <th scope="col" className="ui-th">First</th>
                  <th scope="col" className="ui-th">Last</th>
                  <th scope="col" className="ui-th">Employee</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={keyOf(r)}>
                    <td className="ui-mono">{r.pin}</td>
                    <td>{r.areaName || <span className="ui-caption">No site</span>}</td>
                    <td>{r.readerName || '—'}</td>
                    <td className="text-end tabular-nums">{r.punches}</td>
                    <td className="whitespace-nowrap ui-col-meta">{r.first}</td>
                    <td className="whitespace-nowrap ui-col-meta">{r.last}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-2">
                        <select
                          className="ui-select"
                          aria-label={`Employee for reader ID ${r.pin}`}
                          value={choice[keyOf(r)] || ''}
                          onChange={(e) => setChoice({ ...choice, [keyOf(r)]: e.target.value })}
                        >
                          <option value="">Choose…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
                        </select>
                        {r.areaId ? (
                          <select className="ui-select" aria-label={`Where reader ID ${r.pin} is theirs`} value={siteOnly[keyOf(r)] ? 'site' : 'all'} onChange={(e) => setSiteOnly({ ...siteOnly, [keyOf(r)]: e.target.value === 'site' })}>
                            <option value="all">Their ID everywhere</option>
                            <option value="site">Only at {r.areaName}</option>
                          </select>
                        ) : null}
                        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" aria-label={`Match reader ID ${r.pin}`} disabled={!choice[keyOf(r)]} onClick={() => match(r)}>Match</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
