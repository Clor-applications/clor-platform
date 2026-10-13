import { tdsEventFrom } from './engine';
import { natureForSection, resolveRule, ruleReference } from './ruleMaster';

const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const live = (event) => String(event?.status || '').toLowerCase() === 'posted' && !event?.reversalOfId;

const sameComplianceValues = (left, right) => [
  'companyId', 'branchId', 'sourceType', 'sourceId', 'sourceNumber', 'partyId', 'partyName',
  'panSnapshot', 'transactionDate', 'deductionDate', 'natureCode', 'ruleVersionId',
  'sectionReference', 'sectionCode', 'baseAmount', 'rate', 'tdsAmount', 'ledgerId', 'side',
  'returnQuarter', 'status',
].every((key) => String(left?.[key] ?? '') === String(right?.[key] ?? ''));

/**
 * Bring expense vouchers and the normalized compliance register back into
 * agreement. Older expense saves and server hydration can deliver a voucher
 * with TDS fields but no TDS_EVENT row. This creates that missing row and
 * refreshes its snapshots when the source voucher changes.
 */
export const reconcileExpenseTdsTransactions = (db, company) => {
  const companyId = Number(company?.id);
  if (!companyId) return db;

  const expenses = (Array.isArray(db?.expenses) ? db.expenses : []).filter(
    (expense) => Number(expense?.companyId) === companyId
  );
  const ledgers = Array.isArray(db?.chartOfAccounts) ? db.chartOfAccounts : [];
  const vendors = Array.isArray(db?.vendors) ? db.vendors : [];
  let events = Array.isArray(db?.tdsTransactions) ? db.tdsTransactions : [];
  let changed = false;
  let nextId = events.reduce((max, event) => Math.max(max, Number(event?.id) || 0), 0);

  for (const expense of expenses) {
    if (/draft|cancel|revers/i.test(String(expense?.status || ''))) continue;
    const amount = r2(expense?.tdsAmount);
    if (amount <= 0.005) continue;

    const ledger = ledgers.find((row) => String(row?.id) === String(expense?.tdsLedgerId || ''));
    const natureCode = String(
      expense?.tdsNatureCode || ledger?.tdsNatureCode || natureForSection(expense?.tdsSection || ledger?.tdsSection)?.code || ''
    ).trim();
    if (!natureCode || !ledger) continue;

    const vendor = vendors.find((row) => String(row?.id) === String(expense?.vendorId || ''))
      || vendors.find((row) => String(row?.displayName || row?.name || '').trim().toLowerCase() === String(expense?.vendorName || '').trim().toLowerCase());
    if (!vendor) continue;

    const rate = Number(expense?.tdsRate || ledger?.tdsRate || 0);
    const baseAmount = r2(
      expense?.tdsBaseAmount
      || (rate > 0 ? (amount * 100) / rate : 0)
      || expense?.taxableTotal
      || expense?.subtotal
    );
    const rule = resolveRule(natureCode, expense?.date);
    const desired = tdsEventFrom(
      {
        natureCode,
        ruleVersionId: rule?.id || '',
        statutoryReference: ruleReference(rule),
        sectionCode: rule?.sectionCode || expense?.tdsSection || ledger?.tdsSection || '',
        baseAmount,
        rate,
        tdsAmount: amount,
        ledgerId: String(ledger.id),
        side: 'PAYABLE',
      },
      {
        company,
        party: vendor,
        source: { type: 'expense', id: expense.id, number: expense.number },
        branchId: expense?.branchId || '',
        date: expense?.date,
      }
    );
    const existingIndex = events.findIndex(
      (event) =>
        Number(event?.companyId) === companyId &&
        String(event?.sourceType) === 'expense' &&
        String(event?.sourceId) === String(expense.id) &&
        live(event)
    );

    if (existingIndex < 0) {
      events = [...events, { id: ++nextId, ...desired }];
      changed = true;
      continue;
    }

    const existing = events[existingIndex];
    if (sameComplianceValues(existing, desired)) continue;
    const replacement = {
      ...existing,
      ...desired,
      id: existing.id,
      uid: existing.uid,
      backendMasterId: existing.backendMasterId,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      modifiedAt: new Date().toISOString(),
    };
    events = events.map((event, index) => index === existingIndex ? replacement : event);
    changed = true;
  }

  return changed ? { ...db, tdsTransactions: events } : db;
};

export default reconcileExpenseTdsTransactions;
