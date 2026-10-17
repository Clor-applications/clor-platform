import React, { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { approveRequest, dayLabel, listRequests, rejectRequest } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const time = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16) : '—');

/** Corrections people asked for. Approving writes the day. */
export default function AttendanceRequests() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    listRequests(status).then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load requests.')));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, r, done) => {
    try {
      await fn(r.id);
      notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Requests" description="Corrections people asked for. Approving one writes that day." />
      <div role="tablist" className="flex gap-1">
        {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} className="ui-segment" onClick={() => setStatus(s)}>
            {s ? s[0] + s.slice(1).toLowerCase() : 'All'}
          </button>
        ))}
      </div>
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState title="Nothing here" description={status === 'PENDING' ? 'No corrections are waiting.' : 'No requests in this list.'} />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Day</th>
                  <th scope="col" className="ui-th ui-col-h-center">In</th>
                  <th scope="col" className="ui-th ui-col-h-center">Out</th>
                  <th scope="col" className="ui-th">Reason</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">{r.employeeName}</td>
                    <td className="whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}</td>
                    <td className="ui-col-h-center">{time(r.checkIn)}</td>
                    <td className="ui-col-h-center">{time(r.checkOut)}</td>
                    <td className="max-w-[20rem] truncate" title={r.reason}>{r.reason}</td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${r.status === 'APPROVED' ? 'ui-pill-pos' : r.status === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{r.status.toLowerCase()}</span></td>
                    <td className="whitespace-nowrap">
                      {r.status === 'PENDING' ? (
                        <span className="flex gap-1">
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Approve ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(approveRequest, r, 'Approved; the day is updated.')}><Check size={14} aria-hidden="true" /> Approve</button>
                          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Reject ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(rejectRequest, r, 'Rejected.')}><X size={14} aria-hidden="true" /> Reject</button>
                        </span>
                      ) : null}
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
