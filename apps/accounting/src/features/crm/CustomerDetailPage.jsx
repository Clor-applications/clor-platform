import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarDays, CreditCard,
  FileText, MapPin, MoreVertical, Pencil, Printer, Search, UserRound, Wallet,
} from 'lucide-react';

import { formatMoney } from '@ui/utils/money';
import { getCustomerDisplayName, partyEmail, partyMobile } from '@ui/utils/contacts';
import { DocDate, MoneyValue } from '@ui/components/docs';
import { EmptyState } from '@ui/components/ui/Primitives';
import { FormRow } from '../../components/pickers/customerFormParts';
import { isValidCustomerCode, nextCustomerCode } from '@ui/utils/masterCodes';
import { formatDateIn, localDateIso } from '@ui/utils/dates';
import Modal from '@ui/components/ui/Modal';
import { ExportButton } from '@ui/components/list/ListPageParts';
import InvoicePreview from '../sales/InvoicePreview';
import BillPreview from '../purchase/BillPreview';

const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value) => String(value ?? '').trim();

const addressOf = (customer, kind) => {
  const nested = customer?.[`${kind}Address`];
  if (nested && (typeof nested === 'string' || Object.values(nested).some((value) => text(value)))) return nested;
  const fromList = (Array.isArray(customer?.addresses) ? customer.addresses : [])
    .find((address) => String(address?.key || address?.label || '').toUpperCase() === kind.toUpperCase());
  if (fromList) return fromList;
  const prefix = kind.toLowerCase();
  return {
    line1: customer?.[`${prefix}Line1`], line2: customer?.[`${prefix}Line2`],
    city: customer?.[`${prefix}City`], district: customer?.[`${prefix}District`],
    state: customer?.[`${prefix}State`], pincode: customer?.[`${prefix}Pincode`],
    country: customer?.[`${prefix}Country`],
  };
};

// The customer master owns this value. Never invent a display code from the
// local id: that can disagree with the six-digit code allotted by the form.
const savedCustomerCode = (customer) => text(customer?.code || customer?.customerCode);

const monthKey = (value) => String(value || '').slice(0, 7);
const deltaPercent = (current, previous) => previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const printAccountingEntry = ({ voucher, lines, company }) => {
  const popup = window.open('', '_blank', 'width=1100,height=760');
  if (!popup) return;
  popup.opener = null;
  const debit = lines.reduce((sum, line) => sum + num(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + num(line.credit), 0);
  const rows = lines.map((line, index) => `<tr><td>${index === 0 ? escapeHtml(voucher.date || '—') : ''}</td><td>${index === 0 ? escapeHtml(voucher.number || '—') : ''}</td><td>${escapeHtml(line.account)}</td><td class="amount">${line.debit ? escapeHtml(formatMoney(line.debit, company)) : '—'}</td><td class="amount">${line.credit ? escapeHtml(formatMoney(line.credit, company)) : '—'}</td></tr>`).join('');
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(voucher.number || 'Accounting entry')}</title><style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:32px}h1{font-size:20px;margin:0 0 6px}.meta{color:#64748b;font-size:13px;margin-bottom:22px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px 12px;border:1px solid #e2e8f0;text-align:left}th{background:#f8fafc}.amount{text-align:right}tfoot{font-weight:700}.narration{margin-top:18px;padding:14px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px}@media print{body{margin:16mm}}</style></head><body><h1>${escapeHtml(voucher.type)} · ${escapeHtml(voucher.number || 'Voucher')}</h1><div class="meta">Date: ${escapeHtml(voucher.date || '—')} &nbsp; | &nbsp; Reference: ${escapeHtml(voucher.reference || '—')}</div><table><thead><tr><th>Date</th><th>Voucher No.</th><th>Ledger Name</th><th class="amount">Debit</th><th class="amount">Credit</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3" class="amount">Total</td><td class="amount">${escapeHtml(formatMoney(debit, company))}</td><td class="amount">${escapeHtml(formatMoney(credit, company))}</td></tr></tfoot></table><div class="narration"><strong>Narration</strong><br>${escapeHtml(voucher.raw?.narration || voucher.raw?.notes || voucher.reference || voucher.type)}</div><script>window.onload=()=>{window.print();window.close()}</script></body></html>`);
  popup.document.close();
};

const printVoucherPreview = (number) => {
  const previousTitle = document.title;
  if (number) document.title = number;
  document.body.classList.add('print-mode');
  const cleanup = () => {
    document.body.classList.remove('print-mode');
    document.title = previousTitle;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1200);
};

function Trend({ value, label = 'vs last month' }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${positive ? 'ui-pos' : 'ui-neg'}`}><Icon size={13} />{Math.abs(value).toFixed(1)}% <span className="font-normal ui-subtle">{label}</span></span>;
}

function SummaryMetric({ label, value, hint, trend, icon: Icon, tone }) {
  return (
    <div className="relative overflow-hidden rounded-xl border p-3.5 ui-border-c ui-surface-raised">
      <div className={`absolute inset-x-0 top-0 h-1 ${tone}`} />
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs font-medium ui-subtle">{label}</div><div className="mt-1.5 text-xl font-medium tracking-tight">{value}</div></div>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgb(var(--surface-2))]"><Icon size={16} /></span>
      </div>
      <div className="mt-1.5 min-h-5">{trend == null ? <span className="text-xs ui-subtle">{hint}</span> : <Trend value={trend} />}</div>
      {trend == null ? null : <div className="mt-1 text-xs ui-subtle">{hint}</div>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2 px-2 py-1 text-sm">
      <dt className="ui-muted">{label} :</dt>
      <dd className="truncate font-medium" title={value || '—'}>{value || '—'}</dd>
    </div>
  );
}

function HeaderFact({ label, value }) {
  return <div className="rounded-lg bg-[rgb(var(--surface-2))] px-3 py-2"><div className="text-xs ui-subtle">{label}</div><div className="mt-1 text-sm font-medium">{value || '—'}</div></div>;
}

function DisplayField({ label, value, wide = false }) {
  return (
    <FormRow label={label} className={`customer-detail-form-row ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="ui-input flex min-h-9 w-full cursor-default items-center whitespace-normal py-1.5" role="textbox" aria-readonly="true">{value || '—'}</div>
    </FormRow>
  );
}

function ReadOnlyField({ label, value, mono = false, money = false }) {
  return (
    <div className="min-w-0">
      <label className="ui-label">{label}</label>
      <div className={`ui-input flex min-h-10 w-full cursor-default items-center whitespace-normal py-2 ${mono ? 'ui-mono' : ''} ${money ? 'ui-money ps-7' : ''}`} role="textbox" aria-readonly="true">{value || '—'}</div>
    </div>
  );
}

