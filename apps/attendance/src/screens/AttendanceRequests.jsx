import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCheck, ClipboardClock, HelpCircle, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
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
const TABS = [
  { value: 'PENDING', label: 'Pending', tone: 'partial' },
  { value: 'APPROVED', label: 'Approved', tone: 'paid' },
  { value: 'REJECTED', label: 'Rejected', tone: 'overdue' },
  { value: '', label: 'All', tone: 'all' },
];
const COLUMNS = {
  employee: (r) => r.employeeName,
  date: (r) => r.date,
  reason: (r) => `${r.reasonCode ? reasonLabel(r.reasonCode) : ''} ${r.reason || ''}`.trim(),
  status: (r) => r.status,
};

export default function AttendanceRequests() {
  const [status, setStatus] = useState('PENDING');
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [explaining, setExplaining] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  /* All of them at once: the tabs count every status. */
  const load = useCallback(() => {
    listRequests('')
      .then((v) => { setAll(v); setLoadError(''); setSelected(new Set()); })
      .catch((e) => setLoadError(String(e?.message || 'Could not load requests.')));
  }, []);
  useEffect(() => { load(); }, [load]);
  /* A new tab starts unselected on its first page; reset while rendering, not in an effect. */
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setSelected(new Set());
    setPage(1);
  }
  const explainLoad = useCallback(() => explainDay(explaining?.employeeId, explaining?.date), [explaining]);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const r of all || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'date', 'reason']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useResetPage(setPage, [search.query]);

  const pending = useMemo(() => rows.filter((r) => r.status === 'PENDING'), [rows]);
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
    <DocumentListShell
      entity="request"
      title="Corrections"
      description="What people asked to change, beside the day as it stood. Approving one writes that day."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search corrections…', label: 'Search corrections' }}
      cards={[
        { label: 'Waiting', value: counts.PENDING || 0, count: true, tone: 'partial', Icon: ClipboardClock, onSelect: () => setStatus('PENDING') },
        { label: 'Approved', value: counts.APPROVED || 0, count: true, tone: 'paid', Icon: CheckCheck, onSelect: () => setStatus('APPROVED') },
        { label: 'Rejected', value: counts.REJECTED || 0, count: true, tone: 'overdue', Icon: X, onSelect: () => setStatus('REJECTED') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Correction status"
      above={
        selected.size ? (
          <div className="ui-bulkbar" role="region" aria-label="Decide the selected corrections">
            <span className="text-sm"><strong className="tabular-nums">{selected.size}</strong> selected</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decideMany(true)}><Check size={14} aria-hidden="true" /> Approve</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => decideMany(false)}><X size={14} aria-hidden="true" /> Reject</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        ) : null
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          {/* Phones: cards with 44 px actions, like Exceptions; the table from 768 px. */}
          <ul className="space-y-2 md:hidden" aria-label="Corrections">
            {!rows.length ? (
              <li>
                {inTab.length ? (
                  <EmptyState kind="filtered" totalCount={inTab.length} title="No corrections match" description="Nothing in this tab matches the search or the column filters." />
                ) : (
                  <EmptyState icon={ClipboardClock} title={status === 'PENDING' ? 'No corrections are waiting' : status ? `No ${status.toLowerCase()} corrections` : 'No corrections yet'} description="What people asked to change shows here beside the day as it stood." />
                )}
              </li>
            ) : (
              pageRows.map((r) => (
                <li key={r.id} className="ui-card p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    {r.status === 'PENDING' ? <input type="checkbox" className="ui-checkbox mt-1 h-5 w-5" aria-label={`Select ${r.employeeName}'s correction for ${r.date}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{r.employeeName}</p>
                        <StatusPill status={r.status} />
                      </div>
                      <p className="ui-caption">{dayLabel(r.date, { weekday: true, year: false })}</p>
                      <p className="text-sm mt-1">
                        <span className="ui-caption">Was </span>
                        {r.beforeStatus || r.beforeCheckIn ? `${time(r.beforeCheckIn)}–${time(r.beforeCheckOut)}${r.beforeStatus ? ` · ${STATUS_WORD[r.beforeStatus] || r.beforeStatus}` : ''}` : 'Nothing recorded'}
                        <span className="ui-caption"> · asked for </span>
                        <span className="font-medium tabular-nums">{time(r.checkIn)}–{time(r.checkOut)}</span>
                      </p>
                      <p className="ui-caption mt-1">{r.reasonCode ? `${reasonLabel(r.reasonCode)} · ` : ''}{r.reason}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" className="ui-btn ui-btn-secondary min-h-[44px]" aria-label={`Explain ${r.employeeName}'s day ${r.date}`} onClick={() => setExplaining(r)}><HelpCircle size={16} aria-hidden="true" /> Day</button>
                    {r.status === 'PENDING' ? (
                      <>
                        <button type="button" className="ui-btn ui-btn-secondary min-h-[44px]" aria-label={`Approve ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(approveRequest, r, 'Approved; the day is updated.')}><Check size={16} aria-hidden="true" /> Approve</button>
                        <button type="button" className="ui-btn ui-btn-secondary min-h-[44px]" aria-label={`Reject ${r.employeeName}'s correction for ${r.date}`} onClick={() => act(rejectRequest, r, 'Rejected.')}><X size={16} aria-hidden="true" /> Reject</button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="ui-table-scroll hidden md:block">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    {pending.length ? (
                      <input type="checkbox" className="ui-checkbox" aria-label="Select every waiting correction" checked={pending.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(pending.map((r) => r.id)) : new Set())} />
                    ) : null}
                  </th>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Day" col="date" state={filters} type="date" />
                  <th scope="col">Was</th>
                  <th scope="col">Asked for</th>
                  <ColumnHeader label="Reason" col="reason" state={filters}  className="ui-col-grow" />
                  <ColumnHeader label="Status" col="status" state={filters} align="center" />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={8}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="No corrections match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={ClipboardClock}
                          title={status === 'PENDING' ? 'No corrections are waiting' : status ? `No ${status.toLowerCase()} corrections` : 'No corrections yet'}
                          description="What people asked to change shows here beside the day as it stood. Approving one writes that day."
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.status === 'PENDING' ? <input type="checkbox" className="ui-checkbox" aria-label={`Select ${r.employeeName}'s correction for ${r.date}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : null}</td>
                      <td className="ui-col-entity">{r.employeeName}</td>
                      <td className="ui-col-date whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}</td>
                      <td className="whitespace-nowrap ui-caption">
                        {r.beforeStatus || r.beforeCheckIn ? `${time(r.beforeCheckIn)}–${time(r.beforeCheckOut)}${r.beforeStatus ? ` · ${STATUS_WORD[r.beforeStatus] || r.beforeStatus}` : ''}` : 'Nothing recorded'}
                      </td>
                      <td className="whitespace-nowrap font-medium tabular-nums">{time(r.checkIn)}–{time(r.checkOut)}</td>
                      <td className="ui-col-grow whitespace-normal min-w-[12rem]">
                        {r.reasonCode ? <span className="ui-pill ui-pill-neutral mr-1.5">{reasonLabel(r.reasonCode)}</span> : null}
                        <span className="truncate" title={r.reason}>{r.reason}</span>
                      </td>
                      <td className="ui-col-h-center"><StatusPill status={r.status} /></td>
                      <td className="ui-col-meta">
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
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="corrections" />
        </>
      )}
      <DayExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </DocumentListShell>
  );
}
