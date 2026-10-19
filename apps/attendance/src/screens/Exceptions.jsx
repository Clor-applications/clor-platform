import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, EyeOff, HelpCircle, UserRoundCheck } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
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

  const load = useCallback(() => {
    listExceptions({ ...range, show: showAll ? 'all' : 'open' })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(String(e?.message || 'Could not load the exceptions.')));
  }, [range, showAll]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.exceptions || []).filter((x) => !kind || x.kind === kind), [data, kind]);
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
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Exceptions"
        description="Everything not settled yet, in one place. Each item opens the screen that fixes it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="ui-input !w-auto" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
            <input type="date" className="ui-input !w-auto" value={range.to} max={todayIst()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
          </div>
        }
      />

      {data ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show one kind">
          <button type="button" className={`ui-chip ${!kind ? 'is-on' : ''}`} aria-pressed={!kind} onClick={() => setKind('')}>All <span className="tabular-nums">{Object.values(data.counts).reduce((a, b) => a + b, 0)}</span></button>
          {Object.entries(KIND).filter(([k]) => data.counts[k]).map(([k, label]) => (
            <button key={k} type="button" className={`ui-chip ${kind === k ? 'is-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}>
              {label} <span className="tabular-nums">{data.counts[k]}</span>
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show settled and ignored
          </label>
        </div>
      ) : null}

      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !rows.length ? (
        <EmptyState title="Nothing to settle" description="Every day in this range is complete and every queue is clear." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">What</th>
                  <th scope="col" className="ui-th">Who</th>
                  <th scope="col" className="ui-th">Day</th>
                  <th scope="col" className="ui-th hidden lg:table-cell">Detail</th>
                  <th scope="col" className="ui-th">Owner</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.key} data-severity={x.severity}>
                    <td>
                      <span className="ui-exc-title">
                        <span className="ui-exc-dot" data-severity={x.severity} aria-hidden="true" />
                        <span>
                          <span className="block font-medium">{x.title}</span>
                          <span className="ui-caption">{SEVERITY[x.severity]} · {KIND[x.kind] || x.kind}{x.status !== 'OPEN' ? ` · ${STATUS[x.status]}` : ''}</span>
                        </span>
                      </span>
                    </td>
                    <td className="ui-col-entity">{x.employeeName || '—'}</td>
                    <td className="whitespace-nowrap">{x.date ? dayLabel(x.date, { weekday: true, year: false }) : '—'}</td>
                    <td className="hidden lg:table-cell ui-caption max-w-[22rem]">{x.detail}{x.note ? ` · Note: ${x.note}` : ''}</td>
                    <td className="whitespace-nowrap">{x.assignee || <span className="ui-caption">Nobody</span>}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {x.employeeId && x.date && ['MISSING_OUT', 'NO_RECORD', 'OVERTIME'].includes(x.kind) ? (
                          <button type="button" className="ui-icon-btn" title="Why does this day say this?" aria-label={`Explain ${x.employeeName}'s day`} onClick={() => setExplaining(x)}><HelpCircle size={16} aria-hidden="true" /></button>
                        ) : null}
                        {!x.assigneeUserId ? (
                          <button type="button" className="ui-icon-btn" title="Take it" aria-label="Assign to me" onClick={() => change(x, { assignee: 'me', status: 'IN_PROGRESS' }, 'Assigned to you.')}><UserRoundCheck size={16} aria-hidden="true" /></button>
                        ) : null}
                        {x.status === 'OPEN' || x.status === 'IN_PROGRESS' ? (
                          <>
                            <button type="button" className="ui-icon-btn" title="Mark settled" aria-label="Mark settled" onClick={() => settle(x, 'RESOLVED')}><CheckCircle2 size={16} aria-hidden="true" /></button>
                            <button type="button" className="ui-icon-btn" title="Ignore" aria-label="Ignore" onClick={() => settle(x, 'IGNORED')}><EyeOff size={16} aria-hidden="true" /></button>
                          </>
                        ) : (
                          <button type="button" className="ui-icon-btn" title="Reopen" aria-label="Reopen" onClick={() => change(x, { status: 'OPEN' }, 'Reopened.')}><CircleDot size={16} aria-hidden="true" /></button>
                        )}
                        {openScreen ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => open(x)}>Open</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated ? <p className="ui-caption p-3">Showing the first 1,000. Narrow the dates or pick one kind.</p> : null}
        </div>
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
    </div>
  );
}
