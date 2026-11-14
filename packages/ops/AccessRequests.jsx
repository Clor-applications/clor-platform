import React, { useCallback, useEffect, useState } from 'react';
import { notify } from '@ui/components/ui/notify';
import { AlertTriangle } from '@ui/components/ui/lineIcons';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, Loading, Tabs, when } from './kit';
import { opsEndSupportGrant, opsMySupportGrants } from './api';

/**
 * Access requests (Trust; server: routes/supportGrants.ts, GET /ops/support-grants).
 * Every time you asked a customer to let you look inside one of their
 * companies, across all accounts: waiting for the customer, open now, and
 * the ones that ended. Nothing is approved here — the customer's owner or
 * admin answers in Workspace, so nobody at CLOR approves their own look.
 * New requests are asked from the account's Support access tab, with a reason.
 */
const STATE = {
  PENDING: ['Waiting for the customer', 'ws-pill ws-pill--warn'],
  ACTIVE: ['Open', 'ws-pill ws-pill--ok'],
  EXPIRED: ['Ran out', 'ws-pill ws-pill--off'],
  ENDED: ['Ended', 'ws-pill ws-pill--off'],
  REVOKED: ['Refused or withdrawn', 'ws-pill ws-pill--danger'],
};
const TAB_STATES = { waiting: ['PENDING'], open: ['ACTIVE'], ended: ['EXPIRED', 'ENDED', 'REVOKED'] };

const initials = (s) =>
  String(s || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function AccessRequests({ openCustomer }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('waiting');
  const load = useCallback(() => {
    opsMySupportGrants()
      .then((r) => (setRows(r?.grants || []), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const end = async (g) => {
    try {
      await opsEndSupportGrant(g.id);
      notify.success(g.state === 'PENDING' ? 'Withdrawn.' : 'Closed.');
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    }
    load();
  };

  const count = (k) => (rows ? rows.filter((g) => TAB_STATES[k].includes(g.state)).length : 0);
  const shown = rows ? rows.filter((g) => TAB_STATES[tab].includes(g.state)) : [];
  return (
    <>
      <PageHead
        title="Access requests"
        description="Your requests to look inside a customer’s company. The customer’s owner or admin answers each one in Workspace; nobody at CLOR approves their own."
      />
      <Tabs
        label="Which requests"
        value={tab}
        onChange={setTab}
        tabs={[
          ['waiting', `Waiting${rows ? ` · ${count('waiting')}` : ''}`],
          ['open', `Open${rows ? ` · ${count('open')}` : ''}`],
          ['ended', 'Ended'],
        ]}
      />
      <Err>{error}</Err>
      {!rows ? (
        error ? null : <Loading />
      ) : !shown.length ? (
        <Empty>
          {tab === 'waiting'
            ? 'Nothing is waiting for a customer. Ask from an account’s Support access tab.'
            : tab === 'open'
              ? 'You cannot look inside any customer’s company right now.'
              : 'No request has ended yet.'}
        </Empty>
      ) : (
        <ul className="ws-list ws-list--ground" aria-label="Requests">
          {shown.map((g) => {
            const [word, cls] = STATE[g.state] || [g.state, 'ws-pill'];
            return (
              <li key={g.id}>
                <div className="ws-item ws-item--wrap">
                  <span className="ops-initials" aria-hidden="true">{initials(g.company)}</span>
                  <span className="ws-item-text">
                    <span className="ws-item-title">
                      {g.scope === 'READ_WRITE' ? 'Look at and change' : 'View'} {g.company} {g.scope === 'READ_WRITE' ? '' : '(read-only)'}
                    </span>
                    <span className="ws-item-sub">
                      {[g.ticketRef ? `#${String(g.ticketRef).replace(/^#/, '')}` : null, g.reason, `asked ${ago(g.requestedAt)}`, g.state === 'ACTIVE' && g.expiresAt ? `open until ${when(g.expiresAt)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="ws-item-actions inline-flex flex-wrap items-center gap-2">
                    <span className={cls}>{word}</span>
                    {g.state === 'PENDING' || g.state === 'ACTIVE' ? (
                      <button type="button" className="ops-text-btn" onClick={() => end(g)} aria-label={`${g.state === 'PENDING' ? 'Withdraw' : 'Close'} the request for ${g.company}`}>
                        {g.state === 'PENDING' ? 'Withdraw' : 'Done, close it'}
                      </button>
                    ) : null}
                    {g.accountId ? (
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openCustomer(g.accountId)}>
                        Open account
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="ops-callout">
        <AlertTriangle size={16} aria-hidden="true" />
        Access ends on its own at the time the customer chose. Salary, payslips, employee documents and bank details stay closed either way, and every look is in the customer’s own audit log.
      </p>
    </>
  );
}
