import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDot, Clock, EyeOff, HelpCircle, UserRoundCheck } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { dayLabel, explainDay, listExceptions, setExceptionState, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import DayExplain from '../components/DayExplain';

/**
 * One queue for everything that is not settled yet: days with no check-out,
 * working days with no attendance, overtime to approve, corrections and leave
 * waiting, reader IDs that match nobody, readers with a problem, and two
 * temporary schedules on the same days. Each item opens the screen that
 * settles it; who owns it and whether it is done is kept here.
 */
const KIND = {
  MISSING_OUT: 'No check-out',
  NO_RECORD: 'No attendance',
  OVERTIME: 'Overtime to approve',
  CORRECTION: 'Correction waiting',
  LEAVE: 'Leave waiting',
  UNMATCHED: 'Unknown reader ID',
  READER: 'Reader problem',
  SHIFT_CLASH: 'Schedule clash',
};
const KIND_TONE = {
  MISSING_OUT: 'overdue',
  NO_RECORD: 'overdue',
  OVERTIME: 'sent',
  CORRECTION: 'partial',
  LEAVE: 'partial',
  UNMATCHED: 'outstanding',
  READER: 'outstanding',
  SHIFT_CLASH: 'draft',
};
const COLUMNS = {
  what: (x) => x.title,
  who: (x) => x.employeeName,
  date: (x) => x.date,
  owner: (x) => x.assignee || 'Nobody',
};
const SEVERITY = { high: 'Urgent', medium: 'To do', low: 'When you can' };
const STATUS = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Settled', IGNORED: 'Ignored' };
const back = (n) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

export default function Exceptions({ openScreen }) {
  const [range, setRange] = useState({ from: back(14), to: back(1) });
  const [kind, setKind] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [explaining, setExplaining] = useState(null);
  const [settling, setSettling] = useState(null);
  const [note, setNote] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const load = useCallback(() => {
    listExceptions({ ...range, show: showAll ? 'all' : 'open' })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load the exceptions.')));
  }, [range, showAll]);
  useEffect(() => { load(); }, [load]);

  const all = data?.exceptions;
  /* The server counts every kind (past the 1,000 shown); All is their sum. */
  const counts = useMemo(() => {
    const c = { ...(data?.counts || {}) };
    c[''] = Object.values(data?.counts || {}).reduce((a, b) => a + b, 0);
    return c;
  }, [data]);
  /* Only the kinds that have something, plus the one chosen, so the row is not eight empty tabs. */
  const tabs = useMemo(
    () => [{ value: '', label: 'All', tone: 'all' }, ...Object.entries(KIND).filter(([k]) => counts[k] || kind === k).map(([value, label]) => ({ value, label, tone: KIND_TONE[value] }))],
    [counts, kind]
  );
  const inTab = useMemo(() => (all || []).filter((x) => !kind || x.kind === kind), [all, kind]);
  const search = useListSearch(inTab, ['title', 'employeeName', 'detail', 'assignee', 'date']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useEffect(() => setPage(1), [kind, search.query, range, showAll]);
  const figures = useMemo(() => {
    const list = all || [];
    return {
      high: list.filter((x) => x.severity === 'high').length,
      medium: list.filter((x) => x.severity === 'medium').length,
      low: list.filter((x) => x.severity === 'low').length,
      unowned: list.filter((x) => !x.assigneeUserId && (x.status === 'OPEN' || x.status === 'IN_PROGRESS')).length,
    };
  }, [all]);
  const explainLoad = useCallback(() => explainDay(explaining?.employeeId, explaining?.date), [explaining]);

  const change = async (x, body, done) => {
    try {
      await setExceptionState({ key: x.key, ...body });
      if (done) notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const settle = (x, status) => {
    setNote('');
    setSettling({ x, status });
  };
  const confirmSettle = async () => {
    const { x, status } = settling;
    setSettling(null);
    await change(x, { status, note: note.trim() || null }, status === 'RESOLVED' ? 'Marked settled.' : 'Ignored.');
  };
  const open = (x) => {
    if (!openScreen) return;
    if (x.screen === 'records' && x.employeeId) openScreen('records', { employeeId: x.employeeId, from: x.date, to: x.date });
    else openScreen(x.screen);
  };

  return (
    <DocumentListShell
      entity="exception"
      title="Exceptions"
      description="Everything not settled yet, in one place. Each item opens the screen that fixes it."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search exceptions…', label: 'Search exceptions' }}
      cards={[
        { label: 'Urgent', value: figures.high, count: true, tone: 'overdue', Icon: AlertTriangle },
        { label: 'To do', value: figures.medium, count: true, tone: 'partial', Icon: CircleDot },
        { label: 'When you can', value: figures.low, count: true, tone: 'cancelled', Icon: Clock },
        { label: 'Nobody owns', value: figures.unowned, count: true, tone: 'outstanding', Icon: UserRoundCheck },
      ]}
      tabs={tabs}
      statusValue={kind}
      statusCounts={counts}
      onStatusChange={setKind}
      tabsLabel="Kind of exception"
      tabsExtras={
        <>
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
          <input type="date" className="ui-input ui-ctl-compact !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show settled and ignored
          </label>
        </>
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="What" col="what" state={filters} />
                  <ColumnHeader label="Who" col="who" state={filters} />
                  <ColumnHeader label="Day" col="date" state={filters} type="date" />
                  <th scope="col" className="ui-col-grow hidden lg:table-cell">Detail</th>
                  <ColumnHeader label="Owner" col="owner" state={filters} />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={6}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="No exceptions match" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState icon={CheckCircle2} title="Nothing to settle" description="Every day in this range is complete and every queue is clear. Anything not settled shows here, and each item opens the screen that fixes it." />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((x) => (
                    <tr key={x.key} data-severity={x.severity}>
                      <td className="min-w-[10rem] whitespace-normal">
                        <span className="ui-exc-title">
                          <span className="ui-exc-dot" data-severity={x.severity} aria-hidden="true" />
                          <span>
                            <span className="block font-medium">{x.title}</span>
                            <span className="ui-caption">{SEVERITY[x.severity]} · {KIND[x.kind] || x.kind}{x.status !== 'OPEN' ? ` · ${STATUS[x.status]}` : ''}</span>
                          </span>
                        </span>
                      </td>
                      <td className="ui-col-entity">{x.employeeName || '—'}</td>
                      <td className="ui-col-date whitespace-nowrap">{x.date ? dayLabel(x.date, { weekday: true, year: false }) : '—'}</td>
                      <td className="hidden lg:table-cell ui-caption ui-col-grow whitespace-normal min-w-[9rem]">{x.detail}{x.note ? ` · Note: ${x.note}` : ''}</td>
                      <td className="whitespace-nowrap">{x.assignee || <span className="ui-caption">Nobody</span>}</td>
                      <td className="ui-col-meta">
                        <span className="flex items-center justify-end gap-1">
                          {x.employeeId && x.date && ['MISSING_OUT', 'NO_RECORD', 'OVERTIME'].includes(x.kind) ? (
                            <button type="button" className="ui-icon-btn" title="Why does this day say this?" aria-label={`Explain ${x.employeeName}'s day`} onClick={() => setExplaining(x)}><HelpCircle size={16} aria-hidden="true" /></button>
                          ) : null}
                          {!x.assigneeUserId ? (
                            <button type="button" className="ui-icon-btn" aria-label="Assign to me" title="Take it" onClick={() => change(x, { assignee: 'me', status: 'IN_PROGRESS' }, 'Assigned to you.')}><UserRoundCheck size={16} aria-hidden="true" /></button>
                          ) : null}
                          {x.status === 'OPEN' || x.status === 'IN_PROGRESS' ? (
                            <>
                              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => settle(x, 'RESOLVED')}><CheckCircle2 size={14} aria-hidden="true" /> Settle</button>
                              <button type="button" className="ui-icon-btn" aria-label="Ignore" title="Ignore" onClick={() => settle(x, 'IGNORED')}><EyeOff size={16} aria-hidden="true" /></button>
                            </>
                          ) : (
                            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => change(x, { status: 'OPEN' }, 'Reopened.')}><CircleDot size={14} aria-hidden="true" /> Reopen</button>
                          )}
                          {openScreen ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => open(x)}><ArrowUpRight size={14} aria-hidden="true" /> Open</button> : null}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="items" />
          {data.truncated ? <p className="ui-caption p-3">Showing the first 1,000. Narrow the dates or pick one kind.</p> : null}
        </>
      )}
      <DayExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
      <Drawer
        open={Boolean(settling)}
        onClose={() => setSettling(null)}
        title={settling?.status === 'IGNORED' ? 'Ignore this item' : 'Mark this item settled'}
        description={settling ? `${settling.x.title}${settling.x.employeeName ? `, ${settling.x.employeeName}` : ''}${settling.x.date ? `, ${settling.x.date}` : ''}` : ''}
        widthClass="w-[min(30rem,96vw)]"
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSettling(null)}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={confirmSettle}>{settling?.status === 'IGNORED' ? 'Ignore' : 'Mark settled'}</button>
          </>
        }
      >
        <label className="block">
          <span className="ui-label">{settling?.status === 'IGNORED' ? 'Why ignore it' : 'How it was settled'} <span className="ui-caption">(optional)</span></span>
          <textarea className="ui-input w-full" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <p className="ui-caption mt-2">If the data still shows the problem later, it stays listed under "Show settled and ignored".</p>
      </Drawer>
    </DocumentListShell>
  );
}
