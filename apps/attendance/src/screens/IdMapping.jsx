import React, { useCallback, useEffect, useState } from 'react';
import { Link2, UserX } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getMappingAudit, matchPunches, removeReaderExtras } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Reader IDs and employees, checked against each other: punches from IDs that
 * match nobody (with a likely match where the reader's name or the employee
 * code says so), people who have left but are still on a reader, IDs on a
 * reader that belong to no employee, and employees with no reader ID at all.
 */
export default function IdMapping({ openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    getMappingAudit().then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e?.message || 'Could not check the reader IDs.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const match = async (u) => {
    const ok = await confirmDialog({ title: `Give reader ID ${u.pin} to ${u.suggestion.name}?`, message: `${u.punches} punch${u.punches === 1 ? '' : 'es'} become ${u.suggestion.name}'s, and those days are worked out again. ${u.suggestion.why}.`, confirmLabel: 'Match', tone: 'default' });
    if (!ok) return;
    try {
      await matchPunches(u.pin, u.suggestion.employeeId);
      notify.success(`Reader ID ${u.pin} is now ${u.suggestion.name}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not matched.'));
    }
  };
  const removeStale = async (deviceId, name) => {
    const ok = await confirmDialog({ title: `Remove people who are not expected on ${name}?`, message: 'People who have left (and anyone outside the reader’s area) are taken off this reader the next time it checks in. Their past punches stay.', confirmLabel: 'Remove them' });
    if (!ok) return;
    try {
      await removeReaderExtras(deviceId);
      notify.success('Queued for the reader.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not queued.'));
    }
  };

  const staleByReader = (data?.stale || []).reduce((m, s) => m.set(s.deviceId, [...(m.get(s.deviceId) || []), s]), new Map());
  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="ID mapping" description="Reader IDs against employees: what matches nobody, who has left but is still on a reader, who has no ID." />
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Unknown IDs with punches', data.counts.unmatched, 'neg'],
              ['Left, still on a reader', data.counts.stale, 'warn'],
              ['On a reader, no employee', data.counts.orphan, 'neutral'],
              ['Employees with no reader ID', data.counts.noPin, 'neutral'],
            ].map(([label, n, tone]) => (
              <div key={label} className="ui-stat">
                <span className="ui-card-label">{label}</span>
                <div className={`ui-kpi ${n && tone === 'neg' ? 'ui-amount-neg' : ''}`}>{n}</div>
              </div>
            ))}
          </div>

          <section className="ui-card overflow-hidden" aria-labelledby="unk-h">
            <h2 id="unk-h" className="ui-t-sec px-4 pt-4 pb-2">Unknown reader IDs with punches</h2>
            {data.unmatched.length ? (
              <div className="overflow-x-auto ui-table-scroll">
                <table className="ui-table w-full">
                  <thead><tr><th className="ui-th">Reader ID</th><th className="ui-th">Name on the reader</th><th className="ui-th text-end">Punches</th><th className="ui-th">Last punch</th><th className="ui-th">Likely match</th><th className="ui-th"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.unmatched.map((u) => (
                      <tr key={u.pin}>
                        <td className="ui-mono">{u.pin}</td>
                        <td>{u.nameOnReader || <span className="ui-caption">—</span>}</td>
                        <td className="text-end tabular-nums">{u.punches}</td>
                        <td className="whitespace-nowrap ui-caption">{u.lastAt ? new Date(u.lastAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                        <td>{u.suggestion ? <span>{u.suggestion.name}{u.suggestion.code ? <span className="ui-caption"> · {u.suggestion.code}</span> : null}<span className="ui-caption block">{u.suggestion.why}</span></span> : <span className="ui-caption">No likely match</span>}</td>
                        <td className="whitespace-nowrap text-end">
                          {u.suggestion ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => match(u)}><Link2 size={14} aria-hidden="true" /> Match</button> : openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen('unmatched')}>Choose…</button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ui-caption px-4 pb-4">Every punch belongs to someone.</p>
            )}
          </section>

          <section className="ui-card overflow-hidden" aria-labelledby="stale-h">
            <h2 id="stale-h" className="ui-t-sec px-4 pt-4 pb-2">People who have left but are still on a reader</h2>
            {staleByReader.size ? (
              <ul className="divide-y">
                {[...staleByReader.entries()].map(([deviceId, list]) => (
                  <li key={deviceId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <UserX size={16} aria-hidden="true" className="ui-subtle" />
                    <span className="min-w-0 flex-1 text-sm"><strong>{list[0].reader}</strong>: {list.slice(0, 6).map((s) => `${s.employee} (${s.pin})`).join(', ')}{list.length > 6 ? ` and ${list.length - 6} more` : ''}</span>
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => removeStale(deviceId, list[0].reader)}>Remove from reader</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-caption px-4 pb-4">Nobody who has left is still on a reader.</p>
            )}
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <section className="ui-card p-4" aria-labelledby="orphan-h">
              <h2 id="orphan-h" className="ui-t-sec mb-2">On a reader, no employee</h2>
              {data.orphan.length ? (
                <ul className="divide-y text-sm">
                  {data.orphan.slice(0, 100).map((o) => <li key={`${o.deviceId}-${o.pin}`} className="flex justify-between gap-3 py-1.5"><span>{o.nameOnReader || 'No name'} <span className="ui-mono ui-caption">{o.pin}</span></span><span className="ui-caption">{o.reader}</span></li>)}
                </ul>
              ) : <p className="ui-caption">None.</p>}
              {data.orphan.length ? <p className="ui-caption mt-2">Give these IDs to an employee under Personnel, or remove them at the reader.</p> : null}
            </section>
            <section className="ui-card p-4" aria-labelledby="nopin-h">
              <h2 id="nopin-h" className="ui-t-sec mb-2">Employees with no reader ID</h2>
              {data.noPin.length ? (
                <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {data.noPin.slice(0, 200).map((p) => <li key={p.employeeId} className="truncate">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</li>)}
                </ul>
              ) : <p className="ui-caption">Everyone has one.</p>}
              {data.noPin.length && openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm mt-2" onClick={() => openScreen('employees')}>Open employees</button> : null}
            </section>
          </div>
          {!data.counts.unmatched && !data.counts.stale && !data.counts.orphan && !data.counts.noPin ? <EmptyState title="Every ID matches" description="Readers and employees agree." /> : null}
        </>
      )}
    </div>
  );
}
