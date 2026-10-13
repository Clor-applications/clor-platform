import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Inbox, XCircle } from 'lucide-react';

import { decideApproval, getApprovals } from '../../api/governance';
import { EmptyState, PageHeader, Spinner, StatusPill, LoadingRegion, SkeletonCard } from '@ui/components/ui/Primitives';
import { formatMoney } from '@ui/utils/money';

const FILTERS = [
  { key: 'PENDING', label: 'Waiting' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

/**
 * Documents held by an approval threshold.
 *
 * Until this screen existed the rules were enforced but invisible: a document
 * could be held with nothing in the product showing why or who could release it.
 */
export const ApprovalsInbox = ({ currentCompany }) => {
  const [status, setStatus] = useState('PENDING');
  const [requests, setRequests] = useState([]);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(
    (next = status) => {
      setLoading(true);
      setError('');
      return getApprovals(next)
        .then((d) => setRequests(d?.requests || []))
        .catch((e) => setError(String(e?.message || e)))
        .finally(() => setLoading(false));
    },
    [status]
  );

  useEffect(() => {
    load(status);
  }, [load, status]);

  const decide = async (request, approve) => {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const res = await decideApproval(request.id, approve, comments[request.id] || undefined);
      setNotice(
        approve
          ? res?.posted
            ? 'Approved and posted to the ledger'
            : 'Approved'
          : 'Rejected'
      );
      await load(status);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        entity="report"
        title="Approvals"
        actions={
          notice ? (
            <span className="ui-pill ui-pill-pos" role="status">
              {notice}
            </span>
          ) : null
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatus(f.key)}
            className={`ui-btn ${status === f.key ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingRegion>
          <div className="space-y-3">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
        </LoadingRegion>
      ) : requests.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={Inbox}
      title={status === 'PENDING' ? 'Nothing waiting' : 'Nothing here'}
            description={
              status === 'PENDING'
                ? 'Documents above an approval threshold will appear here for whoever holds the approving role.'
                : 'No documents with this status.'
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="ui-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="ui-title text-sm">
                      {String(r.docType || '').toLowerCase()} · {formatMoney(r.amount, currentCompany)}
                    </span>
                    <StatusPill
                      status={r.status === 'PENDING' ? 'Pending' : r.status === 'APPROVED' ? 'Paid' : 'Rejected'}
                    />
                  </div>
                  <div className="ui-muted text-xs mt-1">
                    Rule: {r.rule?.name || '—'} · raised {new Date(r.createdAt).toLocaleString()}
                  </div>
                  {r.comment ? <div className="ui-subtle text-xs mt-1">Comment: {r.comment}</div> : null}
                </div>

                {r.status === 'PENDING' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="ui-input !w-56"
                      placeholder="Comment (optional)"
                      value={comments[r.id] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      aria-label="Decision comment"
                    />
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, true)}
                    >
                      {busyId === r.id ? <Spinner /> : <CheckCircle2 size={16} aria-hidden="true" />} Approve
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, false)}
                    >
                      <XCircle size={16} aria-hidden="true" /> Reject
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="ui-subtle text-xs">
        Approving a document is what posts it to the ledger. Nobody can approve a document they raised themselves.
      </p>
    </div>
  );
};

export default ApprovalsInbox;
