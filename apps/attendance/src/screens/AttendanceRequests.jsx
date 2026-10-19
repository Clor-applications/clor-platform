import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, HelpCircle, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { approveRequest, bulkReviewRequests, dayLabel, explainDay, listRequests, reasonLabel, rejectRequest } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import DayExplain from '../components/DayExplain';

const time = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16) : '—');
const STATUS_WORD = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };

/**
 * Corrections people asked for. Each shows the day as it stood when asked
 * beside what is asked for, so a reviewer sees the change before deciding.
 * Approving writes the day; several can be decided at once, each with the
 * same checks (a manager first, when the company asks for that).
 */
export default function AttendanceRequests() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [explaining, setExplaining] = useState(null);

  const load = useCallback(() => {
    listRequests(status)
      .then((v) => { setRows(v); setLoadError(''); setSelected(new Set()); })
      .catch((e) => setLoadError(String(e?.message || 'Could not load requests.')));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const explainLoad = useCallback(() => explainDay(explaining?.employeeId, explaining?.date), [explaining]);

  const pending = useMemo(() => (rows || []).filter((r) => r.status === 'PENDING'), [rows]);
  const act = async (fn, r, done) => {
    try {
      await fn(r.id);
      notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const decideMany = async (approve) => {
    try {
      const r = await bulkReviewRequests([...selected], approve);
      if (r.failed) notify.error(`${r.done} ${approve ? 'approved' : 'rejected'}, ${r.failed} not: ${r.results[0]?.error || ''}`);
      else notify.success(`${r.done} ${approve ? 'approved; the days are updated' : 'rejected'}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Corrections" description="What people asked to change, beside the day as it stood. Approving one writes that day." />
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1">
          {['PENDING', 'APPROVED', 'REJECTED', ''].map((s) => (
            <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} className="ui-segment" onClick={() => setStatus(s)}>
              {s ? s[0] + s.slice(1).toLowerCase() : 'All'}
            </button>
          ))}
        </div>
        {selected.size ? (
          <div className="ui-bulkbar ml-auto" role="region" aria-label="Decide the selected corrections">
            <span className="text-sm"><strong className="tabular-nums">{selected.size}</strong> selected</span>
            <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => decideMany(true)}><Check size={14} aria-hidden="true" /> Approve</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decideMany(false)}><X size={14} aria-hidden="true" /> Reject</button>
          </div>
        ) : null}
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
                  <th scope="col" className="ui-th w-8">
                    {pending.length ? (
                      <input type="checkbox" className="ui-checkbox" aria-label="Select every waiting correction" checked={pending.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(pending.map((r) => r.id)) : new Set())} />
                    ) : null}
                  </th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Day</th>
                  <th scope="col" className="ui-th">Was</th>
                  <th scope="col" className="ui-th">Asked for</th>
                  <th scope="col" className="ui-th">Reason</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.status === 'PENDING' ? <input type="checkbox" className="ui-checkbox" aria-label={`Select ${r.employeeName}'s correction for ${r.date}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : null}</td>
                    <td className="ui-col-entity">{r.employeeName}</td>
                    <td className="whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}</td>
                    <td className="whitespace-nowrap ui-caption">
                      {r.beforeStatus || r.beforeCheckIn ? `${time(r.beforeCheckIn)}–${time(r.beforeCheckOut)}${r.beforeStatus ? ` · ${STATUS_WORD[r.beforeStatus] || r.beforeStatus}` : ''}` : 'Nothing recorded'}
                    </td>
                    <td className="whitespace-nowrap font-medium tabular-nums">{time(r.checkIn)}–{time(r.checkOut)}</td>
                    <td className="max-w-[20rem]">
                      {r.reasonCode ? <span className="ui-pill ui-pill-neutral mr-1.5">{reasonLabel(r.reasonCode)}</span> : null}
                      <span className="truncate" title={r.reason}>{r.reason}</span>
                    </td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${r.status === 'APPROVED' ? 'ui-pill-pos' : r.status === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{r.status.toLowerCase()}</span></td>
                    <td className="whitespace-nowrap">
                      <span className="flex items-center justify-end gap-1">
                        <button type="button" className="ui-icon-btn" title="See the day, its punches and history" aria-label={`Explain ${r.employeeName}'s day ${r.date}`} onClick={() => setExplaining(r)}><HelpCircle size={16} aria-hidden="true" /></button>
                        {r.status === 'PENDING' ? (
                          <>
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Approve ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(approveRequest, r, 'Approved; the day is updated.')}><Check size={14} aria-hidden="true" /> Approve</button>
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Reject ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(rejectRequest, r, 'Rejected.')}><X size={14} aria-hidden="true" /> Reject</button>
                          </>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DayExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </div>
  );
}
