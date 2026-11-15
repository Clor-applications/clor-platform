import React from 'react';
import { amountInWordsInr, formatMoney, getCurrencyCode, round2 } from '@ui/utils/money';
import { formatDateIn } from '@ui/utils/dates';

const asArray = (value) => Array.isArray(value) ? value : [];
const dateLabel = (value, company) => formatDateIn(value, company) || '—';
const addressText = (value) => typeof value === 'string' ? value : [value?.line1, value?.line2, value?.city, value?.state, value?.pincode].filter(Boolean).join(', ');

/* Filler for the template designer preview only, like its sampleInvoice. */
export const sampleReceipt = {
  number: 'RCP/26-27/000245', date: '2026-10-14', customerName: 'Future Retail Solutions',
  mode: 'Bank Transfer', reference: 'UTR1234567890', accountName: 'HDFC Bank',
  amount: 900000, netCashAmount: 900000, currency: 'INR',
  allocations: [
    { voucherType: 'invoice', documentNumber: 'INV/26-27/00125', invoiceDate: '2026-09-10', amount: 500000 },
    { voucherType: 'invoice', documentNumber: 'INV/26-27/00148', invoiceDate: '2026-09-25', amount: 350000 },
  ],
  advanceAmount: 50000,
};

export default function ReceiptVoucher({ company, receipt, db, template = {}, preview = false }) {
  const options = template.printOptions || {};
  const show = (key) => options[key] !== false;
  const profile = company?.profile?.companySettings || {};
  const companyName = company?.legalName || company?.name || company?.companyName || 'Your Company';
  const companyAddress = addressText(company?.registeredAddress || company?.address) || [profile.regAddress1, profile.regAddress2, profile.regCity, profile.regStateName, profile.regPincode].filter(Boolean).join(', ');
  const companyGstin = company?.gstin || profile.gstin || profile.regGstin || '';
  const companyPan = company?.pan || profile.pan || '';
  const customer = asArray(db?.customers).find((row) => String(row.id) === String(receipt?.customerId || '') && String(row.companyId) === String(company?.id)) || {};
  const customerAddress = addressText(customer.billingAddress || customer.address || customer.registeredAddress);
  const customerGstin = customer.gstin || customer.gstNumber || '';
  const customerPan = customer.pan || '';
  const accountId = String(receipt?.ledgerAccountId || receipt?.cashBankAccountId || '');
  const account = [...asArray(db?.chartOfAccounts), ...asArray(db?.cashBankAccounts)].find((row) => String(row.companyId) === String(company?.id) && (
    String(row.id) === accountId || String(row.serverLedgerAccountId || '') === accountId ||
    (receipt?.cashBankAccountId && String(row.id) === String(receipt.cashBankAccountId))
  )) || {};
  const total = round2(receipt?.netCashAmount ?? receipt?.amount ?? 0);
  const allocations = asArray(receipt?.allocations).map((allocation) => {
    const invoice = asArray(db?.invoices).find((row) => String(row.id) === String(allocation.voucherId || allocation.docId || ''));
    return {
      number: allocation.documentNumber || invoice?.number || allocation.voucherId || allocation.docId || '—',
      date: allocation.invoiceDate || invoice?.date || '',
      amount: round2(allocation.amount),
    };
  });
  const tds = round2(receipt?.tdsAmount || 0);
  const allocatedTotal = round2(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const advance = round2(receipt?.advanceAmount ?? Math.max(0, Number(receipt?.amount || 0) - allocatedTotal));
  const lines = [
    ...allocations.map((allocation, index) => {
      const share = tds && allocatedTotal ? (index === allocations.length - 1 ? round2(tds - allocations.slice(0, -1).reduce((sum, row) => sum + round2(tds * row.amount / allocatedTotal), 0)) : round2(tds * allocation.amount / allocatedTotal)) : 0;
      return { label: 'Invoice Payment', number: allocation.number, date: allocation.date, amount: allocation.amount, tds: share, received: round2(allocation.amount - share) };
    }),
    ...(advance > 0 ? [{ label: 'Advance Received', number: '—', date: '', amount: advance, tds: 0, received: advance }] : []),
  ];
  if (!lines.length) lines.push({ label: 'Receipt on account', number: '—', date: '', amount: round2(receipt?.amount || 0), tds, received: total });
  const logo = company?.logo || company?.logoUrl || '/clor-wordmark-transparent.png';
  const bankNumber = account.accountNumber || account.bankAccountNumber || account.bankDetails?.accountNumber || '';
  const bankIfsc = account.ifsc || account.ifscCode || account.bankDetails?.ifsc || '';
  const tableColumns = [
    { key: 'serialNumber', label: '#', width: '3%' },
    { key: 'particulars', label: 'Particulars', width: '16%' },
    { key: 'invoiceNumber', label: 'Invoice No.', width: '16%' },
    { key: 'invoiceDate', label: 'Invoice Date', width: '14%' },
    { key: 'invoiceAmount', label: `Invoice Amount (${getCurrencyCode(company)})`, width: '17%' },
    { key: 'tdsAmount', label: `TDS (${getCurrencyCode(company)})`, width: '13%' },
    { key: 'receivedAmount', label: `Received Amount (${getCurrencyCode(company)})`, width: '21%' },
  ].filter((column) => show(column.key));
  const columnValue = (key, line, index) => ({
    serialNumber: index + 1,
    particulars: line.label,
    invoiceNumber: line.number,
    invoiceDate: line.date ? dateLabel(line.date, company) : '—',
    invoiceAmount: formatMoney(line.amount, company),
    tdsAmount: formatMoney(line.tds, company),
    receivedAmount: formatMoney(line.received, company),
  })[key];
  const totalValue = (key) => ({
    invoiceAmount: formatMoney(round2(lines.reduce((sum, line) => sum + line.amount, 0)), company),
    tdsAmount: formatMoney(tds, company),
    receivedAmount: formatMoney(total, company),
  })[key];
  const firstAmountColumn = tableColumns.findIndex((column) => ['invoiceAmount', 'tdsAmount', 'receivedAmount'].includes(column.key));

  return <article className={`receipt-voucher receipt-voucher-${template.templateId === 'compact' ? 'compact' : 'modern'}${preview ? ' receipt-voucher-preview' : ''}`} data-accent={template.accentId || 'blue'} aria-label="Receipt voucher">
    <header className="receipt-voucher-header">
      {show('companyLogo') ? <div className="receipt-voucher-logo"><img src={logo} alt="CLOR" /></div> : null}
      <div className="receipt-voucher-company">
        <strong>{companyName}</strong>
        {show('companyAddress') && companyAddress ? <span>{companyAddress}</span> : null}
        {show('companyGstin') && companyGstin ? <span>GSTIN: {companyGstin}</span> : null}
        {show('companyPan') && companyPan ? <span>PAN: {companyPan}</span> : null}
        {show('companyPhone') && (company?.phone || profile.phone) ? <span>{company?.phone || profile.phone}</span> : null}
        {show('companyEmail') && (company?.email || profile.email) ? <span>{company?.email || profile.email}</span> : null}
      </div>
      <div className="receipt-voucher-title"><strong>{template.printTitle || 'RECEIPT'}</strong><div>{show('voucherNumber') ? <span>Receipt No.<b>{receipt?.number || receipt?.receiptNo || receipt?.documentNumber || '—'}</b></span> : null}{show('voucherDate') ? <span>Date<b>{dateLabel(receipt?.date, company)}</b></span> : null}</div></div>
    </header>
    <section className="receipt-voucher-facts">
      <div className="receipt-voucher-from">{show('receivedFrom') ? <small>Received From</small> : null}<strong>{receipt?.customerName || receipt?.partyName || '—'}</strong>{show('customerAddress') && customerAddress ? <span>{customerAddress}</span> : null}{show('customerGstin') && customerGstin ? <span>GSTIN: {customerGstin}</span> : null}{show('customerPan') && customerPan ? <span>PAN: {customerPan}</span> : null}</div>
      <dl>
        {show('receiptDate') ? <div><dt>Receipt Date</dt><dd>{dateLabel(receipt?.date, company)}</dd></div> : null}
        {show('receiptMode') ? <div><dt>Mode of Receipt</dt><dd>{receipt?.mode || '—'}</dd></div> : null}
        {show('referenceNumber') ? <div><dt>Reference No.</dt><dd>{receipt?.reference || '—'}</dd></div> : null}
        {show('referenceDate') ? <div><dt>Reference Date</dt><dd>{dateLabel(receipt?.referenceDate || receipt?.date, company)}</dd></div> : null}
        {show('accountName') ? <div><dt>{String(receipt?.mode || '').toLowerCase().includes('cash') ? 'Cash Account' : 'Bank Account'}</dt><dd>{receipt?.accountName || account.name || '—'}</dd></div> : null}
        {show('currency') ? <div><dt>Currency</dt><dd>{receipt?.currency || 'INR'}</dd></div> : null}
      </dl>
    </section>
    {show('allocationTable') && tableColumns.length ? <table className="receipt-voucher-table"><colgroup>{tableColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup><thead><tr>{tableColumns.map((column) => <th key={column.key} scope="col" data-column={column.key}>{column.label}</th>)}</tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.number}-${index}`}>{tableColumns.map((column) => <td key={column.key} data-column={column.key}>{columnValue(column.key, line, index)}</td>)}</tr>)}</tbody>{show('totalRow') ? <tfoot><tr><th colSpan={firstAmountColumn > 0 ? firstAmountColumn : 1}>Total</th>{tableColumns.slice(firstAmountColumn > 0 ? firstAmountColumn : 1).map((column) => <th key={column.key} data-column={column.key}>{totalValue(column.key) || ''}</th>)}</tr></tfoot> : null}</table> : <div className="receipt-voucher-total"><span>Received Amount</span><strong>{formatMoney(total, company)}</strong></div>}
    {show('amountInWords') ? <div className="receipt-voucher-words"><span>Amount in Words</span><strong>{amountInWordsInr(total, company)}</strong></div> : null}
    <footer className="receipt-voucher-footer">
      {show('bankDetails') ? <div><b>Bank Details</b><strong>{receipt?.accountName || account.name || '—'}</strong>{bankNumber ? <span>A/c No. {bankNumber}</span> : null}{bankIfsc ? <span>IFSC: {bankIfsc}</span> : null}</div> : null}
      {show('notes') ? <div><b>Notes</b><span>{receipt?.notes || template.footerText || 'This is a computer generated receipt.'}</span></div> : null}
      {show('signature') ? <div className="receipt-voucher-signature"><span>For {companyName}</span><b>Authorised Signatory</b></div> : null}
    </footer>
  </article>;
}
