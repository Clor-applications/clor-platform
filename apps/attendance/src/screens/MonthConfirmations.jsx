import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Clock, MessageSquare, MessageSquareWarning, Smartphone } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { usePermissions } from '@ui/permissions/usePermissions';
import { getMonthReadiness, resolveMonthDispute, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Employees confirm their month in the app, or say what is wrong with it.
 * HR reads each dispute and answers it before the month is closed; the
 * employee sees the answer on their month. Month close warns while any is
 * still unanswered.
 */
const lastMonth = () => {
  const [y, m] = todayIst().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const when = (at) => new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const COLUMNS = {
  name: (d) => d.name,
  note: (d) => d.note,
  at: (d) => String(d.at || '').slice(0, 10),
  answer: (d) => (d.resolved ? 'Answered' : 'Not answered'),
};

/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Employee' },
  { key: 'note', label: 'What they say' },
  { key: 'at', label: 'When', value: (r) => (r.at ? new Date(r.at).toLocaleString('en-IN') : '') },
  { key: 'reply', label: 'HR’s reply', value: (r) => r.resolved?.reply || '' },
  { key: 'by', label: 'Answered by', value: (r) => r.resolved?.by || '' },
];

const EDIT = 'ATTENDANCE::Attendance Records::EDIT';

export default function MonthConfirmations() {
  const [month, setMonth] = useState(lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const perms = usePermissions();
  const canAnswer = Boolean(perms?.isAdmin) || Boolean(perms?.permissions?.has?.(EDIT));
  /* The dispute being answered, its reply, and what the last send said. */
  const [answering, setAnswering] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [message, setMessage] = useState('');
  /* Another month clears the last one's figures at once, while rendering; the fetch fills them in. */
  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setData(null);
    setMessage('');
  }
  const load = useCallback(() => {
    getMonthReadiness(month).then((d) => { setData(d.confirmations); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const disputed = data?.disputed || [];
  const open = disputed.filter((d) => !d.resolved).length;
  const search = useListSearch(disputed, ['name', 'note']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  const startAnswer = (d) => { setAnswering(d); setReply(''); setSendError(''); setMessage(''); };
  const close = () => { setAnswering(null); setReply(''); setSendError(''); };
  const send = async () => {
    setBusy(true);
    setSendError('');
    try {
      await resolveMonthDispute(month, answering.employeeId, reply.trim(), answering.at);
      setMessage(`Reply sent to ${answering.name}.`);
      close();
      load();
    } catch (e) {
      setSendError(String(e?.message || 'Not sent.'));
      /* Answered by someone else, or written again since: show the dispute as it is now. */
      if (e?.status === 409 || e?.code === 'DISPUTE_RESOLVED' || e?.code === 'DISPUTE_CHANGED') load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DocumentListShell
      entity="report"
      title="Employee confirmations"
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Employee confirmations', fileName: 'Month disputes', label: 'dispute/disputes', columns: EXPORT_COLUMNS, rows: rows });
      }}
      description="Who has confirmed their month in the app, and who says something is wrong. Answer each before the month closes."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search disputes…', label: 'Search disputes' }}
      headerExtras={<input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      cards={data ? [
        { label: 'Using the app', value: data.portalPeople, count: true, tone: 'all', Icon: Smartphone },
        { label: 'Confirmed', value: data.confirmed, count: true, tone: 'paid', Icon: CheckCheck },
        { label: 'Say it is wrong', value: disputed.length, count: true, tone: 'partial', Icon: MessageSquare },
        { label: 'Not answered', value: open, count: true, tone: 'overdue', Icon: MessageSquareWarning },
        { label: 'Not yet', value: data.notYet, count: true, tone: 'partial', Icon: Clock },
      ] : null}
    >
      <LoadFailed message={error} onRetry={load} />
      {message ? <p className="text-sm font-medium" role="status" style={{ color: 'rgb(var(--pos))' }}>{message}</p> : null}
      {!data ? (
        error ? null : <SkeletonCard lines={5} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="name" state={filters} />
                <ColumnHeader label="What they say" col="note" state={filters} className="ui-col-grow" />
                <ColumnHeader label="When" col="at" state={filters} type="date" />
                <ColumnHeader label="HR’s reply" col="answer" state={filters} className="ui-col-grow" />
                {canAnswer ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={canAnswer ? 5 : 4}>
                    {disputed.length ? (
                      <EmptyState kind="filtered" totalCount={disputed.length} title="No disputes match" description="Nothing matches the search or the column filters." />
                    ) : (
                      <EmptyState icon={CheckCheck} title="No disputes" description="When someone says their month is wrong, what they wrote appears here." />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.employeeId}>
                    <td className="ui-col-entity">{d.name}</td>
                    <td className="ui-col-grow whitespace-normal">{d.note}</td>
                    <td className="ui-col-date whitespace-nowrap tabular-nums">{when(d.at)}</td>
                    <td className="ui-col-grow whitespace-normal">
                      {d.resolved ? (
                        <>
                          <span className="block">{d.resolved.reply}</span>
                          <span className="ui-caption tabular-nums">{d.resolved.by ? `${d.resolved.by}, ` : ''}{when(d.resolved.at)}</span>
                        </>
                      ) : (
                        <span className="ui-pill ui-pill-warn">Not answered</span>
                      )}
                    </td>
                    {canAnswer ? (
                      <td className="text-right whitespace-nowrap">
                        {!d.resolved ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => startAnswer(d)} aria-label={`Resolve ${d.name}’s dispute`}>Resolve</button> : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <Drawer
        open={Boolean(answering)}
        onClose={close}
        dirty={Boolean(reply.trim()) && !busy}
        title={answering ? `Answer ${answering.name}` : 'Answer'}
        description="Your reply is shown to the employee on their month. Fix any day first in Attendance records; this reply changes no day."
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={close}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy || reply.trim().length < 3} onClick={send}>{busy ? 'Sending…' : 'Send reply'}</button>
          </>
        }
      >
        {answering ? (
          <div className="space-y-3">
            <div>
              <h3 className="ui-t-label">What they say</h3>
              <p className="text-sm whitespace-pre-line">{answering.note}</p>
              <p className="ui-caption tabular-nums">{when(answering.at)}</p>
            </div>
            <label className="block">
              <span className="ui-label">Your reply</span>
              <textarea className="ui-input w-full" rows={4} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Corrected the 12th to on duty. Your payable days are now 22." />
            </label>
            {sendError ? <p className="text-sm font-medium" role="alert" style={{ color: 'rgb(var(--neg))' }}>{sendError}</p> : null}
          </div>
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}
