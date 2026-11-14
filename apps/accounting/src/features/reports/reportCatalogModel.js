import { buildLedgerStatement } from '../../data/db';
import { buildTrialBalance } from './trialBalanceModel';
import { buildStockMovements, computeInventorySummaryByItemId, getItemOpeningQty, getItemOpeningWarehouseId } from '@ui/utils/inventory';
import { batchStockRows } from '@ui/utils/batches';
import { cashBankTransactions } from '../cashBank/transactions';
import { tdsEvents, isLive, allocationsByEvent } from '../tds/reports';

const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();
const num = value => Number(value) || 0;
const round = value => Math.round(num(value) * 100) / 100;
const day = value => text(value).slice(0, 10);
const dateOf = row => day(row?.date || row?.transactionDate || row?.invoiceDate || row?.billDate || row?.createdAt);
const numberOf = row => text(row?.number || row?.invoiceNumber || row?.billNumber || row?.voucherNo || row?.refNo || row?.id);
const amountOf = row => round(row?.total ?? row?.grandTotal ?? row?.amount ?? 0);
const col = (key, label, numeric = false) => ({ key, label, numeric });
const report = (columns, rows, note = '') => ({ columns, rows, note });
const inScope = (db, key, companyId, range) => list(db?.[key]).filter(row => (!row.companyId || String(row.companyId) === String(companyId)) && (!range.start || !dateOf(row) || dateOf(row) >= range.start) && (!range.end || !dateOf(row) || dateOf(row) <= range.end));
const masterName = (db, collection, id, fallback = 'Unassigned') => text(list(db?.[collection]).find(row => String(row.id) === String(id))?.displayName || list(db?.[collection]).find(row => String(row.id) === String(id))?.name) || fallback;
const group = (rows, keyOf, seedOf, add) => {
  const map = new Map();
  for (const row of rows) { const key = text(keyOf(row)) || 'Unassigned'; const value = map.get(key) || seedOf(key, row); add(value, row); map.set(key, value); }
  return [...map.values()].sort((a, b) => text(a.name || a.party || a.month || a.section || a.category || a.branch || a.ledger).localeCompare(text(b.name || b.party || b.month || b.section || b.category || b.branch || b.ledger)));
};
const sum = (rows, key) => round(rows.reduce((total, row) => total + num(row[key]), 0));
const active = row => !['draft', 'cancelled', 'void'].includes(lower(row?.status));

const documentRows = (db, docs, partyCollection, partyKey) => docs.filter(active).map(doc => ({
  id: doc.id, date: dateOf(doc), number: numberOf(doc), party: text(doc.customerName || doc.vendorName || doc.partyName) || masterName(db, partyCollection, doc[partyKey], 'Unassigned'),
  taxable: round(doc.taxableTotal ?? doc.subtotal ?? doc.taxableAmount), gst: round(doc.gstTotal ?? (num(doc.cgstTotal) + num(doc.sgstTotal) + num(doc.igstTotal))),
  amount: amountOf(doc), status: text(doc.status) || 'Recorded', dueDate: day(doc.dueDate), branch: masterName(db, 'branches', doc.branchId),
  items: list(doc.items), raw: doc,
}));
const documentColumns = [col('date','Date'), col('number','Document No.'), col('party','Party'), col('taxable','Taxable (₹)',true), col('gst','GST (₹)',true), col('amount','Total (₹)',true), col('status','Status')];
const summaryColumns = (label = 'Particulars') => [col('name',label), col('count','Documents',true), col('taxable','Taxable (₹)',true), col('gst','GST (₹)',true), col('amount','Total (₹)',true)];
const summarizeDocs = (rows, key, label = 'Particulars') => report(summaryColumns(label), group(rows, row => row[key], name => ({ name, count: 0, taxable: 0, gst: 0, amount: 0 }), (out, row) => { out.count++; out.taxable = round(out.taxable + row.taxable); out.gst = round(out.gst + row.gst); out.amount = round(out.amount + row.amount); }));
const itemRows = (db, docs) => {
  const items = new Map(list(db?.items).map(item => [String(item.id), item]));
  return docs.flatMap(doc => list(doc.items).map(line => { const item = items.get(String(line.itemId)) || {}; const qty = num(line.quantity ?? line.qty); const taxable = round(line.taxableAmount ?? line.amount ?? qty * num(line.rate)); const gst = round(line.gstAmount ?? line.taxAmount ?? taxable * num(line.gstRate ?? item.gstRate) / 100); return { name: text(item.name || line.itemName || line.description) || 'Unnamed item', code: text(item.code || line.itemCode), category: text(item.categoryName || item.category || line.category) || 'Uncategorised', quantity: qty, taxable, gst, amount: round(taxable + gst), document: numberOf(doc.raw), date: doc.date }; }));
};
const summarizeItems = (rows, key) => report([col('code','Item Code'), col('name',key === 'category' ? 'Category' : 'Item'), col('quantity','Quantity',true), col('taxable','Taxable (₹)',true), col('gst','GST (₹)',true), col('amount','Total (₹)',true)], group(rows, row => row[key], (name, row) => ({ code: key === 'category' ? '' : row.code, name, quantity: 0, taxable: 0, gst: 0, amount: 0 }), (out, row) => { for (const field of ['quantity','taxable','gst','amount']) out[field] = round(out[field] + row[field]); }));

