import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Inbox, Search, X } from 'lucide-react';
import { decideApproval, getApprovalHistory, getApprovals, retryApprovalPosting } from '../../api/governance';
import { EmptyState, PageHeader, Spinner } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';
import { formatDateIn } from '@ui/utils/dates';

const VIEWS = {
  approvals: { title: 'My Approvals', scope: 'mine', status: 'PENDING' },
  approvalsOverview: { title: 'Approval Overview', scope: 'all', status: 'ALL' },
  approvalsRequests: { title: 'My Requests', scope: 'requested', status: 'ALL' },
  approvalsAll: { title: 'All Approvals', scope: 'all', status: 'ALL' },
  approvalsHistory: { title: 'Approval History', scope: 'all', status: 'ALL' },
};
const statusTone = (s) => s === 'APPROVED' ? 'ui-pill-pos' : s === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-neutral';

export const ApprovalsInbox = ({ currentCompany, view = 'approvals' }) => {
  const config = VIEWS[view] || VIEWS.approvals;
  const [status, setStatus] = useState(config.status);
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
      setLoading(true);
      setError('');
    try {
      const response = await getApprovals(status, config.scope);
      setRequests(response?.requests || []);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [status, config.scope]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setStatus(config.status); setSelected(null); }, [view]);

  const visible = useMemo(() => requests.filter((r) => {
    if (view === 'approvalsHistory' && r.status === 'PENDING') return false;
    const needle = query.trim().toLowerCase();
    return !needle || [r.docType, r.docId, r.document?.number, r.document?.customerName, r.document?.partyName, r.rule?.name, r.status, r.comment]
      .some((value) => String(value || '').toLowerCase().includes(needle));
  }), [requests, query, view]);
  const counts = {
    pending: requests.filter((r) => r.status === 'PENDING').length,
    approved: requests.filter((r) => r.status === 'APPROVED').length,
    rejected: requests.filter((r) => r.status === 'REJECTED').length,
  };
  const open = async (request) => {
    setSelected(request); setComment(''); setEvents([]);
    try { setEvents((await getApprovalHistory(request.id))?.events || []); }
    catch (e) { setError(String(e?.message || e)); }
  };
  const decide = async (approve) => {
    if (!selected || (!approve && !comment.trim())) return;
    setBusy(true); setError('');
    try {
      const result = await decideApproval(selected.id, approve, comment.trim());
      setNotice(approve ? (result?.posted ? 'Approved and posted' : 'Approved') : 'Rejected');
      setSelected(null); await load();
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const retryPosting = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await retryApprovalPosting(selected.id);
      setNotice('Approved document posted');
      setSelected(null); await load();
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3">
    <PageHeader entity="report" title={config.title} />
    {error && <div className="ui-card p-3 text-sm text-[rgb(var(--neg))]" role="alert">{error}</div>}
    {notice && <div className="ui-pill ui-pill-pos" role="status">{notice}</div>}
    {view === 'approvalsOverview' && <div className="grid grid-cols-3 gap-2">
      {[['Pending', counts.pending], ['Approved', counts.approved], ['Rejected', counts.rejected]].map(([label, count]) =>
        <div className="ui-card p-3" key={label}><div className="ui-muted text-xs">{label}</div><div className="ui-title text-xl">{count}</div></div>)}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 max-w-sm"><Search size={15} className="absolute left-3 top-2.5 ui-muted" />
        <input className="ui-input !pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search approvals" aria-label="Search approvals" /></div>
      {view !== 'approvalsHistory' && <select className="ui-select !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Approval status">
        <option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
      </select>}
    </div>
    <div className="ui-card overflow-x-auto">
      <table className="w-full text-sm"><thead className="text-left"><tr>
        <th className="px-3 py-2">Transaction</th><th className="px-3 py-2">Workflow</th><th className="px-3 py-2 text-right">Amount</th>
        <th className="px-3 py-2">Submitted</th><th className="px-3 py-2">Status</th>
      </tr></thead><tbody>
        {visible.map((r) => <tr key={r.id} className="cursor-pointer ui-hover-sunken" onClick={() => open(r)}>
          <td className="px-3 py-2"><strong>{r.document?.number || r.docType}</strong><div className="ui-muted text-xs">{r.document?.customerName || r.document?.partyName || r.docType}</div></td>
          <td className="px-3 py-2">{r.rule?.name || '—'}</td><td className="px-3 py-2 text-right whitespace-nowrap ui-money">{formatMoney(r.amount, currentCompany)}</td>
          <td className="px-3 py-2 whitespace-nowrap">{formatDateIn(r.createdAt, currentCompany)}</td>
          <td className="px-3 py-2"><span className={`ui-pill ${statusTone(r.status)}`}>{r.status}</span></td>
        </tr>)}
      </tbody></table>
      {!loading && !visible.length && <EmptyState icon={Inbox} title="No approvals found" description="Requests matching this view will appear here." />}
      {loading && <div className="flex justify-center p-6"><Spinner /></div>}
    </div>
    {selected && <div className="fixed inset-0 z-[80] ui-scrim flex justify-end" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
      <aside className="bg-[rgb(var(--surface))] h-full w-full max-w-lg shadow-xl flex flex-col" aria-label="Approval details">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><div className="ui-title text-lg">{selected.docType} approval</div><div className="ui-muted text-xs">{selected.document?.number || selected.docId}</div></div>
          <button className="ui-btn ui-btn-ghost" onClick={() => setSelected(null)} aria-label="Close"><X size={18}/></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
          <div className="grid grid-cols-2 gap-3"><div><div className="ui-muted text-xs">Amount</div><strong>{formatMoney(selected.amount, currentCompany)}</strong></div>
            <div><div className="ui-muted text-xs">Status</div><span className={`ui-pill ${statusTone(selected.status)}`}>{selected.status}</span></div>
            <div><div className="ui-muted text-xs">Workflow</div>{selected.rule?.name || '—'}</div>
            <div><div className="ui-muted text-xs">Submitted</div>{new Date(selected.createdAt).toLocaleString()}</div>
            {selected.document && <><div><div className="ui-muted text-xs">Party</div>{selected.document.customerName || selected.document.partyName || '—'}</div>
              <div><div className="ui-muted text-xs">Accounting status</div>{selected.document.status}</div>
              <div><div className="ui-muted text-xs">Transaction date</div>{selected.document.date}</div></>}</div>
          {selected.comment && <div className="ui-card p-3"><strong>Decision note</strong><p className="mt-1">{selected.comment}</p></div>}
          {selected.status === 'APPROVED' && selected.document?.status === 'Pending Approval' && config.scope === 'mine' &&
            !requests.some((r) => r.docType === selected.docType && r.docId === selected.docId && r.sequence > selected.sequence) &&
            <button className="ui-btn ui-btn-primary" disabled={busy} onClick={retryPosting}>Retry posting</button>}
          <div><div className="ui-title text-sm mb-2">Activity</div><div className="space-y-3">
            {events.map((event, i) => <div className="flex gap-2" key={`${event.action}-${i}`}><Clock3 size={15} className="mt-0.5 ui-muted" />
              <div><strong>{event.action}</strong><div className="ui-muted text-xs">{new Date(event.createdAt).toLocaleString()}</div>{event.message && <div>{event.message}</div>}</div></div>)}
          </div></div>
          {selected.status === 'PENDING' && config.scope === 'mine' && <div>
            <label className="ui-label" htmlFor="approval-comment">Decision note <span className="ui-muted">(required to reject)</span></label>
            <textarea id="approval-comment" className="ui-input min-h-20" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>}
        </div>
        {selected.status === 'PENDING' && config.scope === 'mine' && <div className="border-t p-4 flex gap-2 justify-end">
          <button className="ui-btn ui-btn-ghost" disabled={busy || !comment.trim()} onClick={() => decide(false)}><X size={15}/> Reject</button>
          <button className="ui-btn ui-btn-primary" disabled={busy} onClick={() => decide(true)}>{busy ? <Spinner/> : <Check size={15}/>} Approve</button>
        </div>}
      </aside>
    </div>}
  </div>;
};

export default ApprovalsInbox;
