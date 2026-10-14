import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listEmployees, listUnmatchedPunches, matchPunches } from '../api/attendance';

/**
 * Punches from reader user IDs that match no employee (by Reader ID or
 * employee code). Matching one sets that person's Reader ID, so their past
 * punches become days and their next ones match on their own.
 */
export default function UnmatchedPunches() {
  const [rows, setRows] = useState(null);
  const [people, setPeople] = useState([]);
  const [choice, setChoice] = useState({});

  const load = useCallback(() => {
    listUnmatchedPunches().then(setRows).catch((e) => notify.error(String(e?.message || 'Could not load punches.')));
  }, []);
  useEffect(() => {
    load();
    listEmployees().then(setPeople).catch(() => setPeople([]));
  }, [load]);

  const match = async (pin) => {
    try {
      const r = await matchPunches(pin, choice[pin]);
      notify.success(`${r.matched} ${r.matched === 1 ? 'punch' : 'punches'} matched; ${r.days} ${r.days === 1 ? 'day' : 'days'} worked out.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not matched.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Unmatched punches" description="Reader user IDs that match no employee. Choose who each one is." />
      {!rows ? (
        <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="Every punch is matched" description="Punches from an unknown reader ID will list here." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Reader ID</th>
                  <th scope="col" className="ui-th">Name on reader</th>
                  <th scope="col" className="ui-th text-end">Punches</th>
                  <th scope="col" className="ui-th">First</th>
                  <th scope="col" className="ui-th">Last</th>
                  <th scope="col" className="ui-th">Employee</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pin}>
                    <td className="font-mono">{r.pin}</td>
                    <td>{r.readerName || '—'}</td>
                    <td className="text-end tabular-nums">{r.punches}</td>
                    <td className="whitespace-nowrap ui-col-meta">{r.first}</td>
                    <td className="whitespace-nowrap ui-col-meta">{r.last}</td>
                    <td>
                      <span className="flex items-center gap-2">
                        <select
                          className="ui-select"
                          aria-label={`Employee for reader ID ${r.pin}`}
                          value={choice[r.pin] || ''}
                          onChange={(e) => setChoice({ ...choice, [r.pin]: e.target.value })}
                        >
                          <option value="">Choose…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
                        </select>
                        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" aria-label={`Match reader ID ${r.pin}`} disabled={!choice[r.pin]} onClick={() => match(r.pin)}>Match</button>
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