const outstandingRows = (db, source, companyId, range) => {
  const purchase = source === 'payables';
  const docs = inScope(db, purchase ? 'bills' : 'invoices', companyId, { start: '', end: range.end }).filter(active);
  const parties = purchase ? 'vendors' : 'customers';
  const key = purchase ? 'vendorId' : 'customerId';
  const payments = list(db?.payments).filter(row => String(row.companyId) === String(companyId));
  const today = range.end || new Date().toISOString().slice(0,10);
  return documentRows(db, docs, parties, key).map(row => {
    const allocated = payments.reduce((total, payment) => total + list(payment.allocations).filter(allocation => String(allocation.voucherId) === String(row.id) && lower(allocation.voucherType) === (purchase ? 'bill' : 'invoice')).reduce((part, allocation) => part + num(allocation.amount), 0), 0);
    const paid = Math.max(num(row.raw?.paidAmount), allocated);
    const outstanding = round(Math.max(0, row.amount - paid));
    const age = row.dueDate && row.dueDate < today ? Math.max(0, Math.floor((new Date(`${today}T12:00:00Z`) - new Date(`${row.dueDate}T12:00:00Z`)) / 86400000)) : 0;
    return { ...row, paid: round(paid), outstanding, overdueDays: age, bucket: age === 0 ? 'Not due' : age <= 30 ? '1–30 days' : age <= 60 ? '31–60 days' : age <= 90 ? '61–90 days' : '90+ days' };
  }).filter(row => row.outstanding > 0.005);
};
const outstandingColumns = [col('number','Document No.'), col('date','Date'), col('party','Party'), col('dueDate','Due Date'), col('amount','Total (₹)',true), col('paid','Paid (₹)',true), col('outstanding','Outstanding (₹)',true), col('overdueDays','Overdue Days',true)];

const voucherRows = (db, companyId, range) => [
  ...inScope(db,'invoices',companyId,range).filter(active).map(row => ({ date: dateOf(row), number: numberOf(row), type: 'Sales Invoice', party: text(row.customerName), debit: amountOf(row), credit: 0, amount: amountOf(row) })),
  ...inScope(db,'bills',companyId,range).filter(active).map(row => ({ date: dateOf(row), number: numberOf(row), type: 'Purchase Bill', party: text(row.vendorName), debit: 0, credit: amountOf(row), amount: amountOf(row) })),
  ...inScope(db,'expenses',companyId,range).filter(active).map(row => ({ date: dateOf(row), number: numberOf(row), type: 'Expense', party: text(row.vendorName || row.payee), debit: amountOf(row), credit: 0, amount: amountOf(row) })),
  ...inScope(db,'payments',companyId,range).map(row => ({ date: dateOf(row), number: numberOf(row), type: lower(row.direction) === 'in' ? 'Receipt' : 'Payment', party: text(row.partyName || row.customerName || row.vendorName), debit: lower(row.direction) === 'in' ? num(row.amount) : 0, credit: lower(row.direction) === 'out' ? num(row.amount) : 0, amount: num(row.amount) })),
  ...inScope(db,'journalEntries',companyId,range).filter(active).map(row => ({ date: dateOf(row), number: numberOf(row), type: 'Journal', party: text(row.narration), debit: sum(list(row.lines),'debit'), credit: sum(list(row.lines),'credit'), amount: sum(list(row.lines),'debit') })),
].sort((a,b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));

