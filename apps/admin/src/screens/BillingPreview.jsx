import React, { useEffect, useState } from 'react';

import NotConnected from '@ui/components/ui/NotConnected';
import { emoji } from '@ui/components/ui/emoji';
import { getAccountOverview } from '@platform/admin/admin';
import { memberDirectory } from '@platform/admin/account';
import { requestOpenScreen } from '@platform/context';
import { getEntitlement } from '@ui/api/features';
import { Empty, LoadError, Loading, PageHead, SeatRow, appInfo } from './wsKit';
import { inr } from './InvoiceDocument';
import { InvoiceDrawer, InvoiceTable, invoiceDay, useInvoices } from './InvoiceDrawer';
import { seatsByApp } from './overviewFigures';
import PlanChange from './PlanChange';
import './workspace.css';
import './ws-plan.css';
import { planWord } from './planWords';

/**
 * Workspace → Plan → Billing & seats (redesign W-R8, R&D hand-off CLOR-03).
 *
 * The plan an account is on is real — stored, deciding what the product
 * offers, and read here from the server — and so is the usage. So are the
 * invoices CLOR has issued to this account (roadmap item 8, server:
 * routes/billing.ts GET /billing/invoices): each opens as the document, and an
 * unpaid one shows how to pay it: online by card, UPI or netbanking on the
 * active gateway's page when CLOR has one turned on (billing/payLinks.ts),
 * and a UPI QR with the amount filled in and CLOR's bank account. Back from
 * the gateway (?paid=<invoice>), the page asks whether it was paid.
 *
 * Seats per app are the Overview's: active members who can open the app in
 * any company, against the seats the subscription bought where it meters them.
 */
const used = (n, limit) => `${n ?? '—'}${limit ? ` / ${limit}` : ''}`;
/** What a seat is in each app, in words; seats are counted from the account's members. */
const SEAT_IS = {
  accounting: 'A seat is one person who can open Books.',
  people: 'A seat is one person who can open People.',
  payroll: 'A seat is one person who can open Payroll.',
  attendance: 'A seat is one person who can open Attendance. Devices are free.',
};
/** How many invoices Billing & seats lists; the Invoices page has them all. */
const RECENT = 3;
/* The colour icon the empty invoice list shows: the one the Invoices menu item wears. */
const EMPTY_ICON = emoji('page-facing-up');

