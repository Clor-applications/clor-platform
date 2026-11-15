import { orgId as platformOrgId } from '@platform/context';

export const PERIOD_MODULES = [
  ['sales', 'Sales, including credit notes'],
  ['purchases', 'Purchases, including debit notes'],
  ['expenses', 'Expenses'],
  ['cashBank', 'Cash & bank, receipts and payments'],
  ['inventory', 'Inventory'],
  ['journal', 'Journal entries'],
];

export const defaultPeriodLockPolicy = () => ({
  enabled: false,
  modules: Object.fromEntries(PERIOD_MODULES.map(([key]) => [key, { enabled: false, mode: 'MANUAL', manualThrough: '', autoDays: 0, exemptUserIds: [] }])),
  exemptUserIds: [],
});

export const policyForCompany = (db, companyId) =>
  (db?.periodLockPolicies || []).find((row) => Number(row.companyId) === Number(companyId))?.policy || defaultPeriodLockPolicy();

export const moduleForCollection = (key) => ({
  invoices: 'sales', creditNotes: 'sales', estimates: 'sales', salesOrders: 'sales',
  bills: 'purchases', debitNotes: 'purchases', purchaseOrders: 'purchases',
  expenses: 'expenses', receipts: 'cashBank', payments: 'cashBank', bankTransactions: 'cashBank',
  stockAdjustments: 'inventory', stockTransfers: 'inventory', inventoryAdjustments: 'inventory',
  journalEntries: 'journal',
})[key] || null;

export const moduleForDescription = (what = '') => {
  const value = String(what).toLowerCase();
  if (/invoice|credit note|quotation|sales order/.test(value)) return 'sales';
  if (/bill|debit note|purchase/.test(value)) return 'purchases';
  if (/expense/.test(value)) return 'expenses';
  if (/receipt|payment|cash|bank|contra/.test(value)) return 'cashBank';
  if (/stock|inventory|transfer|adjustment/.test(value)) return 'inventory';
  if (/journal|entry/.test(value)) return 'journal';
  return null;
};

export const periodLockThrough = (policy, module, now = new Date()) => {
  const rule = policy?.modules?.[module];
  if (!policy?.enabled || !rule?.enabled) return '';
  if (rule.mode !== 'AUTO') return String(rule.manualThrough || '').slice(0, 10);
  const days = Math.max(0, Math.min(365, Number(rule.autoDays) || 0));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let monthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  while (new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate() + days) >= today) {
    monthEnd = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 0);
  }
  return `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
};

export const moduleLockMessage = (db, companyId, module, date, userId = '') => {
  const orgId = typeof localStorage === 'undefined' ? '' : platformOrgId();
  if (orgId && localStorage.getItem(`periodLockFeature:${orgId}`) === 'false') return null;
  const policy = policyForCompany(db, companyId);
  if (policy.exemptUserIds?.includes(String(userId)) || policy.modules?.[module]?.exemptUserIds?.includes(String(userId))) return null;
  const through = periodLockThrough(policy, module);
  if (!through || !date || String(date).slice(0, 10) > through) return null;
  const label = PERIOD_MODULES.find(([key]) => key === module)?.[1] || module;
  return `${label} entries dated on or before ${through} are locked. Change the date or update Organization Settings → Period Lock.`;
};