export function buildCatalogReport(db, companyId, title, range = {}, options = {}) {
  const name = text(title);
  const bills = documentRows(db, inScope(db,'bills',companyId,range), 'vendors','vendorId');
  const expenses = documentRows(db, inScope(db,'expenses',companyId,range), 'vendors','vendorId');
  const payments = inScope(db,'payments',companyId,range).filter(row => lower(row.direction) === 'out' || !row.direction && !/receipt/i.test(text(row.voucherType)));
  const receipts = inScope(db,'payments',companyId,range).filter(row => lower(row.direction) === 'in' || /receipt/i.test(text(row.voucherType)));

  if (name === 'Purchase Register') return report(documentColumns, bills);
  if (name === 'Purchase Return Register') return report(documentColumns, documentRows(db, inScope(db,'debitNotes',companyId,range), 'vendors','vendorId'));
  if (name === 'Vendor-wise Purchase') return summarizeDocs(bills,'party','Vendor');
  if (name === 'Item-wise Purchase') return summarizeItems(itemRows(db,bills),'name');
  if (name === 'Category-wise Purchase') return summarizeItems(itemRows(db,bills),'category');
  if (name === 'Monthly Purchase Summary') return summarizeDocs(bills.map(row => ({ ...row, month: row.date.slice(0,7) || 'Undated' })),'month','Month');

  if (name === 'Expense Register') return report([col('date','Date'),col('number','Expense No.'),col('party','Vendor / Payee'),col('category','Category'),col('ledger','Ledger'),col('taxable','Taxable (₹)',true),col('gst','GST (₹)',true),col('amount','Total (₹)',true)], expenses.map(row => ({ ...row, category: text(row.raw.categoryName || row.raw.category) || 'Uncategorised', ledger: masterName(db,'chartOfAccounts',row.raw.ledgerId || row.raw.accountId), costCentre: masterName(db,'costCenters',row.raw.costCenterId || row.raw.costCentreId) })));
  if (/^Expense (Ledger|Category)-wise$/.test(name) || name === 'Vendor-wise Expense' || name === 'Branch-wise Expense' || name === 'Cost Centre-wise Expense' || name === 'Monthly Expense Analysis') {
    const key = name === 'Expense Ledger-wise' ? 'ledger' : name === 'Expense Category-wise' ? 'category' : name === 'Vendor-wise Expense' ? 'party' : name === 'Branch-wise Expense' ? 'branch' : name === 'Cost Centre-wise Expense' ? 'costCentre' : 'month';
    const rows = expenses.map(row => ({ ...row, ledger: masterName(db,'chartOfAccounts',row.raw.ledgerId || row.raw.accountId), category: text(row.raw.categoryName || row.raw.category) || 'Uncategorised', costCentre: masterName(db,'costCenters',row.raw.costCenterId || row.raw.costCentreId), month: row.date.slice(0,7) || 'Undated' }));
    return summarizeDocs(rows,key, key === 'party' ? 'Vendor' : key === 'month' ? 'Month' : key === 'costCentre' ? 'Cost Centre' : key === 'branch' ? 'Branch' : key === 'ledger' ? 'Ledger' : 'Category');
  }

  if (name.includes('Receipts') || name === 'Receipt Register') return buildMoneyReport(db, receipts, name, 'receipt');
  if (name.includes('Payments') || name === 'Payment Register' || name === 'TDS Payments') return buildMoneyReport(db, payments, name, 'payment');

  if (['Outstanding Receivables','Outstanding Payables','Customer Outstanding','Invoice-wise Outstanding','Customer Aging','Overdue Receivables','Advance from Customers','Vendor Outstanding','Bill-wise Outstanding','Vendor Aging','Overdue Payables','Advances to Vendors'].includes(name)) {
    const purchase = /Vendor|Bill|Payable|Vendors/.test(name);
    if (name.startsWith('Advance')) {
      const source = purchase ? payments : receipts;
      return report([col('date','Date'),col('number','Voucher No.'),col('party','Party'),col('amount','Advance (₹)',true)], source.filter(row => row.isAdvance || !list(row.allocations).length).map(row => ({ date: dateOf(row), number: numberOf(row), party: text(row.partyName || row.customerName || row.vendorName) || masterName(db,purchase?'vendors':'customers',purchase?row.vendorId:row.customerId), amount: num(row.amount) })));
    }
    let rows = outstandingRows(db, purchase ? 'payables' : 'receivables', companyId, range);
    if (name.startsWith('Overdue')) rows = rows.filter(row => row.overdueDays > 0);
    if (name.includes('Aging')) return report([col('party',purchase?'Vendor':'Customer'),col('bucket','Age Bucket'),col('count','Documents',true),col('outstanding','Outstanding (₹)',true)], group(rows, row => `${row.party}|${row.bucket}`, (_, row) => ({ party: row.party, bucket: row.bucket, count: 0, outstanding: 0 }), (out,row) => { out.count++; out.outstanding = round(out.outstanding + row.outstanding); }));
    if (name.endsWith('Outstanding') && !name.startsWith('Invoice') && !name.startsWith('Bill') && !name.startsWith('Overdue')) return report([col('party',purchase?'Vendor':'Customer'),col('count','Documents',true),col('outstanding','Outstanding (₹)',true)], group(rows,row=>row.party,party=>({party,count:0,outstanding:0}),(out,row)=>{out.count++;out.outstanding=round(out.outstanding+row.outstanding);}));
    return report(outstandingColumns,rows);
  }

  if (['Ledger Statement','Ledger Summary','Ledger Group Summary','Group-wise Ledger Report','General Ledger','Ledger Monthly Summary'].includes(name)) return buildLedgerReport(db,companyId,name,range,options);
  if (name === 'Day Book' || name === 'Voucher Register' || name === 'Voucher Type Summary' || name === 'Journal Register') return buildVoucherReport(db,companyId,name,range);
  if (['Inventory Register','Batch-wise Report','Reorder Level Report','Near Expiry','Expired Stock','Negative Stock','Stock Summary','Stock Ledger','Stock Valuation','Reorder Report','Negative Stock Report','Item Movement','Item-wise Stock','Warehouse-wise Stock','Branch-wise Stock'].includes(name)) return buildInventoryReport(db,companyId,name,range,options);
  if (/^GST|^GSTR|HSN\/SAC|Tax Liability|Input Tax Credit/.test(name)) return buildGstReport(db,companyId,name,range);
  if (/^TDS|TDS$|Filing-ready TDS|Section-wise TDS|Party-wise TDS/.test(name)) return buildTdsReport(db,companyId,name,range);
  if (name === 'TCS Ledger Summary') return buildTcsLedgerReport(db,companyId,range);
  if (/Cash Book|Bank Book|Account-wise Transactions|Bank Reconciliation|Unreconciled Transactions|Contra Register/.test(name)) return buildCashBankReport(db,companyId,name,range);
  if (/Branch|Cost Centre/.test(name)) return buildAnalysisReport(db,companyId,name,range);
  return report([col('name','Particulars')],[], 'No report definition is available for this title.');
}

function buildMoneyReport(db, source, title, kind) {
  let rows = source.map(row => ({ id: row.id, date: dateOf(row), number: numberOf(row), party: text(row.partyName || row.customerName || row.vendorName || row.ledgerName) || masterName(db,kind === 'receipt' ? 'customers' : 'vendors',kind === 'receipt' ? row.customerId : row.vendorId), account: masterName(db,'chartOfAccounts',row.cashBankAccountId || row.bankAccountId, text(row.mode || row.bankName) || 'Unassigned'), mode: text(row.mode), amount: round(row.amount), tds: round(row.tdsAmount), allocations: list(row.allocations), raw: row }));
  if (/^Cash /.test(title)) rows = rows.filter(row => /cash/i.test(row.mode || row.account));
  if (/^Bank-wise/.test(title)) rows = rows.filter(row => !/cash/i.test(row.mode || row.account));
  if (/^Advance /.test(title)) rows = rows.filter(row => row.raw.isAdvance || !row.allocations.length);
  if (/adjusted/i.test(title)) rows = rows.filter(row => row.allocations.some(allocation => /invoice|bill/i.test(text(allocation.voucherType))));
  if (/^TDS/.test(title)) rows = rows.filter(row => row.tds > 0);
  if (/wise/i.test(title)) {
    const key = /^Bank-wise/.test(title) ? 'account' : 'party';
    return report([col('name',key === 'account' ? 'Bank / Cash Ledger' : 'Party / Ledger'),col('count','Transactions',true),col('amount','Amount (₹)',true),col('tds','TDS (₹)',true)],group(rows,row=>row[key],name=>({name,count:0,amount:0,tds:0}),(out,row)=>{out.count++;out.amount=round(out.amount+row.amount);out.tds=round(out.tds+row.tds);}));
  }
  return report([col('date','Date'),col('number','Voucher No.'),col('party','Party / Ledger'),col('account','Cash / Bank Ledger'),col('mode','Mode'),col('amount','Amount (₹)',true),col('tds','TDS (₹)',true)],rows);
}

