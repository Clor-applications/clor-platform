import React from 'react';
import { ArrowDownloadRegular } from '@fluentui/react-icons';

import NotConnected from '@ui/components/ui/NotConnected';
import { KpiTile, PageHead } from './wsKit';
import { inr } from './InvoiceDocument';
import { InvoiceDrawer, InvoiceTable, invoiceDay, useInvoices } from './InvoiceDrawer';
import './workspace.css';
import './ws-plan.css';

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

export default function Invoices() {
  const viewer = useInvoices();
  const { invoices, payOnline, openInvoice } = viewer;
  const f = invoices ? invoiceFigures(invoices) : null;
  const fy = fyStart();
  const fyName = `FY ${fy.getFullYear()}–${String(fy.getFullYear() + 1).slice(2)}`;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Plan', 'Invoices']} scope="account"
          title="Invoices"
          description="Tax invoices from Clor Applications Pvt Ltd. Claim the GST on them as input tax credit."
          actions={
            invoices?.length ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openInvoice(invoices[0].id)}>
                <ArrowDownloadRegular aria-hidden="true" /> Latest as PDF
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
          <div className="ws-kpis">
            <KpiTile cat={1} label={`Paid this FY`} value={inr(f.paidThisFy)} note={`${f.paidCount} ${f.paidCount === 1 ? 'invoice' : 'invoices'} · ${fyName}`} />
            <KpiTile
              cat={2}
              label="Next to pay"
              value={f.next ? inr(f.next.total) : inr(0)}
              note={
                f.next
                  ? `${f.next.number} · ${f.next.overdue ? 'overdue since' : 'due'} ${invoiceDay(f.next.dueDate)}${f.unpaidCount > 1 ? ` · ${f.unpaidCount} unpaid, ${inr(f.unpaidTotal)}${f.overdue ? `, ${f.overdue} overdue` : ''}` : ''}`
                  : 'Nothing to pay'
              }
            />
            <KpiTile
              cat={3}
              label="GST input credit"
              value={inr(f.gstThisFy)}
              note={f.gstThisFy ? `On ${f.gstCount} ${f.gstCount === 1 ? 'invoice' : 'invoices'} · ${fyName}` : `No GST charged · ${fyName}`}
            />
          </div>
        ) : null}

        <section className="ws-section" aria-label="Invoices">
          {invoices === null ? (
            <p className="ws-card-blurb">Reading invoices…</p>
          ) : !invoices.length ? (
            <p className="ws-card-blurb">No invoices yet.</p>
          ) : (
            <InvoiceTable invoices={invoices} onOpen={openInvoice} detail />
          )}
        </section>

        <p className="ws-foot-note">
          Open an invoice for its GST breakup (CGST and SGST, or IGST) and place of supply. {payOnline ? 'An unpaid one can be paid online, by UPI QR or by bank transfer.' : 'An unpaid one shows CLOR’s UPI QR and bank account.'}
        </p>

        <InvoiceDrawer viewer={viewer} />
      </div>
    </div>
  );
}
