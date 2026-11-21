import React, { useCallback, useEffect, useState } from 'react';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { Panel } from '../../apps/admin/src/screens/wsKit';
import { opsAskSupportGrant, opsEndSupportGrant, opsSupportGrants } from './api';
import { Empty, Err, Loading, countsChanged, may, useRowBusy, when, errorWords } from './kit';
import { Button } from '@ui/components/ui/Primitives';

/**
 * Customer page → Support access (docs/workspace/SUPPORT_GRANTS.md).
 *
 * Support asks to look inside one of the customer's companies, with a reason
 * the customer reads. Nothing opens here: an owner or admin of the account
 * answers in Workspace → CLOR support access. Once they say yes, the company
 * is in your company list on app.clor.in until the time they chose.
 */

const APP_URL = typeof window !== 'undefined' && /(^|\.)clor\.in$/.test(window.location.hostname) ? 'https://app.clor.in' : '';
const STATE = {
  PENDING: 'Waiting for the customer',
  ACTIVE: 'Open',
  EXPIRED: 'Ran out',
  ENDED: 'Ended',
  REVOKED: 'Refused or withdrawn',
};

export function SupportAccess({ id, companies, role }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState(companies[0]?.id || '');
  const [reason, setReason] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [change, setChange] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    opsSupportGrants(id)
      .then((r) => (setData(r.grants || []), setError('')))
      .catch((e) => setError(errorWords(e, 'load the support access requests')));
  }, [id]);
  useEffect(load, [load]);

  const nameOf = (org) => companies.find((c) => c.id === org)?.name || 'A company';
  const codeOf = (org) => companies.find((c) => c.id === org)?.code || '';
  const canAsk = may(role, 'SUPPORT');

  const ask = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await opsAskSupportGrant(id, { orgId, reason, ticketRef: ticketRef || undefined, scope: change ? 'READ_WRITE' : 'READ_ONLY' });
      notify.success('Asked. The customer answers in the Admin center.');
      setReason('');
      setTicketRef('');
      setChange(false);
      load();
    } catch (err) {
      notify.error(errorWords(err, 'ask the customer'));
    } finally {
      setBusy(false);
    }
  };
  const rowBusy = useRowBusy();
  const end = async (g) => {
    if (rowBusy.busy(g.id)) return;
    const company = nameOf(g.orgId);
    const ok = await confirmDialog(
      g.state === 'PENDING'
        ? { title: `Withdraw the request for ${company}?`, message: 'The customer is no longer asked. To look later you ask again, with a reason.', confirmLabel: 'Withdraw request', cancelLabel: 'Keep it' }
        : { title: `Close access to ${company}?`, message: `CLOR staff lose access to ${company} now, before the time the customer chose. To look again you ask the customer again.`, confirmLabel: 'Close access', cancelLabel: 'Keep it open' }
    );
    if (!ok) return;
    await rowBusy.run(g.id, async () => {
      try {
        await opsEndSupportGrant(g.id);
        notify.success(g.state === 'PENDING' ? 'Withdrawn.' : `Closed. CLOR staff no longer see ${company}.`);
        countsChanged();
      } catch (err) {
        notify.error(errorWords(err, 'close the request'));
      }
      load();
    });
  };

  return (
    <>
      {canAsk ? (
        <Panel title="Ask to look inside a company">
          <form onSubmit={ask} className="grid gap-3" style={{ maxWidth: '40rem' }}>
            <p className="ws-card-blurb">
              The customer reads your reason and decides how long. You get read-only access unless you ask to change something and
              they agree. Salary and payslips, employee documents and bank details stay closed either way.
            </p>
            {companies.length > 1 ? (
              <label className="block">
                <span className="ui-label">Company</span>
                <select className="ui-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div>
              <label className="block">
                <span className="ui-label">Why you need to look</span>
                <textarea className="ui-input w-full" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="sg-reason-hint" placeholder="Invoices raised on 12 Nov will not save; I need to see the series settings." />
              </label>
              <span id="sg-reason-hint" className="ui-caption block">The customer reads this. Ten characters at least.</span>
            </div>
            <label className="block">
              <span className="ui-label">Ticket</span>
              <input className="ui-input" maxLength={60} value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} placeholder="Optional, e.g. T-1042" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={change} onChange={(e) => setChange(e.target.checked)} /> I may need to change something to fix it
            </label>
            <div>
              <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={!orgId || reason.trim().length < 10} type="submit">Ask the customer</Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel title="Requests and access">
        {error ? (
          <Err onRetry={load}>{error}</Err>
        ) : !data ? (
          <Loading />
        ) : !data.length ? (
          <Empty>Nobody from CLOR has asked to look inside this account.</Empty>
        ) : (
          <ul className="ws-list">
            {data.map((g) => (
              <li key={g.id}>
                <div className="ws-item">
                  <span className="ws-item-text">
                    <span className="ws-item-title">
                      {nameOf(g.orgId)} · {STATE[g.state] || g.state}
                    </span>
                    <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>
                      {g.staff}{g.mine ? ' (you)' : ''} · {g.scope === 'READ_WRITE' ? 'read and change' : 'read only'} · asked {when(g.requestedAt)}
                      {g.state === 'ACTIVE' ? ` · open until ${when(g.expiresAt)}` : ''}
                    </span>
                    <span className="ws-item-sub" style={{ whiteSpace: 'normal' }}>{g.reason}</span>
                  </span>
                  {g.mine && (g.state === 'ACTIVE' || g.state === 'PENDING') ? (
                    <span className="inline-flex gap-1">
                      {g.state === 'ACTIVE' && codeOf(g.orgId) ? (
                        <a className="ws-btn ws-btn--quiet ws-btn--small" href={`${APP_URL}/o/${encodeURIComponent(codeOf(g.orgId))}`} target="_blank" rel="noreferrer">
                          Open in the app
                        </a>
                      ) : null}
                      <Button plain className="ws-btn ws-btn--quiet ws-btn--small" loading={rowBusy.busy(g.id)} onClick={() => end(g)}>
                        {g.state === 'PENDING' ? 'Withdraw' : 'Done, close it'}
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