function buildLedgerReport(db, companyId, title, range, options) {
  const tb = buildTrialBalance(db,companyId,{start:range.start || '0000-01-01',end:range.end || '9999-12-31'});
  const accounts = list(db?.chartOfAccounts).filter(row=>String(row.companyId)===String(companyId));
  const groups = new Map(list(db?.accountGroups).map(row=>[String(row.id),row]));
  const accountRows = tb.ledgers.map(row=>({ ...row, ledger:row.name, code:row.code, group:text(groups.get(String(accounts.find(a=>String(a.id)===row.id)?.groupId))?.name)||'Ungrouped', opening:row.opening, debit:row.debit, credit:row.credit, closing:row.closing }));
  const balanceColumns = [col('code','Code'),col('ledger','Ledger'),col('group','Group'),col('opening','Opening (₹)',true),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('closing','Closing (₹)',true)];
  if (title === 'Ledger Summary' || title === 'Group-wise Ledger Report') return report(balanceColumns,accountRows);
  if (title === 'Ledger Group Summary') return report([col('name','Group'),col('count','Ledgers',true),col('opening','Opening (₹)',true),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('closing','Closing (₹)',true)],group(accountRows,row=>row.group,name=>({name,count:0,opening:0,debit:0,credit:0,closing:0}),(out,row)=>{out.count++;for(const key of ['opening','debit','credit','closing'])out[key]=round(out[key]+row[key]);}));
  const selected = text(options.ledgerId);
  const postings = accounts.filter(account=>!selected||String(account.id)===selected).flatMap(account=>buildLedgerStatement(db,companyId,account.id).rows.filter(row=>(!range.start||day(row.date)>=range.start)&&(!range.end||day(row.date)<=range.end)).map(row=>({date:day(row.date),number:text(row.voucherNo),type:text(row.voucherType),ledger:account.name,particulars:text(row.particulars),narration:text(row.narration),debit:round(row.debit),credit:round(row.credit),balance:round(row.runningBalance)}))).sort((a,b)=>a.date.localeCompare(b.date)||a.ledger.localeCompare(b.ledger));
  if (title === 'Ledger Monthly Summary') return report([col('month','Month'),col('ledger','Ledger'),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true)],group(postings,row=>`${row.date.slice(0,7)}|${row.ledger}`,(_,row)=>({month:row.date.slice(0,7),ledger:row.ledger,debit:0,credit:0}),(out,row)=>{out.debit=round(out.debit+row.debit);out.credit=round(out.credit+row.credit);}));
  return report([col('date','Date'),col('number','Voucher No.'),col('type','Type'),col('ledger','Ledger'),col('particulars','Particulars'),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('balance','Running Balance (₹)',true)],postings);
}

function buildVoucherReport(db, companyId, title, range) {
  const rows = voucherRows(db,companyId,range);
  if (title === 'Journal Register') return report([col('date','Date'),col('number','Journal No.'),col('party','Narration'),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true)],rows.filter(row=>row.type==='Journal'));
  if (title === 'Voucher Type Summary') return report([col('name','Voucher Type'),col('count','Vouchers',true),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('amount','Amount (₹)',true)],group(rows,row=>row.type,name=>({name,count:0,debit:0,credit:0,amount:0}),(out,row)=>{out.count++;for(const key of ['debit','credit','amount'])out[key]=round(out[key]+row[key]);}));
  return report([col('date','Date'),col('number','Voucher No.'),col('type','Voucher Type'),col('party','Party / Narration'),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('amount','Amount (₹)',true)],rows);
}

