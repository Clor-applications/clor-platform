import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';

import { PageHead } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, Loading, ReasonDrawer, Tabs, when } from './kit';
import { opsApprovalLimit, opsApprovalStep, opsApprovals } from './api';

/**
 * Approvals (operator console, Money; server: routes/opsApprovals.ts). A deal
 * whose discount is over the limit waits here until someone other than the
 * person who asked approves it, with their authenticator code. Only then is
 * it applied. The owner sets the limit.
 */
const PILL = { PENDING: 'ws-pill ws-pill--warn', APPROVED: 'ws-pill ws-pill--ok', REJECTED: 'ws-pill ws-pill--off', CANCELLED: 'ws-pill ws-pill--off', EXPIRED: 'ws-pill ws-pill--off', FAILED: 'ws-pill ws-pill--danger' };

const STEP = {
  approve: { title: 'Approve', what: (a) => `${a.customer}: ${a.summary}. It is set on the customer as soon as you approve, in your name, with ${a.askedBy}’s request on the record.`, done: 'Approved and set on the customer.', optional: true },
  reject: { title: 'Turn down', what: (a) => `${a.customer}: ${a.summary}. Nothing changes for the customer. ${a.askedBy} sees your reason.`, done: 'Turned down.', optional: false },
};

export function Approvals({ openCustomer }) {
  const [tab, setTab] = useState('PENDING');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limit, setLimit] = useState('');

  const load = useCallback(() => {
    opsApprovals(tab)
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [tab]);
  useEffect(() => {
    load();
  }, [load]);

  const changeTab = (t) => {
    setD(null);
    setTab(t);
  };
  const doStep = async (note) => {
    await opsApprovalStep(step.a.id, step.k, note);
    notify.success(STEP[step.k].done);
    setStep(null);
    load();
  };
  const withdraw = async (a) => {
    try {
      await opsApprovalStep(a.id, 'withdraw');
      notify.success('Withdrawn. Nothing changed for the customer.');
      load();
    } catch (e) {
      notify.error(String(e?.message || e));
    }
  };
  const saveLimit = async (reason) => {
    await opsApprovalLimit(Number(limit), reason);
    notify.success(`Discounts over ${Number(limit)}% now need a second person.`);
    setLimitOpen(false);
    load();
  };
  const rows = d?.approvals || [];
  const limitOk = /^\d{1,2}$/.test(limit) && Number(limit) <= 90;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Money', 'Approvals']}
          title="Approvals"
          description={d ? `Deals over ${d.limit}% off wait here until someone other than the person who asked approves them.` : 'Deals over the limit wait here for a second person.'}
          meta={d ? `${d.waiting} waiting · requests expire after ${d.expiresHours} hours` : null}
          actions={
            d?.canChangeLimit ? (
              <button
                type="button"
                className="ws-btn ws-btn--quiet"
                onClick={() => {
                  setLimit(String(d.limit));
                  setLimitOpen(true);
                }}
              >
                Change the limit
              </button>
            ) : null
          }
        />
        <Tabs
          label="Which requests"
          value={tab}
          onChange={changeTab}
          tabs={[
            ['PENDING', `Waiting${d && tab === 'PENDING' ? ` (${d.waiting})` : ''}`],
            ['DONE', 'Decided'],
            ['EXPIRED', 'Expired'],
          ]}
        />
        <Err>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && !rows.length ? (
          <Empty>{tab === 'PENDING' ? 'Nothing is waiting. A deal with a discount over the limit comes here when Finance sets it.' : tab === 'DONE' ? 'Nothing has been decided yet.' : 'No request has expired.'}</Empty>
        ) : d ? (
          <ul className="ws-list ws-list--ground" aria-label="Requests">
            {rows.map((a) => (
              <li key={a.id}>
                <div className="ws-item ws-item--wrap" style={{ alignItems: 'flex-start' }}>
                  <span className="ws-item-text">
                    <span className="ws-item-title">
                      {a.accountId ? (
                        <button type="button" className="ws-name-link" onClick={() => openCustomer(a.accountId)}>
                          {a.customer}
                        </button>
                      ) : (
                        'A customer'
                      )}
                      {a.discountPercent != null ? <span className="tabular-nums"> · {a.discountPercent}% off</span> : null}
                    </span>
                    <span className="ws-item-sub" style={{ color: 'rgb(var(--ws-ink))' }}>
                      {a.summary}
                    </span>
                    <span className="ws-item-sub">
                      Asked by {a.mine ? 'you' : a.askedBy}, {when(a.createdAt)}. Why: {a.reason}
                    </span>
                    <span className="ws-item-sub">
                      <span className={PILL[a.status] || 'ws-pill'}>{a.statusWord}</span>
                      {a.status === 'PENDING' ? ` · until ${when(a.expiresAt)}` : ''}
                      {a.decidedBy && a.status !== 'CANCELLED' ? ` · by ${a.decidedBy}, ${when(a.decidedAt)}` : ''}
                      {a.decisionNote ? ` · “${a.decisionNote}”` : ''}
                      {a.result?.error ? ` · ${a.result.error}` : ''}
                    </span>
                    {a.status === 'PENDING' && a.mine ? <span className="ws-item-sub">Waiting for a colleague. You cannot approve your own request.</span> : null}
                  </span>
                  {a.canDecide || a.canWithdraw ? (
                    <span className="ws-item-actions inline-flex flex-wrap gap-2">
                      {a.canDecide ? (
                        <>
                          <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setStep({ k: 'approve', a })} aria-label={`Approve the request for ${a.customer}`}>
                            Approve
                          </button>
                          <button type="button" className="ws-btn ws-btn--danger-quiet" onClick={() => setStep({ k: 'reject', a })} aria-label={`Turn down the request for ${a.customer}`}>
                            Turn down
                          </button>
                        </>
                      ) : null}
                      {a.canWithdraw ? (
                        <button type="button" className="ws-btn ws-btn--quiet" onClick={() => withdraw(a)} aria-label={`Withdraw the request for ${a.customer}`}>
                          Withdraw
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ReasonDrawer
        open={Boolean(step)}
        title={step ? `${STEP[step.k].title}: ${step.a.customer}` : ''}
        what={step ? STEP[step.k].what(step.a) : ''}
        confirmLabel={step ? STEP[step.k].title : ''}
        tone={step?.k === 'reject' ? 'danger' : 'primary'}
        reasonOptional={step ? STEP[step.k].optional : false}
        onClose={() => setStep(null)}
        onConfirm={doStep}
      />
      <ReasonDrawer open={limitOpen} title="Discount that needs a second person" confirmLabel="Save" ready={limitOk} onClose={() => setLimitOpen(false)} onConfirm={saveLimit}>
        <div className="grid gap-1">
          <label htmlFor="approval-limit" className="text-sm font-medium">
            Ask a second person when a subscription takes off more than, %
          </label>
          <input id="approval-limit" className="ui-input tabular-nums" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-describedby="approval-limit-hint" style={{ maxWidth: '8rem' }} />
          <span id="approval-limit-hint" className="ws-card-blurb">
            0 to 90. At 0 every discount needs a second person.
          </span>
        </div>
      </ReasonDrawer>
    </div>
  );
}