function AddressCardView({ address, title, subtitle, tone = 'muted', badge = null }) {
  const row = address && typeof address === 'object' ? address : {};
  const toneStyle = tone === 'brand'
    ? { backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand))' }
    : tone === 'blue'
      ? { backgroundColor: 'rgb(var(--ov-blue-soft))', color: 'rgb(var(--ov-blue))' }
      : { backgroundColor: 'rgb(var(--surface-sunken))', color: 'rgb(var(--info))' };
  return (
    <div className="ui-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={toneStyle}><MapPin size={18} /></span>
          <div className="min-w-0"><h5 className="text-sm font-semibold">{title}</h5><p className="ui-caption mt-0.5">{subtitle}</p></div>
        </div>
        {badge}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><ReadOnlyField label="Address Line 1" value={row.line1} /><ReadOnlyField label="Address Line 2" value={row.line2} /></div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><ReadOnlyField label="Country" value={row.country || 'India'} /><ReadOnlyField label="State" value={row.state} /><ReadOnlyField label="City" value={row.city} /><ReadOnlyField label="Pincode" value={row.pincode || row.pin || row.zip} mono /></div>
    </div>
  );
}

const entryLinesFor = (row, db, customerName, customerCodeValue = '') => {
  const journals = Array.isArray(db?.journalEntries) ? db.journalEntries : [];
  const journal = journals.find((entry) => (
    (String(entry?.sourceId ?? '') === String(row?.raw?.id ?? '') && String(entry?.sourceType || '').toLowerCase().includes(String(row?.type || '').toLowerCase().split(' ')[0]))
    || String(entry?.number || entry?.voucherNo || '') === String(row?.number || '')
  ));
  const accounts = Array.isArray(db?.chartOfAccounts) ? db.chartOfAccounts : [];
  if (journal?.lines?.length) {
    return journal.lines.map((line) => ({
      account: line.accountName || accounts.find((account) => String(account.id) === String(line.accountId))?.name || line.accountId || 'Ledger',
      debit: num(line.debit), credit: num(line.credit),
    }));
  }
  const raw = row?.raw || {};
  const items = Array.isArray(raw.items) ? raw.items : [];
  const code = customerCodeValue || raw.customerCode || '';
  const partyLedger = `${customerName}${code ? ` (${code})` : ''}`;
  const lines = [];
  const add = (account, debit = 0, credit = 0) => {
    if (Math.abs(num(debit)) > 0.0001 || Math.abs(num(credit)) > 0.0001) lines.push({ account, debit: num(debit), credit: num(credit) });
  };
  const accountName = (id, fallback) => accounts.find((account) => String(account.id) === String(id || ''))?.name || fallback;

  if (row?.type === 'Bill') {
    add('Purchase Account', num(raw.subtotal || row.taxable), 0);
    add('Input CGST', num(raw.cgstTotal), 0);
    add('Input SGST', num(raw.sgstTotal), 0);
    add('Input IGST', num(raw.igstTotal), 0);
    add(partyLedger, 0, num(raw.total || row.credit));
  } else if (row?.type === 'Payment') {
    add(partyLedger, num(raw.amount || raw.total || row.debit), 0);
    add(accountName(raw.ledgerAccountId || raw.cashBankAccountId, raw.mode || 'Bank / Cash'), 0, num(raw.amount || raw.total || row.debit));
  } else if (row?.type === 'Vendor Debit Note') {
    add(partyLedger, num(raw.total || raw.amount || row.debit), 0);
    add('Purchase Return Account', 0, num(raw.subtotal || row.taxable || raw.total || raw.amount));
    add('Input CGST reversal', 0, num(raw.cgstTotal));
    add('Input SGST reversal', 0, num(raw.sgstTotal));
    add('Input IGST reversal', 0, num(raw.igstTotal));
  } else if (row?.type === 'Sales') {
    add(partyLedger, num(raw.total || row.debit), 0);
    const taxableSales = items.length
      ? items.reduce((sum, item) => sum + num(item.taxableAmount ?? item.taxable ?? item.amount ?? item.subtotal), 0)
      : num(raw.subtotal || row.taxable);
    add('Sales Account', 0, taxableSales);
    add('Output CGST', 0, num(raw.cgstTotal));
    add('Output SGST', 0, num(raw.sgstTotal));
    add('Output IGST', 0, num(raw.igstTotal));
    add('Output Cess', 0, num(raw.cessTotal));
    add('Other charges', 0, num(raw.otherChargesTotal ?? raw.otherCharges));
  } else if (row?.type === 'Receipt') {
    const bankId = raw.ledgerAccountId || raw.cashBankAccountId;
    add(accountName(bankId, raw.mode || 'Bank / Cash'), num(raw.netCashAmount ?? raw.amount), 0);
    add(accountName(raw.tdsLedgerId, 'TDS Receivable'), num(raw.tdsAmount), 0);
    add('Bank charges', num(raw.bankCharges), 0);
    add('Other charges', num(raw.otherCharges), 0);
    add(partyLedger, 0, num(raw.amount || row.credit));
  } else if (row?.type === 'CN' || row?.type === 'Sales Return') {
    add('Sales Return / Credit Note', num(raw.subtotal || row.taxable), 0);
    add('Output CGST reversal', num(raw.cgstTotal), 0);
    add('Output SGST reversal', num(raw.sgstTotal), 0);
    add('Output IGST reversal', num(raw.igstTotal), 0);
    add(partyLedger, 0, num(raw.total || raw.amount || row.credit));
  } else if (row?.type === 'Debit Note') {
    add(partyLedger, num(raw.total || raw.amount || row.debit), 0);
    add('Debit note adjustment', 0, num(raw.subtotal || row.taxable || raw.total || raw.amount));
    add('Output CGST', 0, num(raw.cgstTotal));
    add('Output SGST', 0, num(raw.sgstTotal));
    add('Output IGST', 0, num(raw.igstTotal));
  } else if (row?.type === 'Opening Balance') {
    if (row.debit) { add(partyLedger, row.debit, 0); add('Opening Balance Equity', 0, row.debit); }
    if (row.credit) { add('Opening Balance Equity', row.credit, 0); add(partyLedger, 0, row.credit); }
  }

  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  const difference = Math.round((debit - credit) * 100) / 100;
  if (difference > 0.0001) add('Round off / adjustment', 0, difference);
  if (difference < -0.0001) add('Round off / adjustment', Math.abs(difference), 0);
  return lines;
};

function DisplayChoices({ label, value, options }) {
  return (
    <FormRow label={label} className="customer-detail-form-row">
      <div className="flex min-h-9 items-center gap-5">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-2 text-sm">
            <input type="radio" className="ui-radio" checked={value === option.value} readOnly tabIndex={-1} />
            {option.label}
          </label>
        ))}
      </div>
    </FormRow>
  );
}