function buildInventoryReport(db, companyId, title, range, options) {
  const items = list(db?.items).filter(item=>String(item.companyId)===String(companyId));
  const warehouseId = text(options.warehouseId);
  if(['Batch-wise Report','Near Expiry','Expired Stock'].includes(title)) {
    const today=day(new Date().toISOString());
    const asOf=range.end&&range.end<today?range.end:today;
    const sourceBillByNumber=new Map(list(db?.bills).filter(bill=>String(bill.companyId)===String(companyId)).map(bill=>[numberOf(bill),bill]));
    const source={...db,
      batches:list(db?.batches).filter(batch=>{const receivedDate=dateOf(sourceBillByNumber.get(text(batch.sourceBillNumber)))||dateOf(batch);return String(batch.companyId)===String(companyId)&&(!receivedDate||receivedDate<=asOf);}),
      invoices:list(db?.invoices).filter(invoice=>!dateOf(invoice)||dateOf(invoice)<=asOf),
      stockTransfers:list(db?.stockTransfers).filter(transfer=>!dateOf(transfer)||dateOf(transfer)<=asOf),
    };
    const itemById=new Map(items.map(item=>[String(item.id),item]));
    let batches=batchStockRows(source,companyId).map(batch=>{
      const item=itemById.get(String(batch.itemId))||{};
      const batchWarehouseId=text(batch.warehouseId||sourceBillByNumber.get(text(batch.sourceBillNumber))?.warehouseId||item.openingWarehouseId);
      const expiryDate=day(batch.expiryDate);
      const days=expiryDate?Math.round((new Date(`${expiryDate}T00:00:00Z`)-new Date(`${asOf}T00:00:00Z`))/86400000):null;
      return{id:String(batch.id),code:text(item.code),name:text(batch.itemName),batch:text(batch.batchNo),manufactured:day(batch.mfgDate),expiry:expiryDate,received:round(batch.qtyIn),issued:round(batch.qtyOut),remaining:round(batch.remaining),days,source:text(batch.sourceBillNumber),warehouseId:batchWarehouseId,warehouse:masterName(db,'warehouses',batchWarehouseId),status:batch.remaining<=0?'Depleted':days==null?'No expiry':days<0?'Expired':days<=num(options.expiryDays||30)?'Near expiry':'In stock'};
    }).filter(batch=>!warehouseId||batch.warehouseId===warehouseId);
    if(title==='Near Expiry')batches=batches.filter(batch=>batch.remaining>0&&batch.days!=null&&batch.days>=0&&batch.days<=num(options.expiryDays||30));
    if(title==='Expired Stock')batches=batches.filter(batch=>batch.remaining>0&&batch.days!=null&&batch.days<0);
    const columns=[col('code','Item Code'),col('name','Item Name'),col('batch','Batch No.'),col('manufactured','Mfg Date'),col('expiry','Expiry Date'),col('received','Received Qty',true),col('issued','Issued Qty',true),col('remaining','On Hand',true),col('days','Days to Expiry',true),col('warehouse','Warehouse'),col('source','Source Bill'),col('status','Status')];
    return report(columns,batches);
  }
  const summary = computeInventorySummaryByItemId({db,companyId,fromDate:range.start||'',toDate:range.end||'',warehouseId});
  const rows = items.map(item=>{const movement=summary.get(String(item.id))||{};const opening=num(movement.openingQty),purchases=num(movement.purchasesQty),sales=num(movement.salesQty),debitNotes=num(movement.debitNoteQty),creditNotes=num(movement.creditNoteQty),adjustment=num(movement.adjustmentQty),closing=num(movement.closingQty),rate=num(item.purchasePrice||item.costPrice||item.valuationRate);return{id:String(item.id),code:text(item.code),name:text(item.name),category:text(item.categoryName||item.category),unit:text(item.unit||item.uom),opening,purchases,sales,debitNotes,creditNotes,adjustment,closing,rate,value:round(closing*rate),reorder:num(item.reorderLevel||item.minimumStock||item.minStock),branch:masterName(db,'branches',item.branchId),warehouse:masterName(db,'warehouses',item.warehouseId||item.openingWarehouseId)};});
  const stockColumns=[col('code','Item Code'),col('name','Item Name'),col('unit','UOM'),col('opening','Opening',true),col('purchases','Purchases',true),col('sales','Sales',true),col('debitNotes','Debit Notes',true),col('creditNotes','Credit Notes',true),col('closing','Closing',true)];
  if (title==='Stock Summary') return report(stockColumns,rows);
  if (title==='Item-wise Stock') return report([col('code','Item Code'),col('name','Item Name'),col('category','Category'),col('unit','UOM'),col('opening','Opening Qty',true),col('purchases','Purchased',true),col('sales','Sold',true),col('closing','Closing Qty',true),col('value','Stock Value (₹)',true)],rows);
  if (title==='Stock Valuation') return report([col('code','Item Code'),col('name','Item Name'),col('unit','UOM'),col('closing','Closing Qty',true),col('rate','Cost / Unit (₹)',true),col('value','Stock Value (₹)',true)],rows);
  if (title==='Reorder Report'||title==='Reorder Level Report') return report([col('code','Item Code'),col('name','Item Name'),col('unit','UOM'),col('closing','Available Qty',true),col('reorder','Reorder Level',true),col('shortfall','Shortfall',true)],rows.filter(row=>row.reorder>0&&row.closing<row.reorder).map(row=>({...row,shortfall:round(row.reorder-row.closing)})));
  if (title==='Negative Stock Report'||title==='Negative Stock') {
    const warehouses=list(db?.warehouses).filter(warehouse=>String(warehouse.companyId)===String(companyId)&&(!warehouseId||String(warehouse.id)===warehouseId));
    const negatives=warehouses.flatMap(warehouse=>{const balances=computeInventorySummaryByItemId({db,companyId,fromDate:range.start||'',toDate:range.end||'',warehouseId:String(warehouse.id)});return items.map(item=>({code:text(item.code),name:text(item.name),unit:text(item.unit||item.uom),warehouse:text(warehouse.name),closing:round(num(balances.get(String(item.id))?.closingQty)-(getItemOpeningWarehouseId(item)?0:getItemOpeningQty(item)))})).filter(row=>row.closing<0);});
    if(!warehouseId){const unassignedMovements=buildStockMovements({db,companyId}).movements.filter(movement=>!text(movement.warehouseId)&&(!range.end||day(movement.date)<=range.end));negatives.push(...items.map(item=>({code:text(item.code),name:text(item.name),unit:text(item.unit||item.uom),warehouse:'Unassigned',closing:round((getItemOpeningWarehouseId(item)?0:getItemOpeningQty(item))+unassignedMovements.filter(movement=>String(movement.itemId)===String(item.id)).reduce((total,movement)=>total+num(movement.qtyIn)-num(movement.qtyOut),0))})).filter(row=>row.closing<0));}
    return report([col('code','Item Code'),col('name','Item Name'),col('unit','UOM'),col('warehouse','Warehouse'),col('closing','Negative Qty',true)],negatives);
  }
  if (title==='Warehouse-wise Stock'||title==='Branch-wise Stock') {
    const warehouses=list(db?.warehouses).filter(warehouse=>String(warehouse.companyId)===String(companyId) && (!warehouseId||String(warehouse.id)===warehouseId));
    const byWarehouse=warehouses.map(warehouse=>{
      const balances=computeInventorySummaryByItemId({db,companyId,fromDate:range.start||'',toDate:range.end||'',warehouseId:String(warehouse.id)});
      const stocked=items.map(item=>({item,quantity:round(num(balances.get(String(item.id))?.closingQty)-(getItemOpeningWarehouseId(item)?0:getItemOpeningQty(item)))})).filter(entry=>entry.quantity!==0);
      return {id:String(warehouse.id),name:text(warehouse.name)||'Unnamed warehouse',branch:masterName(db,'branches',warehouse.branchId),items:stocked.length,quantity:round(stocked.reduce((total,entry)=>total+entry.quantity,0)),value:round(stocked.reduce((total,entry)=>total+entry.quantity*num(entry.item.purchasePrice||entry.item.costPrice||entry.item.valuationRate),0))};
    });
    if(!warehouseId){
      const unassignedMovements=buildStockMovements({db,companyId}).movements.filter(movement=>!text(movement.warehouseId)&&(!range.end||day(movement.date)<=range.end));
      const unassigned=items.map(item=>({item,quantity:round((getItemOpeningWarehouseId(item)?0:getItemOpeningQty(item))+unassignedMovements.filter(movement=>String(movement.itemId)===String(item.id)).reduce((total,movement)=>total+num(movement.qtyIn)-num(movement.qtyOut),0))})).filter(entry=>entry.quantity!==0);
      if(unassigned.length)byWarehouse.push({id:'unassigned',name:'Unassigned',branch:'Unassigned',items:unassigned.length,quantity:round(unassigned.reduce((total,entry)=>total+entry.quantity,0)),value:round(unassigned.reduce((total,entry)=>total+entry.quantity*num(entry.item.purchasePrice||entry.item.costPrice||entry.item.valuationRate),0))});
    }
    if(title==='Warehouse-wise Stock')return report([col('name','Warehouse'),col('branch','Branch'),col('items','Items',true),col('quantity','Closing Qty',true),col('value','Stock Value (₹)',true)],byWarehouse);
    return report([col('name','Branch'),col('warehouses','Warehouses',true),col('items','Items',true),col('quantity','Closing Qty',true),col('value','Stock Value (₹)',true)],group(byWarehouse,row=>row.branch,name=>({name,warehouses:0,items:0,quantity:0,value:0}),(out,row)=>{out.warehouses++;out.items+=row.items;out.quantity=round(out.quantity+row.quantity);out.value=round(out.value+row.value);}));
  }
  const stock=buildStockMovements({db,companyId,warehouseId}).movements;
  const itemById=new Map(items.map(item=>[String(item.id),item]));
  const documents={bill:db?.bills,invoice:db?.invoices,debitNote:db?.debitNotes,creditNote:db?.creditNotes,stockAdjustment:db?.stockAdjustments,stockTransfer:db?.stockTransfers};
  const documentByType=Object.fromEntries(Object.entries(documents).map(([type,collection])=>[type,new Map(list(collection).filter(document=>String(document.companyId)===String(companyId)).map(document=>[String(document.id),document]))]));
  const warehouseById=new Map(list(db?.warehouses).map(warehouse=>[String(warehouse.id),warehouse]));
  const movementLabels={bill:'Purchase Bill',invoice:'Sales Invoice',debitNote:'Purchase Return',creditNote:'Sales Return',stockAdjustment:'Stock Adjustment',stockTransfer:'Stock Transfer'};
  const balances=new Map(items.map(item=>[String(item.id),warehouseId&&getItemOpeningWarehouseId(item)&&getItemOpeningWarehouseId(item)!==warehouseId?0:getItemOpeningQty(item)]));
  const movements=stock.map(row=>{
    const itemId=String(row.itemId);
    const item=itemById.get(itemId)||{};
    const type=text(row.voucherType);
    const document=documentByType[type]?.get(String(row.voucherId));
    const quantity=round(num(row.qtyIn)-num(row.qtyOut));
    const balance=round((balances.get(itemId)||0)+quantity);
    balances.set(itemId,balance);
    const lines=list(type==='stockTransfer'?document?.lines:document?.items).filter(line=>String(line.itemId)===itemId);
    const lineQty=lines.reduce((total,line)=>total+num(line.quantity??line.qty),0);
    const lineAmount=lines.reduce((total,line)=>{const qty=num(line.quantity??line.qty);const rate=num(line.rate??line.unitPrice??line.price??item.purchasePrice??item.costPrice);return total+num(line.taxableAmount??line.amount??line.lineTotal??line.netAmount??qty*rate);},0);
    const fallbackRate=num(type==='invoice'||type==='creditNote'?item.salesPrice??item.sellingPrice??item.purchasePrice:item.purchasePrice??item.costPrice);
    const amount=round(type==='stockAdjustment'&&document?.valueDelta!=null?Math.abs(num(document.valueDelta)):(lineQty>0?lineAmount/lineQty:fallbackRate)*Math.abs(quantity));
    const branchId=document?.branchId||warehouseById.get(String(row.warehouseId))?.branchId||item.branchId;
    return{date:day(row.date),number:text(row.voucherNumber),type:movementLabels[type]||type,branch:masterName(db,'branches',branchId),warehouse:masterName(db,'warehouses',row.warehouseId),code:text(item.code),name:text(item.name),quantity,amount,in:round(row.qtyIn),out:round(row.qtyOut),balance};
  }).filter(row=>(!range.start||row.date>=range.start)&&(!range.end||row.date<=range.end));
  if(title==='Item Movement')return report([col('code','Item Code'),col('name','Item Name'),col('unit','UOM'),col('purchases','Purchased',true),col('creditNotes','Sales Returns',true),col('sales','Sold',true),col('debitNotes','Purchase Returns',true),col('adjustment','Adjustments',true),col('closing','Closing Qty',true)],rows);
  if(title==='Inventory Register')return report([col('date','Date'),col('number','Voucher No.'),col('type','Movement Type'),col('branch','Branch'),col('warehouse','Warehouse'),col('code','Item Code'),col('name','Item Name'),col('quantity','Quantity',true),col('amount','Amount',true)],movements);
  return report([col('date','Date'),col('number','Voucher No.'),col('type','Movement Type'),col('code','Item Code'),col('name','Item Name'),col('in','Qty In',true),col('out','Qty Out',true),col('balance','Running Qty',true),col('warehouse','Warehouse')],movements);
}

