import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, Check, CheckCheck, Clock, ShieldCheck, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { listDataRequests, resolveDataRequest } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

/**
 * DPDP data-subject requests employees raise from the portal — see, correct,
 * erase — and HR's answer, which the person reads back in the portal. HR's
 * queue, so it sits with Personnel (ClorTime's Data Requests).
 */
const TYPES = { ACCESS: 'See their data', CORRECTION: 'Correct their data', ERASURE: 'Erase their data', NOMINATE: 'Name a nominee', GRIEVANCE: 'Grievance', WITHDRAW: 'Withdrew consent' };
const TABS = [
  { value: 'PENDING', label: 'Waiting', tone: 'partial' },
  { value: 'RESOLVED', label: 'Done', tone: 'paid' },
  { value: 'REJECTED', label: 'Declined', tone: 'overdue' },
  { value: '', label: 'All', tone: 'all' },
];
const COLUMNS = {
  employee: (r) => r.employeeName,
  type: (r) => TYPES[r.type] || r.type,
  asked: (r) => String(r.createdAt || '').slice(0, 10),
};
const dateOf = (d) => d.toLocaleDateString('en-IN', { dateStyle: 'medium' });

export default function DataRequests() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('PENDING');
  const [answer, setAnswer] = useState({});
  /* Read once per mount: the rule against impure calls in render, and a day's precision is all the badge needs. */
  const [now] = useState(() => Date.now());
  /* All of them at once: the tabs count every status. */
  const load = useCallback(() => listDataRequests('').then((d) => { setData(d); setError(null); }).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  const timing = useCallback((r) => {
    const due = r.dueAt ? new Date(r.dueAt) : new Date(new Date(r.createdAt).getTime() + 30 * 86_400_000);
    const late = r.status === 'PENDING' && due.getTime() < now;
    const soon = r.status === 'PENDING' && !late && due.getTime() - now < 5 * 86_400_000;
    return { due, late, soon, age: Math.floor((now - new Date(r.createdAt).getTime()) / 86_400_000) };
  }, [now]);

  const all = useMemo(() => data?.requests || [], [data]);
  const counts = useMemo(() => {
    const c = { '': all.length };
    for (const r of all) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => all.filter((r) => !filter || r.status === filter), [all, filter]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'details', 'resolution']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const pending = all.filter((r) => r.status === 'PENDING').map(timing);
    return { waiting: pending.length, late: pending.filter((t) => t.late).length, soon: pending.filter((t) => t.soon).length, done: counts.RESOLVED || 0 };
  }, [all, counts, timing]);

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

  return (
    <DocumentListShell
      entity="privacy"
      title="Data requests"
      description="What employees asked about their personal data, and your answers. Employees are told to expect an answer within 30 days; the DPDP Rules allow at most 90 for a grievance."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search requests…', label: 'Search data requests' }}
      cards={[
        { label: 'Waiting', value: figures.waiting, count: true, tone: 'partial', Icon: Clock, onSelect: () => setFilter('PENDING') },
        { label: 'Overdue', value: figures.late, count: true, tone: 'overdue', Icon: AlarmClock },
        { label: 'Due in 5 days', value: figures.soon, count: true, tone: 'outstanding', Icon: AlarmClock },
        { label: 'Done', value: figures.done, count: true, tone: 'paid', Icon: CheckCheck, onSelect: () => setFilter('RESOLVED') },
      ]}
      tabs={TABS}
      statusValue={filter}
      statusCounts={counts}
      onStatusChange={setFilter}
      tabsLabel="Request status"
    >
      {error && !data ? <LoadFailed error={error} onRetry={load} /> : null}
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <ColumnHeader label="Request" col="type" state={filters}  className="ui-col-grow" />
                <ColumnHeader label="Asked" col="asked" state={filters} type="date" />
                <th scope="col" className="ui-col-date">Answer by</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col">Answer</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No requests match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={ShieldCheck}
                        title={filter === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
                        description="Employees ask from the portal under Me → My data."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const { due, late, soon, age } = timing(r);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="ui-col-entity">{r.employeeName || 'Unknown'}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                      <td className="ui-col-grow whitespace-normal min-w-[14rem]">
                        <div>{TYPES[r.type] || r.type}</div>
                        <p className="ui-caption">“{r.details}”</p>
                      </td>
                      <td className="ui-col-date whitespace-nowrap">
                        {dateOf(new Date(r.createdAt))}
                        {r.status === 'PENDING' ? <div className="ui-caption">{age} day{age === 1 ? '' : 's'} ago</div> : null}
                      </td>
                      <td className="ui-col-date whitespace-nowrap">{r.status === 'PENDING' ? dateOf(due) : '—'}</td>
                      <td className="ui-col-h-center">
                        <span className={`ui-pill ${r.status === 'RESOLVED' ? 'ui-pill-pos' : r.status === 'REJECTED' ? 'ui-pill-neg' : late || soon ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{r.status === 'PENDING' ? (late ? 'Overdue' : soon ? 'Due soon' : 'Waiting') : r.status === 'RESOLVED' ? 'Done' : 'Declined'}</span>
                      </td>
                      <td className="ui-col-meta min-w-[18rem]">
                        {r.status === 'PENDING' ? (
                          <div className="space-y-2">
                            <textarea className="ui-input w-full" rows={2} aria-label={`Answer to ${r.employeeName}`} placeholder="What was done, or why not — the person reads this" value={answer[r.id] || ''} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} />
                            <div className="flex gap-1">
                              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decide(r, 'RESOLVED')}><Check size={14} aria-hidden="true" /> Mark done</button>
                              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => decide(r, 'REJECTED')}><X size={14} aria-hidden="true" /> Decline</button>
                            </div>
                          </div>
                        ) : <span className="text-sm">{r.resolution}</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}
