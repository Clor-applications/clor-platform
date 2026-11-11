import React, { useCallback, useEffect, useRef, useState } from 'react';

import NotConnected from '@ui/components/ui/NotConnected';
import { notify } from '@ui/components/ui/notify';
import { getAccountOverview } from '@platform/admin/admin';
import { getEntitlement } from '@ui/api/features';
import { apiFetch } from '@platform/http';
import { printElement } from '@ui/utils/printElement';
import { ICON, PageHead, Panel, Stat, WsDrawer } from './wsKit';
import { InvoiceDocument, InvoiceStatus, inr } from './InvoiceDocument';
import './workspace.css';

/**
 * Workspace → Plan → Billing (redesign W-R8).
 *
 * The plan an account is on is real — stored, deciding what the product
 * offers, and read here from the server — and so is the usage. So are the
 * invoices CLOR has issued to this account (roadmap item 8, server:
 * routes/billing.ts GET /billing/invoices): each opens as the document, and an
 * unpaid one shows how to pay it: online by card, UPI or netbanking on the
 * active gateway's page when CLOR has one turned on (billing/payLinks.ts),
 * and a UPI QR with the amount filled in and CLOR's bank account. Back from
 * the gateway (?paid=<invoice>), the page asks whether it was paid.
 */
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const used = (n, limit) => `${n ?? '—'}${limit ? ` / ${limit}` : ''}`;