function buildGstReport(db, companyId, title, range) {
  const sales = documentRows(db,inScope(db,'invoices',companyId,range),'customers','customerId');
  const purchases = documentRows(db,inScope(db,'bills',companyId,range),'vendors','vendorId');
  const returns = documentRows(db,inScope(db,'creditNotes',companyId,range),'customers','customerId');
  const taxColumns=[col('date','Date'),col('number','Document No.'),col('party','Party'),col('taxable','Taxable (₹)',true),col('cgst','CGST (₹)',true),col('sgst','SGST (₹)',true),col('igst','IGST (₹)',true),col('gst','GST (₹)',true)];
  const taxRows=docs=>docs.map(row=>({...row,cgst:round(row.raw.cgstTotal),sgst:round(row.raw.sgstTotal),igst:round(row.raw.igstTotal)}));
  if (title==='GST Sales Register'||title==='GSTR-1') return report(taxColumns,taxRows(sales).concat(title==='GSTR-1'?taxRows(returns).map(row=>({...row,number:`CN ${row.number}`,taxable:-row.taxable,cgst:-row.cgst,sgst:-row.sgst,igst:-row.igst,gst:-row.gst})):[]));
  if (title==='GST Purchase Register') return report(taxColumns,taxRows(purchases));
  if (title==='HSN/SAC Summary') return report([col('name','HSN / SAC'),col('quantity','Quantity',true),col('taxable','Taxable (₹)',true),col('gst','GST (₹)',true)],group(itemRows(db,sales).map(row=>({...row,hsn:text(list(db?.items).find(item=>text(item.code)===row.code)?.hsnSac)||'Unspecified'})),row=>row.hsn,name=>({name,quantity:0,taxable:0,gst:0}),(out,row)=>{for(const key of ['quantity','taxable','gst'])out[key]=round(out[key]+row[key]);}));
  if (title==='Tax Liability Summary'||title==='GSTR-3B') {
    const output=taxRows(sales),credit=taxRows(returns),input=taxRows(purchases.concat(documentRows(db,inScope(db,'expenses',companyId,range),'vendors','vendorId')));
    const row=(name,docs,sign=1)=>({name,taxable:round(sum(docs,'taxable')*sign),cgst:round(sum(docs,'cgst')*sign),sgst:round(sum(docs,'sgst')*sign),igst:round(sum(docs,'igst')*sign),gst:round(sum(docs,'gst')*sign)});
    const rows=[row('Outward supplies',output),row('Sales returns',credit,-1)];
    if(title==='GSTR-3B')rows.push(row('Eligible input tax credit',input));
    rows.push({name:'Net tax liability',taxable:round(rows[0].taxable+rows[1].taxable),cgst:round(rows[0].cgst+rows[1].cgst-(title==='GSTR-3B'?rows[2].cgst:0)),sgst:round(rows[0].sgst+rows[1].sgst-(title==='GSTR-3B'?rows[2].sgst:0)),igst:round(rows[0].igst+rows[1].igst-(title==='GSTR-3B'?rows[2].igst:0)),gst:round(rows[0].gst+rows[1].gst-(title==='GSTR-3B'?rows[2].gst:0))});
    return report([col('name','Particulars'),col('taxable','Taxable (₹)',true),col('cgst','CGST (₹)',true),col('sgst','SGST (₹)',true),col('igst','IGST (₹)',true),col('gst','GST (₹)',true)],rows,'Summary from posted documents; review statutory return rules before filing.');
  }
  if (title==='Input Tax Credit Summary') return report([col('name','Source'),col('count','Documents',true),col('taxable','Taxable (₹)',true),col('gst','Input GST (₹)',true)],[{name:'Purchase bills',count:purchases.length,taxable:sum(purchases,'taxable'),gst:sum(purchases,'gst')},{name:'Expenses',count:inScope(db,'expenses',companyId,range).length,taxable:sum(documentRows(db,inScope(db,'expenses',companyId,range),'vendors','vendorId'),'taxable'),gst:sum(documentRows(db,inScope(db,'expenses',companyId,range),'vendors','vendorId'),'gst')}]);
  const accounts=list(db?.chartOfAccounts).filter(account=>String(account.companyId)===String(companyId)&&/gst|cgst|sgst|igst|tax credit/i.test(text(account.name)));
  return report([col('ledger','GST Ledger'),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('balance','Closing (₹)',true)],accounts.map(account=>{const statement=buildLedgerStatement(db,companyId,account.id);const rows=statement.rows.filter(row=>(!range.start||day(row.date)>=range.start)&&(!range.end||day(row.date)<=range.end));return{ledger:account.name,debit:sum(rows,'debit'),credit:sum(rows,'credit'),balance:round(statement.openingBalance+sum(statement.rows.filter(row=>!range.end||day(row.date)<=range.end),'credit')-sum(statement.rows.filter(row=>!range.end||day(row.date)<=range.end),'debit'))};}));
}

