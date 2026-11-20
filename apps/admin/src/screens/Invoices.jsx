import React, { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { emoji } from '@ui/components/ui/emoji';

import NotConnected from '@ui/components/ui/NotConnected';
import { CountLine } from '@ui/components/ui/CountLine';
import { Empty, LoadError, Loading, PageHead } from './wsKit';
import { inr } from './InvoiceDocument';
import { InvoiceDrawer, InvoiceTable, invoiceDay, useInvoices } from './InvoiceDrawer';
import BillingDocs from './BillingDocs';
import './workspace.css';
import './ws-plan.css';

/* The colour icon an empty list shows: the one its menu item wears. */
const EMPTY_ICON = emoji('page-facing-up');

/**
 * Workspace → Plan → Invoices (R&D hand-off WS-10): every tax invoice CLOR
 * has issued to this account (server: routes/billing.ts GET /billing/invoices),
 * the money paid this financial year, and the next one to pay. Each opens as
 * the document — with its GST breakup and place of supply — to print, save as
 * PDF or pay.
 *
 * The list carries each invoice's period, taxable value, GST and total, so the
 * table and the "GST input credit" tile are the server's own figures; the
 * CGST/SGST or IGST split and the place of supply are on the document.
 */

/** 1 April of the Indian financial year that `now` falls in. */
export function fyStart(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 3, 1);
}

/** The Invoices page's figures, from the list alone. */
export function invoiceFigures(invoices, now = new Date()) {
  const from = fyStart(now);
  const paid = invoices.filter((i) => i.status === 'PAID' && new Date(i.paidAt || i.issueDate) >= from);
  const unpaid = invoices.filter((i) => i.status === 'ISSUED');
  /* GST charged on this year's invoices (not cancelled ones): what the account may claim as input credit. */
  const thisFy = invoices.filter((i) => (i.status === 'PAID' || i.status === 'ISSUED') && new Date(i.issueDate || i.createdAt) >= from);
  const next = [...unpaid].sort((a, b) => new Date(a.dueDate || a.issueDate) - new Date(b.dueDate || b.issueDate))[0] || null;
  return {
    paidThisFy: paid.reduce((n, i) => n + Number(i.total || 0), 0),
    paidCount: paid.length,
    next,
    unpaidTotal: unpaid.reduce((n, i) => n + Number(i.total || 0), 0),
    unpaidCount: unpaid.length,
    overdue: unpaid.filter((i) => i.overdue).length,
    gstThisFy: thisFy.reduce((n, i) => n + Number(i.taxTotal || 0), 0),
    gstCount: thisFy.filter((i) => Number(i.taxTotal || 0) > 0).length,
  };
}

export default function Invoices({ params }) {
  const viewer = useInvoices();
  const { invoices, failed, reload, payOnline, openInvoice } = viewer;
  /* From the search bar: an invoice found by its number opens here, once the list is in. */
  const wanted = typeof params?.invoice === 'string' ? params.invoice : '';
  const opened = useRef('');
  useEffect(() => {
    if (!wanted || opened.current === wanted || !invoices?.some((i) => i.id === wanted)) return;
    opened.current = wanted;
    openInvoice(wanted);
  }, [wanted, invoices, openInvoice]);
  const f = invoices ? invoiceFigures(invoices) : null;
  const fy = fyStart();
  const fyName = `FY ${fy.getFullYear()}–${String(fy.getFullYear() + 1).slice(2)}`;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Invoices']} scope="account"
          title="Invoices"
          description="Tax invoices from CLOR Applications Private Limited. Claim the GST on them as input tax credit."
          actions={
            invoices?.length ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openInvoice(invoices[0].id)}>
                <Download size={16} aria-hidden="true" /> Latest as PDF
              </button>
            ) : null
          }
        />

        {invoices !== null && !payOnline ? (
          <NotConnected what="card payment">
            Pay each invoice by UPI or bank transfer, as it shows.
          </NotConnected>
        ) : null}

        {f ? (
          <CountLine label="Invoice figures" items={[
            { key: 'due', label: f.next ? `${f.overdue ? 'to pay, overdue since' : 'to pay, next due'} ${invoiceDay(f.next.dueDate)}` : 'to pay', value: f.unpaidTotal ? inr(f.unpaidTotal) : null, tone: f.overdue ? 'neg' : undefined },
            { key: 'paid', label: `paid in ${fyName}`, value: f.paidThisFy ? inr(f.paidThisFy) : null },
            { key: 'gst', label: `GST you can claim as input credit, ${fyName}`, value: f.gstThisFy ? inr(f.gstThisFy) : null },
          ]} />
        ) : null}

        <section className="ws-section" aria-label="Invoices">
          {failed ? (
            <LoadError onRetry={reload}>Invoices could not be loaded. Try again in a minute.</LoadError>
          ) : invoices === null ? (
            <Loading shape="rows" label="Loading invoices…" />
          ) : !invoices.length ? (
            <Empty icon={EMPTY_ICON} compact>No invoices yet. CLOR’s tax invoices for your plan will appear here.</Empty>
          ) : (
            <InvoiceTable invoices={invoices} onOpen={openInvoice} detail />
          )}
        </section>

        <BillingDocs />

        <p className="ws-foot-note">
          Open an invoice for its GST breakup (CGST and SGST, or IGST) and place of supply. {payOnline ? 'An unpaid one can be paid online, by UPI QR or by bank transfer.' : 'An unpaid one shows CLOR’s UPI QR and bank account.'}
        </p>

        <InvoiceDrawer viewer={viewer} />
      </div>
    </div>
  );
}
