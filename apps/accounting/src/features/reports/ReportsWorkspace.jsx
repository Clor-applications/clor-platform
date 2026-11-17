import SyncProblemsNotice from '@ui/components/SyncProblemsNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  MoreVertical,
  PackageSearch,
  ReceiptIndianRupee,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react';

import { EntityMark, PageHeader } from '@ui/components/ui/Primitives';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { formatMoney } from '@ui/utils/money';
import ProfitLossReport from './ProfitLossReport';
import BalanceSheetReport from './BalanceSheetReport';
import TrialBalanceReport from './TrialBalanceReport';
import CashFlowReport from './CashFlowReport';
import CatalogReport from './CatalogReport';
import InventoryRegisterReport from './InventoryRegisterReport';

const report = (name, route = '', feature = '') => ({ name, route, feature });

const BUCKETS = {
  sales: {
    title: 'Sales', icon: ReceiptIndianRupee, source: 'sales',
    reports: [
      report('Sales Register', 'salesReports'),
      report('Sales Return Register'),
      report('Customer-wise Sales'),
      report('Item-wise Sales'),
      report('Category-wise Sales'),
      report('Salesperson-wise Sales', 'salesBySalesman', 'salesmen'),
      report('Monthly Sales Summary'),
    ],
  },
  purchases: {
    title: 'Purchases', icon: WalletCards, source: 'purchases',
    reports: [
      report('Purchase Register'),
      report('Purchase Return Register'),
      report('Vendor-wise Purchase'),
      report('Item-wise Purchase'),
      report('Category-wise Purchase'),
      report('Monthly Purchase Summary'),
    ],
  },
  expenses: {
    title: 'Expenses', icon: CircleDollarSign, source: 'expenses',
    reports: [
      report('Expense Register'), report('Expense Ledger-wise'),
      report('Vendor-wise Expense'), report('Monthly Expense Analysis'),
    ],
  },
  receipts: {
    title: 'Receipts', icon: ReceiptIndianRupee, source: 'receipts',
    reports: [
      report('Receipt Register'), report('Customer/Ledger-wise Receipts'), report('Advance Receipts'),
    ],
  },
  payments: {
    title: 'Payments', icon: WalletCards, source: 'payments',
    reports: [
      report('Payment Register'), report('Vendor/Ledger-wise Payments'), report('Advance Payments'),
    ],
  },
  ledgers: {
    title: 'Ledger Statement', icon: BookOpen, source: 'ledgers',
    reports: [report('Ledger Summary'), report('Ledger Group Summary')],
  },
  outstanding: {
    title: 'Outstanding Registers', icon: UsersRound, source: 'ledgers',
    reports: [report('Outstanding Receivables'), report('Outstanding Payables')],
  },
  inventory: {
    title: 'Inventory', icon: PackageSearch, source: 'inventory',
    reports: [
      report('Inventory Register'), report('Batch-wise Report'), report('Reorder Level Report'),
      report('Near Expiry'), report('Expired Stock'), report('Negative Stock'),
    ],
  },
  gst: {
    title: 'GST', icon: ShieldCheck, source: 'gst',
    reports: [
      report('GSTR-1', 'gstr1'), report('GSTR-3B', 'gstr3b'), report('GST Sales Register'),
      report('GST Purchase Register'), report('HSN/SAC Summary'), report('Tax Liability Summary'),
      report('Input Tax Credit Summary', 'gstr2bReco'), report('GST Ledger Summary'),
    ],
  },
  tds: {
    title: 'TDS', icon: ShieldCheck, source: 'tds',
    reports: [
      report('TDS Receivable Register', 'tds'), report('TDS Payable Register', 'tdsTcs'),
      report('Section-wise TDS'), report('Party-wise TDS'), report('TDS Deduction Summary'),
      report('TDS Payment Summary'), report('Filing-ready TDS Summary'),
    ],
  },
  tcs: {
    title: 'TCS', icon: ShieldCheck, source: 'ledgers',
    reports: [report('TCS Ledger Summary')],
  },
};

const NAV_GROUPS = [
  { title: 'Business Reports', keys: ['sales', 'purchases', 'inventory', 'expenses', 'receipts', 'payments', 'ledgers', 'outstanding'] },
  {
    title: 'Financial Statements',
    direct: [
      report('Profit & Loss', 'profitLoss'), report('Balance Sheet', 'balanceSheet'),
      report('Trial Balance', 'trialBalance'), report('Cash Flow Statement', 'cashFlow'),
    ],
  },
  { title: 'Statutory Reports', keys: ['gst', 'tds', 'tcs'] },
];

const BUCKET_PERMISSIONS = {
  sales: 'Sales Reports', purchases: 'Purchase Reports', inventory: 'Inventory Reports',
  expenses: 'Expense Reports', receipts: 'Receipt Reports', payments: 'Payment Reports',
  ledgers: 'Ledger Reports', outstanding: 'Outstanding Registers',
  tds: 'TDS Reports', tcs: 'TCS Reports',
};

export const reportViewPermission = (item) => {
  const name = String(item?.name || '');
  const direct = { 'Profit & Loss': 'Profit & Loss', 'Balance Sheet': 'Balance Sheet', 'Trial Balance': 'Trial Balance', 'Cash Flow Statement': 'Cash Flow', 'GSTR-1': 'GSTR-1', 'GSTR-3B': 'GSTR-3B' };
  const resource = direct[name] || (item?.bucketKey === 'gst' ? 'GST Reports' : BUCKET_PERMISSIONS[item?.bucketKey]);
  return resource ? `REPORTS::${resource}::VIEW` : null;
};

const canViewBucket = (key, can) => key === 'gst'
  ? ['GSTR-1', 'GSTR-3B', 'GST Reports'].some((resource) => can(`REPORTS::${resource}::VIEW`))
  : can(`REPORTS::${BUCKET_PERMISSIONS[key]}::VIEW`);

export const reportSidebarItems = (isEnabled = () => true, can = () => true) => NAV_GROUPS.flatMap((group) => {
  const buckets = (group.keys || [])
    .filter((key) => (!BUCKETS[key]?.feature || isEnabled(BUCKETS[key].feature)) && canViewBucket(key, can))
    .map((key) => ({ key: `reportBucket:${key}`, label: BUCKETS[key].title, icon: BUCKETS[key].icon, reportBucket: key }));
  const direct = (group.direct || [])
    .filter((item) => (!item.feature || isEnabled(item.feature)) && can(reportViewPermission(item)))
    .map((item) => ({
      key: `reportDirect:${group.title}:${item.name}`, label: item.name, icon: FileSpreadsheet,
      reportItem: { ...item, bucketKey: group.bucket || '', category: group.title, source: group.title === 'Financial Statements' ? 'ledgers' : 'cashBank' },
    }));
  return buckets.length || direct.length ? [{ type: 'subgroup', label: group.title }, ...buckets, ...direct] : [];
});

const collectionFor = (db, source) => {
  if (source === 'sales') return db?.invoices || [];
  if (source === 'purchases') return db?.bills || db?.purchases || [];
  if (source === 'expenses') return db?.expenses || [];
  if (source === 'receipts') return (db?.payments || []).filter((row) => /^(in|inflow)$/i.test(String(row.direction || '')) || /receipt|received/i.test(String(row.type || row.kind || row.voucherType || '')));
  if (source === 'payments') return (db?.payments || []).filter((row) => !/^(in|inflow)$/i.test(String(row.direction || '')) && !/receipt|received/i.test(String(row.type || row.kind || row.voucherType || '')));
  if (source === 'journals') return db?.journalEntries || db?.journals || [];
  if (source === 'inventory') return db?.items || [];
  if (source === 'ledgers') return db?.chartOfAccounts || [];
  if (source === 'cashBank') return db?.bankTransactions || db?.cashBankTransactions || db?.payments || [];
  if (source === 'gst') return [...(db?.invoices || []), ...(db?.bills || []), ...(db?.expenses || [])];
  if (source === 'tds') return db?.tdsEvents || db?.payments || [];
  return [];
};

const rowDate = (row) => String(row?.date || row?.invoiceDate || row?.billDate || row?.createdAt || '').slice(0, 10);
const rowNumber = (row) => row?.number || row?.receiptNo || row?.paymentNo || row?.invoiceNumber || row?.billNumber || row?.voucherNo || row?.code || `#${row?.id || ''}`;
const rowParty = (row) => row?.customerName || row?.vendorName || row?.partyName || row?.ledgerName || row?.payee || row?.name || '—';
const rowAmount = (row) => Number(row?.total ?? row?.amount ?? row?.balance ?? row?.closingBalance ?? 0) || 0;

const genericReportColumns = [
  { key: 'date', label: 'Date' },
  { key: 'number', label: 'Voucher No.' },
  { key: 'party', label: 'Customer / Vendor / Ledger' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'taxable', label: 'Taxable Amount', money: true },
  { key: 'gst', label: 'GST', money: true },
  { key: 'amount', label: 'Total Amount', money: true },
];