function buildTdsReport(db, companyId, title, range) {
  const events=tdsEvents(db,companyId,{from:range.start||'',to:range.end||''}).filter(isLive);
  const paid=allocationsByEvent(db,companyId);
  const rows=events.map(event=>({id:event.id,date:day(event.transactionDate),number:text(event.voucherNumber||event.sourceNumber||event.id),side:text(event.side),party:text(event.partyName)||masterName(db,event.side==='PAYABLE'?'vendors':'customers',event.partyId),section:text(event.natureCode||event.section),taxable:round(event.taxableAmount||event.baseAmount),rate:round(event.rate||event.tdsRate),tds:round(event.tdsAmount),paid:round(paid.for(event.id)),outstanding:round(num(event.tdsAmount)-paid.for(event.id)),quarter:text(event.returnQuarter),pan:text(event.partyPan||event.pan)}));
  const registerCols=[col('date','Date'),col('number','Voucher No.'),col('party','Party'),col('section','TDS Section'),col('taxable','Base (₹)',true),col('rate','Rate %',true),col('tds','TDS (₹)',true),col('paid','Paid (₹)',true),col('outstanding','Outstanding (₹)',true)];
  if(title==='TDS Receivable Register')return report(registerCols,rows.filter(row=>row.side==='RECEIVABLE'));
  if(title==='TDS Payable Register')return report(registerCols,rows.filter(row=>row.side==='PAYABLE'));
  if(title==='Section-wise TDS'||title==='Party-wise TDS'||title==='TDS Deduction Summary'||title==='TDS Payment Summary') {const key=title==='Section-wise TDS'?'section':title==='Party-wise TDS'?'party':title==='TDS Payment Summary'?'quarter':'side';return report([col('name',key==='section'?'TDS Section':key==='party'?'Party':key==='quarter'?'Return Quarter':'Side'),col('count','Transactions',true),col('taxable','Base (₹)',true),col('tds','Deducted (₹)',true),col('paid','Paid (₹)',true),col('outstanding','Outstanding (₹)',true)],group(rows,row=>row[key],name=>({name,count:0,taxable:0,tds:0,paid:0,outstanding:0}),(out,row)=>{out.count++;for(const field of ['taxable','tds','paid','outstanding'])out[field]=round(out[field]+row[field]);}));}
  return report([col('quarter','Return Quarter'),col('side','Side'),col('party','Party'),col('pan','PAN'),col('section','TDS Section'),col('taxable','Base (₹)',true),col('tds','TDS (₹)',true),col('paid','Paid (₹)',true),col('outstanding','Outstanding (₹)',true)],rows,'Filing preparation view from posted TDS events; validate identifiers and statutory requirements before filing.');
}

