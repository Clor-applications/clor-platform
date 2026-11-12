import React from 'react';

/**
 * One of CLOR's invoices to a customer, as a document (roadmap item 8): the
 * same page in the operator console (Money, Invoices) and in the customer's
 * Workspace, Billing. Like every printed document in CLOR it is black on
 * white whatever the app's theme, because it is a piece of paper.
 *
 * An unpaid invoice ends with how to pay: a UPI QR that already carries the
 * amount and the invoice number, and CLOR's bank account. Amounts are paise.
 */
export function inr(paise) {
  if (paise == null || Number.isNaN(Number(paise))) return '—';
  const n = Number(paise);
  const abs = Math.abs(n);
  const s = String(Math.floor(abs / 100));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const fraction = abs % 100;
  return `${n < 0 ? '−' : ''}₹${rest ? `${rest},` : ''}${last3}.${String(fraction).padStart(2, '0')}`;
}
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dateText = (iso) => (iso ? day(`${iso}T00:00:00+05:30`) : null);

export const STATUS_WORD = { DRAFT: 'Draft', ISSUED: 'Unpaid', PAID: 'Paid', VOID: 'Cancelled' };
/** The status as a pill: overdue beats unpaid. */
export function InvoiceStatus({ status, overdue }) {
  if (status === 'ISSUED' && overdue) return <span className="ws-pill ws-pill--danger">Overdue</span>;
  const tone = { PAID: 'ws-pill ws-pill--ok', ISSUED: 'ws-pill ws-pill--warn', VOID: 'ws-pill ws-pill--off', DRAFT: 'ws-pill' }[status] || 'ws-pill';
  return <span className={tone}>{STATUS_WORD[status] || status}</span>;
}