export default function BillingPreview() {
  const [plan, setPlan] = useState(null);
  const [usage, setUsage] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [open, setOpen] = useState(null);
  const [payOnline, setPayOnline] = useState(false);
  const [paying, setPaying] = useState(false);
  const paper = useRef(null);

  const openInvoice = useCallback((id) => {
    setOpen({ loading: true });
    apiFetch(`/billing/invoices/${encodeURIComponent(id)}`)
      .then((inv) => setOpen({ inv }))
      .catch((e) => setOpen({ error: String(e?.message || e) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The plan and the usage are real; there is no money to show.
    Promise.all([getEntitlement().catch(() => null), getAccountOverview().catch(() => null)]).then(([ent, acct]) => {
      if (cancelled) return;
      setPlan(ent?.plan || acct?.plan || null);
      setUsage(acct?.usage || ent?.usage || null);
    });
    const listInvoices = () =>
      apiFetch('/billing/invoices')
        .then((r) => {
          if (cancelled) return;
          setInvoices(r?.invoices || []);
          setPayOnline(Boolean(r?.payOnline));
        })
        .catch(() => !cancelled && setInvoices([]));
    /* Back from the payment page: ask whether the invoice is paid, then show it. */
    const back = new URLSearchParams(window.location.search).get('paid');
    if (back) {
      const url = new URL(window.location.href);
      url.searchParams.delete('paid');
      window.history.replaceState(null, '', url.toString());
      apiFetch(`/billing/invoices/${encodeURIComponent(back)}/pay/check`, { method: 'POST', body: {} })
        .then((r) => {
          if (cancelled) return;
          if (r?.paid) notify.success('Paid. Thank you. The invoice is marked paid.');
          else notify.info('If you paid, it can take a minute to show here. Nothing is charged twice.');
        })
        .catch(() => null)
        .finally(() => {
          if (cancelled) return;
          listInvoices();
          openInvoice(back);
        });
    } else listInvoices();
    return () => {
      cancelled = true;
    };
  }, [openInvoice]);
  /* The gateway's page for this invoice; it sends the customer back here with ?paid=<id>. */
  const payNow = async (inv) => {
    setPaying(true);
    try {
      const here = new URL(window.location.href);
      here.searchParams.set('paid', inv.id);
      const r = await apiFetch(`/billing/invoices/${encodeURIComponent(inv.id)}/pay`, { method: 'POST', body: { returnTo: here.toString() } });
      window.location.assign(r.url);
    } catch (e) {
      notify.error(String(e?.message || e));
      setPaying(false);
    }
  };
  const unpaid = (invoices || []).filter((i) => i.status === 'ISSUED');

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Billing']} scope="account"
          title="Billing"
        />

        {invoices !== null && !payOnline ? (
          <NotConnected what="card payment">
            Plan, usage and invoices below are live. Pay each invoice by UPI or bank transfer, as it shows.
          </NotConnected>
        ) : null}

        <div className="ws-stats">
          <Stat
            icon={ICON.plan}
            label="Current plan"
            value={plan?.name || '—'}
            note={plan ? (plan.inGoodStanding === false ? `Status: ${plan.status}` : 'Active') : 'Reading the plan…'}
          />
          <Stat icon={ICON.companies} label="Companies" value={used(usage?.companies, plan?.limits?.maxCompanies)} note={plan?.limits?.maxCompanies ? 'Used of the plan’s allowance' : 'No limit on this plan'} />
          <Stat icon={ICON.people} label="Users" value={used(usage?.users, plan?.limits?.maxUsers)} note={plan?.limits?.maxUsers ? 'Used of the plan’s allowance' : 'No limit on this plan'} />
        </div>

        <div className="ws-layout">
          <div className="ws-main">
            <Panel title="Invoices">
              {invoices === null ? (
                <p className="ws-card-blurb">Reading invoices…</p>
              ) : !invoices.length ? (
                <p className="ws-card-blurb">No invoices yet.</p>
              ) : (
                <ul className="ws-list">
                  {invoices.map((i) => (
                    <li key={i.id} className="ws-item" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <span className="ws-item-text">
                        <button type="button" className="ws-name-link" onClick={() => openInvoice(i.id)}>
                          {i.number}
                        </button>
                        <span className="ws-item-sub" style={{ display: 'block' }}>
                          {day(i.issueDate)}
                          {i.status === 'ISSUED' ? `, due ${day(i.dueDate)}` : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="ui-num">{inr(i.total)}</span>
                        <InvoiceStatus status={i.status} overdue={i.overdue} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <aside className="ws-side">
            <Panel title="How to pay">
              <p className="ws-card-blurb">
                {unpaid.length
                  ? `${unpaid.length === 1 ? 'One invoice is' : `${unpaid.length} invoices are`} unpaid. Open it to ${payOnline ? 'pay online by card, UPI or netbanking, ' : ''}scan the UPI QR, or pay into CLOR’s bank account.`
                  : payOnline
                    ? 'Each invoice can be paid online by card, UPI or netbanking, or by UPI QR and bank transfer.'
                    : 'Each invoice shows CLOR’s UPI QR and bank account. Nothing is charged to a card.'}
              </p>
              <p className="ws-card-blurb">{payOnline ? 'An online payment is marked paid here at once; a transfer, once the money reaches CLOR.' : 'Once the money reaches CLOR the invoice is marked paid here.'}</p>
            </Panel>
          </aside>
        </div>
        {open ? (
          <WsDrawer
            open
            onClose={() => setOpen(null)}
            widthClass="w-[min(56rem,96vw)]"
            title={open.inv?.number ? `Invoice ${open.inv.number}` : 'Invoice'}
            actions={
              <>
                <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setOpen(null)}>
                  Close
                </button>
                {open.inv ? (
                  <button type="button" className={open.inv.payOnline ? 'ws-btn ws-btn--quiet' : 'ws-btn ws-btn--primary'} onClick={() => paper.current?.firstElementChild && printElement({ element: paper.current.firstElementChild, title: `CLOR invoice ${open.inv.number}` })}>
                    Print or save as PDF
                  </button>
                ) : null}
                {open.inv?.payOnline ? (
                  <button type="button" className="ws-btn ws-btn--primary" disabled={paying} onClick={() => payNow(open.inv)}>
                    {paying ? 'Opening the payment page…' : `Pay ${inr(open.inv.total)} online`}
                  </button>
                ) : null}
              </>
            }
          >
            {open.inv ? (
              <div ref={paper}>
                <InvoiceDocument invoice={open.inv} />
              </div>
            ) : open.error ? <p role="alert">{open.error}</p> : <p className="ws-card-blurb">Opening…</p>}
          </WsDrawer>
        ) : null}
      </div>
    </div>
  );
}