export default function BillingPreview() {
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);
  const [overview, setOverview] = useState(null);
  const [directory, setDirectory] = useState(null);
  /* Neither the entitlement nor the account answered: said so, not left as "Reading the plan…". */
  const [planFailed, setPlanFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const viewer = useInvoices();
  const { invoices, failed: invoicesFailed, reload: reloadInvoices, payOnline, openInvoice } = viewer;

  useEffect(() => {
    let cancelled = false;
    // The plan and the usage are real; there is no money to show.
    Promise.all([getEntitlement().catch(() => null), getAccountOverview().catch(() => null)]).then(([ent, acct]) => {
      if (cancelled) return;
      setPlan(ent?.plan || acct?.plan || null);
      setUsage(acct?.usage || ent?.usage || null);
      setOverview(acct || null);
      setPlanFailed(!ent && !acct);
    });
    /* The directory counts seats in use; only owners and administrators may read it, so anyone else sees no seats. */
    memberDirectory()
      .then((d) => !cancelled && setDirectory(Array.isArray(d?.members) ? d.members : null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tries]);

  const unpaid = (invoices || []).filter((i) => i.status === 'ISSUED');
  const seatApps = (overview?.seats || []).map((s) => s.app).filter((a) => appInfo(a));
  const seats = directory && seatApps.length ? seatsByApp(directory, overview?.seats, seatApps) : null;
  const runRate = overview?.runRate || null;
  const renewal = overview?.renewal || null;
  const billedTo = invoices?.[0]?.buyerName || overview?.account?.name || null;
  const planWhen = renewal?.renewsAt ? `renews ${invoiceDay(renewal.renewsAt)}` : renewal?.endsAt ? `${renewal.status === 'trialing' ? 'trial ends' : 'ends'} ${invoiceDay(renewal.endsAt)}` : null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Billing & seats']} scope="account"
          title="Billing & seats"
          description="What you pay for, what you use, and what counts as a seat in each app."
          actions={
            <>
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => requestOpenScreen('invoices')}>
                Download invoices
              </button>
              <PlanChange
                asButton
                onInvoice={(id) => {
                  reloadInvoices();
                  openInvoice(id);
                }}
              />
            </>
          }
        />

        {invoices !== null && !payOnline ? (
          <NotConnected what="card payment">
            Plan, usage and invoices below are live. Pay each invoice by UPI or bank transfer, as it shows.
          </NotConnected>
        ) : null}

        {planFailed ? (
          <LoadError onRetry={() => { setPlanFailed(false); setTries((n) => n + 1); }}>The plan could not be loaded. Try again in a minute.</LoadError>
        ) : null}

        <section className="ws-plan-summary" aria-label="Plan">
          <div>
            <span className="ws-plan-label">Plan</span>
            <span className="ws-plan-value">{plan?.name || '—'}</span>
            <span className="ws-plan-sub">
              {plan ? (plan.inGoodStanding === false ? planWord(plan.status) : ['Active', planWhen].filter(Boolean).join(' · ')) : planFailed ? 'Could not load' : 'Loading the plan…'}
            </span>
          </div>
          {runRate ? (
            <div>
              <span className="ws-plan-label">Per month</span>
              <span className="ws-plan-value ws-plan-money">{runRate.monthly != null ? inr(runRate.monthly) : 'Not priced yet'}</span>
              <span className="ws-plan-sub">{runRate.monthly != null ? 'At today’s seats' : (runRate.unpriced || []).map((a) => appInfo(a)?.name || a).join(', ') || 'Ask CLOR for the price'}</span>
            </div>
          ) : null}
          {/* Round 64 "billingpage" A: the next bill's date and amount at the top, so nothing on it is a surprise. */}
          {runRate?.monthly > 0 && renewal?.renewsAt && (runRate.interval === 'month' || runRate.interval === 'year') ? (
            <div>
              <span className="ws-plan-label">Next bill</span>
              <span className="ws-plan-value ws-plan-money">{inr(runRate.interval === 'year' ? runRate.monthly * 12 : runRate.monthly)}</span>
              <span className="ws-plan-sub">On {invoiceDay(renewal.renewsAt)}, at today’s seats</span>
            </div>
          ) : null}
          <div>
            <span className="ws-plan-label">To pay</span>
            <span className="ws-plan-value ws-plan-money">{invoices === null ? '—' : inr(unpaid.reduce((n, i) => n + Number(i.total || 0), 0))}</span>
            <span className="ws-plan-sub">{invoices === null ? (invoicesFailed ? 'Could not load' : 'Loading invoices…') : unpaid.length ? `${unpaid.length === 1 ? 'One invoice' : `${unpaid.length} invoices`} unpaid` : 'Nothing unpaid'}</span>
          </div>
          <div>
            <span className="ws-plan-label">Usage</span>
            <span className="ws-plan-value">{used(usage?.users, plan?.limits?.maxUsers)} {usage?.users === 1 && !plan?.limits?.maxUsers ? 'user' : 'users'}</span>
            <span className="ws-plan-sub">{used(usage?.companies, plan?.limits?.maxCompanies)} {usage?.companies === 1 ? 'company' : 'companies'}</span>
          </div>
          {billedTo ? (
            <div>
              <span className="ws-plan-label">Billed to</span>
              <span className="ws-plan-value">{billedTo}</span>
            </div>
          ) : null}
        </section>

        {seats ? (
          <section className="ws-section" aria-labelledby="ws-seats-title">
            <h2 id="ws-seats-title" className="ws-h2">Seats by app</h2>
            <div className="ws-seats">
              {seats.map((x) => (
                <SeatRow key={x.app} app={x.app} used={x.used} limit={x.bought} unit={x.used === 1 && x.bought == null ? 'user' : 'users'} note={SEAT_IS[x.app]} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="ws-section" aria-labelledby="ws-invoices-title">
          <div className="ws-section-head">
            <h2 id="ws-invoices-title" className="ws-h2">Invoices</h2>
            {invoices && invoices.length > RECENT ? (
              <button type="button" className="ws-link" onClick={() => requestOpenScreen('invoices')}>
                All {invoices.length} invoices
              </button>
            ) : null}
          </div>
          {invoicesFailed ? (
            <LoadError onRetry={reloadInvoices}>Invoices could not be loaded. Try again in a minute.</LoadError>
          ) : invoices === null ? (
            <Loading shape="rows" rows={3} label="Loading invoices…" />
          ) : !invoices.length ? (
            <Empty icon={EMPTY_ICON} compact>No invoices yet. CLOR’s tax invoices for your plan will appear here.</Empty>
          ) : (
            <InvoiceTable invoices={invoices.slice(0, RECENT)} onOpen={openInvoice} />
          )}
          <p className="ws-foot-note">
            {unpaid.length
              ? `${unpaid.length === 1 ? 'One invoice is' : `${unpaid.length} invoices are`} unpaid. Open it to ${payOnline ? 'pay online by card, UPI or netbanking, ' : ''}scan the UPI QR, or pay into CLOR’s bank account.`
              : payOnline
                ? 'Each invoice can be paid online by card, UPI or netbanking, or by UPI QR and bank transfer.'
                : 'Each invoice shows CLOR’s UPI QR and bank account. Nothing is charged to a card.'}{' '}
            {payOnline ? 'An online payment is marked paid here at once; a transfer, once the money reaches CLOR.' : 'Once the money reaches CLOR the invoice is marked paid here.'}
          </p>
        </section>

        <InvoiceDrawer viewer={viewer} />
      </div>
    </div>
  );
}