const salesReportColumns = [
  { key: 'number', label: 'Invoice No.' },
  { key: 'date', label: 'Invoice Date' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'refNo', label: 'Reference No.' },
  { key: 'refDate', label: 'Reference Date' },
  { key: 'party', label: 'Customer Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'customerGstin', label: 'Customer GSTIN' },
  { key: 'customerPan', label: 'Customer PAN' },
  { key: 'customerPhone', label: 'Customer Mobile' },
  { key: 'customerEmail', label: 'Customer Email' },
  { key: 'billingAddress', label: 'Billing Address' },
  { key: 'shippingAddress', label: 'Shipping Address' },
  { key: 'customerCity', label: 'Customer City' },
  { key: 'customerState', label: 'Customer State' },
  { key: 'creditLimit', label: 'Credit Limit (₹)', money: true },
  { key: 'paymentTerms', label: 'Payment Terms' },
  { key: 'branch', label: 'Branch' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'costCentre', label: 'Cost Centre' },
  { key: 'itemCount', label: 'Item Count', numeric: true },
  { key: 'itemCodes', label: 'Item Codes' },
  { key: 'itemNames', label: 'Item Names' },
  { key: 'itemDescriptions', label: 'Item Descriptions' },
  { key: 'hsnSac', label: 'HSN / SAC' },
  { key: 'totalQuantity', label: 'Total Quantity', numeric: true },
  { key: 'subtotal', label: 'Subtotal (₹)', money: true },
  { key: 'discount', label: 'Discount (₹)', money: true },
  { key: 'otherCharges', label: 'Other Charges (₹)', money: true },
  { key: 'taxable', label: 'Taxable Amount (₹)', money: true },
  { key: 'taxType', label: 'Tax Type' },
  { key: 'placeOfSupply', label: 'Place of Supply' },
  { key: 'reverseCharge', label: 'Reverse Charge' },
  { key: 'cgst', label: 'CGST (₹)', money: true },
  { key: 'sgst', label: 'SGST (₹)', money: true },
  { key: 'igst', label: 'IGST (₹)', money: true },
  { key: 'gst', label: 'GST (₹)', money: true },
  { key: 'tdsSection', label: 'TDS Section' },
  { key: 'tdsRate', label: 'TDS Rate (%)', numeric: true },
  { key: 'tdsAmount', label: 'TDS Amount (₹)', money: true },
  { key: 'amount', label: 'Total Amount (₹)', money: true },
  { key: 'paidAmount', label: 'Paid Amount (₹)', money: true },
  { key: 'balanceAmount', label: 'Balance Amount (₹)', money: true },
  { key: 'paymentStatus', label: 'Payment Status' },
  { key: 'lastPaidDate', label: 'Last Paid Date' },
  { key: 'receiptNumbers', label: 'Receipt No.' },
  { key: 'receiptDates', label: 'Receipt Date' },
  { key: 'receiptModes', label: 'Receipt Mode' },
  { key: 'paymentReferences', label: 'Payment Reference' },
  { key: 'salesOrderNumber', label: 'Sales Order No.' },
  { key: 'salesOrderDate', label: 'Sales Order Date' },
  { key: 'salesOrderStatus', label: 'Sales Order Status' },
  { key: 'customerPoRef', label: 'Customer PO Reference' },
  { key: 'expectedDeliveryDate', label: 'Expected Delivery Date' },
  { key: 'creditNoteNumbers', label: 'Credit Note No.' },
  { key: 'creditNoteDates', label: 'Credit Note Date' },
  { key: 'creditNoteAmount', label: 'Credit Note Amount (₹)', money: true },
  { key: 'creditNoteReasons', label: 'Credit Note Reason' },
  { key: 'creditNoteStatus', label: 'Credit Note Status' },
  { key: 'notes', label: 'Notes / Narration' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },
  { key: 'createdBy', label: 'Created By' },
  { key: 'invoiceCount', label: 'Invoice Count', numeric: true },
  { key: 'customerCount', label: 'Customer Count', numeric: true },
  { key: 'averageInvoiceValue', label: 'Average Invoice Value (₹)', money: true },
  { key: 'itemCode', label: 'Item Code' },
  { key: 'itemName', label: 'Item Name' },
  { key: 'itemCategory', label: 'Item Category' },
  { key: 'averageRate', label: 'Average Rate (₹)', money: true },
  { key: 'month', label: 'Month' },
  { key: 'gstRate', label: 'GST Rate (%)', numeric: true },
  { key: 'originalInvoiceNumber', label: 'Original Invoice No.' },
  { key: 'originalInvoiceDate', label: 'Original Invoice Date' },
  { key: 'creditNoteReason', label: 'Credit Note Reason' },
  { key: 'status', label: 'Status' },
  { key: 'action', label: 'Action' },
];

const salesDefaultColumnKeys = ['number', 'date', 'party', 'branch', 'itemCount', 'taxable', 'gst', 'amount', 'status', 'action'];
const salesColumnByKey = new Map(salesReportColumns.map((column) => [column.key, column]));
const salesColumns = (...keys) => keys.map((key) => salesColumnByKey.get(key)).filter(Boolean);

const salesReportPresentation = (title) => {
  const lower = String(title || '').toLowerCase();
  if (lower.includes('return') || lower.includes('credit note')) return {
    kind: 'creditNote',
    columns: salesColumns('number', 'date', 'originalInvoiceNumber', 'originalInvoiceDate', 'party', 'customerCode', 'customerGstin', 'creditNoteReason', 'itemCount', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount', 'status', 'notes', 'createdAt', 'createdBy', 'action'),
    defaults: ['number', 'date', 'originalInvoiceNumber', 'party', 'creditNoteReason', 'taxable', 'gst', 'amount', 'status', 'action'],
  };
  if (lower.includes('customer-wise')) return {
    kind: 'customer',
    columns: salesColumns('party', 'customerCode', 'customerType', 'customerGstin', 'customerPan', 'customerPhone', 'customerEmail', 'customerCity', 'customerState', 'billingAddress', 'shippingAddress', 'creditLimit', 'paymentTerms', 'invoiceCount', 'itemCount', 'taxable', 'gst', 'amount', 'averageInvoiceValue', 'paidAmount', 'creditNoteAmount', 'balanceAmount', 'lastPaidDate'),
    defaults: ['party', 'customerGstin', 'invoiceCount', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('item-wise')) return {
    kind: 'item',
    columns: salesColumns('itemCode', 'itemName', 'itemCategory', 'hsnSac', 'invoiceCount', 'customerCount', 'totalQuantity', 'averageRate', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount'),
    defaults: ['itemCode', 'itemName', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('category-wise')) return {
    kind: 'category',
    columns: salesColumns('itemCategory', 'itemCount', 'invoiceCount', 'customerCount', 'totalQuantity', 'taxable', 'gst', 'amount', 'averageInvoiceValue'),
    defaults: ['itemCategory', 'itemCount', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('branch-wise')) return {
    kind: 'branch',
    columns: salesColumns('branch', 'invoiceCount', 'customerCount', 'itemCount', 'totalQuantity', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount', 'paidAmount', 'balanceAmount', 'averageInvoiceValue'),
    defaults: ['branch', 'invoiceCount', 'customerCount', 'itemCount', 'taxable', 'gst', 'amount', 'paidAmount', 'balanceAmount'],
  };
  if (lower.includes('salesperson-wise')) return {
    kind: 'salesperson',
    columns: salesColumns('salesperson', 'invoiceCount', 'customerCount', 'itemCount', 'totalQuantity', 'taxable', 'gst', 'amount', 'paidAmount', 'balanceAmount', 'averageInvoiceValue'),
    defaults: ['salesperson', 'customerCount', 'invoiceCount', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('monthly')) return {
    kind: 'month',
    columns: salesColumns('month', 'invoiceCount', 'customerCount', 'itemCount', 'totalQuantity', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount', 'paidAmount', 'creditNoteAmount', 'balanceAmount', 'averageInvoiceValue'),
    defaults: ['month', 'invoiceCount', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('gst-wise')) return {
    kind: 'gst',
    columns: salesColumns('gstRate', 'invoiceCount', 'customerCount', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount'),
    defaults: ['gstRate', 'invoiceCount', 'customerCount', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount'],
  };
  if (lower.includes('hsn') || lower.includes('sac')) return {
    kind: 'hsn',
    columns: salesColumns('hsnSac', 'itemCount', 'invoiceCount', 'customerCount', 'totalQuantity', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'amount'),
    defaults: ['hsnSac', 'itemCount', 'invoiceCount', 'customerCount', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  return { kind: 'invoice', columns: salesReportColumns, defaults: salesDefaultColumnKeys };
};

const purchaseReportColumns = [
  ...salesColumns('number', 'date', 'dueDate', 'refNo', 'refDate', 'party'),
  { key: 'vendorCode', label: 'Vendor Code' },
  { key: 'vendorGstin', label: 'Vendor GSTIN' },
  ...salesColumns('branch', 'warehouse', 'itemCount', 'itemCodes', 'itemNames', 'itemDescriptions', 'hsnSac', 'totalQuantity', 'subtotal', 'discount', 'otherCharges', 'taxable', 'taxType', 'placeOfSupply', 'reverseCharge', 'cgst', 'sgst', 'igst', 'gst', 'tdsSection', 'tdsRate', 'tdsAmount', 'amount', 'paidAmount', 'balanceAmount', 'paymentStatus', 'lastPaidDate'),
  { key: 'purchaseOrderNumber', label: 'Purchase Order No.' },
  { key: 'originalBillNumber', label: 'Original Bill No.' },
  { key: 'returnReason', label: 'Return Reason' },
  ...salesColumns('notes', 'createdAt', 'updatedAt', 'createdBy', 'invoiceCount', 'itemCount', 'customerCount', 'itemCode', 'itemName', 'itemCategory', 'month', 'status', 'action'),
].filter((column, index, columns) => columns.findIndex((candidate) => candidate.key === column.key) === index)
  .map((column) => ({ ...column, label: ({ number: 'Bill No.', date: 'Bill Date', party: 'Vendor Name', invoiceCount: 'Bill Count', customerCount: 'Vendor Count' })[column.key] || column.label }));
const purchaseColumnByKey = new Map(purchaseReportColumns.map((column) => [column.key, column]));
const purchaseColumns = (...keys) => keys.map((key) => purchaseColumnByKey.get(key)).filter(Boolean);

const purchaseReportPresentation = (title) => {
  const lower = String(title || '').toLowerCase();
  if (lower.includes('return')) return {
    kind: 'debitNote', columns: purchaseReportColumns.map((column) => ({ ...column, label: ({ number: 'Debit Note No.', date: 'Return Date' })[column.key] || column.label })),
    defaults: ['number', 'date', 'originalBillNumber', 'party', 'itemCount', 'taxable', 'gst', 'amount', 'status'],
  };
  if (lower.includes('vendor-wise')) return {
    kind: 'vendor', columns: purchaseColumns('party', 'vendorCode', 'vendorGstin', 'invoiceCount', 'taxable', 'gst', 'amount', 'paidAmount', 'balanceAmount'),
    defaults: ['party', 'vendorGstin', 'invoiceCount', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('item-wise')) return {
    kind: 'item', columns: purchaseColumns('itemCode', 'itemName', 'itemCategory', 'hsnSac', 'invoiceCount', 'totalQuantity', 'taxable', 'gst', 'amount'),
    defaults: ['itemCode', 'itemName', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('category-wise')) return {
    kind: 'category', columns: purchaseColumns('itemCategory', 'itemCount', 'invoiceCount', 'totalQuantity', 'taxable', 'gst', 'amount'),
    defaults: ['itemCategory', 'itemCount', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  if (lower.includes('monthly')) return {
    kind: 'month', columns: purchaseColumns('month', 'invoiceCount', 'itemCount', 'totalQuantity', 'taxable', 'gst', 'amount'),
    defaults: ['month', 'invoiceCount', 'totalQuantity', 'taxable', 'gst', 'amount'],
  };
  return {
    kind: 'bill', columns: purchaseReportColumns,
    defaults: ['number', 'date', 'party', 'itemCount', 'taxable', 'gst', 'amount', 'status'],
  };
};

const expenseReportColumns = [
  ...purchaseColumns('number', 'date', 'dueDate', 'refNo', 'party', 'vendorCode', 'vendorGstin', 'branch', 'warehouse'),
  { key: 'costCentre', label: 'Cost Centre' },
  { key: 'expenseLedger', label: 'Expense Ledger' },
  { key: 'expenseCategory', label: 'Expense Category' },
  ...purchaseColumns('itemCount', 'itemDescriptions', 'subtotal', 'taxable', 'cgst', 'sgst', 'igst', 'gst', 'tdsSection', 'tdsRate', 'tdsAmount', 'amount', 'paidAmount', 'balanceAmount', 'paymentStatus', 'lastPaidDate', 'notes', 'createdAt', 'createdBy', 'invoiceCount', 'month', 'status'),
].map((column) => ({ ...column, label: ({ number: 'Expense No.', date: 'Expense Date', party: 'Vendor Name', invoiceCount: 'Expense Count' })[column.key] || column.label }));
const expenseColumnByKey = new Map(expenseReportColumns.map((column) => [column.key, column]));
const expenseColumns = (...keys) => keys.map((key) => expenseColumnByKey.get(key)).filter(Boolean);

const expenseReportPresentation = (title) => {
  const lower = String(title || '').toLowerCase();
  if (lower.includes('ledger-wise')) return { kind: 'expenseLedger', columns: expenseColumns('expenseLedger', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'), defaults: ['expenseLedger', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'] };
  if (lower.includes('category-wise')) return { kind: 'expenseCategory', columns: expenseColumns('expenseCategory', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'), defaults: ['expenseCategory', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'] };
  if (lower.includes('vendor-wise')) return { kind: 'expenseVendor', columns: expenseColumns('party', 'vendorGstin', 'invoiceCount', 'taxable', 'gst', 'amount'), defaults: ['party', 'vendorGstin', 'invoiceCount', 'taxable', 'gst', 'amount'] };
  if (lower.includes('branch-wise')) return { kind: 'expenseBranch', columns: expenseColumns('branch', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'), defaults: ['branch', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'] };
  if (lower.includes('cost centre-wise')) return { kind: 'expenseCostCentre', columns: expenseColumns('costCentre', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'), defaults: ['costCentre', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'] };
  if (lower.includes('monthly')) return { kind: 'expenseMonth', columns: expenseColumns('month', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'), defaults: ['month', 'invoiceCount', 'taxable', 'gst', 'tdsAmount', 'amount'] };
  return { kind: 'expense', columns: expenseReportColumns, defaults: ['number', 'date', 'party', 'expenseCategory', 'taxable', 'gst', 'amount', 'status'] };
};

const moneyReportColumns = [
  { key: 'number', label: 'Voucher No.' },
  { key: 'date', label: 'Date' },
  { key: 'party', label: 'Party / Ledger' },
  { key: 'cashBankLedger', label: 'Cash / Bank Ledger' },
  { key: 'mode', label: 'Mode' },
  { key: 'reference', label: 'Reference' },
  { key: 'invoiceNumbers', label: 'Invoice No.' },
  { key: 'billNumbers', label: 'Bill No.' },
  { key: 'transactionCount', label: 'Transactions', numeric: true },
  { key: 'amount', label: 'Amount (₹)', money: true },
  { key: 'allocatedAmount', label: 'Allocated (₹)', money: true },
  { key: 'advanceAmount', label: 'Advance (₹)', money: true },
  { key: 'tdsAmount', label: 'TDS (₹)', money: true },
  { key: 'netCashAmount', label: 'Cash / Bank Amount (₹)', money: true },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Narration' },
];
const moneyColumnByKey = new Map(moneyReportColumns.map((column) => [column.key, column]));
const moneyColumns = (...keys) => keys.map((key) => moneyColumnByKey.get(key)).filter(Boolean);

const moneyReportPresentation = (title) => {
  if (/^(Customer\/Ledger-wise Receipts|Vendor\/Ledger-wise Payments)$/.test(title)) return { kind: 'moneyGroupParty', columns: moneyColumns('party', 'transactionCount', 'amount', 'tdsAmount', 'netCashAmount'), defaults: ['party', 'transactionCount', 'amount', 'tdsAmount', 'netCashAmount'] };
  if (/^Bank-wise/.test(title)) return { kind: 'moneyGroupBank', columns: moneyColumns('cashBankLedger', 'transactionCount', 'amount', 'tdsAmount', 'netCashAmount'), defaults: ['cashBankLedger', 'transactionCount', 'amount', 'tdsAmount', 'netCashAmount'] };
  if (/adjusted/i.test(title)) return { kind: 'moneyDetail', columns: moneyReportColumns, defaults: ['number', 'date', 'party', title.startsWith('Invoice') ? 'invoiceNumbers' : 'billNumbers', 'allocatedAmount', 'tdsAmount', 'amount', 'status'] };
  if (/^Advance /.test(title)) return { kind: 'moneyDetail', columns: moneyReportColumns, defaults: ['number', 'date', 'party', 'cashBankLedger', 'mode', 'advanceAmount', 'amount', 'status'] };
  if (/^TDS/.test(title)) return { kind: 'moneyDetail', columns: moneyReportColumns, defaults: ['number', 'date', 'party', 'cashBankLedger', 'amount', 'tdsAmount', 'netCashAmount', 'status'] };
  return { kind: 'moneyDetail', columns: moneyReportColumns, defaults: ['number', 'date', 'party', 'cashBankLedger', 'mode', 'amount', 'tdsAmount', 'status'] };
};

const addressText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [value.addressLine1, value.addressLine2, value.street, value.city, value.state, value.pincode || value.pinCode, value.country]
    .filter(Boolean).join(', ');
};

const linkedSalesDetails = (db, invoice) => {
  const customer = (db?.customers || []).find((row) => String(row?.id) === String(invoice?.customerId)) || {};
  const order = (db?.salesOrders || []).find((row) =>
    [invoice?.salesOrderId, invoice?.sourceSalesOrderId, invoice?.sourceOrderId].filter(Boolean).some((id) => String(id) === String(row?.id)) ||
    String(row?.convertedInvoiceId || '') === String(invoice?.id || '')
  ) || {};
  const receipts = (db?.payments || []).filter((payment) =>
    Number(payment?.companyId) === Number(invoice?.companyId) &&
    (payment?.allocations || []).some((allocation) =>
      String(allocation?.voucherType || '').toLowerCase() === 'invoice' && String(allocation?.voucherId) === String(invoice?.id)
    )
  );
  const creditNotes = (db?.creditNotes || []).filter((note) =>
    String(note?.originalInvoiceId || '') === String(invoice?.id || '') ||
    String(note?.originalInvoiceNumber || '') === String(rowNumber(invoice)) ||
    (note?.invoiceIds || []).some((id) => String(id) === String(invoice?.id))
  );
  const itemsById = new Map((db?.items || []).map((item) => [String(item?.id), item]));
  const lines = Array.isArray(invoice?.items) ? invoice.items : [];
  const itemValues = (selector) => lines.map((line) => selector(line, itemsById.get(String(line?.itemId)) || {})).filter(Boolean).join(', ');
  const receiptAllocation = (receipt) => (receipt?.allocations || []).find((allocation) => String(allocation?.voucherId) === String(invoice?.id));
  return {
    customerCode: customer.code || customer.customerCode || invoice?.customerCode || '',
    customerType: customer.type || customer.customerType || '',
    customerGstin: invoice?.customerGstin || customer.gstin || '',
    customerPan: customer.pan || '',
    customerPhone: customer.mobile || customer.phone || '',
    customerEmail: customer.email || '',
    billingAddress: addressText(customer.billingAddress || customer.address),
    shippingAddress: addressText(invoice?.shippingAddress || customer.shippingAddress),
    customerCity: customer.city || customer.billingCity || '',
    customerState: customer.state || invoice?.placeOfSupplyState || '',
    creditLimit: Number(customer.creditLimit || 0),
    paymentTerms: customer.paymentTerms || customer.creditDays ? `${customer.paymentTerms || customer.creditDays}${customer.creditDays && !String(customer.paymentTerms || '').toLowerCase().includes('day') ? ' Days' : ''}` : '',
    itemCodes: itemValues((line, item) => item.code || line.itemCode),
    itemNames: itemValues((line, item) => item.name || line.itemName || line.description),
    itemDescriptions: itemValues((line, item) => line.description || item.description),
    hsnSac: itemValues((line, item) => line.hsn || line.sac || line.hsnSac || item.hsn || item.sac || item.hsnSac),
    totalQuantity: lines.reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0),
    salesOrderNumber: order.number || invoice?.salesOrderNumber || '',
    salesOrderDate: rowDate(order),
    salesOrderStatus: order.status || '',
    customerPoRef: order.customerPoRef || order.poRef || invoice?.customerPoRef || '',
    expectedDeliveryDate: order.expectedDate || order.deliveryDate || '',
    paidAmount: Number(invoice?.paidAmount || 0),
    balanceAmount: Math.max(0, rowAmount(invoice) - Number(invoice?.paidAmount || 0) - creditNotes.reduce((sum, note) => sum + (Number(note?.total) || 0), 0)),
    paymentStatus: invoice?.status || '',
    lastPaidDate: receipts.map(rowDate).filter(Boolean).sort().at(-1) || '',
    receiptNumbers: receipts.map(rowNumber).filter(Boolean).join(', '),
    receiptDates: receipts.map(rowDate).filter(Boolean).join(', '),
    receiptModes: [...new Set(receipts.map((receipt) => receipt.mode).filter(Boolean))].join(', '),
    paymentReferences: receipts.map((receipt) => receipt.reference || receipt.refNo).filter(Boolean).join(', '),
    allocatedReceiptAmount: receipts.reduce((sum, receipt) => sum + (Number(receiptAllocation(receipt)?.amount) || 0), 0),
    creditNoteNumbers: creditNotes.map(rowNumber).join(', '),
    creditNoteDates: creditNotes.map(rowDate).filter(Boolean).join(', '),
    creditNoteAmount: creditNotes.reduce((sum, note) => sum + (Number(note?.total) || 0), 0),
    creditNoteReasons: [...new Set(creditNotes.map((note) => note.reasonLabel || note.reason).filter(Boolean))].join(', '),
    creditNoteStatus: [...new Set(creditNotes.map((note) => note.status).filter(Boolean))].join(', '),
  };
};

const linkedPurchaseDetails = (db, bill) => {
  const vendor = (db?.vendors || []).find((entry) => String(entry?.id) === String(bill?.vendorId)) || {};
  const order = (db?.purchaseOrders || []).find((entry) => String(entry?.id) === String(bill?.sourcePurchaseOrderId || bill?.purchaseOrderId)) || {};
  const itemsById = new Map((db?.items || []).map((item) => [String(item?.id), item]));
  const lines = Array.isArray(bill?.items) ? bill.items : [];
  const itemValues = (select) => lines.map((line) => select(line, itemsById.get(String(line?.itemId)) || {})).filter(Boolean).join(', ');
  const payments = (db?.payments || []).filter((payment) => (payment?.allocations || []).some((allocation) =>
    String(allocation?.voucherId) === String(bill?.id) && /bill|purchase/i.test(String(allocation?.voucherType || ''))
  ));
  const debitNotes = (db?.debitNotes || []).filter((note) =>
    String(note?.originalBillId || '') === String(bill?.id) || String(note?.originalBillNumber || '') === String(rowNumber(bill))
  );
  const paidAmount = Number(bill?.paidAmount || 0) || payments.reduce((sum, payment) => sum + (payment.allocations || [])
    .filter((allocation) => String(allocation?.voucherId) === String(bill?.id))
    .reduce((value, allocation) => value + (Number(allocation?.amount) || 0), 0), 0);
  return {
    vendorCode: vendor.code || bill?.vendorCode || '',
    vendorGstin: bill?.vendorGstin || bill?.partyGstin || vendor.gstin || vendor.gstNo || '',
    itemCodes: itemValues((line, item) => item.code || line.itemCode),
    itemNames: itemValues((line, item) => item.name || line.itemName || line.description),
    itemDescriptions: itemValues((line, item) => line.description || item.description),
    hsnSac: itemValues((line, item) => line.hsn || line.sac || line.hsnSac || item.hsn || item.sac || item.hsnSac),
    totalQuantity: lines.reduce((sum, line) => sum + (Number(line?.quantity) || 0), 0),
    purchaseOrderNumber: order.number || bill?.purchaseOrderNumber || '',
    originalBillNumber: bill?.originalBillNumber || '',
    returnReason: bill?.reasonLabel || bill?.reason || '',
    paidAmount,
    balanceAmount: Math.max(0, rowAmount(bill) - paidAmount - debitNotes.reduce((sum, note) => sum + (Number(note?.total) || 0), 0)),
    paymentStatus: bill?.status || '',
    lastPaidDate: payments.map(rowDate).filter(Boolean).sort().at(-1) || '',
  };
};

const linkedExpenseDetails = (db, expense) => {
  const vendor = (db?.vendors || []).find((entry) => String(entry?.id) === String(expense?.vendorId)) || {};
  const accounts = db?.chartOfAccounts || [];
  const lines = Array.isArray(expense?.lines) ? expense.lines : [];
  const ledger = accounts.find((entry) => String(entry?.id) === String(expense?.ledgerId)) || {};
  return {
    vendorCode: vendor.code || expense?.vendorCode || '',
    vendorGstin: expense?.vendorGstin || expense?.partyGstin || vendor.gstin || vendor.gstNo || '',
    expenseLedger: expense?.ledgerName || ledger.name || lines.map((line) => line.ledgerName || accounts.find((entry) => String(entry?.id) === String(line?.ledgerId))?.name).filter(Boolean).join(', ') || 'Unassigned',
    expenseCategory: expense?.category || expense?.categoryName || 'Uncategorised',
    itemDescriptions: lines.map((line) => line.description).filter(Boolean).join(', '),
    paidAmount: Number(expense?.paidAmount || 0),
    balanceAmount: Math.max(0, rowAmount(expense) - Number(expense?.paidAmount || 0)),
    paymentStatus: expense?.status || '',
  };
};

const moneyAccountName = (db, row) => {
  const accountId = row?.cashBankAccountId || row?.bankAccountId || row?.ledgerAccountId;
  const account = [...(db?.chartOfAccounts || []), ...(db?.bankAccounts || [])].find((entry) => String(entry?.id) === String(accountId));
  return row?.cashBankAccountName || row?.bankAccountName || account?.name || row?.bankName || row?.mode || 'Unassigned';
};

const matchesMoneyReport = (db, row, title) => {
  const isCash = /cash/i.test(`${row?.mode || ''} ${moneyAccountName(db, row)}`);
  const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
  if (/^Cash /.test(title)) return isCash;
  if (/^Bank-wise/.test(title)) return !isCash;
  if (/^Advance /.test(title)) return Boolean(row?.isAdvance) || allocations.length === 0;
  if (/Invoice-adjusted/.test(title)) return allocations.some((allocation) => /invoice/i.test(String(allocation?.voucherType || '')));
  if (/Bill-adjusted/.test(title)) return allocations.some((allocation) => /bill|purchase/i.test(String(allocation?.voucherType || '')));
  if (/^TDS/.test(title)) return Number(row?.tdsAmount || 0) > 0;
  return true;
};

const linkedMoneyDetails = (db, row, source) => {
  const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
  const namesFor = (kind, collection) => allocations.filter((allocation) => kind.test(String(allocation?.voucherType || '')))
    .map((allocation) => allocation?.voucherNumber || allocation?.number || collection.find((entry) => String(entry?.id) === String(allocation?.voucherId))?.number)
    .filter(Boolean).join(', ');
  const amount = rowAmount(row);
  const allocatedAmount = Number(row?.allocatedAmount ?? allocations.reduce((sum, allocation) => sum + (Number(allocation?.amount) || 0), 0)) || 0;
  return {
    cashBankLedger: moneyAccountName(db, row),
    mode: row?.mode || '',
    reference: row?.reference || row?.refNo || row?.transactionRef || '',
    invoiceNumbers: namesFor(/invoice/i, db?.invoices || []),
    billNumbers: namesFor(/bill|purchase/i, db?.bills || []),
    allocatedAmount,
    advanceAmount: Math.max(0, amount - allocatedAmount),
    netCashAmount: Number(row?.netCashAmount ?? (source === 'receipts' ? amount - Number(row?.tdsAmount || 0) : amount)) || 0,
  };
};

export const normalizedReportRows = (db, bucket, title, scope = {}) => {
  const presentation = bucket?.source === 'sales' ? salesReportPresentation(title)
    : bucket?.source === 'purchases' ? purchaseReportPresentation(title)
      : bucket?.source === 'expenses' ? expenseReportPresentation(title)
        : ['receipts', 'payments'].includes(bucket?.source) ? moneyReportPresentation(title) : null;
  const unfilteredSourceRows = presentation?.kind === 'creditNote' ? (db?.creditNotes || [])
    : presentation?.kind === 'debitNote' ? (db?.debitNotes || []) : collectionFor(db, bucket?.source);
  const sourceRows = ['receipts', 'payments'].includes(bucket?.source)
    ? unfilteredSourceRows.filter((row) => matchesMoneyReport(db, row, title)) : unfilteredSourceRows;
  const companyMasters = (collection) => (collection || []).filter((entry) => !scope.companyId || !entry?.companyId || String(entry.companyId) === String(scope.companyId));
  const displayMasterName = (entry) => entry?.name || entry?.branchName || entry?.warehouseName || entry?.label || entry?.code || '';
  const nameFrom = (collection, id) => displayMasterName(companyMasters(collection).find((entry) => String(entry?.id) === String(id)));
  const defaultMaster = (collection, requestedId) => {
    const list = companyMasters(collection);
    return list.find((entry) => requestedId && String(entry?.id) === String(requestedId))
      || list.find((entry) => entry?.isDefault || entry?.default)
      || list[0]
      || null;
  };
  const defaultBranch = defaultMaster(db?.branches, scope.defaultBranchId);
  const defaultWarehouse = defaultMaster(db?.warehouses, scope.defaultWarehouseId);
  const defaultBranchName = displayMasterName(defaultBranch);
  const defaultWarehouseName = displayMasterName(defaultWarehouse);
  const base = sourceRows.map((row, index) => ({
    id: row?.id || `${rowNumber(row)}-${index}`,
    date: rowDate(row), number: rowNumber(row), party: rowParty(row),
    type: row?.type || row?.voucherType || bucket?.title || 'Recorded',
    status: row?.status || 'Recorded',
    branch: row?.branchName || row?.branch?.name || nameFrom(db?.branches, row?.branchId || row?.branch?.id || row?.branch) || (typeof row?.branch === 'string' ? row.branch : '') || defaultBranchName || 'Default Branch',
    branchId: String(row?.branchId || row?.branch?.id || defaultBranch?.id || ''),
    warehouse: row?.warehouseName || row?.warehouse?.name || nameFrom(db?.warehouses, row?.warehouseId || row?.warehouse?.id || row?.warehouse) || (typeof row?.warehouse === 'string' ? row.warehouse : '') || defaultWarehouseName || 'Default Warehouse',
    warehouseId: String(row?.warehouseId || row?.warehouse?.id || defaultWarehouse?.id || ''),
    itemCount: Array.isArray(row?.items) ? row.items.length : Array.isArray(row?.lines) ? row.lines.length : Number(row?.itemCount || 0),
    ...linkedSalesDetails(db, row),
    ...(bucket?.source === 'purchases' ? linkedPurchaseDetails(db, row) : {}),
    ...(bucket?.source === 'expenses' ? linkedExpenseDetails(db, row) : {}),
    ...(['receipts', 'payments'].includes(bucket?.source) ? linkedMoneyDetails(db, row, bucket.source) : {}),
    dueDate: row?.dueDate || '', refNo: row?.refNo || row?.reference || '', refDate: row?.refDate || '',
    salesperson: row?.salespersonName || row?.salesmanName || row?.salesperson || nameFrom(db?.salesmen || db?.salespersons, row?.salesmanId || row?.salespersonId) || '',
    costCentre: row?.costCenterName || row?.costCentreName || nameFrom(db?.costCenters, row?.costCenterId || row?.costCentreId) || '',
    subtotal: Number(row?.subtotal ?? row?.taxableTotal ?? row?.taxableAmount ?? 0) || 0,
    discount: Number(row?.invoiceDiscountApplied ?? row?.discountAmount ?? 0) || 0,
    otherCharges: Number(row?.otherChargesTotal ?? 0) || 0,
    taxable: Number(row?.taxableTotal ?? row?.subtotal ?? row?.taxableAmount ?? 0) || 0,
    taxType: row?.taxType || '', placeOfSupply: row?.placeOfSupplyState || row?.placeOfSupply || '', reverseCharge: row?.reverseCharge ? 'Yes' : 'No',
    cgst: Number(row?.cgstTotal || 0), sgst: Number(row?.sgstTotal || 0), igst: Number(row?.igstTotal || 0),
    gst: Number(row?.gstTotal ?? row?.taxAmount ?? row?.gst ?? 0) || 0,
    tdsSection: row?.tdsSection || '', tdsRate: Number(row?.tdsRate || 0), tdsAmount: Number(row?.tdsAmount || 0),
    originalInvoiceNumber: row?.originalInvoiceNumber || '', originalInvoiceDate: row?.originalInvoiceDate || '', creditNoteReason: row?.reasonLabel || row?.reason || '',
    notes: row?.notes || row?.narration || '', createdAt: row?.createdAt || '', updatedAt: row?.updatedAt || '', createdBy: row?.createdByName || row?.createdBy || '',
    amount: rowAmount(row), raw: row,
  })).filter((row) => !scope.companyId || !row?.raw?.companyId || String(row.raw.companyId) === String(scope.companyId))
    .filter((row) => !scope.from || !row.date || row.date >= scope.from)
    .filter((row) => !scope.to || !row.date || row.date <= scope.to)
    .filter((row) => !scope.branch || scope.branch === 'all' || row.branchId === scope.branch || row.branch === scope.branch)
    .filter((row) => !scope.warehouse || scope.warehouse === 'all' || row.warehouseId === scope.warehouse || row.warehouse === scope.warehouse);

  if (!presentation || ['invoice', 'creditNote', 'bill', 'debitNote', 'expense', 'moneyDetail'].includes(presentation.kind)) return base;

  const summarySeed = (id, values = {}) => ({
    id, invoiceCount: 0, customerCount: 0, itemCount: 0, totalQuantity: 0,
    taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, tdsAmount: 0, amount: 0,
    paidAmount: 0, balanceAmount: 0, creditNoteAmount: 0, allocatedAmount: 0, advanceAmount: 0, netCashAmount: 0,
    ...values,
    _invoiceIds: new Set(), _customerIds: new Set(), _itemIds: new Set(), _rateTotal: 0, _exportRows: [],
  });
  const addSummary = (current, row, factor = 1) => {
    current._exportRows.push(row);
    current._invoiceIds.add(String(row.id));
    current._customerIds.add(String(row.raw?.customerId || row.party));
    (row.raw?.items || []).forEach((line) => current._itemIds.add(String(line?.itemId || line?.itemCode || line?.description || '')));
    current.totalQuantity += (Number(row.totalQuantity) || 0) * factor;
    for (const key of ['taxable', 'cgst', 'sgst', 'igst', 'gst', 'tdsAmount', 'amount', 'paidAmount', 'balanceAmount', 'creditNoteAmount', 'allocatedAmount', 'advanceAmount', 'netCashAmount']) current[key] += (Number(row[key]) || 0) * factor;
    current._rateTotal += (Number(row.taxable) || 0) * factor;
  };
  const finish = (rows) => rows.map((row) => ({
    ...row,
    invoiceCount: row._invoiceIds.size,
    transactionCount: row._invoiceIds.size,
    customerCount: row._customerIds.size,
    itemCount: row._itemIds.size,
    averageInvoiceValue: row._invoiceIds.size ? row.amount / row._invoiceIds.size : 0,
    averageRate: row.totalQuantity ? row.taxable / row.totalQuantity : 0,
    _invoiceIds: undefined, _customerIds: undefined, _itemIds: undefined, _rateTotal: undefined,
  }));

  if (presentation.kind === 'moneyGroupParty' || presentation.kind === 'moneyGroupBank') {
    const grouped = new Map();
    for (const row of base) {
      const key = presentation.kind === 'moneyGroupParty' ? row.party : row.cashBankLedger;
      const current = grouped.get(key) || summarySeed(key, presentation.kind === 'moneyGroupParty' ? { party: key } : { cashBankLedger: key });
      addSummary(current, row);
      grouped.set(key, current);
    }
    return finish([...grouped.values()]);
  }

  if (presentation.kind === 'item' || presentation.kind === 'category' || presentation.kind === 'gst' || presentation.kind === 'hsn') {
    const itemsById = new Map((db?.items || []).map((item) => [String(item?.id), item]));
    const grouped = new Map();
    for (const row of base) {
      const lines = row.raw?.items || [];
      for (const line of lines) {
        const item = itemsById.get(String(line?.itemId)) || {};
        const quantity = Number(line?.quantity || 0);
        const taxable = Number(line?.taxableAmount ?? line?.amount ?? (quantity * Number(line?.rate || 0))) || 0;
        const rate = Number(line?.gstRate ?? item?.gstRate ?? 0) || 0;
        const lineGst = Number(line?.gstAmount ?? line?.taxAmount ?? (taxable * rate / 100)) || 0;
        const intra = String(row.taxType).toUpperCase() !== 'IGST';
        const hsnSac = line?.hsn || line?.sac || line?.hsnSac || item?.hsn || item?.sac || item?.hsnSac || 'Unspecified';
        const category = item?.categoryName || item?.category || line?.category || 'Uncategorised';
        const itemCode = item?.code || line?.itemCode || 'Uncoded';
        const itemName = item?.name || line?.itemName || line?.description || 'Unnamed item';
        const key = presentation.kind === 'item' ? String(line?.itemId || itemCode || itemName)
          : presentation.kind === 'category' ? category
          : presentation.kind === 'gst' ? String(rate)
          : hsnSac;
        const values = presentation.kind === 'item' ? { itemCode, itemName, itemCategory: category, hsnSac }
          : presentation.kind === 'category' ? { itemCategory: category }
          : presentation.kind === 'gst' ? { gstRate: rate }
          : { hsnSac };
        const current = grouped.get(key) || summarySeed(key, values);
        current._exportRows.push({ ...row, raw: { ...(row.raw || {}), items: [line] } });
        current._invoiceIds.add(String(row.id)); current._customerIds.add(String(row.raw?.customerId || row.party)); current._itemIds.add(String(line?.itemId || itemCode));
        current.totalQuantity += quantity; current.taxable += taxable; current.gst += lineGst; current.amount += taxable + lineGst;
        current.cgst += intra ? lineGst / 2 : 0; current.sgst += intra ? lineGst / 2 : 0; current.igst += intra ? 0 : lineGst;
        grouped.set(key, current);
      }
    }
    return finish([...grouped.values()]);
  }

  if (presentation.kind.startsWith('expense')) {
    const grouped = new Map();
    const accountsById = new Map((db?.chartOfAccounts || []).map((account) => [String(account?.id), account]));
    for (const row of base) {
      if (presentation.kind === 'expenseLedger') {
        const lines = row.raw?.lines?.length ? row.raw.lines : [{ ledgerId: row.raw?.ledgerId, ledgerName: row.expenseLedger, amount: row.taxable || row.amount }];
        const lineAmounts = lines.map((line) => Number(line?.taxableAmount ?? line?.amount ?? 0) || 0);
        const totalLineAmount = lineAmounts.reduce((sum, amount) => sum + amount, 0);
        lines.forEach((line, index) => {
          const expenseLedger = line?.ledgerName || accountsById.get(String(line?.ledgerId))?.name || row.expenseLedger || 'Unassigned';
          const share = totalLineAmount ? lineAmounts[index] / totalLineAmount : 1 / lines.length;
          const current = grouped.get(expenseLedger) || summarySeed(expenseLedger, { expenseLedger });
          current._exportRows.push({ ...row, raw: { ...row.raw, lines: [line] } });
          current._invoiceIds.add(String(row.id));
          for (const key of ['taxable', 'gst', 'tdsAmount', 'amount', 'paidAmount', 'balanceAmount']) current[key] += (Number(row[key]) || 0) * share;
          grouped.set(expenseLedger, current);
        });
        continue;
      }
      const key = presentation.kind === 'expenseCategory' ? row.expenseCategory
        : presentation.kind === 'expenseVendor' ? row.party
          : presentation.kind === 'expenseBranch' ? row.branch
            : presentation.kind === 'expenseCostCentre' ? (row.costCentre || 'Unassigned')
              : (row.date ? row.date.slice(0, 7) : 'Undated');
      const identity = presentation.kind === 'expenseCategory' ? { expenseCategory: key }
        : presentation.kind === 'expenseVendor' ? { party: key, vendorGstin: row.vendorGstin }
          : presentation.kind === 'expenseBranch' ? { branch: key }
            : presentation.kind === 'expenseCostCentre' ? { costCentre: key }
              : { month: key };
      const current = grouped.get(key) || summarySeed(key, identity);
      addSummary(current, row);
      grouped.set(key, current);
    }
    return finish([...grouped.values()]);
  }

  const grouped = new Map();
  for (const row of base) {
    const key = presentation.kind === 'customer' || presentation.kind === 'vendor' ? row.party
      : presentation.kind === 'branch' ? row.branch
      : presentation.kind === 'salesperson' ? (row.salesperson || 'Unassigned')
      : (row.date ? row.date.slice(0, 7) : 'Undated');
    const identity = presentation.kind === 'customer'
      ? { party: key, customerCode: row.customerCode, customerType: row.customerType, customerGstin: row.customerGstin, customerPan: row.customerPan, customerPhone: row.customerPhone, customerEmail: row.customerEmail, customerCity: row.customerCity, customerState: row.customerState, billingAddress: row.billingAddress, shippingAddress: row.shippingAddress, creditLimit: row.creditLimit, paymentTerms: row.paymentTerms }
      : presentation.kind === 'vendor' ? { party: key, vendorCode: row.vendorCode, vendorGstin: row.vendorGstin }
      : presentation.kind === 'branch' ? { branch: key }
      : presentation.kind === 'salesperson' ? { salesperson: key }
      : { month: key };
    const current = grouped.get(key) || summarySeed(key, identity);
    addSummary(current, row);
    if (!current.lastPaidDate || row.lastPaidDate > current.lastPaidDate) current.lastPaidDate = row.lastPaidDate;
    grouped.set(key, current);
  }
  return finish([...grouped.values()]);
};

/*
 * The screen is intentionally one row per document. Exports are working data,
 * so every item/allocation needs its own row; comma-joining item names makes
 * quantity, rate, HSN and tax impossible to analyse in Excel. This expander is
 * source-agnostic and therefore applies to sales, purchases, returns,
 * expenses, journals, receipts and payments whenever their source document
 * carries detail lines.
 */
export const expandReportRowsForExport = (rows, db) => {
  const itemsById = new Map((db?.items || []).map((item) => [String(item?.id), item]));
  const accountsById = new Map((db?.chartOfAccounts || []).map((account) => [String(account?.id), account]));
  const expanded = [];
  let hasDetails = false;

  // Grouped screens (customer, branch, month, category, GST, HSN and so on)
  // retain their contributing document rows solely for export. The UI still
  // receives and displays the single aggregate row.
  const sourceRows = rows.flatMap((row) => Array.isArray(row?._exportRows) && row._exportRows.length ? row._exportRows : [row]);
  for (const row of sourceRows) {
    const raw = row?.raw || {};
    const details = Array.isArray(raw.items) && raw.items.length ? raw.items
      : Array.isArray(raw.lines) && raw.lines.length ? raw.lines
      : Array.isArray(raw.allocations) && raw.allocations.length ? raw.allocations
      : [];
    if (!details.length) { expanded.push(row); continue; }
    hasDetails = true;
    details.forEach((line, index) => {
      const item = itemsById.get(String(line?.itemId ?? line?.productId ?? '')) || {};
      const account = accountsById.get(String(line?.accountId ?? line?.ledgerId ?? '')) || {};
      const quantity = Number(line?.quantity ?? line?.qty ?? 0) || 0;
      const rate = Number(line?.rate ?? line?.unitRate ?? line?.price ?? 0) || 0;
      const discount = Number(line?.discountAmount ?? line?.discount ?? 0) || 0;
      const taxable = Number(line?.taxableAmount ?? line?.taxable ?? line?.amount ?? (quantity * rate - discount)) || 0;
      const gstRate = Number(line?.gstRate ?? line?.taxRate ?? item?.gstRate ?? 0) || 0;
      const gst = Number(line?.gstAmount ?? line?.taxAmount ?? (taxable * gstRate / 100)) || 0;
      const isIgst = String(row?.taxType || '').toUpperCase() === 'IGST';
      const total = Number(line?.total ?? line?.lineTotal ?? line?.grossAmount ?? (taxable + gst)) || 0;
      const itemCode = item?.code || line?.itemCode || line?.code || account?.code || '';
      const itemName = item?.name || line?.itemName || line?.name || line?.description || account?.name || line?.ledgerName || '';
      const itemDescription = line?.description || item?.description || line?.narration || '';
      expanded.push({
        ...row,
        exportLineNo: index + 1,
        // Override both the singular detail fields and the older plural
        // invoice fields. A saved layout may contain either set; every one of
        // them must describe only this export row's item.
        itemCode,
        itemCodes: itemCode,
        itemName,
        itemNames: itemName,
        itemDescription,
        itemDescriptions: itemDescription,
        itemCount: 1,
        hsnSac: line?.hsn || line?.sac || line?.hsnSac || item?.hsn || item?.sac || item?.hsnSac || '',
        quantity,
        totalQuantity: quantity,
        unit: line?.unit || item?.unit || item?.uom || '',
        rate,
        lineDiscount: discount,
        gstRate,
        taxable,
        cgst: Number(line?.cgstAmount ?? (isIgst ? 0 : gst / 2)) || 0,
        sgst: Number(line?.sgstAmount ?? (isIgst ? 0 : gst / 2)) || 0,
        igst: Number(line?.igstAmount ?? (isIgst ? gst : 0)) || 0,
        gst,
        amount: total,
      });
    });
  }
  return { rows: expanded, hasDetails };
};

const exportLineColumns = [
  { key: 'exportLineNo', label: 'Line No.' },
  { key: 'itemCode', label: 'Item / Ledger Code' },
  { key: 'itemName', label: 'Item / Ledger Name' },
  { key: 'itemDescription', label: 'Line Description' },
  { key: 'hsnSac', label: 'HSN / SAC' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'unit', label: 'Unit' },
  { key: 'rate', label: 'Rate' },
  { key: 'lineDiscount', label: 'Line Discount' },
  { key: 'gstRate', label: 'GST Rate (%)' },
];

const detailedExportColumns = (columns, hasDetails) => {
  const base = columns.filter((column) => column.key !== 'action');
  if (!hasDetails) return base;
  const keys = new Set(base.map((column) => column.key));
  return [...base, ...exportLineColumns.filter((column) => !keys.has(column.key))];
};

const GenericReport = ({ title, bucket, db, currentCompany, onBack, isEnabled = () => true, defaultBranchId = '', defaultWarehouseId = '', customerScope = null, itemScope = null, breakdownScope = null, initialPeriod = 'all', initialFrom = '', initialTo = '' }) => {
  const displayTitle = title === 'Sales Register' || title === 'Sales Invoice Register' ? 'Sales Report' : title;
  const purchaseReport = bucket?.source === 'purchases';
  const expenseReport = bucket?.source === 'expenses';
  const receiptReport = bucket?.source === 'receipts';
  const paymentReport = bucket?.source === 'payments';
  const registerTitle = receiptReport ? 'Receipt Register' : paymentReport ? 'Payment Register' : expenseReport ? 'Expense Register' : purchaseReport ? 'Purchase Register' : 'Sales Report';
  const customerSummary = ['Customer-wise Sales', 'Vendor-wise Purchase'].includes(title);
  const itemSummary = ['Item-wise Sales', 'Item-wise Purchase'].includes(title);
  const groupedSalesSummary = ['Category-wise Sales', 'Salesperson-wise Sales', 'Monthly Sales Summary', 'Category-wise Purchase', 'Monthly Purchase Summary', 'Expense Ledger-wise', 'Expense Category-wise', 'Vendor-wise Expense', 'Branch-wise Expense', 'Cost Centre-wise Expense', 'Monthly Expense Analysis', 'Customer/Ledger-wise Receipts', 'Bank-wise Receipts', 'Vendor/Ledger-wise Payments', 'Bank-wise Payments'].includes(title);
  const compactSalesReport = purchaseReport || expenseReport || receiptReport || paymentReport || displayTitle === 'Sales Report' || title === 'Sales Return Register' || customerSummary || itemSummary || groupedSalesSummary;
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState(initialPeriod);
  const [from, setFrom] = useState(initialFrom); const [to, setTo] = useState(initialTo);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedBreakdown, setSelectedBreakdown] = useState(null);
  const [draftFrom, setDraftFrom] = useState(''); const [draftTo, setDraftTo] = useState('');
  const [customPeriodOpen, setCustomPeriodOpen] = useState(false);
  const [branch, setBranch] = useState(() => String(defaultBranchId || db?.branches?.[0]?.id || db?.branches?.[0]?.name || ''));
  const [warehouse, setWarehouse] = useState(() => String(defaultWarehouseId || db?.warehouses?.[0]?.id || db?.warehouses?.[0]?.name || ''));
  const [exportOpen, setExportOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const reportActionsRef = useRef(null);
  const periodControlRef = useRef(null);
  const tableScrollRef = useRef(null);
  const columnFilters = useColumnFilters();
  const salesPresentation = bucket?.source === 'sales' ? salesReportPresentation(title)
    : purchaseReport ? purchaseReportPresentation(title)
      : expenseReport ? expenseReportPresentation(title)
        : receiptReport || paymentReport ? moneyReportPresentation(title) : null;
  const allColumns = customerSummary || itemSummary || groupedSalesSummary
    ? salesPresentation.columns.map((column) => ({ ...column, label: ({ customerGstin: 'GSTIN', vendorGstin: 'GSTIN', itemCategory: 'Category', itemCount: 'Items', customerCount: 'Customers', invoiceCount: expenseReport ? 'Expense Count' : customerSummary ? (purchaseReport ? 'Bill Count' : 'Invoice Count') : (purchaseReport ? 'Bills' : 'Invoices'), totalQuantity: purchaseReport ? 'Qty Purchased' : 'Qty Sold', taxable: 'Taxable Value (₹)', amount: 'Amount (₹)' })[column.key] || column.label }))
    : salesPresentation?.columns || genericReportColumns;
  const defaultColumnKeys = salesPresentation?.defaults || allColumns.map((column) => column.key);
  const canonicalLayoutTitle = ['Sales Register', 'Sales Invoice Register', 'Sales Report'].includes(title) ? 'Sales Report' : title;
  const layoutGroup = String(bucket?.source || bucket?.title || canonicalLayoutTitle).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const groupReportTitles = Object.values(BUCKETS)
    .filter((entry) => String(entry?.source || '') === String(bucket?.source || ''))
    .flatMap((entry) => (entry?.reports || []).map((item) => item.name));
  const legacyLayoutTitles = [...new Set([
    canonicalLayoutTitle,
    title,
    displayTitle,
    ...groupReportTitles,
    ...(canonicalLayoutTitle === 'Sales Report' ? ['Sales Register', 'Sales Invoice Register'] : []),
  ])];
  const layoutKey = `report-layout:${customerSummary || itemSummary || groupedSalesSummary ? 'v4' : 'v3'}:${canonicalLayoutTitle}`;
  const savedLayoutsKey = `report-saved-layouts:v3:group:${layoutGroup}`;
  const columnWidthsKey = `report-column-widths:v2:${canonicalLayoutTitle}`;
  const readStoredJson = (keys, fallback) => {
    for (const key of keys) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (value !== null) return value;
      } catch { /* Continue to the next compatible key. */ }
    }
    return fallback;
  };
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [layoutEditor, setLayoutEditor] = useState(null);
  const [layoutSearch, setLayoutSearch] = useState('');
  const [draggedColumn, setDraggedColumn] = useState('');
  const [dragOverColumn, setDragOverColumn] = useState('');
  const [dragOverAfter, setDragOverAfter] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState(() => {
    const keys = legacyLayoutTitles.flatMap((name) => [
      `report-saved-layouts:v2:${name}`,
      `report-saved-layouts:v1:${name}`,
      `report-saved-layouts:${name}`,
    ]);
    keys.unshift(savedLayoutsKey);
    const merged = [];
    for (const key of keys) {
      const layouts = readStoredJson([key], []);
      if (!Array.isArray(layouts)) continue;
      for (const layout of layouts) {
        if (!layout || !Array.isArray(layout.columns)) continue;
        if (!merged.some((item) => String(item.id) === String(layout.id) || item.name === layout.name)) merged.push(layout);
      }
    }
    if (merged.length) localStorage.setItem(savedLayoutsKey, JSON.stringify(merged));
    return merged;
  });
  const [activeLayoutId, setActiveLayoutId] = useState('default');
  const [columnWidths, setColumnWidths] = useState(() => {
    return readStoredJson(legacyLayoutTitles.flatMap((name) => [`report-column-widths:v2:${name}`, `report-column-widths:v1:${name}`]), {});
  });
  const [visibleColumns, setVisibleColumns] = useState(() => {
    const stored = readStoredJson(customerSummary || itemSummary || groupedSalesSummary ? [layoutKey] : legacyLayoutTitles.flatMap((name) => [
      `report-layout:v3:${name}`,
      `report-layout:v2:${name}`,
      `report-layout:v1:${name}`,
      `report-layout:${name}`,
    ]), null);
    if (Array.isArray(stored) && stored.length) {
      localStorage.setItem(layoutKey, JSON.stringify(stored));
      return stored;
    }
    return defaultColumnKeys;
  });
  useEffect(() => {
    const closeOutside = (event) => {
      if ((layoutOpen || exportOpen) && !reportActionsRef.current?.contains(event.target)) {
        setLayoutOpen(false);
        setExportOpen(false);
      }
      if (rowMenu && !event.target.closest?.('[data-report-row-menu]')) setRowMenu('');
      if (customPeriodOpen && !periodControlRef.current?.contains(event.target)) setCustomPeriodOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setLayoutOpen(false); setExportOpen(false); setRowMenu(''); setLayoutEditor(null); setCustomPeriodOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [customPeriodOpen, exportOpen, layoutOpen, rowMenu]);
  const periodBounds = useMemo(() => {
    const now = new Date(); const iso = (date) => date.toISOString().slice(0, 10);
    if (period === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    if (period === 'quarter') return { from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: iso(now) };
    if (period === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    return period === 'custom' ? { from, to } : { from: '', to: '' };
  }, [from, period, to]);
  const periodDateLabel = (value, fallback) => value ? value.split('-').reverse().join('-') : fallback;
  const rows = useMemo(() => {
    const companyId = currentCompany?.id;
    const needle = query.trim().toLowerCase();
    return normalizedReportRows(db, bucket, title, { companyId, from: periodBounds.from, to: periodBounds.to, branch: compactSalesReport ? '' : branch, warehouse: compactSalesReport ? '' : warehouse, defaultBranchId, defaultWarehouseId })
      .filter((row) => !customerScope || String(row.party) === String(customerScope.party))
      .filter((row) => !itemScope || (row.raw?.items || []).some((line) => {
        const item = (db?.items || []).find((entry) => String(entry?.id) === String(line?.itemId)) || {};
        return String(line?.itemId || item?.code || line?.itemCode || 'Uncoded') === String(itemScope.id);
      }))
      .filter((row) => !breakdownScope || (
        breakdownScope.kind === 'moneyGroupParty' ? String(row.party) === String(breakdownScope.value)
          : breakdownScope.kind === 'moneyGroupBank' ? String(row.cashBankLedger) === String(breakdownScope.value)
          : breakdownScope.kind === 'category'
          ? (row.raw?.items || []).some((line) => {
            const item = (db?.items || []).find((entry) => String(entry?.id) === String(line?.itemId)) || {};
            return String(item?.categoryName || item?.category || line?.category || 'Uncategorised') === String(breakdownScope.value);
          })
          : breakdownScope.kind === 'salesperson'
            ? String(row.salesperson || 'Unassigned') === String(breakdownScope.value)
            : breakdownScope.kind === 'expenseLedger'
              ? (row.raw?.lines?.length ? row.raw.lines : [{ ledgerId: row.raw?.ledgerId, ledgerName: row.expenseLedger }]).some((line) =>
                String(line?.ledgerName || (db?.chartOfAccounts || []).find((entry) => String(entry?.id) === String(line?.ledgerId))?.name || row.expenseLedger || 'Unassigned') === String(breakdownScope.value))
              : breakdownScope.kind === 'expenseCategory' ? String(row.expenseCategory) === String(breakdownScope.value)
                : breakdownScope.kind === 'expenseVendor' ? String(row.party) === String(breakdownScope.value)
                  : breakdownScope.kind === 'expenseBranch' ? String(row.branch) === String(breakdownScope.value)
                    : breakdownScope.kind === 'expenseCostCentre' ? String(row.costCentre || 'Unassigned') === String(breakdownScope.value)
            : String(row.date ? row.date.slice(0, 7) : 'Undated') === String(breakdownScope.value)
      ))
      .filter((row) => !needle || allColumns.some((column) => String(row[column.key] ?? '').toLowerCase().includes(needle)));
  }, [allColumns, branch, breakdownScope, bucket, currentCompany?.id, customerScope, db, defaultBranchId, defaultWarehouseId, itemScope, periodBounds, query, compactSalesReport, title, warehouse]);
  const columns = visibleColumns.map((key) => allColumns.find((column) => column.key === key)).filter(Boolean);
  const availableColumnKeys = new Set(allColumns.map((column) => column.key));
  const compatibleLayouts = savedLayouts
    .map((layout) => ({ ...layout, compatibleColumns: layout.columns.filter((key) => availableColumnKeys.has(key)) }))
    .filter((layout) => layout.compatibleColumns.length > 0);
  const widthFor = (column) => Math.max(
    Number(columnWidths[column.key] || 0),
    column.key === 'party' ? 190 : column.key === 'action' ? 82 : Math.max(92, column.label.length * 7.5 + 38),
  );
  const branches = Array.isArray(db?.branches) ? db.branches : [];
  const warehouses = Array.isArray(db?.warehouses) ? db.warehouses : [];
  const branchesEnabled = isEnabled('branches');
  const warehousesEnabled = isEnabled('warehouses');
  const columnExtractors = Object.fromEntries(allColumns.filter((column) => column.key !== 'action').map((column) => [column.key, (row) => row[column.key]]));
  const filteredRows = columnFilters.apply(rows, columnExtractors);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const exportCsv = () => {
    const expanded = expandReportRowsForExport(filteredRows, db);
    const exportColumns = detailedExportColumns(columns, expanded.hasDetails);
    const csv = [exportColumns.map((c) => c.label), ...expanded.rows.map((row) => exportColumns.map((c) => row[c.key] ?? ''))]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const exportExcel = () => {
    const expanded = expandReportRowsForExport(filteredRows, db);
    const exportColumns = detailedExportColumns(columns, expanded.hasDetails);
    const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const table = `<table><thead><tr>${exportColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${expanded.rows.map((row) => `<tr>${exportColumns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([table], { type: 'application/vnd.ms-excel' }));
    link.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xls`; link.click(); URL.revokeObjectURL(link.href);
  };
  const openLayoutEditor = (layout = null) => {
    const compatibleColumns = layout?.columns?.filter((key) => availableColumnKeys.has(key));
    setLayoutEditor({
      id: layout?.id || `layout-${Date.now()}`,
      name: layout?.name || 'New layout',
      columns: [...(compatibleColumns?.length ? compatibleColumns : visibleColumns)],
      isNew: !layout,
    });
    setLayoutOpen(false);
    setLayoutSearch('');
  };
  const saveLayout = () => {
    if (!layoutEditor) return;
    const clean = { id: layoutEditor.id, name: layoutEditor.name.trim() || 'Custom layout', columns: layoutEditor.columns };
    const next = layoutEditor.isNew ? [...savedLayouts, clean] : savedLayouts.map((layout) => layout.id === clean.id ? clean : layout);
    setSavedLayouts(next);
    localStorage.setItem(savedLayoutsKey, JSON.stringify(next));
    localStorage.setItem(layoutKey, JSON.stringify(clean.columns));
    setVisibleColumns(clean.columns);
    setActiveLayoutId(clean.id);
    setLayoutEditor(null);
  };
  const dropLayoutColumn = (targetKey, placeAfter = false) => {
    if (!draggedColumn || draggedColumn === targetKey) {
      setDraggedColumn(''); setDragOverColumn(''); setDragOverAfter(false); return;
    }
    setLayoutEditor((current) => {
      const columns = current.columns.filter((key) => key !== draggedColumn);
      const target = columns.indexOf(targetKey);
      columns.splice(target < 0 ? columns.length : target + (placeAfter ? 1 : 0), 0, draggedColumn);
      return { ...current, columns };
    });
    setDraggedColumn(''); setDragOverColumn(''); setDragOverAfter(false);
  };
  const startColumnResize = (event, key) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const column = allColumns.find((item) => item.key === key);
    const minimumWidth = column ? (column.key === 'party' ? 190 : column.key === 'action' ? 82 : Math.max(92, column.label.length * 7.5 + 38)) : 92;
    const startWidth = columnWidths[key] || event.currentTarget.parentElement?.getBoundingClientRect().width || minimumWidth;
    const onMove = (moveEvent) => {
      const width = Math.max(minimumWidth, Math.round(startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [key]: width }));
    };
    const onUp = (upEvent) => {
      const clientX = Number.isFinite(upEvent.clientX) ? upEvent.clientX : startX;
      const width = Math.max(minimumWidth, Math.round(startWidth + clientX - startX));
      setColumnWidths((current) => {
        const next = { ...current, [key]: width };
        localStorage.setItem(columnWidthsKey, JSON.stringify(next));
        return next;
      });
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-resizing-report-column');
    };
    document.body.classList.add('is-resizing-report-column');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  useEffect(() => {
    if (!compactSalesReport) return undefined;
    const fitTable = () => {
      const element = tableScrollRef.current;
      if (!element) return;
      const height = Math.max(160, window.innerHeight - element.getBoundingClientRect().top - 16);
      element.style.setProperty('height', `${height}px`, 'important');
      element.style.setProperty('max-height', `${height}px`, 'important');
    };
    const frame = requestAnimationFrame(fitTable);
    window.addEventListener('resize', fitTable);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fitTable);
    };
  }, [compactSalesReport]);

  const periodControl = <div ref={periodControlRef} className="relative" style={{ width: compactSalesReport ? 132 : 210, flex: compactSalesReport ? '0 0 132px' : '0 0 210px' }}>
    <select aria-label="Report period" className="ui-select h-8 w-full text-xs" value={period} onClick={() => { if (period === 'custom') { setDraftFrom(from); setDraftTo(to); setCustomPeriodOpen(true); } }} onChange={(event) => { const value = event.target.value; setPeriod(value); if (value === 'custom') { setDraftFrom(from); setDraftTo(to); setCustomPeriodOpen(true); } else setCustomPeriodOpen(false); setPage(1); }}><option value="all">All periods</option><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option><option value="custom">{from || to ? `${periodDateLabel(from, 'Start')} – ${periodDateLabel(to, 'Today')}` : 'Custom period'}</option></select>
    {customPeriodOpen ? <div className="absolute start-0 top-[calc(100%+0.4rem)] z-40 w-80 rounded-xl border bg-[rgb(var(--surface))] p-4 shadow-xl ui-border-c" role="dialog" aria-label="Select custom report period">
      <div className="mb-3 text-sm font-bold">Custom period</div>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold ui-muted">From<input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} className="ui-input mt-1 w-full text-sm" aria-label="Report custom period from" /></label><label className="text-sm font-semibold ui-muted">To<input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} min={draftFrom || undefined} className="ui-input mt-1 w-full text-sm" aria-label="Report custom period to" /></label></div>
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setCustomPeriodOpen(false)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => { setFrom(draftFrom); setTo(draftTo); setCustomPeriodOpen(false); setPage(1); }}>Apply</button></div>
    </div> : null}
  </div>;
  const searchControl = <label className="relative block shrink-0" style={{ width: compactSalesReport ? 224 : 290 }}>
    <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 ui-subtle" aria-hidden="true" />
    <input aria-label="Search report" className="ui-input h-8 w-full ps-9 text-xs" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={receiptReport ? 'Search receipt, customer, account…' : paymentReport ? 'Search payment, vendor, account…' : expenseReport ? 'Search expense, vendor, ledger…' : purchaseReport ? 'Search bill, vendor, item, reference…' : 'Search invoice, customer, item, reference…'} />
  </label>;

  if (selectedCustomer || selectedItem || selectedBreakdown) return <GenericReport
    key={selectedCustomer?.party || selectedItem?.id || `${selectedBreakdown?.kind}:${selectedBreakdown?.value}`}
    title={receiptReport ? 'Receipt Register' : paymentReport ? 'Payment Register' : expenseReport ? 'Expense Register' : purchaseReport ? 'Purchase Register' : 'Sales Register'}
    bucket={bucket}
    db={db}
    currentCompany={currentCompany}
    onBack={() => { setSelectedCustomer(null); setSelectedItem(null); setSelectedBreakdown(null); }}
    isEnabled={isEnabled}
    defaultBranchId={defaultBranchId}
    defaultWarehouseId={defaultWarehouseId}
    customerScope={selectedCustomer}
    itemScope={selectedItem}
    breakdownScope={selectedBreakdown}
    initialPeriod={period}
    initialFrom={from}
    initialTo={to}
  />;

  return (
    <div className={`min-w-0 w-full flex-1 ${compactSalesReport ? 'space-y-2 p-3 lg:p-4' : 'space-y-3'}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${compactSalesReport ? 'ui-page-heading' : 'rounded-lg bg-[rgb(var(--heading-bg))] px-3 py-2'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className="ui-icon-btn shrink-0" onClick={onBack} aria-label={customerScope ? `Back to ${purchaseReport ? 'Vendor-wise Purchase' : 'Customer-wise Sales'}` : itemScope ? `Back to ${purchaseReport ? 'Item-wise Purchase' : 'Item-wise Sales'}` : breakdownScope ? `Back to ${breakdownScope.reportTitle}` : 'Back to Reports'} title={customerScope ? `Back to ${purchaseReport ? 'Vendor-wise Purchase' : 'Customer-wise Sales'}` : itemScope ? `Back to ${purchaseReport ? 'Item-wise Purchase' : 'Item-wise Sales'}` : breakdownScope ? `Back to ${breakdownScope.reportTitle}` : 'Back to Reports'}><ArrowLeft size={16} /></button>
          <div>
            <h2 className="ui-t-page leading-tight">{customerScope ? `${customerScope.party} — ${registerTitle}` : itemScope ? `${itemScope.name} — ${registerTitle}` : breakdownScope ? `${breakdownScope.value} — ${registerTitle}` : displayTitle}</h2>
          </div>
        </div>
        <div ref={reportActionsRef} className="relative flex flex-wrap items-center gap-2">
          {compactSalesReport ? <>{searchControl}{periodControl}</> : null}
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setExportOpen(false); setLayoutOpen((open) => !open); }}><SlidersHorizontal size={14} /> Layout <ChevronDown size={13} /></button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setLayoutOpen(false); setExportOpen((open) => !open); }}><Download size={14} /> Export <ChevronDown size={13} /></button>
          {layoutOpen ? <div className="absolute end-44 top-10 z-40 w-72 rounded-xl border ui-border-c bg-[rgb(var(--surface))] p-2 shadow-xl">
            <div className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-wide ui-muted">Saved layouts</div>
            <button type="button" className={`report-layout-choice ${activeLayoutId === 'default' ? 'is-active' : ''}`} onClick={() => { const keys = defaultColumnKeys; setVisibleColumns(keys); localStorage.setItem(layoutKey, JSON.stringify(keys)); setActiveLayoutId('default'); setLayoutOpen(false); }}><span><strong>Default layout</strong><small>Essential report columns</small></span><span aria-hidden="true">{activeLayoutId === 'default' ? '✓' : ''}</span></button>
            {compatibleLayouts.map((layout) => <div key={layout.id} className={`report-layout-choice ${activeLayoutId === layout.id ? 'is-active' : ''}`}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setVisibleColumns(layout.compatibleColumns); localStorage.setItem(layoutKey, JSON.stringify(layout.compatibleColumns)); setActiveLayoutId(layout.id); setLayoutOpen(false); }}><strong className="block truncate">{layout.name}</strong><small>{layout.compatibleColumns.length} compatible column{layout.compatibleColumns.length === 1 ? '' : 's'}</small></button><button type="button" className="ui-link px-2" onClick={() => openLayoutEditor(layout)}>Edit</button></div>)}
            <div className="mt-2 border-t ui-border-c pt-2"><button type="button" className="ui-btn ui-btn-primary ui-btn-sm w-full" onClick={() => openLayoutEditor()}>+ Create new layout</button></div>
          </div> : null}
          {exportOpen ? <div className="absolute end-10 top-10 z-40 w-36 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-1 shadow-lg"><button type="button" className="report-menu-item" onClick={() => { exportExcel(); setExportOpen(false); }}>Excel</button><button type="button" className="report-menu-item" onClick={() => { window.print(); setExportOpen(false); }}>PDF</button><button type="button" className="report-menu-item" onClick={() => { exportCsv(); setExportOpen(false); }}>CSV</button></div> : null}
        </div>
      </div>

      {layoutEditor ? <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center ui-scrim p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Customize Layout" onPointerDown={(event) => { if (event.target === event.currentTarget) setLayoutEditor(null); }}><div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border ui-border-c bg-[rgb(var(--surface))] shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex flex-none items-start justify-between gap-4 border-b ui-border-c px-5 py-3"><div className="min-w-0"><h3 className="text-xl font-bold text-[rgb(var(--fg))]">Customize Layout</h3><p className="truncate text-sm ui-muted">Choose and arrange the columns to display in the {displayTitle}.</p></div><div className="flex flex-none items-center gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setLayoutEditor(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={!layoutEditor.columns.length} onClick={saveLayout}>Save</button></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b ui-border-c px-5 py-3"><label className="block max-w-sm"><span className="mb-1 block text-sm font-semibold">Layout name</span><input className="ui-input h-9 w-full text-sm" value={layoutEditor.name} onChange={(event) => setLayoutEditor((current) => ({ ...current, name: event.target.value }))} /></label></div>
        <div className="grid grid-cols-[230px_1fr] gap-4 p-4">
          <section className="rounded-lg border ui-border-c p-3"><div className="relative mb-3"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 ui-muted" /><input className="ui-input h-9 w-full ps-9 text-sm" placeholder="Search columns…" value={layoutSearch} onChange={(event) => setLayoutSearch(event.target.value)} /></div><h4 className="mb-2 text-sm font-bold">Available Columns</h4><div className="max-h-72 space-y-1 overflow-y-auto">{allColumns.filter((column) => column.label.toLowerCase().includes(layoutSearch.toLowerCase())).map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-sm ui-hover-sunken"><input type="checkbox" className="ui-checkbox" checked={layoutEditor.columns.includes(column.key)} onChange={() => setLayoutEditor((current) => ({ ...current, columns: current.columns.includes(column.key) ? current.columns.filter((key) => key !== column.key) : [...current.columns, column.key] }))} />{column.label}</label>)}</div></section>
          <section className="rounded-lg border ui-border-c p-3"><div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-bold">Selected Columns <span className="font-normal ui-muted">(drag to reorder)</span></h4><button type="button" className="ui-link text-sm" onClick={() => setLayoutEditor((current) => ({ ...current, columns: [...defaultColumnKeys] }))}>Reset to Default</button></div><div className="overflow-hidden rounded-lg border ui-border-c">{layoutEditor.columns.map((key) => { const column = allColumns.find((item) => item.key === key); if (!column) return null; return <div key={key} draggable onDragStart={(event) => { setDraggedColumn(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const rect = event.currentTarget.getBoundingClientRect(); setDragOverAfter(event.clientY > rect.top + rect.height / 2); setDragOverColumn(key); }} onDragLeave={() => setDragOverColumn((current) => current === key ? '' : current)} onDrop={(event) => { event.preventDefault(); dropLayoutColumn(key, dragOverAfter); }} onDragEnd={() => { setDraggedColumn(''); setDragOverColumn(''); setDragOverAfter(false); }} className={`report-layout-drag-row ${draggedColumn === key ? 'is-dragging' : ''} ${dragOverColumn === key && draggedColumn !== key ? (dragOverAfter ? 'is-drop-target-after' : 'is-drop-target') : ''}`}><span className="report-layout-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span><span className="min-w-0 flex-1 font-medium">{column.label}</span><span className="text-sm ui-muted">Show</span><button type="button" className="ui-icon-btn h-7 w-7" onClick={() => setLayoutEditor((current) => ({ ...current, columns: current.columns.filter((item) => item !== key) }))} aria-label={`Remove ${column.label}`}>×</button></div>; })}</div></section>
        </div>
        </div>
      </div></div> : null}

      {!compactSalesReport ? <div className="flex flex-nowrap items-center gap-2 py-2">
        {periodControl}
        <select aria-label={branchesEnabled ? 'Branch' : 'Default branch (locked)'} disabled={!branchesEnabled || branches.length <= 1} className="ui-select h-8 text-xs" style={{ width: 145, flex: '0 0 145px' }} value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}>{branches.map((item) => <option key={item.id || item.name} value={String(item.id || item.name)}>{item.name || item.branchName}</option>)}</select>
        <select aria-label={warehousesEnabled ? 'Warehouse' : 'Default warehouse (locked)'} disabled={!warehousesEnabled || warehouses.length <= 1} className="ui-select h-8 text-xs" style={{ width: 145, flex: '0 0 145px' }} value={warehouse} onChange={(event) => { setWarehouse(event.target.value); setPage(1); }}>{warehouses.map((item) => <option key={item.id || item.name} value={String(item.id || item.name)}>{item.name || item.warehouseName}</option>)}</select>
        <div className="ms-auto flex min-w-0 items-center justify-end gap-2">{searchControl}</div>
          </div> : null}

      <div className="relative w-full">
      <div ref={tableScrollRef} data-fill-viewport className="ui-table-scroll w-full overflow-auto rounded-lg border ui-border-c pb-12">
        <table className="ui-table ui-table-sticky" data-no-column-resize="true" style={{ width: Math.max(760, columns.reduce((sum, column) => sum + widthFor(column), 0)), minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>{columns.map((column) => <col key={column.key} style={{ width: widthFor(column) }} />)}</colgroup>
          <thead>
            <tr>{columns.map((column) => column.key === 'action'
              ? <th key={column.key} className="relative whitespace-nowrap">{column.label}<span role="separator" aria-orientation="vertical" aria-label={`Resize ${column.label} column`} className="report-column-resizer" onPointerDown={(event) => startColumnResize(event, column.key)} /></th>
              : <ColumnHeader key={column.key} label={column.label} col={column.key} state={columnFilters} type={column.key.toLowerCase().includes('date') || column.key.endsWith('At') ? 'date' : column.money || column.numeric ? 'number' : column.key.toLowerCase().includes('status') ? 'choice' : 'text'} className={`${column.money || column.numeric ? 'ui-num ' : ''}whitespace-nowrap ${compactSalesReport && columnFilters.filters[column.key] ? 'sales-report-filter-active' : ''}`} align={column.money || column.numeric ? 'right' : 'left'} onResizeStart={startColumnResize} />)}</tr>
          </thead>
          <tbody>
            {pageRows.length ? pageRows.map((row, index) => (
              <tr key={row.id || index}>{columns.map((column) => <td key={column.key} className={column.money || column.numeric ? 'ui-num ui-money whitespace-nowrap' : ''}>{column.key === 'action' ? <div className="relative flex justify-center" data-report-row-menu><button type="button" className="ui-icon-btn" aria-label={`Actions for ${row.number}`} onClick={() => setRowMenu((current) => current === row.id ? '' : row.id)}><MoreVertical size={14} /></button>{rowMenu === row.id ? <div className="absolute end-8 top-0 z-30 w-40 rounded-lg border ui-border-c bg-[rgb(var(--surface))] p-1 text-start shadow-lg"><button className="report-menu-item" type="button">View</button><button className="report-menu-item" type="button">Edit</button><button className="report-menu-item" type="button" onClick={() => window.print()}>Print</button><button className="report-menu-item" type="button" onClick={() => window.print()}>Download PDF</button></div> : null}</div> : customerSummary && column.key === 'party' ? <button type="button" className="text-left font-medium text-[rgb(var(--brand-ink))] hover:underline" onClick={() => { setSelectedCustomer({ party: row.party }); setPage(1); }}>{row.party}</button> : itemSummary && column.key === 'itemName' ? <button type="button" className="text-left font-medium text-[rgb(var(--brand-ink))] hover:underline" onClick={() => { setSelectedItem({ id: row.id, name: row.itemName }); setPage(1); }}>{row.itemName}</button> : groupedSalesSummary && column.key === ({ 'Category-wise Sales': 'itemCategory', 'Salesperson-wise Sales': 'salesperson', 'Monthly Sales Summary': 'month', 'Category-wise Purchase': 'itemCategory', 'Monthly Purchase Summary': 'month', 'Expense Ledger-wise': 'expenseLedger', 'Expense Category-wise': 'expenseCategory', 'Vendor-wise Expense': 'party', 'Branch-wise Expense': 'branch', 'Cost Centre-wise Expense': 'costCentre', 'Monthly Expense Analysis': 'month', 'Customer/Ledger-wise Receipts': 'party', 'Bank-wise Receipts': 'cashBankLedger', 'Vendor/Ledger-wise Payments': 'party', 'Bank-wise Payments': 'cashBankLedger' })[title] ? <button type="button" className="text-left font-medium text-[rgb(var(--brand-ink))] hover:underline" onClick={() => { setSelectedBreakdown({ kind: salesPresentation.kind, value: row[column.key], reportTitle: title }); setPage(1); }}>{row[column.key]}</button> : column.key === 'number' ? <button type="button" className="ui-mono font-medium text-[rgb(var(--brand-ink))] hover:underline">{row[column.key] || '—'}</button> : column.key === 'status' ? <span className={`report-status report-status-${String(row[column.key] || 'recorded').toLowerCase().replace(/\s+/g, '-')}`}>{row[column.key] || 'Recorded'}</span> : column.money ? formatMoney(row[column.key], currentCompany) : row[column.key] || '—'}</td>)}</tr>
            )) : (
              <tr><td colSpan={Math.max(1, columns.length)} className="py-12 text-center ui-muted">No entries match this report and filters.</td></tr>
            )}
          </tbody>
          {filteredRows.length ? <tfoot><tr className="bg-[rgb(var(--surface-sunken))] font-medium">{columns.map((column, index) => <td key={column.key} className={column.money ? 'ui-num ui-money' : ''}>{index === 0 ? `Total (${filteredRows.length})` : column.money ? formatMoney(filteredRows.reduce((sum, row) => sum + Number(row[column.key] || 0), 0), currentCompany) : ''}</td>)}</tr></tfoot> : null}
        </table>
      </div>
      <div className={`pointer-events-none absolute inset-x-0 z-10 flex items-center justify-end text-xs ui-muted ${compactSalesReport ? 'bottom-2 px-2' : 'bottom-4 px-4'}`}><div className={`pointer-events-auto flex items-center rounded-lg border bg-[rgb(var(--surface))] shadow-sm ui-border-c ${compactSalesReport ? 'gap-1.5 px-1.5 py-0.5 text-[11px]' : 'gap-3 px-2 py-1'}`}><span>Rows per page</span><select className={`ui-select text-xs ${compactSalesReport ? 'h-6' : 'h-8'}`} style={{ width: compactSalesReport ? 54 : 72 }} value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(1); }}><option>10</option><option>25</option><option>50</option></select><span>{filteredRows.length ? `${(currentPage - 1) * rowsPerPage + 1}–${Math.min(currentPage * rowsPerPage, filteredRows.length)} of ${filteredRows.length}` : '0 of 0'}</span><button type="button" className="ui-icon-btn" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><button type="button" className="ui-icon-btn" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></div>
      </div>
    </div>
  );
};

const ReportsWorkspace = ({ db, currentCompany, isEnabled = () => true, canView = () => true, branches = [], warehouses = [], defaultBranchId = '', defaultWarehouseId = '', onExit = null, embedded = false, navigation = null, onLoadSamples = null, onLoadInventorySamples = null }) => {
  const reportDb = useMemo(() => ({
    ...db,
    branches: branches.length ? branches.map(branch => ({ ...branch, companyId: currentCompany.id })) : (db?.branches || []),
    warehouses: warehouses.length ? warehouses.map(warehouse => ({ ...warehouse, companyId: currentCompany.id })) : (db?.warehouses || []),
  }), [branches, currentCompany.id, db, warehouses]);
  const firstKey = 'sales';
  const [selectedKey, setSelectedKey] = useState(firstKey);
  const [openGroups, setOpenGroups] = useState(() => new Set(NAV_GROUPS.map((group) => group.title)));
  const [selectedReport, setSelectedReport] = useState(null);
  const [search, setSearch] = useState('');

  /* A host that drives the reports from its own menu hands a new `navigation`
     each time; the workspace follows it. */
  useEffect(() => {
    if (!navigation) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- following a prop the host changes
    setSelectedKey(navigation.bucketKey || firstKey);
    setSelectedReport(navigation.report && canView(reportViewPermission(navigation.report)) ? navigation.report : null);
    setSearch('');
  }, [navigation?.seq]);

  const bucket = BUCKETS[selectedKey] || BUCKETS[firstKey];
  const compactListKeys = ['sales', 'purchases', 'inventory', 'expenses', 'receipts', 'payments', 'ledgers', 'outstanding', 'gst', 'tds', 'tcs'];
  const simpleCategoryHeader = embedded && compactListKeys.includes(selectedKey);
  const universalReports = useMemo(() => {
    const items = [];
    for (const [bucketKey, value] of Object.entries(BUCKETS)) {
      if ((value.feature && !isEnabled(value.feature)) || !canViewBucket(bucketKey, canView)) continue;
      for (const item of value.reports || []) {
        if ((!item.feature || isEnabled(item.feature)) && canView(reportViewPermission({ ...item, bucketKey }))) items.push({ ...item, bucketKey, category: value.title });
      }
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.direct || []) {
        if ((!item.feature || isEnabled(item.feature)) && canView(reportViewPermission(item))) items.push({ ...item, bucketKey: group.bucket || '', category: group.title, source: group.title === 'Financial Statements' ? 'ledgers' : 'cashBank' });
      }
    }
    return items.filter((item, index, rows) => rows.findIndex((candidate) => candidate.name === item.name && candidate.bucketKey === item.bucketKey) === index);
  }, [isEnabled, canView]);
  const query = search.trim().toLowerCase();
  const businessReportList = compactListKeys.includes(selectedKey) && (!query || simpleCategoryHeader);
  const reports = query && !simpleCategoryHeader
    ? universalReports.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query))
    : (bucket.reports || [])
        .filter((item) => (!item.feature || isEnabled(item.feature)) && canView(reportViewPermission({ ...item, bucketKey: selectedKey })))
        .map((item) => ({ ...item, bucketKey: selectedKey, category: bucket.title }));

  const openReport = (item) => {
    if (!canView(reportViewPermission(item))) return;
    if (item.bucketKey) setSelectedKey(item.bucketKey);
    setSelectedReport(item);
  };

  if (selectedReport) {
    if (!canView(reportViewPermission(selectedReport))) return <div className="p-5 text-sm ui-muted">You do not have access to this report.</div>;
    const reportBucket = BUCKETS[selectedReport.bucketKey] || { title: selectedReport.category || 'Report', source: selectedReport.source || bucket?.source };
    if (selectedReport.name === 'Profit & Loss') return <ProfitLossReport db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} onLoadSamples={onLoadSamples} />;
    if (selectedReport.name === 'Balance Sheet') return <BalanceSheetReport db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} />;
    if (selectedReport.name === 'Trial Balance') return <TrialBalanceReport db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} />;
    if (selectedReport.name === 'Cash Flow Statement') return <CashFlowReport db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} />;
    if (selectedReport.name === 'Inventory Register') return <InventoryRegisterReport db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} />;
    if (!['sales', 'purchases', 'expenses', 'receipts', 'payments'].includes(selectedReport.bucketKey)) return <CatalogReport title={selectedReport.name} db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} />;
    return (
      <div className="min-h-[calc(100dvh-4rem)] w-full bg-[rgb(var(--surface))]">
        <GenericReport title={selectedReport.name} bucket={reportBucket} db={reportDb} currentCompany={currentCompany} onBack={() => setSelectedReport(null)} isEnabled={isEnabled} defaultBranchId={defaultBranchId} defaultWarehouseId={defaultWarehouseId} />
      </div>
    );
  }

  const Icon = bucket.icon || FileSpreadsheet;
  return (
    <div className="space-y-0">
      {!embedded ? <div
        className="reports-page-bar sticky top-0 z-50 grid grid-cols-1 items-center gap-3 border-b py-2.5 ui-border-c sm:grid-cols-[1fr_minmax(16rem,24rem)_1fr]"
        style={{ backgroundColor: 'rgb(var(--app-bg))', boxShadow: '0 8px 16px rgb(0 0 0 / 0.04)' }}
      >
        <div className="flex items-center gap-2.5">
          {onExit ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onExit} aria-label="Back to application"><ArrowLeft size={15} aria-hidden="true" /> Back to app</button> : null}
          <EntityMark entity="report" /><h1 className="ui-t-page">Reports</h1>
        </div>
        <label className="relative block w-full">
          <Search size={17} className="absolute start-3 top-1/2 -translate-y-1/2 ui-subtle" aria-hidden="true" />
          <input className="ui-input w-full ps-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all reports…" aria-label="Search all reports" />
        </label>
        <span aria-hidden="true" />
      </div> : null}
      <div className={embedded ? 'flex min-h-0 bg-[rgb(var(--surface))]' : 'flex min-h-[calc(100dvh-12rem)] overflow-hidden border ui-border-c bg-[rgb(var(--surface))]'}>
        {!embedded ? <ReportSidebar selectedKey={selectedKey} setSelectedKey={setSelectedKey} openGroups={openGroups} setOpenGroups={setOpenGroups} onOpenReport={openReport} isEnabled={isEnabled} canView={canView} /> : null}
        <main className={embedded ? 'min-w-0 flex-1 p-2' : 'min-w-0 flex-1 p-5 lg:p-7'}>
          {simpleCategoryHeader ? <PageHeader title={bucket.title} entity="report" actions={selectedKey === 'inventory' && onLoadInventorySamples ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onLoadInventorySamples}>{(db.sampleScenarioSets || []).some(entry => String(entry.companyId) === String(currentCompany.id) && entry.key === `inventory-reports-v1:${currentCompany.id}`) ? 'Update inventory examples' : 'Add inventory report examples'}</button> : null} /> : <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b ui-border-c pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[rgb(var(--heading-bg))]"><Icon size={17} /></span>
              <div><h2 className="text-sm font-bold">{query ? 'Search results' : bucket.title}</h2><p className="ui-muted text-xs">{reports.length} report{reports.length === 1 ? '' : 's'} available</p></div>
            </div>
            {embedded ? <div className="flex flex-wrap items-center gap-2">{onLoadSamples ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onLoadSamples} disabled={(db.sampleScenarioSets || []).some((entry) => String(entry.companyId) === String(currentCompany.id) && String(entry.key).startsWith('linked-v1:'))}>{(db.sampleScenarioSets || []).some((entry) => String(entry.companyId) === String(currentCompany.id) && String(entry.key).startsWith('linked-v1:')) ? 'Sample entries loaded' : 'Add 12 months of sample entries'}</button> : null}<label className="relative block w-full max-w-72"><Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 ui-subtle" aria-hidden="true" /><input className="ui-input w-full ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports…" aria-label="Search reports" /></label></div> : null}
          </div>}
          <div className={businessReportList ? 'flex flex-col gap-0.5' : 'grid overflow-hidden rounded-xl border ui-border-c xl:grid-cols-2'}>
            {reports.map((item) => (
              <button key={`${item.bucketKey || selectedKey}-${item.name}`} type="button" onClick={() => openReport(item)} className={`group flex w-full items-center text-left transition-colors hover:bg-[rgb(var(--heading-bg))] focus-visible:z-10 ${businessReportList ? 'min-h-9 gap-2 rounded-lg px-3 py-1.5' : `min-h-12 gap-3 border-b ui-border-c px-4 py-3 ${selectedKey === 'ledgers' && !query ? 'last:border-b-0' : 'xl:odd:border-e'}`}`}>
                <span className={`grid flex-none place-items-center rounded-lg bg-[rgb(var(--surface-sunken))] transition-colors group-hover:bg-[rgb(var(--surface))] ${businessReportList ? 'h-6 w-6' : 'h-7 w-7'}`}><FileSpreadsheet size={businessReportList ? 13 : 14} className="ui-muted" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                <ChevronRight size={15} className="ui-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            ))}
            {!reports.length ? <div className="col-span-full rounded-xl border border-dashed ui-border-c px-5 py-12 text-center text-sm ui-muted">No reports match “{search}”.</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
};

const ReportSidebar = ({ selectedKey, setSelectedKey, openGroups, setOpenGroups, onOpenReport, isEnabled, canView }) => {
  const toggle = (title) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });
  return (
    <aside className="settings-catalog ui-rail hidden w-[15rem] flex-none overflow-y-auto sm:block" aria-label="Report categories">
      <nav className="space-y-1">
        {NAV_GROUPS.map((group) => {
          const keys = (group.keys || []).filter((key) => (!BUCKETS[key]?.feature || isEnabled(BUCKETS[key].feature)) && canViewBucket(key, canView));
          const direct = (group.direct || []).filter((item) => (!item.feature || isEnabled(item.feature)) && canView(reportViewPermission(item)));
          if (!keys.length && !direct.length) return null;
          const open = openGroups.has(group.title);
          return (
            <div key={group.title}>
              <button type="button" onClick={() => toggle(group.title)} className="ui-nav-item" data-level="module" data-tone="reports">
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>{group.title}</span>
              </button>
              {open ? (
                <div className="mt-0.5 space-y-0.5 pl-5">
                  {keys.map((key) => {
                    const item = BUCKETS[key];
                    return <button key={key} type="button" data-active={selectedKey === key ? 'true' : undefined} data-tone="reports" onClick={() => setSelectedKey(key)} className="ui-nav-item">{item.title}</button>;
                  })}
                  {direct.map((item) => (
                    <button key={item.name} type="button" data-tone="reports" onClick={() => onOpenReport?.({ ...item, bucketKey: group.bucket || '', category: group.title, source: group.title === 'Financial Statements' ? 'ledgers' : 'cashBank' })} className="ui-nav-item">{item.name}</button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

/** Reports, with a warning above when the books here are not whole. */
const ReportsWorkspaceWithNotice = (props) => (
  <>
    <SyncProblemsNotice problems={props.db?.syncProblems} />
    <ReportsWorkspace {...props} />
  </>
);

export default ReportsWorkspaceWithNotice;

