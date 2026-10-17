import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listDataRequests, resolveDataRequest } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

/**
 * DPDP data-subject requests employees raise from the portal — see, correct,
 * erase — and HR's answer, which the person reads back in the portal. HR's
 * queue, so it sits with Personnel (ClorTime's Data Requests).
 */
const TYPES = { ACCESS: 'See their data', CORRECTION: 'Correct their data', ERASURE: 'Erase their data' };

export default function DataRequests() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('PENDING');
  const [answer, setAnswer] = useState({});
  /* Read once per mount: the rule against impure calls in render, and a day's precision is all the badge needs. */
  const [now] = useState(() => Date.now());
  const load = useCallback(() => listDataRequests(filter === 'ALL' ? '' : filter).then((d) => { setData(d); setError(null); }).catch(setError), [filter]);
  useEffect(() => { load(); }, [load]);

  const decide = async (r, status) => {
    const resolution = (answer[r.id] || '').trim();
    if (!resolution) return notify.error('Say what was done — the person reads this.');
    try {
      await resolveDataRequest(r.id, { status, resolution });
      notify.success(status === 'RESOLVED' ? 'Marked done; the person can see your answer.' : 'Declined; the person can see why.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };

  if (error && !data) return <LoadFailed error={error} onRetry={load} />;
  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Data requests" description="What employees asked about their personal data, and your answers. The DPDP Act gives 30 days." />
      <div className="flex flex-wrap gap-2">
        {[['PENDING', 'Waiting'], ['RESOLVED', 'Done'], ['REJECTED', 'Declined'], ['ALL', 'All']].map(([k, l]) => (
          <button key={k} type="button" className={`ui-btn ui-btn-sm ${filter === k ? 'ui-btn-primary' : 'ui-btn-secondary'}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {!data ? <SkeletonCard lines={6} /> : !data.requests.length ? (
        <EmptyState icon={ShieldCheck} title={filter === 'PENDING' ? 'Nothing waiting' : 'Nothing here'} description="Employees ask from the portal under Me → My data." />
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => {
            const age = Math.floor((now - new Date(r.createdAt).getTime()) / 86_400_000);
            return (
              <section key={r.id} className="ui-card p-5 space-y-3" aria-label={`${TYPES[r.type] || r.type} from ${r.employeeName}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{r.employeeName || 'Unknown'}{r.employeeCode ? <span className="ui-caption font-normal"> · {r.employeeCode}</span> : null}</div>
                    <div className="text-sm">{TYPES[r.type] || r.type} · asked {new Date(r.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{r.status === 'PENDING' ? ` · ${age} day${age === 1 ? '' : 's'} ago` : ''}</div>
                  </div>
                  <span className={`ui-pill ${r.status === 'RESOLVED' ? 'ui-pill-pos' : r.status === 'REJECTED' ? 'ui-pill-neg' : age > 25 ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{r.status === 'PENDING' ? (age > 25 ? 'Due now' : 'Waiting') : r.status === 'RESOLVED' ? 'Done' : 'Declined'}</span>
                </div>
                <p className="text-sm ui-muted">“{r.details}”</p>
                {r.status === 'PENDING' ? (
                  <div className="space-y-2">
                    <textarea className="ui-input w-full" rows={2} placeholder="What was done, or why not — the person reads this" value={answer[r.id] || ''} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} />
                    <div className="flex gap-2">
                      <button type="button" className="ui-btn ui-btn-primary" onClick={() => decide(r, 'RESOLVED')}>Mark done</button>
                      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => decide(r, 'REJECTED')}>Decline</button>
                    </div>
                  </div>
                ) : <p className="text-sm">Answer: {r.resolution}</p>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
