/** A repeatable, clearly labelled twelve-month walkthrough for one company. */
const rows = (value) => Array.isArray(value) ? value : [];
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const iso = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, new Date(year, month + 1, 0).getDate())).padStart(2, '0')}`;
const stamp = (year, month) => `${year}${String(month + 1).padStart(2, '0')}`;

export function addSampleScenario(db, company, now = new Date(), scope = {}) {
  const companyId = company?.id;
  if (companyId == null) throw new Error('Select a company before adding sample entries.');
  const key = `linked-v1:${companyId}`;
  if (rows(db.sampleScenarioSets).some((entry) => String(entry.companyId) === String(companyId) && String(entry.key).startsWith(key))) return { db, added: false, key };

  const next = { ...db };
  const add = (collection, value) => {
    if (!Array.isArray(next[collection])) next[collection] = [];
    if (next[collection] === db[collection]) next[collection] = [...next[collection]];
    const id = next[collection].reduce((max, entry) => Math.max(max, Number(entry?.id) || 0), 0) + 1;
    const entry = { id, companyId, sampleScenarioKey: key, ...value };
    next[collection].push(entry);
    return entry;
  };
  const bankGroup = rows(db.accountGroups).find((group) => String(group.companyId) === String(companyId) && group.name === 'Bank Accounts');
  const cashGroup = rows(db.accountGroups).find((group) => String(group.companyId) === String(companyId) && group.name === 'Cash-in-Hand');
  const expenseGroup = rows(db.accountGroups).find((group) => String(group.companyId) === String(companyId) && group.name === 'Indirect Expenses');
  const assetsGroup = rows(db.accountGroups).find((group) => String(group.companyId) === String(companyId) && group.name === 'Fixed Assets');
  const bank = add('chartOfAccounts', { name: 'Sample Current Bank', code: 'SAMPLE-BANK', groupId: bankGroup?.id ?? null, accountType: 'bank', type: 'Asset', openingBalance: 0, openingBalanceType: 'Dr', balance: 0 });
  const cash = add('chartOfAccounts', { name: 'Sample Petty Cash', code: 'SAMPLE-CASH', groupId: cashGroup?.id ?? null, accountType: 'cash', type: 'Asset', openingBalance: 0, openingBalanceType: 'Dr', balance: 0 });
  const operatingExpense = add('chartOfAccounts', { name: 'Sample Office Expenses', code: 'SAMPLE-OPEX', groupId: expenseGroup?.id ?? null, type: 'Expense', openingBalance: 0, openingBalanceType: 'Dr', balance: 0 });
  const equipment = add('chartOfAccounts', { name: 'Sample Office Equipment', code: 'SAMPLE-EQUIP', groupId: assetsGroup?.id ?? null, type: 'Asset', openingBalance: 0, openingBalanceType: 'Dr', balance: 0 });
  const customer = add('customers', { name: 'Sample Northstar Retail Pvt Ltd', displayName: 'Sample Northstar Retail Pvt Ltd', state: 'Karnataka', gstin: '29AABCU9603R1ZJ', phone: '9845012345', openingBalance: 0 });
  const serviceCustomer = add('customers', { name: 'Sample Coastal Advisory LLP', displayName: 'Sample Coastal Advisory LLP', state: 'Tamil Nadu', gstin: '33AAGCS8765N1ZM', phone: '9845012346', openingBalance: 0 });
  const vendor = add('vendors', { name: 'Sample Metro Components', displayName: 'Sample Metro Components', state: 'Karnataka', gstin: '29AAFCM1234K1ZE', openingBalance: 0 });
  const serviceVendor = add('vendors', { name: 'Sample Office Services', displayName: 'Sample Office Services', state: 'Karnataka', gstin: '29AABCK4321L1ZG', openingBalance: 0 });
  const goods = add('items', { name: 'Sample Network Router', code: 'SMP-ROUTER', type: 'goods', itemType: 'goods', unit: 'Nos', uom: 'Nos', hsnSac: '85176290', gstRate: 18, salePrice: 15000, purchasePrice: 9000, openingQty: 0, reorderLevel: 8 });
  const spare = add('items', { name: 'Sample Router Adapter', code: 'SMP-ADAPTER', type: 'goods', itemType: 'goods', unit: 'Nos', uom: 'Nos', hsnSac: '85044090', gstRate: 18, salePrice: 1500, purchasePrice: 800, openingQty: 0, reorderLevel: 12 });
  const service = add('items', { name: 'Sample Network Maintenance', code: 'SMP-SERVICE', type: 'service', itemType: 'service', unit: 'Service', uom: 'Service', hsnSac: '998713', gstRate: 18, salePrice: 40000, purchasePrice: 0 });
  const branchId = String(scope.branchId || '');
  const warehouseId = String(scope.warehouseId || '');
  const line = (item, quantity, rate) => ({ itemId: String(item.id), description: item.name, itemName: item.name, quantity, unit: item.unit, hsnSac: item.hsnSac, rate, gstRate: 18, taxableAmount: round(quantity * rate), amount: round(quantity * rate), gstAmount: round(quantity * rate * 0.18) });
  const values = (lines, interstate = false) => {
    const subtotal = round(lines.reduce((total, item) => total + item.amount, 0));
    const gstTotal = round(subtotal * 0.18);
    return { subtotal, taxableTotal: subtotal, cgstTotal: interstate ? 0 : round(gstTotal / 2), sgstTotal: interstate ? 0 : round(gstTotal / 2), igstTotal: interstate ? gstTotal : 0, gstTotal, total: round(subtotal + gstTotal) };
  };
  const document = (number, date, lines, interstate = false) => ({ number, date, items: lines, ...values(lines, interstate), branchId, warehouseId, status: 'Unpaid' });
  const allocated = (voucherType, voucher, amount) => [{ voucherType, voucherId: voucher.id, documentNumber: voucher.number, amount }];
  const tdsEvent = (date, sourceType, source, party, side, baseAmount, rate) => add('tdsTransactions', { date, transactionDate: date, deductionDate: date, sourceType, sourceId: source.id, sourceNumber: source.number, partyId: party.id, partyName: party.name, side, natureCode: side === 'PAYABLE' ? '194J' : '194C', section: side === 'PAYABLE' ? '194J' : '194C', baseAmount, taxableAmount: baseAmount, rate, tdsAmount: round(baseAmount * rate / 100), status: 'Posted', returnQuarter: `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`, branchId });

  for (let index = 0; index < 12; index += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const suffix = stamp(year, monthIndex);
    const date = (day) => iso(year, monthIndex, day);
    const supplyLines = [line(goods, 20 + index, 9000 + index * 50), line(spare, 12, 800)];
    const saleLines = [line(goods, 10 + index, 15000 + index * 100), line(spare, 4, 1500)];
    const maintenanceLines = [line(service, 1, 40000 + index * 250)];
    const expenseLines = [line(service, 1, 12000 + index * 100)];
    const directExpenseLines = [line(service, 1, 3200 + index * 40)];

    const purchaseOrder = add('purchaseOrders', { ...document(`SAMPLE-PO-${suffix}`, date(2), supplyLines), vendorId: vendor.id, vendorName: vendor.name, status: 'Pending' });
    const bill = add('bills', { ...document(`SAMPLE-BILL-${suffix}`, date(4), supplyLines), vendorId: vendor.id, vendorName: vendor.name, sourcePurchaseOrderId: purchaseOrder.id, dueDate: date(27), paidAmount: 0 });
    add('debitNotes', { ...document(`SAMPLE-DN-${suffix}`, date(9), [line(spare, 1, 800)]), vendorId: vendor.id, vendorName: vendor.name, originalBillId: bill.id, originalBillNumber: bill.number, status: 'Open', settlementMode: 'DOCUMENT' });
    const payableTds = tdsEvent(date(10), 'bill', bill, vendor, 'PAYABLE', bill.subtotal, 1);
    bill.tdsAmount = payableTds.tdsAmount;
    bill.tdsRate = 1;
    bill.tdsSection = '194C';
    bill.netPayable = round(bill.total - bill.tdsAmount);
    const billSettlement = round(bill.total * 0.42);
    add('payments', { number: `SAMPLE-PAY-${suffix}`, paymentNo: `SAMPLE-PAY-${suffix}`, date: date(13), voucherType: 'payment', direction: 'OUT', vendorId: vendor.id, vendorName: vendor.name, amount: billSettlement, allocatedAmount: billSettlement, allocations: allocated('bill', bill, billSettlement), mode: 'Bank', ledgerAccountId: String(bank.id), cashBankAccountId: bank.id, reconciled: index % 3 !== 0, bankDate: index % 3 === 0 ? '' : date(14), status: 'Recorded' });
    bill.paidAmount = billSettlement;
    bill.status = 'Partial';

    const salesOrder = add('salesOrders', { ...document(`SAMPLE-SO-${suffix}`, date(3), saleLines), customerId: customer.id, customerName: customer.name, status: 'Open' });
    const invoice = add('invoices', { ...document(`SAMPLE-INV-${suffix}`, date(7), saleLines), customerId: customer.id, customerName: customer.name, sourceSalesOrderId: salesOrder.id, dueDate: date(28), paidAmount: 0 });
    add('creditNotes', { ...document(`SAMPLE-CN-${suffix}`, date(11), [line(spare, 1, 1500)]), customerId: customer.id, customerName: customer.name, originalInvoiceId: invoice.id, originalInvoiceNumber: invoice.number, originalInvoiceDate: invoice.date, settlementMode: 'DOCUMENT', status: 'Open' });
    const invoiceSettlement = round(invoice.total * 0.38);
    add('payments', { number: `SAMPLE-RCPT-${suffix}`, receiptNo: `SAMPLE-RCPT-${suffix}`, date: date(15), voucherType: 'receipt', direction: 'IN', customerId: customer.id, customerName: customer.name, amount: invoiceSettlement, allocatedAmount: invoiceSettlement, netCashAmount: invoiceSettlement, allocations: allocated('invoice', invoice, invoiceSettlement), mode: index % 4 === 0 ? 'Cash' : 'Bank', ledgerAccountId: String(index % 4 === 0 ? cash.id : bank.id), cashBankAccountId: index % 4 === 0 ? cash.id : bank.id, reconciled: index % 3 !== 1, bankDate: index % 3 === 1 ? '' : date(16), status: 'Recorded' });
    invoice.paidAmount = invoiceSettlement;
    invoice.status = 'Partial';

    const serviceInvoice = add('invoices', { ...document(`SAMPLE-SVC-${suffix}`, date(12), maintenanceLines, true), customerId: serviceCustomer.id, customerName: serviceCustomer.name, dueDate: date(29), tdsSection: '194C', tdsRate: 2, tdsAmount: round(maintenanceLines[0].amount * 0.02), tdsExpectedAmount: round(maintenanceLines[0].amount * 0.02), paidAmount: 0, taxType: 'IGST' });
    const serviceSettlement = round(serviceInvoice.total * 0.3);
    const receiptTds = round(serviceSettlement / 1.18 * 0.02);
    const serviceReceipt = add('payments', { number: `SAMPLE-SVC-RCPT-${suffix}`, receiptNo: `SAMPLE-SVC-RCPT-${suffix}`, date: date(20), voucherType: 'receipt', direction: 'IN', customerId: serviceCustomer.id, customerName: serviceCustomer.name, amount: serviceSettlement, allocatedAmount: serviceSettlement, tdsAmount: receiptTds, netCashAmount: round(serviceSettlement - receiptTds), allocations: allocated('invoice', serviceInvoice, serviceSettlement), mode: 'Bank', ledgerAccountId: String(bank.id), cashBankAccountId: bank.id, reconciled: false, status: 'Recorded' });
    tdsEvent(date(20), 'receipt', serviceReceipt, serviceCustomer, 'RECEIVABLE', round(serviceSettlement / 1.18), 2);
    serviceInvoice.paidAmount = serviceSettlement;
    serviceInvoice.status = 'Partial';

    const expenseOrder = add('purchaseOrders', { ...document(`SAMPLE-EXP-PO-${suffix}`, date(5), expenseLines), vendorId: serviceVendor.id, vendorName: serviceVendor.name, status: 'Pending' });
    const expenseBill = add('bills', { ...document(`SAMPLE-EXP-BILL-${suffix}`, date(8), expenseLines), vendorId: serviceVendor.id, vendorName: serviceVendor.name, sourcePurchaseOrderId: expenseOrder.id, dueDate: date(28), paidAmount: 0, category: 'Office services' });
    add('debitNotes', { ...document(`SAMPLE-EXP-DN-${suffix}`, date(17), [line(service, 1, 1000)]), vendorId: serviceVendor.id, vendorName: serviceVendor.name, originalBillId: expenseBill.id, originalBillNumber: expenseBill.number, status: 'Open', settlementMode: 'DOCUMENT' });
    const expenseVoucher = add('expenses', { number: `SAMPLE-EXP-${suffix}`, date: date(19), dueDate: date(28), vendorId: serviceVendor.id, vendorName: serviceVendor.name, description: 'Sample office utilities', category: 'Office services', ledgerId: operatingExpense.id, lines: directExpenseLines.map((item) => ({ ...item, ledgerId: operatingExpense.id })), ...values(directExpenseLines), amount: directExpenseLines[0].amount, paidAmount: 0, status: 'Unpaid', branchId });
    const expenseTds = tdsEvent(date(8), 'expense', expenseVoucher, serviceVendor, 'PAYABLE', expenseVoucher.subtotal, 2);
    expenseVoucher.tdsAmount = expenseTds.tdsAmount;
    expenseVoucher.tdsRate = 2;
    const expenseSettlement = round(expenseBill.total * 0.35);
    add('payments', { number: `SAMPLE-EXP-PAY-${suffix}`, paymentNo: `SAMPLE-EXP-PAY-${suffix}`, date: date(21), voucherType: 'payment', direction: 'OUT', vendorId: serviceVendor.id, vendorName: serviceVendor.name, amount: expenseSettlement, allocatedAmount: expenseSettlement, allocations: allocated('bill', expenseBill, expenseSettlement), mode: 'Bank', ledgerAccountId: String(bank.id), cashBankAccountId: bank.id, reconciled: index % 2 === 0, bankDate: index % 2 === 0 ? date(22) : '', status: 'Recorded' });
    expenseBill.paidAmount = expenseSettlement;
    expenseBill.status = 'Partial';

    const journal = (name, day, debitId, creditId, amount) => add('journalEntries', { number: `SAMPLE-JE-${name}-${suffix}`, date: date(day), narration: `Sample ${name.toLowerCase()} entry`, lines: [{ accountId: debitId, debit: amount, credit: 0 }, { accountId: creditId, debit: 0, credit: amount }], totalDebit: amount, totalCredit: amount, status: 'Posted' });
    journal('BANK-TO-CASH', 18, cash.id, bank.id, 2000 + index * 50);
    journal('EQUIPMENT', 24, equipment.id, bank.id, 1000 + index * 25);
    journal('DEPRECIATION', 25, operatingExpense.id, equipment.id, 300 + index * 10);
    if (index % 3 === 0) add('bankTransactions', { date: date(26), bankDate: '', cashBankAccountId: bank.id, amount: 450 + index * 5, direction: 'OUT', description: 'Sample uncategorised bank charge', refNo: `SAMPLE-BANK-${suffix}`, reconciled: false, status: 'Unallocated', branchId });
  }

  next.sampleScenarioSets = [...rows(db.sampleScenarioSets), { key, companyId, months: 12, createdAt: new Date().toISOString() }];
  return { db: next, added: true, key };
}

/** Additional, idempotent examples for each inventory report bucket. */
export function addInventoryReportSamples(db, company, now = new Date(), scope = {}) {
  const companyId = company?.id;
  if (companyId == null) throw new Error('Select a company before adding inventory examples.');
  const key = `inventory-reports-v1:${companyId}`;
  const availableWarehouses = [...rows(scope.warehouses), ...rows(db.warehouses)];
  const preferredWarehouse = availableWarehouses.find(row => String(row.id) === String(scope.warehouseId))
    || availableWarehouses.find(row => String(row.branchId) === String(scope.branchId))
    || availableWarehouses[0];
  const scopedBranchId = String(scope.branchId || preferredWarehouse?.branchId || '');
  const scopedWarehouseId = String(scope.warehouseId || preferredWarehouse?.id || '');
  if (rows(db.sampleScenarioSets).some(entry => String(entry.companyId) === String(companyId) && entry.key === key)) {
    const existingBill = rows(db.bills).find(entry => entry.sampleScenarioKey === key);
    if (!existingBill || !scopedWarehouseId || (String(existingBill.warehouseId) === scopedWarehouseId && String(existingBill.branchId) === scopedBranchId && Number(existingBill.total) > 0)) return { db, added: false, key };
    const repaired = { ...db };
    const sampleVendor = rows(db.vendors).find(row => row.sampleScenarioKey?.startsWith('linked-v1:'));
    const sampleCustomer = rows(db.customers).find(row => row.sampleScenarioKey?.startsWith('linked-v1:'));
    for (const collection of ['items', 'bills', 'invoices', 'batches']) {
      repaired[collection] = rows(db[collection]).map(entry => {
        if (entry.sampleScenarioKey !== key) return entry;
        const subtotal = rows(entry.items).reduce((sum, line) => sum + Number(line.amount || 0), 0);
        return { ...entry, branchId: scopedBranchId, warehouseId: scopedWarehouseId,
          ...(collection === 'bills' || collection === 'invoices' ? { subtotal, taxableTotal: subtotal, total: subtotal, amount: subtotal } : {}),
          ...(collection === 'bills' && sampleVendor ? { vendorId: sampleVendor.id, vendorName: sampleVendor.name } : {}),
          ...(collection === 'invoices' && sampleCustomer ? { customerId: sampleCustomer.id, customerName: sampleCustomer.name } : {}) };
      });
    }
    return { db: repaired, added: true, repaired: true, key };
  }

  const next = { ...db };
  const add = (collection, value) => {
    if (!Array.isArray(next[collection])) next[collection] = [];
    if (next[collection] === db[collection]) next[collection] = [...next[collection]];
    const id = next[collection].reduce((max, entry) => Math.max(max, Number(entry?.id) || 0), 0) + 1;
    const entry = { id, companyId, sampleScenarioKey: key, ...value };
    next[collection].push(entry);
    return entry;
  };
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dateOffset = days => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
  const branch = rows(db.branches).find(row => String(row.id) === scopedBranchId && String(row.companyId) === String(companyId))
    || (scopedBranchId ? add('branches', { id: scopedBranchId, name: rows(scope.branches).find(row => String(row.id) === scopedBranchId)?.name || 'Sample Branch' }) : null)
    || rows(db.branches).find(row => String(row.companyId) === String(companyId))
    || add('branches', { name: 'Sample Branch' });
  const warehouse = rows(db.warehouses).find(row => String(row.id) === scopedWarehouseId && String(row.companyId) === String(companyId))
    || (scopedWarehouseId ? add('warehouses', { id: scopedWarehouseId, name: preferredWarehouse?.name || 'Sample Warehouse', branchId: branch.id }) : null)
    || rows(db.warehouses).find(row => String(row.companyId) === String(companyId))
    || add('warehouses', { name: 'Sample Warehouse', branchId: branch.id });
  const branchId = scopedBranchId || String(branch.id);
  const warehouseId = scopedWarehouseId || String(warehouse.id);
  const item = (name, code, reorderLevel, purchasePrice, trackingType = 'BATCH_EXPIRY') => add('items', {
    name, code, type: 'goods', itemType: 'goods', unit: 'Nos', uom: 'Nos',
    trackingType, reorderLevel, purchasePrice, openingQty: 0,
    branchId, warehouseId,
  });
  const near = item('Sample Near Expiry Kits', 'SMP-EXP-NEAR', 10, 120);
  const expired = item('Sample Expired Reagents', 'SMP-EXP-OLD', 5, 90);
  const fresh = item('Sample Fresh Test Packs', 'SMP-EXP-FRESH', 5, 150);
  const low = item('Sample Low Stock Parts', 'SMP-REORDER', 12, 200, 'NONE');
  const negative = item('Sample Negative Stock Parts', 'SMP-NEGATIVE', 8, 75, 'NONE');
  const billNumber = `SAMPLE-INVST-BILL-${dateOffset(0).replaceAll('-', '')}`;
  const invoiceNumber = `SAMPLE-INVST-SALE-${dateOffset(0).replaceAll('-', '')}`;
  const purchaseLines = [[near, 12], [expired, 9], [fresh, 7], [low, 5]].map(([entry, quantity]) => ({
    itemId: String(entry.id), itemName: entry.name, description: entry.name,
    quantity, rate: entry.purchasePrice, amount: quantity * entry.purchasePrice,
  }));
  const purchaseSubtotal = purchaseLines.reduce((sum, line) => sum + line.amount, 0);
  const sampleVendor = rows(db.vendors).find(row => row.sampleScenarioKey?.startsWith('linked-v1:'));
  add('bills', {
    number: billNumber, date: dateOffset(-6), status: 'Posted', branchId, warehouseId,
    vendorId: sampleVendor?.id, vendorName: sampleVendor?.name,
    items: purchaseLines, subtotal: purchaseSubtotal, taxableTotal: purchaseSubtotal, total: purchaseSubtotal, amount: purchaseSubtotal,
  });
  const batchFor = (entry, quantity, expiryOffset, label) => add('batches', {
    itemId: entry.id, batchNo: `SAMPLE-${label}-${dateOffset(0).replaceAll('-', '')}`,
    mfgDate: dateOffset(-120), expiryDate: dateOffset(expiryOffset), qtyIn: quantity,
    sourceBillNumber: billNumber, warehouseId, createdAt: dateOffset(-6),
  });
  const nearBatch = batchFor(near, 12, 14, 'NEAR');
  batchFor(expired, 9, -12, 'EXPIRED');
  batchFor(fresh, 7, 120, 'FRESH');
  const saleLines = [[near, 3, nearBatch.id], [low, 4, null], [negative, 6, null]].map(([entry, quantity, batchId]) => ({
    itemId: String(entry.id), itemName: entry.name, description: entry.name,
    quantity, rate: entry.purchasePrice * 1.5, amount: quantity * entry.purchasePrice * 1.5,
    ...(batchId ? { batchId } : {}),
  }));
  const saleSubtotal = saleLines.reduce((sum, line) => sum + line.amount, 0);
  const sampleCustomer = rows(db.customers).find(row => row.sampleScenarioKey?.startsWith('linked-v1:'));
  add('invoices', {
    number: invoiceNumber, date: dateOffset(-3), status: 'Posted', branchId, warehouseId,
    customerId: sampleCustomer?.id, customerName: sampleCustomer?.name,
    items: saleLines, subtotal: saleSubtotal, taxableTotal: saleSubtotal, total: saleSubtotal, amount: saleSubtotal,
  });
  next.sampleScenarioSets = [...rows(db.sampleScenarioSets), { key, companyId, createdAt: now.toISOString() }];
  return { db: next, added: true, key };
}