function buildTcsLedgerReport(db, companyId, range) {
  const accounts = list(db?.chartOfAccounts).filter(account => String(account.companyId) === String(companyId) && /\btcs\b/i.test(text(account.name)));
  const rows = accounts.map(account => {
    const statement = buildLedgerStatement(db, companyId, account.id);
    const entries = statement.rows.filter(row => (!range.start || day(row.date) >= range.start) && (!range.end || day(row.date) <= range.end));
    const prior = statement.rows.filter(row => range.start && day(row.date) < range.start);
    const opening = prior.length ? num(prior.at(-1).runningBalance) : num(statement.openingBalance);
    const debit = sum(entries, 'debit');
    const credit = sum(entries, 'credit');
    return { ledger: account.name, opening, debit, credit, closing: entries.length ? num(entries.at(-1).runningBalance) : opening };
  });
  return report([col('ledger','TCS Ledger'),col('opening','Opening (₹)',true),col('debit','Debit (₹)',true),col('credit','Credit (₹)',true),col('closing','Closing (₹)',true)], rows);
}

function buildCashBankReport(db, companyId, title, range) {
  let rows=cashBankTransactions(db,companyId,{from:range.start||'',to:range.end||''});
  const accounts=new Map(list(db?.chartOfAccounts).map(account=>[String(account.id),account]));
  const groups=new Map(list(db?.accountGroups).map(group=>[String(group.id),group]));
  const kind=row=>{const account=accounts.get(String(row.accountId));let group=groups.get(String(account?.groupId));const seen=new Set();while(group&&!seen.has(String(group.id))){if(/cash-in-hand|cash in hand/i.test(group.name))return'Cash';if(/bank account/i.test(group.name))return'Bank';seen.add(String(group.id));group=groups.get(String(group.parentGroupId));}return'Other';};
  rows=rows.map(row=>({...row,accountType:kind(row),date:day(row.date),number:text(row.number),party:text(row.ledgerName),account:text(row.accountName),inflow:row.flow==='IN'?num(row.amount):0,outflow:row.flow==='OUT'?num(row.amount):0,amount:num(row.amount)}));
  if(title==='Cash Book')rows=rows.filter(row=>row.accountType==='Cash');
  if(title==='Bank Book')rows=rows.filter(row=>row.accountType==='Bank');
  if(title==='Contra Register')rows=rows.filter(row=>row.type==='Contra');
  if(title==='Unreconciled Transactions')rows=rows.filter(row=>row.accountType==='Bank'&&row.reconciled!==true);
  if(title.startsWith('Bank Reconciliation'))return report([col('name','Bank Account'),col('count','Transactions',true),col('inflow','Receipts (₹)',true),col('outflow','Payments (₹)',true),col('cleared','Reconciled (₹)',true),col('pending','Unreconciled (₹)',true)],group(rows.filter(row=>row.accountType==='Bank'),row=>row.account,name=>({name,count:0,inflow:0,outflow:0,cleared:0,pending:0}),(out,row)=>{out.count++;out.inflow=round(out.inflow+row.inflow);out.outflow=round(out.outflow+row.outflow);const key=row.reconciled?'cleared':'pending';out[key]=round(out[key]+row.amount);}));
  if(title==='Account-wise Transactions')return report([col('name','Cash / Bank Account'),col('count','Transactions',true),col('inflow','Inflow (₹)',true),col('outflow','Outflow (₹)',true)],group(rows,row=>row.account,name=>({name,count:0,inflow:0,outflow:0}),(out,row)=>{out.count++;out.inflow=round(out.inflow+row.inflow);out.outflow=round(out.outflow+row.outflow);}));
  return report([col('date','Date'),col('number','Reference'),col('account','Cash / Bank Ledger'),col('party','Counterparty'),col('type','Type'),col('inflow','Inflow (₹)',true),col('outflow','Outflow (₹)',true),col('status','Status'),col('reconciled','Reconciled')],rows.map(row=>({...row,reconciled:row.reconciled?'Yes':'No'})));
}

function buildAnalysisReport(db, companyId, title, range) {
  const branch=title.startsWith('Branch');
  const key=branch?'branch':'costCentre';
  const documents=[...documentRows(db,inScope(db,'invoices',companyId,range),'customers','customerId').map(row=>({...row,kind:'Sales'})),...documentRows(db,inScope(db,'bills',companyId,range),'vendors','vendorId').map(row=>({...row,kind:'Purchase'})),...documentRows(db,inScope(db,'expenses',companyId,range),'vendors','vendorId').map(row=>({...row,kind:'Expense'}))];
  const rows=documents.map(row=>({...row,branch:masterName(db,'branches',row.raw.branchId),costCentre:masterName(db,'costCenters',row.raw.costCenterId||row.raw.costCentreId)}));
  if(title.includes('Transaction')||title.includes('Sales/Purchase/Expense'))return report([col('date','Date'),col('number','Document No.'),col(key,branch?'Branch':'Cost Centre'),col('kind','Type'),col('party','Party'),col('amount','Amount (₹)',true)],rows);
  if(title.includes('Ledger Summary'))return report([col('name','Cost Centre'),col('count','Transactions',true),col('amount','Amount (₹)',true)],group(rows,row=>row[key],name=>({name,count:0,amount:0}),(out,row)=>{out.count++;out.amount=round(out.amount+row.amount);}));
  return report([col('name',branch?'Branch':'Cost Centre'),col('sales','Sales (₹)',true),col('purchases','Purchases (₹)',true),col('expenses','Expenses (₹)',true),col('net','Net (₹)',true)],group(rows,row=>row[key],name=>({name,sales:0,purchases:0,expenses:0,net:0}),(out,row)=>{const field=row.kind==='Sales'?'sales':row.kind==='Purchase'?'purchases':'expenses';out[field]=round(out[field]+row.amount);out.net=round(out.sales-out.purchases-out.expenses);}));
}
