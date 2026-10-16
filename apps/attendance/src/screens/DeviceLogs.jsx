import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { listDeviceLogs, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const weekAgo = () => new Date(Date.now() + 330 * 60_000 - 6 * 86_400_000).toISOString().slice(0, 10);

/**
 * What the readers report about themselves: operations done at the reader
 * (enrolling, deleting users, opening the menu) and errors. Codes are the
 * reader's own numbering (ClorTime's Operation Log and Error Log).
 */
export default function DeviceLogs() {
  const [kind, setKind] = useState('OPERATION');
  const [range, setRange] = useState({ from: weekAgo(), to: todayIst() });
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    listDeviceLogs({ kind, ...range })
      .then((r) => {
        setRows(r?.logs || []);
        setLoadError('');
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load reader logs.')));
  }, [kind, range]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Reader logs" description="Operations done at the readers, and errors they report." />
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1">
          {[['OPERATION', 'Operations'], ['ERROR', 'Errors']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className="ui-segment" onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <input type="date" className="ui-input !w-auto" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
        <input type="date" className="ui-input !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
      </div>
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState title={kind === 'ERROR' ? 'No errors' : 'No operations'} description="Readers send these with their punches." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Time</th>
                  <th scope="col" className="ui-th">Reader</th>
                  <th scope="col" className="ui-th">{kind === 'ERROR' ? 'Error' : 'Operation'}</th>
                  <th scope="col" className="ui-th">By</th>
                  <th scope="col" className="ui-th">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums">{r.localTime}</td>
                    <td>{r.deviceName}</td>
                    <td className="ui-mono">{r.code}</td>
                    <td className="ui-mono">{r.operator || '—'}</td>
                    <td className="ui-col-meta">{r.details || '—'}</td>
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