const ink = '#111827';
const ink2 = '#4b5563';
const rule = '#e5e7eb';
const paper = { background: '#ffffff', color: ink, border: `1px solid ${rule}`, borderRadius: 12, padding: 'clamp(16px, 4vw, 40px)', fontVariantNumeric: 'tabular-nums' };
const label = { fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', color: ink2, textTransform: 'uppercase', marginBottom: 4 };
const num = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const cell = { padding: '10px 8px', borderBottom: `1px solid ${rule}`, verticalAlign: 'top' };

function Party({ title, p }) {
  if (!p) return null;
  return (
    <div>
      <div style={label}>{title}</div>
      <div style={{ fontWeight: 600 }}>{p.legalName || p.name}</div>
      {p.address ? <div style={{ color: ink2, whiteSpace: 'pre-line' }}>{p.address}</div> : null}
      {p.state ? <div style={{ color: ink2 }}>{p.state}</div> : null}
      {p.gstin ? <div style={{ color: ink2 }}>GSTIN {p.gstin}</div> : null}
      {p.email ? <div style={{ color: ink2 }}>{p.email}</div> : null}
    </div>
  );
}

export function InvoiceDocument({ invoice: inv, from = null }) {
  const tax = inv.tax || {};
  const seller = inv.seller || from || { legalName: 'Clor Applications Private Limited' };
  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const period = inv.periodStart || inv.periodEnd ? [dateText(inv.periodStart), dateText(inv.periodEnd)].filter(Boolean).join(' to ') : null;
  const pay = inv.status === 'PAID' || inv.status === 'VOID' ? null : inv.payTo;
  return (
    <article style={paper} aria-label={inv.number ? `Invoice ${inv.number}` : 'Draft invoice'}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{seller.gstin ? 'Tax invoice' : 'Invoice'}</div>
          <div style={{ color: ink2 }}>{inv.number || 'Draft: the number is given when it is issued'}</div>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 16, rowGap: 2, margin: 0, color: ink2 }}>
          <dt>Date</dt>
          <dd style={{ margin: 0, color: ink, ...num }}>{day(inv.issueDate)}</dd>
          <dt>Due</dt>
          <dd style={{ margin: 0, color: ink, ...num }}>{day(inv.dueDate)}</dd>
          {period ? (
            <>
              <dt>For</dt>
              <dd style={{ margin: 0, color: ink }}>{period}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 24, marginBottom: 24 }}>
        <Party title="From" p={seller} />
        <Party title="Bill to" p={inv.buyer} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: ink2, textAlign: 'left' }}>
              <th style={{ ...cell, fontWeight: 600 }}>Description</th>
              {seller.sac ? <th style={{ ...cell, fontWeight: 600 }}>SAC</th> : null}
              <th style={{ ...cell, ...num, fontWeight: 600 }}>Qty</th>
              <th style={{ ...cell, ...num, fontWeight: 600 }}>Price</th>
              <th style={{ ...cell, ...num, fontWeight: 600 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={cell}>{l.description}</td>
                {seller.sac ? <td style={cell}>{seller.sac}</td> : null}
                <td style={{ ...cell, ...num }}>{l.quantity}</td>
                <td style={{ ...cell, ...num }}>{inr(l.unitAmount)}</td>
                <td style={{ ...cell, ...num }}>{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 0, rowGap: 6, margin: '16px 0 0 auto', maxWidth: 360 }}>
        <dt style={{ color: ink2 }}>Subtotal</dt>
        <dd style={{ margin: 0, ...num }}>{inr(inv.subtotal)}</dd>
        {tax.cgst ? (
          <>
            <dt style={{ color: ink2 }}>CGST {tax.ratePercent / 2}%</dt>
            <dd style={{ margin: 0, ...num }}>{inr(tax.cgst)}</dd>
            <dt style={{ color: ink2 }}>SGST {tax.ratePercent / 2}%</dt>
            <dd style={{ margin: 0, ...num }}>{inr(tax.sgst)}</dd>
          </>
        ) : null}
        {tax.igst ? (
          <>
            <dt style={{ color: ink2 }}>IGST {tax.ratePercent}%</dt>
            <dd style={{ margin: 0, ...num }}>{inr(tax.igst)}</dd>
          </>
        ) : null}
        {tax.charged && !tax.cgst && !tax.igst && tax.amount ? (
          <>
            <dt style={{ color: ink2 }}>GST {tax.ratePercent}%</dt>
            <dd style={{ margin: 0, ...num }}>{inr(tax.amount)}</dd>
          </>
        ) : null}
        <dt style={{ fontWeight: 700, borderTop: `1px solid ${ink}`, paddingTop: 8 }}>Total</dt>
        <dd style={{ margin: 0, fontWeight: 700, borderTop: `1px solid ${ink}`, paddingTop: 8, paddingLeft: 24, ...num }}>{inr(inv.total)}</dd>
      </dl>
      {!tax.charged ? <p style={{ color: ink2, fontSize: 13, marginTop: 8, textAlign: 'right' }}>No GST: CLOR is not yet registered for GST.</p> : null}

      {inv.status === 'PAID' ? (
        <p style={{ marginTop: 24, fontWeight: 600 }}>
          Paid {inr(inv.paidAmount)} on {day(inv.paidAt)}
          {inv.paymentReference ? `, reference ${inv.paymentReference}` : ''}. Thank you.
        </p>
      ) : null}
      {inv.status === 'VOID' ? <p style={{ marginTop: 24, fontWeight: 600 }}>Cancelled on {day(inv.voidedAt)}. Nothing is due on this invoice.</p> : null}

      {pay ? (
        <section aria-label="How to pay" style={{ marginTop: 32, paddingTop: 24, borderTop: `1px solid ${rule}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 24 }}>
          {pay.upiId || pay.qr ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {pay.qr ? <img src={pay.qr} alt={`UPI QR code to pay ${inr(inv.total)} to ${pay.upiId || 'CLOR'}`} width={132} height={132} style={{ border: `1px solid ${rule}`, borderRadius: 8 }} /> : null}
              <div>
                <div style={label}>Pay by UPI</div>
                <div>Scan with any UPI app. The amount{inv.number ? ' and invoice number are' : ' is'} filled in.</div>
                {pay.upiId ? <div style={{ marginTop: 6, fontWeight: 600 }}>{pay.upiId}</div> : null}
                {pay.payeeName ? <div style={{ color: ink2 }}>{pay.payeeName}</div> : null}
              </div>
            </div>
          ) : null}
          {pay.bank?.accountNumber ? (
            <div>
              <div style={label}>Or bank transfer</div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 2, margin: 0 }}>
                <dt style={{ color: ink2 }}>Name</dt>
                <dd style={{ margin: 0 }}>{pay.bank.accountName}</dd>
                <dt style={{ color: ink2 }}>Account</dt>
                <dd style={{ margin: 0, ...num, textAlign: 'left' }}>{pay.bank.accountNumber}</dd>
                <dt style={{ color: ink2 }}>IFSC</dt>
                <dd style={{ margin: 0 }}>{pay.bank.ifsc}</dd>
                {pay.bank.bankName ? (
                  <>
                    <dt style={{ color: ink2 }}>Bank</dt>
                    <dd style={{ margin: 0 }}>{[pay.bank.bankName, pay.bank.branch].filter(Boolean).join(', ')}</dd>
                  </>
                ) : null}
              </dl>
              {inv.number ? <div style={{ marginTop: 6, color: ink2 }}>Put {inv.number} in the transfer’s remarks.</div> : null}
            </div>
          ) : null}
          {pay.instructions ? <p style={{ gridColumn: '1 / -1', color: ink2, margin: 0 }}>{pay.instructions}</p> : null}
        </section>
      ) : null}

      {inv.note ? <p style={{ marginTop: 24, color: ink2, whiteSpace: 'pre-line' }}>{inv.note}</p> : null}
      {seller.footer ? <p style={{ marginTop: 16, color: ink2, fontSize: 13, whiteSpace: 'pre-line' }}>{seller.footer}</p> : null}
    </article>
  );
}
