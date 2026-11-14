import React, { useCallback, useEffect, useRef, useState } from 'react';

import { notify } from '@ui/components/ui/notify';
import { apiFetch } from '@platform/http';
import { printElement } from '@ui/utils/printElement';
import { WsDrawer } from './wsKit';
import { InvoiceDocument, inr } from './InvoiceDocument';

/**
 * CLOR's invoices to this account (roadmap item 8, server: routes/billing.ts),
 * shared by Billing & seats and Invoices: the list, one invoice opened as the
 * document, paying it online on the active gateway's page, and the way back
 * from that page (?paid=<invoice>), where the server is asked whether it was
 * paid before the invoice is shown again.
 */
export function useInvoices() {
  const [invoices, setInvoices] = useState(null);
  const [payOnline, setPayOnline] = useState(false);
  const [open, setOpen] = useState(null);
  const [paying, setPaying] = useState(false);

  const openInvoice = useCallback((id) => {
    setOpen({ loading: true });
    apiFetch(`/billing/invoices/${encodeURIComponent(id)}`)
      .then((inv) => setOpen({ inv }))
      .catch((e) => setOpen({ error: String(e?.message || e) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
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

  return { invoices, payOnline, open, openInvoice, close: () => setOpen(null), payNow, paying };
}

/** One invoice as the document, with Print or save as PDF and, when CLOR takes payments online, Pay. */
export function InvoiceDrawer({ viewer }) {
  const paper = useRef(null);
  const { open, close, payNow, paying } = viewer;
  if (!open) return null;
  return (
    <WsDrawer
      open
      onClose={close}
      widthClass="w-[min(56rem,96vw)]"
      title={open.inv?.number ? `Invoice ${open.inv.number}` : 'Invoice'}
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={close}>
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
  );
}

export const invoiceDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** The status as a pill in the hand-off's words: paid, due on a day, overdue, cancelled. */
export function InvoicePill({ inv }) {
  if (inv.status === 'PAID') return <span className="ws-pill ws-pill--ok">Paid</span>;
  if (inv.status === 'VOID') return <span className="ws-pill ws-pill--neutral">Cancelled</span>;
  if (inv.status === 'ISSUED' && inv.overdue) return <span className="ws-pill ws-pill--danger">Overdue</span>;
  if (inv.status === 'ISSUED') {
    const due = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null;
    return <span className="ws-pill ws-pill--warn">{due ? `Due ${due}` : 'Unpaid'}</span>;
  }
  return <span className="ws-pill ws-pill--neutral">{inv.status}</span>;
}

/** CLOR's invoices as a table: number (opens it), issued, due, total, state and the PDF. */
export function InvoiceTable({ invoices, onOpen, caption = 'Invoices from CLOR' }) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Issued</th>
            <th>Due</th>
            <th className="num">Total</th>
            <th>Status</th>
            <th><span className="sr-only">Document</span></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>
                <button type="button" className="ws-name-link ws-inv-number" onClick={() => onOpen(i.id)}>
                  {i.number}
                </button>
              </td>
              <td>{invoiceDay(i.issueDate)}</td>
              <td>{i.status === 'ISSUED' ? invoiceDay(i.dueDate) : '—'}</td>
              <td className="num ws-inv-total">{inr(i.total)}</td>
              <td><InvoicePill inv={i} /></td>
              <td className="num">
                <button type="button" className="ws-link" aria-label={`${i.number} as PDF`} onClick={() => onOpen(i.id)}>
                  PDF
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
