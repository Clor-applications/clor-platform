import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { useListSearch } from '@ui/components/ListToolbar';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { formatDateIn } from '@ui/utils/dates';
import { decideRequest, listRequests, replyRequest, withdrawRequest } from '../api/approvals';

/*
 * Approvals (docs/people/04 §4.2): everything waiting for me, by due date,
 * and what I asked for. A row opens the request with its steps; approve,
 * reject with a reason, ask for more, or withdraw my own.
 */
const STATUS = { WAITING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', MORE_INFO: 'Asked for more' };
const STEP = { WAITING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', MORE_INFO: 'Asked for more', HANDED_ON: 'Handed on', SKIPPED: 'Skipped', WITHDRAWN: 'Withdrawn' };
const TONE = { WAITING: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral', MORE_INFO: 'warn', HANDED_ON: 'neutral', SKIPPED: 'neutral' };
const TYPE = { PROFILE_CHANGE: 'Profile change', JOB_CHANGE: 'Job change', LEAVING: 'Leaving', DOCUMENT_REQUEST: 'Document', LETTER_REQUEST: 'Letter', POLICY_PUBLISH: 'Policy', DESK_ESCALATION: 'Help desk', SEAT_REQUEST: 'Seat', PROBATION: 'Probation' };
const TABS = [{ key: 'waiting', label: 'Waiting for me' }, { key: 'mine', label: 'Asked by me' }];

export default function Approvals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('waiting');
  const [open, setOpen] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const load = useCallback(async () => {
    try {
      setData(await listRequests());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load approvals.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (tab === 'waiting' ? data?.waitingForMe : data?.mine) || [], [data, tab]);
  const search = useListSearch(rows, ['title', 'requesterName', 'requestType']);
  useResetPage(setPage, [tab, search.query, perPage]);
  const { pageRows, safePage, pageCount } = usePaged(search.filtered, perPage, page);
  const counts = { waiting: data?.waitingForMe?.length || 0, mine: data?.mine?.length || 0 };

  const act = async (action) => {
    if (!open) return;
    if (action !== 'approve' && action !== 'withdraw' && !comment.trim()) return notify.error(action === 'reject' ? 'Say why it is not approved.' : 'Say what more is needed.');
    setBusy(action);
    try {
      const r = action === 'withdraw' ? await withdrawRequest(open.id) : action === 'reply' ? await replyRequest(open.id, comment.trim()) : await decideRequest(open.id, action, comment.trim() || undefined);
      setOpen(r.request);
      setComment('');
      notify.success(action === 'approve' ? (r.request.status === 'APPROVED' ? 'Approved and done.' : 'Approved; sent on to the next step.') : action === 'reject' ? 'Not approved.' : action === 'withdraw' ? 'Withdrawn.' : action === 'reply' ? 'Answer sent.' : 'Asked for more.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };

  if (!data && !error) return <SkeletonCard lines={6} />;
  const mineOpen = open && tab === 'mine';
  return (
    <DocumentListShell
      entity="people"
      title="Approvals"
      description="What is waiting for you, by when it is due; and what you asked for."
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search requests…', label: 'Search requests' }}
      tabs={TABS}
      statusValue={tab}
      statusCounts={counts}
      onStatusChange={setTab}
      tabsLabel="Requests"
    >
      {error ? <div className="p-4" role="alert">{error}<button className="ui-btn ml-3" onClick={load}>Retry</button></div> : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table w-full">
              <thead><tr><th scope="col">Request</th><th scope="col">Kind</th><th scope="col">Asked by</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
              <tbody className="ui-rows">
                {!pageRows.length ? (
                  <tr><td colSpan={5}><EmptyState title={tab === 'waiting' ? 'Nothing waiting for you' : 'You have not asked for anything yet'} description={tab === 'waiting' ? 'Requests routed to you show here, soonest due first.' : 'A change you send for approval shows here with each step.'} /></td></tr>
                ) : pageRows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => { setOpen(r); setComment(''); }}>
                    <td className="ui-col-entity">{r.title}</td>
                    <td className="ui-col-meta">{TYPE[r.requestType] || r.requestType}</td>
                    <td className="ui-col-meta">{r.requesterName}</td>
                    <td className="ui-col-meta tabular-nums">{r.status === 'WAITING' ? formatDateIn(String(r.dueAt).slice(0, 10)) : '—'}{r.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</td>
                    <td><span className={`ui-pill ui-pill-${TONE[r.status] || 'neutral'}`}>{STATUS[r.status] || r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={search.filtered.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} />
        </>
      )}

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title || 'Request'} widthClass="w-[min(40rem,96vw)]"
        actions={open ? (
          <>
            {open.status === 'WAITING' && tab === 'waiting' ? (
              <>
                <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('more-info')}>Ask for more</button>
                <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('reject')}>Reject</button>
                <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => act('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
              </>
            ) : null}
            {mineOpen && open.status === 'MORE_INFO' ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => act('reply')}>Send answer</button> : null}
            {mineOpen && ['WAITING', 'MORE_INFO'].includes(open.status) ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('withdraw')}>Withdraw</button> : null}
          </>
        ) : null}
      >
        {open ? (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="ui-t-label">Kind</dt><dd>{TYPE[open.requestType] || open.requestType}</dd></div>
              <div><dt className="ui-t-label">Asked by</dt><dd>{open.requesterName} · {formatDateIn(String(open.createdAt).slice(0, 10))}</dd></div>
              <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ui-pill-${TONE[open.status] || 'neutral'}`}>{STATUS[open.status] || open.status}</span></dd></div>
              <div><dt className="ui-t-label">Rule</dt><dd>version {open.ruleVersion}</dd></div>
            </dl>
            {open.payload?.fields ? (
              <div>
                <h3 className="ui-t-label mb-1">What changes</h3>
                <ul className="space-y-1">
                  {Object.entries(open.payload.fields).map(([k, v]) => (
                    <li key={k}><span className="ui-muted">{k.replace(/Id$/, '')}</span>: <span className="ui-muted">{String(v.before ?? 'None')}</span> → <strong>{String(v.after ?? 'None')}</strong></li>
                  ))}
                </ul>
                {open.payload.effectiveOn ? <p className="ui-caption mt-1">Takes effect {formatDateIn(open.payload.effectiveOn)}</p> : null}
                {open.payload.reason ? <p className="mt-1">{open.payload.reason}</p> : null}
              </div>
            ) : null}
            <div>
              <h3 className="ui-t-label mb-1">Steps</h3>
              <ol className="space-y-2" aria-label="Approval steps">
                {open.steps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <span className={`ui-pill ui-pill-${TONE[s.status] || 'neutral'}`}>{STEP[s.status] || s.status}</span>
                    <span>Step {s.order}: {s.decidedBy || s.candidates.join(' or ')}{s.standInFor ? ` (standing in for ${s.standInFor})` : ''}</span>
                    <span className="ui-caption tabular-nums">{s.status === 'WAITING' ? `due ${formatDateIn(String(s.dueAt).slice(0, 10))}` : s.decidedAt ? formatDateIn(String(s.decidedAt).slice(0, 10)) : ''}</span>
                    {s.comment ? <span className="ui-caption">· {s.comment}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
            {(open.status === 'WAITING' && tab === 'waiting') || (mineOpen && open.status === 'MORE_INFO') ? (
              <label className="block">
                <span className="ui-label">{mineOpen ? 'Your answer' : 'Comment (needed to reject or ask for more)'}</span>
                <textarea className="ui-input w-full" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
              </label>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}