export default function CustomerDetailPage({ db, currentCompany, customer, onBack, onEdit, onEditTransaction, onDeleteTransaction, partyKind = 'customer' }) {
  const isVendor = partyKind === 'vendor';
  const [tab, setTab] = useState('Details');
  const [detailsTab, setDetailsTab] = useState('Address');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customPeriodOpen, setCustomPeriodOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState('');
  const [voucherPopup, setVoucherPopup] = useState(null);
  const [entryPopup, setEntryPopup] = useState(null);
  const name = getCustomerDisplayName(customer) || 'Customer';
  const customerId = String(customer?.id ?? '');
  const storedCode = savedCustomerCode(customer);
  const displayCustomerCode = isVendor
    ? text(customer?.code || customer?.vendorCode)
    : isValidCustomerCode(storedCode)
      ? storedCode
      : nextCustomerCode((db?.customers || []).filter((row) => String(row.id) !== customerId));

  const invoices = useMemo(() => (isVendor ? db?.bills || [] : db?.invoices || []).filter((row) =>
    row.companyId === currentCompany?.id && String(isVendor ? row.vendorId : row.customerId) === customerId
  ), [db?.bills, db?.invoices, currentCompany?.id, customerId, isVendor]);
  const receipts = useMemo(() => (db?.payments || []).filter((row) =>
    row.companyId === currentCompany?.id && String(isVendor ? row.vendorId : row.customerId) === customerId &&
    (isVendor || ['receipt', 'receipts'].includes(String(row.type || row.voucherType || 'receipt').toLowerCase()))
  ), [db?.payments, currentCompany?.id, customerId, isVendor]);
  const creditNotes = useMemo(() => (isVendor ? db?.debitNotes || [] : db?.creditNotes || []).filter((row) =>
    row.companyId === currentCompany?.id && String(isVendor ? row.vendorId : row.customerId) === customerId
  ), [db?.creditNotes, db?.debitNotes, currentCompany?.id, customerId, isVendor]);
  const debitNotes = useMemo(() => (db?.debitNotes || []).filter((row) =>
    row.companyId === currentCompany?.id && String(row.customerId) === customerId
  ), [db?.debitNotes, currentCompany?.id, customerId]);
  const salesReturns = useMemo(() => (db?.salesReturns || []).filter((row) =>
    row.companyId === currentCompany?.id && String(row.customerId) === customerId
  ), [db?.salesReturns, currentCompany?.id, customerId]);

  const transactions = useMemo(() => {
    const invoiceRows = invoices.map((row) => ({
      id: `invoice-${row.id}`, date: row.date, type: isVendor ? 'Bill' : 'Sales', number: row.number,
      reference: row.reference || row.poNumber || '—', taxable: num(row.subtotal || row.taxableAmount), tax: num(row.gstTotal || row.taxAmount || row.tax), debit: isVendor ? 0 : num(row.total), credit: isVendor ? num(row.total) : 0,
      status: row.status || (num(row.paidAmount) >= num(row.total) ? 'Paid' : 'Unpaid'), raw: row,
    }));
    const receiptRows = receipts.map((row) => ({
      id: `receipt-${row.id}`, date: row.date, type: isVendor ? 'Payment' : 'Receipt', number: row.number,
      reference: row.reference || row.referenceNo || row.utr || '—', debit: isVendor ? num(row.amount || row.total) : 0,
      taxable: 0, tax: num(row.tdsAmount), credit: isVendor ? 0 : num(row.amount || row.total), status: row.status || 'Cleared', raw: row,
    }));
    const creditRows = creditNotes.map((row) => ({
      id: `credit-${row.id}`, date: row.date, type: isVendor ? 'Vendor Debit Note' : 'CN', number: row.number,
      reference: row.reference || row.originalInvoiceNumber || 'Return', taxable: num(row.subtotal || row.taxableAmount), tax: num(row.gstTotal || row.taxAmount || row.tax), debit: 0, credit: num(row.total || row.amount),
      status: row.status || 'Adjusted', raw: row, ...(isVendor ? { debit: num(row.total || row.amount), credit: 0 } : {}),
    }));
    const debitRows = debitNotes.map((row) => ({
      id: `debit-${row.id}`, date: row.date, type: 'Debit Note', number: row.number,
      reference: row.reference || 'Adjustment', taxable: num(row.subtotal || row.taxableAmount), tax: num(row.gstTotal || row.taxAmount || row.tax),
      debit: num(row.total || row.amount), credit: 0, status: row.status || 'Posted', raw: row,
    }));
    const returnRows = salesReturns.map((row) => ({
      id: `return-${row.id}`, date: row.date, type: 'Sales Return', number: row.number,
      reference: row.reference || row.originalInvoiceNumber || 'Return', taxable: num(row.subtotal || row.taxableAmount), tax: num(row.gstTotal || row.taxAmount || row.tax),
      debit: 0, credit: num(row.total || row.amount), status: row.status || 'Posted', raw: row,
    }));
    const openingRows = num(customer?.openingBalance) ? [{
      id: 'opening-balance', date: customer?.createdAt, type: 'Opening Balance', number: 'OPENING', reference: `${isVendor ? 'Vendor' : 'Customer'} master`, taxable: 0, tax: 0,
      debit: String(customer?.openingBalanceType || (isVendor ? 'CR' : 'DR')).toUpperCase() === 'CR' ? 0 : num(customer.openingBalance),
      credit: String(customer?.openingBalanceType || (isVendor ? 'CR' : 'DR')).toUpperCase() === 'CR' ? num(customer.openingBalance) : 0,
      status: 'Posted', raw: customer,
    }] : [];
    const sorted = [...openingRows, ...invoiceRows, ...receiptRows, ...creditRows, ...debitRows, ...returnRows]
      .sort((a, b) => {
        if (a.type === 'Opening Balance') return -1;
        if (b.type === 'Opening Balance') return 1;
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
    return sorted.reduce(
      (result, row) => {
        const balance = result.balance + row.debit - row.credit;
        return { balance, rows: [...result.rows, { ...row, balance }] };
      },
      { balance: 0, rows: [] }
    ).rows;
  }, [invoices, receipts, creditNotes, debitNotes, salesReturns, customer, isVendor]);

  useEffect(() => {
    if (!rowMenu) return undefined;
    const close = () => setRowMenu('');
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenu]);

  const totalSales = invoices.filter((r) => !['draft', 'cancelled'].includes(String(r.status || '').toLowerCase()))
    .reduce((sum, row) => sum + num(row.total), 0);
  const totalReceipts = receipts.reduce((sum, row) => sum + num(row.amount || row.total), 0);
  const totalCreditNotes = creditNotes.reduce((sum, row) => sum + num(row.total || row.amount), 0);
  const outstanding = Math.max(0, invoices.reduce((sum, row) => sum + Math.max(0, num(row.total) - num(row.paidAmount)), 0));
  const openInvoices = invoices.filter((row) => num(row.total) - num(row.paidAmount) > 0.0001);
  const settledInvoices = invoices.filter((row) => num(row.total) > 0 && num(row.paidAmount) >= num(row.total));
  const averagePaymentDays = settledInvoices.length
    ? Math.round(settledInvoices.reduce((sum, row) => {
        const issued = new Date(`${row.date || ''}T00:00:00`).getTime();
        const paid = new Date(`${row.paidDate || row.paymentDate || row.updatedAt || row.dueDate || row.date || ''}T00:00:00`).getTime();
        return sum + (Number.isFinite(issued) && Number.isFinite(paid) ? Math.max(0, (paid - issued) / 86_400_000) : 0);
      }, 0) / settledInvoices.length)
    : 0;
  const returnPercent = totalSales > 0 ? (totalCreditNotes / totalSales) * 100 : 0;
  const outstandingPercent = totalSales > 0 ? (outstanding / totalSales) * 100 : 0;
  const monthlyActivity = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-IN', { month: 'short' }),
        sales: 0,
        receipts: 0,
      };
    });
    const byMonth = new Map(months.map((month) => [month.key, month]));
    invoices.forEach((row) => { const month = byMonth.get(monthKey(row.date)); if (month) month.sales += num(row.total); });
    receipts.forEach((row) => { const month = byMonth.get(monthKey(row.date)); if (month) month.receipts += num(row.amount || row.total); });
    return months;
  }, [invoices, receipts]);
  const currentMonth = monthlyActivity.at(-1) || { sales: 0, receipts: 0 };
  const previousMonth = monthlyActivity.at(-2) || { sales: 0, receipts: 0 };
  const salesMom = deltaPercent(currentMonth.sales, previousMonth.sales);
  const receiptsMom = deltaPercent(currentMonth.receipts, previousMonth.receipts);
  const chartMax = Math.max(1, ...monthlyActivity.flatMap((month) => [month.sales, month.receipts]));
  const collectionRate = totalSales > 0 ? Math.min(100, (totalReceipts / totalSales) * 100) : 0;
  const periodStart = useMemo(() => {
    if (!periodFilter || periodFilter === 'custom') return '';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (periodFilter === 'month') return `${year}-${String(month + 1).padStart(2, '0')}-01`;
    if (periodFilter === 'quarter') return `${year}-${String(Math.floor(month / 3) * 3 + 1).padStart(2, '0')}-01`;
    return `${year}-01-01`;
  }, [periodFilter]);
  const filtered = transactions.filter((row) => {
    const matchesSearch = `${row.type} ${row.number} ${row.reference} ${row.status}`.toLowerCase().includes(query.toLowerCase());
    const matchesType = !typeFilter || row.type === typeFilter;
    const rowDate = String(row.date || '');
    const isOpening = row.type === 'Opening Balance';
    const matchesPreset = isOpening || !periodStart || rowDate >= periodStart;
    const matchesFrom = isOpening || periodFilter !== 'custom' || !customFrom || rowDate >= customFrom;
    const matchesTo = isOpening || periodFilter !== 'custom' || !customTo || rowDate <= customTo;
    return matchesSearch && matchesType && matchesPreset && matchesFrom && matchesTo;
  });
  const displayed = filtered;
  const datedStatementRows = displayed.filter((row) => row.type !== 'Opening Balance' && row.date);
  const statementPeriodFrom = periodFilter === 'custom'
    ? customFrom
    : periodStart || datedStatementRows[0]?.date || '';
  const statementPeriodTo = periodFilter === 'custom'
    ? customTo
    : (periodStart ? localDateIso() : datedStatementRows.at(-1)?.date || '');
  const statementClosingBalance = displayed.at(-1)?.balance ?? 0;
  const companySettings = currentCompany?.profile?.companySettings || {};
  const companyAddressValue = currentCompany?.registeredAddress || currentCompany?.address || '';
  const companyAddressParts = typeof companyAddressValue === 'string'
    ? [companyAddressValue]
    : [companyAddressValue?.line1, companyAddressValue?.line2, companyAddressValue?.city, companyAddressValue?.state, companyAddressValue?.pincode, companyAddressValue?.country];
  const companyAddress = [
    ...companyAddressParts,
    companySettings.regAddress1, companySettings.regAddress2,
    currentCompany?.city || companySettings.regCity,
    currentCompany?.state || companySettings.regStateName,
    currentCompany?.pincode || companySettings.regPincode,
    currentCompany?.country || companySettings.regCountry,
  ].map(text).filter((part, index, parts) => part && parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index).join(', ');
  const statementMetaLines = [
    currentCompany?.legalName || companySettings.legalName || currentCompany?.name || 'Company',
    companyAddress,
    currentCompany?.gstin ? `GSTIN: ${currentCompany.gstin}` : '',
    `Ledger Statement of ${name}${displayCustomerCode ? ` (${displayCustomerCode})` : ''}`,
    `Period: ${statementPeriodFrom ? formatDateIn(statementPeriodFrom) : 'Beginning'} to ${statementPeriodTo ? formatDateIn(statementPeriodTo) : 'Today'}`,
  ].filter(Boolean);
  const statementExportRows = displayed.flatMap((row) => {
    const lines = entryLinesFor(row, db, name, displayCustomerCode);
    return lines.map((line) => ({
      date: row.date || '',
      type: row.type,
      voucher: row.number || '',
      reference: row.reference || '',
      ledger: line.account,
      debit: line.debit || '',
      credit: line.credit || '',
      balance: row.balance,
    }));
  });

  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const billingSource = addressOf(customer, 'billing');
  const shippingSource = addressOf(customer, 'shipping');
  const addressSource = billingSource || customer?.address;
  const addressParts = typeof addressSource === 'string' ? addressSource.split(',').map(text).filter(Boolean) : [];
  const city = text(customer?.city || (typeof addressSource === 'object' && addressSource?.city) || addressParts.at(-3));
  const state = text(customer?.state || (typeof addressSource === 'object' && addressSource?.state) || addressParts.at(-2));
  const cityState = [city, state].filter(Boolean).join(', ');
  const phone = partyMobile(customer);
  const email = partyEmail(customer);
  const contacts = Array.isArray(customer?.contacts) ? customer.contacts : [];
  const displayedContacts = contacts.length ? contacts : [{ name: customer?.contactPerson || '', position: '', email, mobile: phone, isPrimary: true }];
  const extraAddresses = (Array.isArray(customer?.shipToAddresses) ? customer.shipToAddresses : (Array.isArray(customer?.addresses) ? customer.addresses : []))
    .filter((address) => !['BILLING', 'SHIPPING'].includes(String(address?.key || '').toUpperCase()));
  const priceListName = (db?.priceLists || []).find((item) => String(item.id) === String(customer?.priceListId || ''))?.name || customer?.priceListName || '';
  const tdsLedgerName = (db?.chartOfAccounts || []).find((item) => String(item.id) === String(customer?.tdsLedgerId || ''))?.name || '';
  const groupName = customer?.groupName || customer?.partyGroup || (db?.accountGroups || []).find((item) => String(item.id) === String(customer?.groupId || ''))?.name || '';
  const tabs = ['Details', 'Summary', 'Statement'];
  const entryPopupLines = entryPopup ? entryLinesFor(entryPopup, db, name, displayCustomerCode) : [];

  return (
    <div className="space-y-2.5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 ui-subtle hover:text-[rgb(var(--fg))]">
          <ArrowLeft size={15} aria-hidden="true" /> {isVendor ? 'Vendors' : 'Customers'}
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEdit} className="ui-btn ui-btn-secondary"><Pencil size={15} /> Edit</button>
          <button type="button" className="ui-btn ui-btn-secondary px-2.5" aria-label={`More ${isVendor ? 'vendor' : 'customer'} actions`}><MoreVertical size={16} /></button>
        </div>
      </div>

      <section className="ui-card overflow-hidden">
        <div className="grid items-stretch gap-2 p-2 lg:grid-cols-[minmax(20rem,1.15fr)_minmax(14rem,.85fr)_minmax(14rem,.85fr)]">
          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-[rgb(var(--surface-sunken))] p-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[rgb(var(--fg))] text-sm font-medium text-[rgb(var(--surface))] shadow-sm">{initials || 'CU'}</div>
            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{name}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${customer?.isActive === false ? 'ui-pill ui-pill-neutral' : 'ui-pill ui-pill-pos'}`}>{customer?.isActive === false ? 'Inactive' : 'Active'}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm ui-subtle">
              <span>{displayCustomerCode || '—'}</span><span>{groupName || customer?.customerType || (isVendor ? 'Regular Vendor' : 'Regular Customer')}</span>
            </div>
            <div className="mt-1 text-sm ui-subtle">
              {cityState ? <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{cityState}</span> : null}
            </div>
            <div className="mt-1 text-xs ui-subtle">GSTIN: <span className="font-medium text-[rgb(var(--fg))]">{customer?.gstin || '—'}</span></div>
          </div>
          </div>
          <div className="rounded-xl border p-2 ui-border-c">
            <div className="flex items-center gap-2 px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide ui-subtle"><UserRound size={14} /> Contact</div>
            <dl>
              <InfoRow label="Contact" value={customer?.contactPerson} />
              <InfoRow label="Phone" value={phone} />
              <InfoRow label="Email" value={email} />
            </dl>
          </div>
          <div className="rounded-xl border p-2 ui-border-c">
            <div className="flex items-center gap-2 px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide ui-subtle"><CreditCard size={14} /> Account</div>
            <dl>
              <InfoRow label="Group" value={groupName} />
              <InfoRow label="Terms" value={customer?.paymentTermName || `${num(customer?.paymentTermDays ?? customer?.creditDays)} Days`} />
              <InfoRow label="Credit limit" value={formatMoney(num(customer?.creditLimit), currentCompany)} />
            </dl>
          </div>
        </div>
      </section>

      <section className="ui-card min-w-0 overflow-hidden">
          <div className="ui-tabs px-3" role="tablist" aria-label={`${isVendor ? 'Vendor' : 'Customer'} information`}>
            {tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`ui-tab ${tab === item ? 'is-active' : ''}`}>{item}</button>)}
          </div>

          {tab === 'Details' ? (
            <div className="space-y-3 bg-[rgb(var(--surface-2))] p-3">
              <section className="ui-card p-4">
                <div className="mb-3">
                  <h2 className="ui-t-sec">Basic Details</h2>
                  <p className="ui-caption mt-1">Primary information recorded for this {isVendor ? 'vendor' : 'customer'}.</p>
                </div>
                <FormRow label={`${isVendor ? 'Vendor' : 'Customer'} Status`} className="customer-detail-form-row"><div className="ui-input flex min-h-9 w-full cursor-default items-center py-1.5" role="textbox" aria-readonly="true">{customer?.isActive === false ? 'Inactive' : 'Active'}</div></FormRow>
                <dl className="mt-2.5 grid gap-x-6 gap-y-2 lg:grid-cols-2">
                  <DisplayChoices label="GST Registration Type" value={String(customer?.gstRegistration || customer?.gstRegistrationType || 'Unregistered').toLowerCase() === 'unregistered' ? 'Unregistered' : 'Registered'} options={[{ value: 'Registered', label: 'Registered' }, { value: 'Unregistered', label: 'Unregistered' }]} />
                  <DisplayField label={`${isVendor ? 'Vendor' : 'Customer'} Code`} value={displayCustomerCode} />
                  <DisplayField label={`${isVendor ? 'Vendor' : 'Customer'} Name`} value={name} />
                  <DisplayField label={`${isVendor ? 'Vendor' : 'Customer'} Group`} value={groupName} />
                  <DisplayField label="Opening Balance" value={formatMoney(num(customer?.openingBalance), currentCompany)} />
                  <DisplayField label="Currency" value={customer?.currency === 'INR' || !customer?.currency ? '₹  INR - Indian Rupee' : customer.currency} />
                  <DisplayChoices label="Balance Type" value={String(customer?.openingBalanceType || (isVendor ? 'Cr' : 'Dr')).toLowerCase() === 'cr' ? 'Cr' : 'Dr'} options={[{ value: 'Dr', label: isVendor ? 'Dr' : 'Dr (Default)' }, { value: 'Cr', label: isVendor ? 'Cr (Default)' : 'Cr' }]} />
                </dl>
              </section>

              <section className="ui-card overflow-hidden p-4">
                <div className="ui-tabs" role="tablist" aria-label={`${isVendor ? 'Vendor' : 'Customer'} detail sections`}>
                  {['Address', 'Contacts', 'Credit Details', 'Statutory Details', 'Others'].map((item) => (
                    <button key={item} type="button" role="tab" aria-selected={detailsTab === item} onClick={() => setDetailsTab(item)} className={`ui-tab ${detailsTab === item ? 'is-active' : ''}`}>{item}</button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 pt-3">
                  {detailsTab === 'Address' ? (
                    <section className="space-y-4">
                      <div><h4 className="ui-t-sec">Address</h4><p className="ui-caption mt-0.5">Billing and shipping addresses are here by default. Add more places below if you need them.</p></div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <AddressCardView address={billingSource} title="Billing Address" subtitle="Primary address for invoices and accounting." tone="brand" badge={<span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: 'rgb(var(--brand) / 0.12)', color: 'rgb(var(--brand))' }}>Primary</span>} />
                        <AddressCardView address={shippingSource} title="Shipping Address" subtitle="Used for delivery and correspondence." tone="blue" badge={customer?.shippingSameAsBilling !== false ? <span className="inline-flex shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked readOnly tabIndex={-1} />Same as billing</span> : null} />
                        {extraAddresses.map((address, index) => <AddressCardView key={address.id || address.key || index} address={address} title={address.label || `Address ${index + 3}`} subtitle="Another place goods or documents go." />)}
                      </div>
                    </section>
                  ) : detailsTab === 'Contacts' ? (
                    <section className="space-y-3">
                      <div><h4 className="ui-t-sec">Contacts</h4><p className="ui-caption mt-0.5">The people at this {isVendor ? 'vendor' : 'customer'}. The one marked primary is used for correspondence.</p></div>
                      <div className="overflow-x-auto"><table className="w-full min-w-[38rem] border-collapse text-sm"><thead><tr><th className="ui-t-label w-20 px-2 py-2 text-center">Primary</th>{['Name', 'Position', 'Email', 'Mobile'].map((column) => <th key={column} className="ui-t-label px-2 py-2 text-left">{column}</th>)}</tr></thead><tbody>{displayedContacts.map((contact, index) => <tr key={contact.id || index}><td className="px-1 py-1 text-center"><input type="radio" name="customer-view-primary-contact" className="ui-radio mx-auto" checked={Boolean(contact.isPrimary) || (!displayedContacts.some((row) => row?.isPrimary) && index === 0)} readOnly tabIndex={-1} /></td><td className="px-1 py-1"><div className="ui-input min-w-[8rem]">{contact.name || '—'}</div></td><td className="px-1 py-1"><div className="ui-input min-w-[7rem]">{contact.position || '—'}</div></td><td className="px-1 py-1"><div className="ui-input min-w-[9rem]">{contact.email || '—'}</div></td><td className="px-1 py-1"><div className="ui-input ui-mono min-w-[7rem]">{contact.mobile || '—'}</div></td></tr>)}</tbody></table></div>
                    </section>
                  ) : detailsTab === 'Credit Details' ? (
                    <section className="space-y-4">
                      <div><h4 className="ui-t-sec">Credit Details</h4><p className="ui-caption mt-0.5">Payment terms and limits for this {isVendor ? 'vendor' : 'customer'}.</p></div>
                      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
                        <div className="space-y-4"><ReadOnlyField label="Credit Period (days)" value={String(customer?.paymentTermDays ?? customer?.creditDays ?? 0)} /><ReadOnlyField label={isVendor ? 'Purchase Price List' : 'Price List'} value={priceListName || '— none —'} /></div>
                        <div className="space-y-4"><ReadOnlyField label="Credit Limit" value={formatMoney(num(customer?.creditLimit), currentCompany)} money />{isVendor ? null : <div><span className="ui-label block">Credit Notes</span><span className="mt-1.5 inline-flex items-center gap-2.5 text-sm"><input type="checkbox" className="ui-checkbox" checked={customer?.allowCreditNotes !== false} readOnly tabIndex={-1} />Allow credit notes for this customer</span><p className="ui-caption mt-1">If disabled, credit notes cannot be raised for this customer.</p></div>}</div>
                      </div>
                    </section>
                  ) : detailsTab === 'Statutory Details' ? (
                    <section className="space-y-4">
                      <div><h4 className="ui-t-sec">Statutory Details</h4><p className="ui-caption mt-0.5">Tax and regulatory information for this {isVendor ? 'vendor' : 'customer'}.</p></div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <ReadOnlyField label="GSTIN" value={customer?.gstin} mono /><ReadOnlyField label="PAN" value={customer?.pan} mono />
                        {isVendor ? <><ReadOnlyField label="MSME registered" value={customer?.msmeRegistered || customer?.msmeNumber ? 'Yes' : 'No'} />{customer?.msmeRegistered || customer?.msmeNumber ? <ReadOnlyField label="MSME / Udyam number" value={customer?.msmeNumber} /> : null}</> : <><ReadOnlyField label="GST Registration / Treatment" value={customer?.gstRegistration || customer?.gstRegistrationType || 'Unregistered'} />
                        <ReadOnlyField label="TDS applicable" value={customer?.tdsApplicable == null ? 'Use the company default' : customer.tdsApplicable ? 'Yes — deduct' : 'No — never deduct'} />
                        <ReadOnlyField label="TDS nature" value={customer?.tdsNatureCode || '— none —'} /><ReadOnlyField label="Deductee type" value={customer?.tdsDeducteeType || 'COMPANY'} />
                        <ReadOnlyField label="Residential status" value={customer?.tdsResidentialStatus || 'RESIDENT'} /><ReadOnlyField label="Default TDS Receivable Ledger" value={tdsLedgerName || "Follow the nature's mapping"} />
                        <details className="sm:col-span-2 ui-sunken rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Lower / nil deduction certificate</summary><div className="mt-3 grid gap-4 sm:grid-cols-4"><ReadOnlyField label="Certificate number" value={customer?.tdsCertificate?.number} mono /><ReadOnlyField label="Certificate rate (%)" value={customer?.tdsCertificate?.rate} mono /><ReadOnlyField label="Valid from" value={customer?.tdsCertificate?.validFrom} /><ReadOnlyField label="Valid to" value={customer?.tdsCertificate?.validTo} /><ReadOnlyField label="15G / 15H declaration" value={customer?.tdsCertificate?.form15GH} /><ReadOnlyField label="15G / 15H period" value={customer?.tdsCertificate?.form15GHPeriod} /></div></details>
                        <ReadOnlyField label="MSME / Udyam" value={customer?.msmeNumber} /><ReadOnlyField label="Others" value={customer?.statutoryOther} />
                        </>}
                      </div>
                    </section>
                  ) : (
                    <section className="space-y-4"><div><h4 className="ui-t-sec">Others</h4><p className="ui-caption mt-0.5">Additional settings for this {isVendor ? 'vendor' : 'customer'}.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2 lg:col-span-1"><label className="ui-label">Remarks</label><div className="ui-input min-h-[5.25rem] w-full whitespace-pre-wrap py-2" role="textbox" aria-readonly="true">{customer?.notes || customer?.description || '—'}</div><p className="ui-caption mt-1">Internal notes about this {isVendor ? 'vendor' : 'customer'}.</p></div></div></section>
                  )}
                </div>
              </section>
            </div>
          ) : tab === 'Summary' ? (
            <div className="space-y-6 bg-[rgb(var(--surface-2))] p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="ui-t-sec">Business overview</h2><p className="ui-caption mt-0.5">{isVendor ? 'Purchases, payments, returns and payable behaviour for this vendor.' : 'Sales, collections, returns and payment behaviour for this customer.'}</p></div>
                <div className="rounded-full border bg-[rgb(var(--surface))] px-3 py-1.5 text-xs font-semibold ui-border-c">Updated from live transactions</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryMetric label={isVendor ? 'Total purchases' : 'Total sales'} value={formatMoney(totalSales, currentCompany)} hint={`${invoices.length} ${isVendor ? 'purchase bill' : 'sales invoice'}${invoices.length === 1 ? '' : 's'}`} trend={salesMom} icon={FileText} tone="ui-bar-sales" />
                <SummaryMetric label={isVendor ? 'Amount paid' : 'Amount received'} value={formatMoney(totalReceipts, currentCompany)} hint={`${collectionRate.toFixed(1)}% of ${isVendor ? 'purchases paid' : 'sales collected'}`} trend={receiptsMom} icon={CreditCard} tone="ui-bar-receipts" />
                <SummaryMetric label="Average payment time" value={`${averagePaymentDays} days`} hint={`${settledInvoices.length} fully settled ${isVendor ? 'bill' : 'invoice'}${settledInvoices.length === 1 ? '' : 's'}`} icon={CalendarDays} tone="ui-bar-invoiced" />
                <SummaryMetric label={isVendor ? 'Debit notes' : 'Credit notes'} value={formatMoney(totalCreditNotes, currentCompany)} hint={`${returnPercent.toFixed(1)}% return against ${isVendor ? 'purchases' : 'sales'}`} icon={FileText} tone="ui-bar-returns" />
                <SummaryMetric label="Outstanding ratio" value={`${outstandingPercent.toFixed(1)}%`} hint={`${formatMoney(outstanding, currentCompany)} currently due`} icon={Wallet} tone="ui-bar-outstanding" />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,1fr)]">
                <section className="rounded-2xl border bg-[rgb(var(--surface))] p-5 ui-border-c">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{isVendor ? 'Purchases and payments' : 'Sales and collections'}</h3><p className="mt-1 text-sm ui-subtle">Six-month movement</p></div><div className="flex gap-4 text-xs font-medium"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full ui-bar-sales" />{isVendor ? 'Purchases' : 'Sales'}</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full ui-bar-receipts" />{isVendor ? 'Payments' : 'Receipts'}</span></div></div>
                  <div className="mt-6 grid h-52 grid-cols-6 items-end gap-3 border-b ui-border-c">
                    {monthlyActivity.map((month) => (
                      <div key={month.key} className="flex h-full min-w-0 flex-col justify-end">
                        <div className="flex h-[10rem] items-end justify-center gap-1.5">
                          <div title={`${isVendor ? 'Purchases' : 'Sales'}: ${formatMoney(month.sales, currentCompany)}`} className="w-3 rounded-t ui-bar-sales transition-all" style={{ height: `${Math.max(month.sales ? 6 : 1, (month.sales / chartMax) * 100)}%` }} />
                          <div title={`${isVendor ? 'Payments' : 'Receipts'}: ${formatMoney(month.receipts, currentCompany)}`} className="w-3 rounded-t ui-bar-receipts transition-all" style={{ height: `${Math.max(month.receipts ? 6 : 1, (month.receipts / chartMax) * 100)}%` }} />
                        </div>
                        <div className="mt-3 text-center text-xs font-medium ui-subtle">{month.label}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border bg-[rgb(var(--surface))] p-5 ui-border-c">
                  <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold">Top 5 outstanding {isVendor ? 'bills' : 'invoices'}</h3><p className="mt-1 text-sm ui-subtle">Oldest open balances</p></div><span className="rounded-full border px-3 py-1 text-xs font-medium ui-link ui-border-c">{openInvoices.length} open</span></div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs ui-subtle ui-border-c"><th className="py-2">Invoice</th><th className="py-2">Date</th><th className="py-2 text-right">Outstanding</th></tr></thead><tbody>
                      {[...openInvoices].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(0, 5).map((invoice) => <tr key={invoice.id} className="border-b last:border-0 ui-border-c"><td className="py-3 font-medium ui-link">{invoice.number || '—'}</td><td className="py-3"><DocDate value={invoice.date} /></td><td className="ui-money py-3 text-right">{formatMoney(Math.max(0, num(invoice.total) - num(invoice.paidAmount)), currentCompany)}</td></tr>)}
                      {!openInvoices.length ? <tr><td colSpan={3} className="py-8 text-center ui-subtle">No outstanding {isVendor ? 'bills' : 'invoices'}</td></tr> : null}
                    </tbody></table>
                  </div>
                </section>
              </div>
            </div>
          ) : tab === 'Statement' ? (
            <>
              <div className="grid grid-cols-1 items-center gap-2 border-b p-3 ui-border-c md:grid-cols-[minmax(15rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_auto]">
                <label className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ui-subtle" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="ui-input w-full pl-9 text-sm" placeholder="Search transactions…" aria-label={`Search ${isVendor ? 'vendor' : 'customer'} transactions`} /></label>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="ui-input w-full text-sm" aria-label="Transaction type"><option value="">All transactions</option>{isVendor ? <><option value="Bill">Purchase bills</option><option value="Payment">Payments</option><option value="Vendor Debit Note">Debit notes</option></> : <><option value="Sales">Sales invoices</option><option value="Receipt">Receipts</option><option value="CN">Credit notes</option><option value="Debit Note">Debit notes</option><option value="Sales Return">Sales returns</option></>}<option value="Opening Balance">Opening balance</option></select>
                <div className="relative">
                  <select
                    value={periodFilter}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPeriodFilter(value);
                      setCustomPeriodOpen(value === 'custom');
                    }}
                    onClick={() => { if (periodFilter === 'custom') setCustomPeriodOpen(true); }}
                    className="ui-input w-full text-sm"
                    aria-label="Transaction period"
                  >
                    <option value="">All periods</option><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option><option value="custom">{customFrom || customTo ? `${customFrom || 'Start'} – ${customTo || 'Today'}` : 'Custom period'}</option>
                  </select>
                  {customPeriodOpen ? (
                    <div className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-72 rounded-xl border bg-[rgb(var(--surface))] p-3 shadow-xl ui-border-c" role="dialog" aria-label="Select custom period">
                      <div className="mb-3 text-sm font-bold">Custom period</div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs font-semibold ui-subtle">From<input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="ui-input mt-1 w-full text-sm" aria-label="Custom period from" /></label>
                        <label className="text-xs font-semibold ui-subtle">To<input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom || undefined} className="ui-input mt-1 w-full text-sm" aria-label="Custom period to" /></label>
                      </div>
                      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setCustomPeriodOpen(false)} className="ui-btn ui-btn-secondary px-3">Cancel</button><button type="button" onClick={() => setCustomPeriodOpen(false)} className="ui-btn ui-btn-primary px-3">Apply</button></div>
                    </div>
                  ) : null}
                </div>
                <ExportButton
                  label="Export"
                  title={`${name} Statement`}
                  fileName={`${displayCustomerCode || name}-statement`}
                  sheetName="Customer Statement"
                  columns={[
                    { key: 'date', label: 'Date' },
                    { key: 'type', label: 'Type' },
                    { key: 'voucher', label: 'Voucher No.' },
                    { key: 'reference', label: 'Reference' },
                    { key: 'ledger', label: 'Ledger Name' },
                    { key: 'debit', label: 'Debit', align: 'right', type: 'number' },
                    { key: 'credit', label: 'Credit', align: 'right', type: 'number' },
                    { key: 'balance', label: 'Balance', align: 'right', type: 'number' },
                  ]}
                  rows={statementExportRows}
                  metaLines={statementMetaLines}
                  footerRows={[{
                    ledger: 'Closing Balance',
                    balance: statementClosingBalance,
                  }]}
                  reportStyle="statement"
                  subtitleParts={{
                    period: periodFilter === 'custom'
                      ? [customFrom, customTo].filter(Boolean).join(' to ') || 'Custom period'
                      : ({ month: 'This month', quarter: 'This quarter', year: 'This year' }[periodFilter] || 'All periods'),
                  }}
                />
              </div>
              {displayed.length ? (
                <div className="overflow-x-auto ui-table-scroll">
                  <table className="ui-table w-full text-sm">
                    <thead><tr><th>Date</th><th>Type</th><th>Voucher No.</th><th className="ui-num">Debit</th><th className="ui-num">Credit</th><th className="ui-num">Balance</th><th className="w-14 text-center">Action</th></tr></thead>
                    <tbody className="ui-rows">{displayed.map((row) => (
                      <tr key={row.id} className="cursor-pointer" onClick={() => setEntryPopup(row)}>
                        <td className="ui-col-date"><DocDate value={row.date || '—'} /></td>
                        <td className="ui-col-entity">{row.type}</td>
                        <td className="ui-col-id"><button type="button" className="font-medium ui-link" onClick={(event) => { event.stopPropagation(); setVoucherPopup(row); }}>{row.number || '—'}</button></td>
                        <td className="ui-col-amount">{row.debit ? <MoneyValue value={row.debit} company={currentCompany} /> : '—'}</td>
                        <td className="ui-col-amount">{row.credit ? <MoneyValue value={row.credit} company={currentCompany} /> : '—'}</td>
                        <td className="ui-col-amount"><MoneyValue value={row.balance} company={currentCompany} /></td>
                        <td className="relative text-center" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="ui-icon-btn mx-auto" aria-label={`Actions for ${row.number}`} onClick={(event) => { event.stopPropagation(); setRowMenu((current) => current === row.id ? '' : row.id); }}><MoreVertical size={16} /></button>
                          {rowMenu === row.id ? <div className="absolute right-10 top-1 z-40 w-32 rounded-lg border bg-[rgb(var(--surface))] p-1 text-left shadow-xl ui-border-c"><button type="button" className="report-menu-item" onClick={() => { setRowMenu(''); onEditTransaction?.(row); }}>Edit</button><button type="button" className="report-menu-item text-[rgb(var(--neg))]" onClick={() => { setRowMenu(''); onDeleteTransaction?.(row); }}>Delete</button></div> : null}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <EmptyState icon={FileText} title="No transactions found" description={query ? 'Try a different search.' : `${isVendor ? 'Vendor' : 'Customer'} activity will appear here.`} />}
            </>
          ) : null}
      </section>

      {voucherPopup ? <Modal
        onClose={() => setVoucherPopup(null)}
        title={`${voucherPopup.type === 'Sales' ? 'Invoice' : voucherPopup.type} · ${voucherPopup.number || 'Voucher'}`}
        maxWidthClass={['Sales', 'Bill'].includes(voucherPopup.type) ? 'max-w-[96vw]' : 'max-w-4xl'}
        showCloseIcon={false}
        headerActions={<>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => printVoucherPreview(voucherPopup.number)}><Printer size={16} /> Print</button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setVoucherPopup(null)}>Close</button>
        </>}
      >
        {voucherPopup.type === 'Sales' && voucherPopup.raw ? (
          <div className="overflow-x-auto"><InvoicePreview db={db} currentCompany={currentCompany} invoice={voucherPopup.raw} /></div>
        ) : voucherPopup.type === 'Bill' && voucherPopup.raw ? (
          <div className="overflow-x-auto"><BillPreview db={db} currentCompany={currentCompany} bill={voucherPopup.raw} /></div>
        ) : (
          <div className="printable space-y-4"><div className="grid gap-3 sm:grid-cols-3"><HeaderFact label="Date" value={voucherPopup.date || '—'} /><HeaderFact label="Reference" value={voucherPopup.reference} /><HeaderFact label="Status" value={voucherPopup.status} /></div><div className="grid gap-3 sm:grid-cols-3"><HeaderFact label="Taxable value" value={formatMoney(voucherPopup.taxable, currentCompany)} /><HeaderFact label="Tax / TDS" value={formatMoney(voucherPopup.tax, currentCompany)} /><HeaderFact label="Voucher amount" value={formatMoney(voucherPopup.debit || voucherPopup.credit, currentCompany)} /></div>{Array.isArray(voucherPopup.raw?.items) && voucherPopup.raw.items.length ? <div className="overflow-x-auto"><table className="ui-table w-full text-sm"><thead><tr><th>Item</th><th className="ui-num">Quantity</th><th className="ui-num">Rate</th><th className="ui-num">Amount</th></tr></thead><tbody>{voucherPopup.raw.items.map((item, index) => <tr key={item.id || index}><td>{item.name || item.itemName || item.description || 'Item'}</td><td className="ui-num">{item.quantity || item.qty || '—'}</td><td className="ui-num">{formatMoney(item.rate || item.price, currentCompany)}</td><td className="ui-num">{formatMoney(item.amount || item.total, currentCompany)}</td></tr>)}</tbody></table></div> : null}</div>
        )}
      </Modal> : null}

      {entryPopup ? <Modal
        onClose={() => setEntryPopup(null)}
        title={`${entryPopup.type} · ${entryPopup.number || 'Voucher'}`}
        maxWidthClass="max-w-[96vw]"
        showCloseIcon={false}
        headerActions={<>
          <ExportButton
            label="Export"
            title={`${entryPopup.type} ${entryPopup.number || 'Voucher'}`}
            fileName={`accounting-entry-${entryPopup.number || 'voucher'}`}
            sheetName="Accounting Entry"
            columns={[
              { key: 'date', label: 'Date' }, { key: 'voucher', label: 'Voucher No.' },
              { key: 'ledger', label: 'Ledger Name' }, { key: 'debit', label: 'Debit' },
              { key: 'credit', label: 'Credit' },
            ]}
            rows={entryPopupLines.map((line, index) => ({
              date: index === 0 ? entryPopup.date || '' : '',
              voucher: index === 0 ? entryPopup.number || '' : '',
              ledger: line.account,
              debit: line.debit || '',
              credit: line.credit || '',
            }))}
          />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => printAccountingEntry({ voucher: entryPopup, lines: entryPopupLines, company: currentCompany })}><Printer size={16} /> Print</button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEntryPopup(null)}>Close</button>
        </>}
      ><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><HeaderFact label="Date" value={entryPopup.date || '—'} /><HeaderFact label="Voucher type" value={entryPopup.type} /><HeaderFact label="Reference" value={entryPopup.reference} /></div><div className="overflow-hidden rounded-xl border ui-border-c"><div className="overflow-x-auto"><table className="ui-table w-full min-w-[64rem] text-sm"><thead><tr><th className="w-40">Date</th><th className="w-52">Voucher No.</th><th>Ledger Name</th><th className="ui-num w-56">Debit</th><th className="ui-num w-56">Credit</th></tr></thead><tbody>{entryPopupLines.map((line, index) => <tr key={`${line.account}-${index}`}><td>{index === 0 ? <DocDate value={entryPopup.date || '—'} /> : ''}</td><td className="font-medium">{index === 0 ? entryPopup.number || '—' : ''}</td><td className="font-medium">{line.account}</td><td className="ui-col-amount">{line.debit ? <MoneyValue value={line.debit} company={currentCompany} /> : '—'}</td><td className="ui-col-amount">{line.credit ? <MoneyValue value={line.credit} company={currentCompany} /> : '—'}</td></tr>)}</tbody><tfoot><tr><th colSpan={3} className="text-right">Total</th><th className="ui-num">{formatMoney(entryPopupLines.reduce((sum, line) => sum + line.debit, 0), currentCompany)}</th><th className="ui-num">{formatMoney(entryPopupLines.reduce((sum, line) => sum + line.credit, 0), currentCompany)}</th></tr></tfoot></table></div></div><div className="rounded-xl border p-4 ui-border-c"><div className="ui-t-label ui-subtle">Narration</div><div className="ui-narration mt-1">{entryPopup.raw?.narration || entryPopup.raw?.notes || entryPopup.reference || entryPopup.type}</div></div></div></Modal> : null}
    </div>
  );
}
