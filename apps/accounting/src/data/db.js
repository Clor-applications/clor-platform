// Centralized DB initialization + migrations
import { computeInventorySummaryByItemId, getItemOpeningQty, isStockItem } from '@ui/utils/inventory.js';

export const getDefaultDocSettings = () => ({
  numbering: {
    invoice: { mode: 'auto', prefix: 'INV-', suffix: '', nextNumber: 1, allowManualOverride: true },
    estimate: { mode: 'auto', prefix: 'EST-', suffix: '', nextNumber: 1, allowManualOverride: true },
    bill: { mode: 'auto', prefix: 'BILL-', suffix: '', nextNumber: 1, allowManualOverride: true },
    purchaseOrder: { mode: 'auto', prefix: 'PO-', suffix: '', nextNumber: 1, allowManualOverride: true },
    expense: { mode: 'auto', prefix: 'EXP-', suffix: '', nextNumber: 1, allowManualOverride: true },
    creditNote: { mode: 'auto', prefix: 'CN-', suffix: '', nextNumber: 1, allowManualOverride: true },
    debitNote: { mode: 'auto', prefix: 'DN-', suffix: '', nextNumber: 1, allowManualOverride: true },
    journalEntry: { mode: 'auto', prefix: 'JE-', suffix: '', nextNumber: 1, allowManualOverride: true },
    /**
     * Item codes, kept per item type.
     *
     * Codes were `ITM${Date.now()}` — a thirteen-digit timestamp, unique but
     * unreadable and identical in shape for a bag of cement and an hour of
     * labour. A business that wants its goods and its services numbered
     * apart could not have it.
     *
     * Off by default: switching it on is a decision about how a company
     * names its things, and until it is made the old timestamp is what
     * existing books already contain.
     */
    itemCode: {
      enabled: false,
      goods: { prefix: 'GD-', digits: 4, nextNumber: 1 },
      service: { prefix: 'SV-', digits: 4, nextNumber: 1 },
    },
  },
  templates: {
    invoice: { templateId: 'classic', accentId: 'blue' },
    estimate: { templateId: 'classic', accentId: 'blue' },
    bill: { templateId: 'classic', accentId: 'indigo' },
    purchaseOrder: { templateId: 'classic', accentId: 'indigo' },
    expense: { templateId: 'minimal', accentId: 'slate' },
    creditNote: { templateId: 'classic', accentId: 'orange' },
    debitNote: { templateId: 'classic', accentId: 'orange' },
    journalEntry: { templateId: 'minimal', accentId: 'slate' },
  },
  migrations: {},
});

/**
 * There is no demo book any more.
 *
 * This built "Demo Company Ltd" of 123 Business St, New York — an American
 * address on an Indian GST product — together with invented customers,
 * vendors and items. A signed-in company already started empty via
 * initEmptyDB; only the signed-out book was still furnished with strangers,
 * so anyone opening the product cold judged it on fake data and could not
 * tell their own first record from the fixtures.
 *
 * Kept as a name because callers import it; it now returns the same empty
 * book everyone else gets.
 */
export const initDB = () => initEmptyDB();

// Empty tenant DB: no demo company, masters, or transactions.
// normalizeDB() will still ensure required arrays and per-company system defaults.
export const initEmptyDB = () => {
  return {
    companies: [],
    users: [],
    accountTypes: [],
    accountGroups: [],
    chartOfAccounts: [],
    customers: [],
    vendors: [],
    bankTransactions: [],
    items: [],
    invoices: [],
    estimates: [],
    creditNotes: [],
    purchaseOrders: [],
    bills: [],
    debitNotes: [],
    expenses: [],
    stockTransfers: [],
    journalEntries: [],
    payments: [],
    msmeBankRates: [],
    gstRates: [],
    uoms: [],
  };
};

/**
 * Removed: seedDummyDataV1.
 *
 * Generated seventy-five invented customers, vendors, items, invoices and
 * payments into a company. Nothing called it — it was reachable only by
 * editing code — but it sat here as a standing invitation to put fake rows
 * into a real set of books, and it is the last generator of invented data in
 * the file. The books start empty and stay that way.
 */

export const normalizeDB = (db) => {
  const next = { ...db };

  if (!Array.isArray(next.bankTransactions)) next.bankTransactions = [];

  if (!Array.isArray(next.stockTransfers)) next.stockTransfers = [];

  if (!Array.isArray(next.accountTypes)) next.accountTypes = [];
  if (!Array.isArray(next.accountGroups)) next.accountGroups = [];

  const ensureDefaultsForCompany = (companyId) => {
    const types = next.accountTypes.filter((t) => Number(t.companyId) === Number(companyId));
    const groups = next.accountGroups.filter((g) => Number(g.companyId) === Number(companyId));

    const TEMPLATE_TYPES = [
      { main: 'Balance Sheet', accountClass: 'Asset', name: 'Assets' },
      { main: 'Balance Sheet', accountClass: 'Liability', name: 'Liabilities' },
      { main: 'P&L', accountClass: 'Expense', name: 'Expenses' },
      { main: 'P&L', accountClass: 'Income', name: 'Income' },
    ];

    const ensureType = ({ main, accountClass, name }) => {
      const found = types.find(
        (t) =>
          String(t.main || '').trim() === main &&
          String(t.accountClass || '').trim() === accountClass &&
          String(t.name || '').trim().toLowerCase() === name.toLowerCase()
      );
      if (found) {
        found.isSystem = true;
        found.isLegacy = Boolean(found.isLegacy) && false;
        return found;
      }
      const nextId = next.accountTypes.reduce((m, t) => Math.max(m, Number(t?.id || 0)), 0) + 1;
      const created = { id: nextId, companyId, main, accountClass, name, isSystem: true };
      next.accountTypes.push(created);
      types.push(created);
      return created;
    };

    const typeByName = new Map();
    for (const t of TEMPLATE_TYPES) {
      const row = ensureType(t);
      typeByName.set(t.name, row);
    }

    const TEMPLATE_GROUPS = [
      { typeName: 'Assets', name: 'Current Assets' },
      { typeName: 'Assets', name: 'Bank Accounts', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'Cash-in-Hand', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'Deposits (Asset)', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'TDS Receivable', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'Loans & Advances (Asset)', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'Inventory', parentName: 'Current Assets' },
      { typeName: 'Assets', name: 'Sundry Debtors', parentName: 'Current Assets', groupCategory: 'Customer' },
      { typeName: 'Assets', name: 'Fixed Assets' },
      { typeName: 'Assets', name: 'Investments' },

      { typeName: 'Liabilities', name: 'Capital Account' },
      { typeName: 'Liabilities', name: 'Reserves & Surplus' },
      { typeName: 'Liabilities', name: 'Current Liabilities' },
      { typeName: 'Liabilities', name: 'Duties & Taxes', parentName: 'Current Liabilities' },
      { typeName: 'Liabilities', name: 'TDS Payable', parentName: 'Current Liabilities' },
      { typeName: 'Liabilities', name: 'Provisions', parentName: 'Current Liabilities' },
      { typeName: 'Liabilities', name: 'Sundry Creditors', parentName: 'Current Liabilities', groupCategory: 'Vendor' },
      { typeName: 'Liabilities', name: 'Loans (Liability)' },
      { typeName: 'Liabilities', name: 'Bank OD A/c', parentName: 'Loans (Liability)' },
      { typeName: 'Liabilities', name: 'Secured Loans', parentName: 'Loans (Liability)' },
      { typeName: 'Liabilities', name: 'Unsecured Loans', parentName: 'Loans (Liability)' },
      { typeName: 'Liabilities', name: 'Suspense A/c' },
      { typeName: 'Liabilities', name: 'Profit & Loss A/c' },

      { typeName: 'Expenses', name: 'Direct Expenses', groupCategory: 'Expense' },
      { typeName: 'Expenses', name: 'Indirect Expenses', groupCategory: 'Expense' },
      { typeName: 'Expenses', name: 'Purchase Accounts', groupCategory: 'Expense' },

      { typeName: 'Income', name: 'Direct Incomes' },
      { typeName: 'Income', name: 'Indirect Incomes' },
      { typeName: 'Income', name: 'Sales Accounts' },
    ];

    const templateGroupKeySet = new Set();

    const ensureGroup = ({ typeId, name, parentGroupId = null, groupCategory = 'General', isLegacy = false }) => {
      const company = (Array.isArray(next.companies) ? next.companies : []).find(
        (row) => Number(row?.id) === Number(companyId)
      );
      const removedDefaults = new Set(
        Array.isArray(company?.docSettings?.deletedDefaultAccountGroups)
          ? company.docSettings.deletedDefaultAccountGroups.map((value) => String(value || '').trim().toLowerCase())
          : []
      );
      if (removedDefaults.has(String(name || '').trim().toLowerCase())) return null;

      const found = groups.find(
        (g) =>
          Number(g.typeId) === Number(typeId) &&
          String(g.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()
      );
      if (found) {
        found.isSystem = true;
        found.groupCategory = found.groupCategory || groupCategory;
        found.parentGroupId = parentGroupId;
        found.isLegacy = Boolean(found.isLegacy) && isLegacy;
        return found;
      }
      const nextId = next.accountGroups.reduce((m, g) => Math.max(m, Number(g?.id || 0)), 0) + 1;
      const created = { id: nextId, companyId, typeId: Number(typeId), name, parentGroupId, groupCategory, isSystem: true, isLegacy };
      next.accountGroups.push(created);
      groups.push(created);
      return created;
    };

    // Create parent groups first, then resolve child parent ids.
    for (const g of TEMPLATE_GROUPS.filter((row) => !row.parentName)) {
      const typeRow = typeByName.get(g.typeName);
      if (!typeRow) continue;
      templateGroupKeySet.add(`${Number(typeRow.id)}__${String(g.name).trim().toLowerCase()}`);
      ensureGroup({ typeId: typeRow.id, name: g.name, groupCategory: g.groupCategory, isLegacy: false });
    }
    for (const g of TEMPLATE_GROUPS.filter((row) => row.parentName)) {
      const typeRow = typeByName.get(g.typeName);
      if (!typeRow) continue;
      const parent = groups.find(
        (row) => Number(row.typeId) === Number(typeRow.id) && String(row.name || '').trim().toLowerCase() === g.parentName.toLowerCase()
      );
      templateGroupKeySet.add(`${Number(typeRow.id)}__${String(g.name).trim().toLowerCase()}`);
      ensureGroup({
        typeId: typeRow.id,
        name: g.name,
        parentGroupId: parent?.id ?? null,
        groupCategory: g.groupCategory,
        isLegacy: false,
      });
    }

    // Keep Primary fallback groups (legacy/hidden)
    for (const t of types) {
      ensureGroup({ typeId: t.id, name: 'Primary', groupCategory: 'General', isLegacy: true });
    }

    // Mark non-template types/groups as legacy (hidden from dropdowns), but keep them for existing ledgers
    const templateTypeNames = new Set(TEMPLATE_TYPES.map((t) => `${t.main}__${t.accountClass}__${t.name.toLowerCase()}`));
    for (const t of types) {
      if (t && t.isUserDefined) {
        t.isLegacy = false;
        continue;
      }
      const key = `${String(t.main || '').trim()}__${String(t.accountClass || '').trim()}__${String(t.name || '').trim().toLowerCase()}`;
      if (!templateTypeNames.has(key)) {
        t.isLegacy = true;
      } else {
        t.isLegacy = false;
        t.isSystem = true;
      }
    }
    for (const g of groups) {
      if (g && g.isUserDefined) {
        g.isLegacy = false;
        continue;
      }
      const key = `${Number(g.typeId)}__${String(g.name || '').trim().toLowerCase()}`;
      if (String(g.name || '').trim().toLowerCase() === 'primary') {
        g.isLegacy = true;
        continue;
      }
      if (!templateGroupKeySet.has(key)) {
        // Hard replace: anything outside the template is legacy/hidden.
        g.isLegacy = true;
      } else {
        g.isLegacy = false;
        g.isSystem = true;
      }
    }

    const sundryDebtors = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'sundry debtors') || null;
    const sundryCreditors = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'sundry creditors') || null;
    const cashInHand = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'cash-in-hand') || null;
    const indirectExpenses = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'indirect expenses') || null;
    const inputGstGroup = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'input gst') || null;
    const outputGstGroup = groups.find((x) => String(x.name || '').trim().toLowerCase() === 'output gst') || null;

    return { sundryDebtors, sundryCreditors, cashInHand, indirectExpenses, inputGstGroup, outputGstGroup };
  };

  const companies = Array.isArray(next.companies) ? next.companies : [];
  const templateInfoByCompany = new Map();
  for (const c of companies) {
    templateInfoByCompany.set(Number(c.id), ensureDefaultsForCompany(c.id));
  }

  if (Array.isArray(next.chartOfAccounts)) {
    next.chartOfAccounts = next.chartOfAccounts.map((a) => {
      const ledgerCategory = String(a?.ledgerCategory || '').trim();
      return {
        ...a,
        ledgerCategory: ledgerCategory || 'General',
        main: String(a?.main || '').trim() || (['Income', 'Expense'].includes(String(a?.type || '').trim()) ? 'P&L' : 'Balance Sheet'),
        groupId: a?.groupId !== undefined ? a.groupId : null,
      };
    });
  }

  // Hard replace: migrate existing ledgers into template groups (one-time per company)
  const getCompanyDocSettings = (company) => {
    const ds = company?.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
    const migrations = ds.migrations && typeof ds.migrations === 'object' ? ds.migrations : {};
    return { docSettings: ds, migrations };
  };

  const groupCategoryToLedgerCategory = (groupCategory) => {
    const c = String(groupCategory || '').trim();
    if (c === 'Customer') return 'Customer';
    if (c === 'Vendor') return 'Vendor';
    if (c === 'Expense') return 'Expense';
    return 'General';
  };

  const pickTemplateGroupName = (ledger) => {
    const ledgerCategory = String(ledger?.ledgerCategory || '').trim();
    const accountClass = String(ledger?.type || '').trim();
    const subType = String(ledger?.subType || '').trim().toLowerCase();
    const name = String(ledger?.name || '').trim().toLowerCase();

    if (ledgerCategory === 'Customer') return 'sundry debtors';
    if (ledgerCategory === 'Vendor') return 'sundry creditors';
    if (ledgerCategory === 'Expense') {
      // Keep it simple: default all expenses to Indirect Expenses.
      // Users can later create more ledgers under template groups as needed.
      return 'indirect expenses';
    }

     if (name.includes('receivable') || name.includes('debtors')) return 'sundry debtors';
     if (name.includes('payable') || name.includes('creditors')) return 'sundry creditors';
     if (name === "owner's equity" || name.includes('capital')) return 'capital account';
     if (name.includes('fixed assets') || (accountClass === 'Asset' && subType.includes('fixed'))) return 'fixed assets';

    if (accountClass === 'Asset') {
      if (name.includes('cash')) return 'cash-in-hand';
      if (name.includes('bank')) return 'bank accounts';
      if (name.includes('inventory') || name.includes('stock')) return 'inventory';
      if (name.includes('deposit')) return 'deposits (asset)';
      if (name.includes('advance') || name.includes('loan')) return 'loans & advances (asset)';
      if (subType.includes('fixed')) {
        return 'fixed assets';
      }
      // Default for other assets
      return 'loans & advances (asset)';
    }

    if (accountClass === 'Liability') {
      if (name.includes('creditor') || name.includes('payable')) return 'sundry creditors';
      if (name.includes('tax') || name.includes('gst') || name.includes('duty')) return 'duties & taxes';
      if (name.includes('provision')) return 'provisions';
      if (name.includes('overdraft') || name.includes('bank od')) return 'bank od a/c';
      if (name.includes('unsecured')) return 'unsecured loans';
      if (name.includes('secured')) return 'secured loans';
      if (name.includes('loan')) return 'loans (liability)';
      if (name.includes('investment')) return 'investments';
      if (name.includes('suspense')) return 'suspense a/c';
      if (name.includes('profit') || name.includes('loss')) return 'profit & loss a/c';
      return 'current liabilities';
    }

    if (accountClass === 'Equity') {
      if (name.includes('reserve') || name.includes('surplus')) return 'reserves & surplus';
      return 'capital account';
    }

    if (accountClass === 'Income') {
      if (name.includes('sale')) return 'sales accounts';
      return 'indirect incomes';
    }

    if (accountClass === 'Expense') {
      return 'indirect expenses';
    }

    return 'cash-in-hand';
  };

  const migrateCompanyToTemplate = (company) => {
    const companyId = Number(company?.id);
    if (!companyId) return;

    const { docSettings, migrations } = getCompanyDocSettings(company);
    const alreadyApplied = Boolean(migrations.coaTemplateHardReplaceV1Applied);

    const allGroups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const allTypes = Array.isArray(next.accountTypes) ? next.accountTypes : [];

    const templateGroupsByName = new Map();
    for (const g of allGroups) {
      if (Number(g.companyId) !== companyId) continue;
      if (g.isLegacy) continue;
      templateGroupsByName.set(String(g.name || '').trim().toLowerCase(), g);
    }

    function getTemplateGroup(nameLower) {
      return templateGroupsByName.get(String(nameLower || '').trim().toLowerCase()) || null;
    }

    const isForcedLedgerName = (nm) => {
      const n = String(nm || '').trim().toLowerCase();
      if (!n) return false;
      return (
        n === 'accounts receivable' ||
        n === 'accounts payable' ||
        n === 'fixed assets' ||
        n === 'cash' ||
        n === 'inventory' ||
        n === "owner's equity" ||
        n === 'sales revenue' ||
        n === 'cogs' ||
        n === 'operating expenses' ||
        n === 'short term loan'
      );
    };

    const shouldForceTemplatePlacement = (ledger) => {
      const cat = String(ledger?.ledgerCategory || '').trim();
      if (cat === 'Customer' || cat === 'Vendor' || cat === 'Expense') return true;
      return isForcedLedgerName(ledger?.name);
    };

    const getTargetGroupForLedger = (ledger) => {
      const targetName = pickTemplateGroupName(ledger);
      return getTemplateGroup(targetName);
    };

    const typeById = new Map();
    for (const t of allTypes) {
      if (Number(t.companyId) !== companyId) continue;
      typeById.set(String(t.id), t);
    }

    const groupById = new Map();
    for (const g of allGroups) {
      if (Number(g.companyId) !== companyId) continue;
      groupById.set(String(g.id), g);
    }

    if (alreadyApplied) {
      const coa = Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : [];
      const hasNonTemplateLedger = coa.some((a) => {
        if (Number(a.companyId) !== companyId) return false;
        const gid = a?.groupId !== null && a?.groupId !== undefined && a?.groupId !== '' ? String(a.groupId) : '';
        if (!gid) return true;
        const g = groupById.get(gid);
        if (!g) return true;
        const gName = String(g.name || '').trim().toLowerCase();
        if (gName === 'primary') return true;
        return Boolean(g.isLegacy);
      });
        const hasMisplacedForcedLedger = coa.some((a) => {
          if (Number(a.companyId) !== companyId) return false;
          if (!shouldForceTemplatePlacement(a)) return false;
          const gid = a?.groupId !== null && a?.groupId !== undefined && a?.groupId !== '' ? String(a.groupId) : '';
          const currentGroup = gid ? groupById.get(gid) : null;
          const targetGroup = getTargetGroupForLedger(a);
          if (!targetGroup) return false;
          const currentName = String(currentGroup?.name || '').trim().toLowerCase();
          const targetName = String(targetGroup?.name || '').trim().toLowerCase();
          return currentName !== targetName;
        });

        if (!hasNonTemplateLedger && !hasMisplacedForcedLedger) return;
    }

    const updateLedgerToGroup = (ledger, group) => {
      const t = group ? typeById.get(String(group.typeId)) : null;
      const derivedType = String(t?.accountClass || ledger.type || '').trim();
      const derivedSubType = String(t?.name || ledger.subType || '').trim();
      const derivedMain = String(t?.main || ledger.main || '').trim();

      return {
        ...ledger,
        groupId: group ? Number(group.id) : ledger.groupId,
        ledgerCategory: group ? groupCategoryToLedgerCategory(group.groupCategory) : ledger.ledgerCategory,
        type: derivedType || ledger.type,
        subType: derivedSubType || ledger.subType,
        main: derivedMain || ledger.main,
      };
    };

    if (Array.isArray(next.chartOfAccounts)) {
      next.chartOfAccounts = next.chartOfAccounts.map((a) => {
        if (Number(a.companyId) !== companyId) return a;

        const currentGroup = a?.groupId !== null && a?.groupId !== undefined && a?.groupId !== '' ? groupById.get(String(a.groupId)) : null;
        const alreadyTemplate = currentGroup && !currentGroup.isLegacy && String(currentGroup.name || '').trim().toLowerCase() !== 'primary';
          const force = shouldForceTemplatePlacement(a);
          if (alreadyTemplate) {
            if (!force) return a;
            // If the user placed an Expense ledger into a valid template expense group, keep it.
            // This prevents "Edit Ledger" (group change) from being overwritten on normalize.
            const cat = String(a?.ledgerCategory || '').trim();
            if (cat === 'Expense') {
              const gname = String(currentGroup?.name || '').trim().toLowerCase();
              const keep = gname === 'direct expenses' || gname === 'indirect expenses' || gname === 'purchase accounts';
              if (keep) return a;
            }
          }

          const targetGroup = getTargetGroupForLedger(a);
          if (!targetGroup) return a;

          const currentName = String(currentGroup?.name || '').trim().toLowerCase();
          const targetName = String(targetGroup?.name || '').trim().toLowerCase();
          if (!force && alreadyTemplate && currentName === targetName) return a;

          return updateLedgerToGroup(a, targetGroup);
      });
    }

    // Force customers/vendors to default template groups if missing or legacy
    const info = templateInfoByCompany.get(companyId) || {};
    const sundryDebtors = info.sundryDebtors && !info.sundryDebtors.isLegacy ? info.sundryDebtors : getTemplateGroup('sundry debtors');
    const sundryCreditors = info.sundryCreditors && !info.sundryCreditors.isLegacy ? info.sundryCreditors : getTemplateGroup('sundry creditors');

    if (Array.isArray(next.customers) && sundryDebtors) {
      next.customers = next.customers.map((cust) => {
        if (Number(cust.companyId) !== companyId) return cust;
        const currentGroup = cust?.groupId !== undefined && cust?.groupId !== null && cust?.groupId !== '' ? groupById.get(String(cust.groupId)) : null;
        const needsDefault = !cust?.groupId || (currentGroup && currentGroup.isLegacy);
        if (!needsDefault) return cust;
        return { ...cust, groupId: Number(sundryDebtors.id) };
      });
    }

    if (Array.isArray(next.vendors) && sundryCreditors) {
      next.vendors = next.vendors.map((vend) => {
        if (Number(vend.companyId) !== companyId) return vend;
        const currentGroup = vend?.groupId !== undefined && vend?.groupId !== null && vend?.groupId !== '' ? groupById.get(String(vend.groupId)) : null;
        const needsDefault = !vend?.groupId || (currentGroup && currentGroup.isLegacy);
        if (!needsDefault) return vend;
        return { ...vend, groupId: Number(sundryCreditors.id) };
      });
    }

    // Stamp migration
    const appliedAt = new Date().toISOString();
    const nextMigrations = { ...migrations, coaTemplateHardReplaceV1Applied: true, coaTemplateHardReplaceV1AppliedAt: appliedAt };
    const nextDocSettings = { ...docSettings, migrations: nextMigrations };
    next.companies = (Array.isArray(next.companies) ? next.companies : []).map((c) =>
      Number(c.id) === companyId ? { ...c, docSettings: nextDocSettings } : c
    );
  };

  for (const c of companies) migrateCompanyToTemplate(c);

  // Assign missing groupId for ledgers to a default "Primary" group within their derived type
  if (Array.isArray(next.chartOfAccounts)) {
    const groupByCompanyAndType = new Map();
    for (const g of next.accountGroups) {
      const companyId = Number(g.companyId);
      const typeId = Number(g.typeId);
      const key = `${companyId}__${typeId}__${String(g.name || '').trim().toLowerCase()}`;
      groupByCompanyAndType.set(key, g);
    }

    const typeByCompanyAndClass = new Map();
    for (const t of next.accountTypes) {
      const companyId = Number(t.companyId);
      const key = `${companyId}__${String(t.accountClass || '').trim()}`;
      if (!typeByCompanyAndClass.has(key)) typeByCompanyAndClass.set(key, t);
    }

    next.chartOfAccounts = next.chartOfAccounts.map((a) => {
      if (a?.groupId !== null && a?.groupId !== undefined && a?.groupId !== '') return a;
      const companyId = Number(a.companyId);
      const accountClass = String(a.type || '').trim() || 'Asset';
      const type = typeByCompanyAndClass.get(`${companyId}__${accountClass}`);
      if (!type) return a;
      const primary = groupByCompanyAndType.get(`${companyId}__${Number(type.id)}__primary`);
      if (!primary) return a;
      return {
        ...a,
        groupId: primary.id,
        subType: String(type.name || '').trim() || a.subType,
        main: String(type.main || '').trim() || a.main,
      };
    });
  }

  // Ensure customers have optional groupId and a linked ledger account
  if (Array.isArray(next.customers)) {
    const coa = Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : [];
    const groups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const types = Array.isArray(next.accountTypes) ? next.accountTypes : [];

    const typeById = new Map(types.map((t) => [String(t.id), t]));

    const findSundryDebtorsGroup = (companyId) =>
      groups.find(
        (g) =>
          Number(g.companyId) === Number(companyId) &&
          !g.isLegacy &&
          String(g.name || '').trim().toLowerCase() === 'sundry debtors'
      ) || null;

    const nextCoaIdBase = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0);
    let nextCoaId = nextCoaIdBase + 1;

    next.customers = next.customers.map((cust) => {
      const companyId = Number(cust.companyId);
      const existingAccountId = cust?.accountId ? String(cust.accountId) : '';
      const groupId = cust?.groupId !== undefined && cust?.groupId !== null && cust?.groupId !== '' ? Number(cust.groupId) : null;
      const defaultGroup = findSundryDebtorsGroup(companyId);
      const effectiveGroupId = groupId || (defaultGroup ? Number(defaultGroup.id) : null);

      const existingLedger = existingAccountId
        ? coa.find((a) => Number(a.companyId) === companyId && String(a.id) === existingAccountId)
        : null;

      if (existingLedger) {
        return {
          ...cust,
          groupId: effectiveGroupId,
          accountId: existingLedger.id,
        };
      }

      if (!effectiveGroupId) {
        return {
          ...cust,
          groupId: null,
          accountId: existingAccountId || '',
        };
      }

      const group = groups.find((g) => Number(g.id) === Number(effectiveGroupId) && Number(g.companyId) === companyId) || null;
      const type = group ? typeById.get(String(group.typeId)) : null;

      const code = `CUST-${cust.id}`;
      const name = String(cust.displayName || cust.name || '').trim() || `Customer ${cust.id}`;
      const newLedger = {
        id: nextCoaId++,
        companyId,
        code,
        name,
        ledgerCategory: 'Customer',
        groupId: effectiveGroupId,
        type: String(type?.accountClass || 'Asset'),
        subType: String(type?.name || ''),
        main: String(type?.main || 'Balance Sheet'),
        balance: Number(cust.balance || 0),
      };
      next.chartOfAccounts.push(newLedger);

      return {
        ...cust,
        groupId: effectiveGroupId,
        accountId: newLedger.id,
      };
    });
  }

  // Ensure vendors have optional groupId and a linked ledger account
  if (Array.isArray(next.vendors)) {
    const coa = Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : [];
    const groups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const types = Array.isArray(next.accountTypes) ? next.accountTypes : [];

    const typeById = new Map(types.map((t) => [String(t.id), t]));

    const findSundryCreditorsGroup = (companyId) =>
      groups.find(
        (g) =>
          Number(g.companyId) === Number(companyId) &&
          !g.isLegacy &&
          String(g.name || '').trim().toLowerCase() === 'sundry creditors'
      ) || null;

    let nextCoaId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;

    next.vendors = next.vendors.map((vend) => {
      const companyId = Number(vend.companyId);
      const existingAccountId = vend?.accountId ? String(vend.accountId) : '';
      const groupId = vend?.groupId !== undefined && vend?.groupId !== null && vend?.groupId !== '' ? Number(vend.groupId) : null;
      const defaultGroup = findSundryCreditorsGroup(companyId);
      const effectiveGroupId = groupId || (defaultGroup ? Number(defaultGroup.id) : null);

      const existingLedger = existingAccountId
        ? coa.find((a) => Number(a.companyId) === companyId && String(a.id) === existingAccountId)
        : null;

      if (existingLedger) {
        return {
          ...vend,
          groupId: effectiveGroupId,
          accountId: existingLedger.id,
        };
      }

      if (!effectiveGroupId) {
        return {
          ...vend,
          groupId: null,
          accountId: existingAccountId || '',
        };
      }

      const group = groups.find((g) => Number(g.id) === Number(effectiveGroupId) && Number(g.companyId) === companyId) || null;
      const type = group ? typeById.get(String(group.typeId)) : null;

      const code = `VEND-${vend.id}`;
      const name = String(vend.displayName || vend.name || '').trim() || `Vendor ${vend.id}`;
      const newLedger = {
        id: nextCoaId++,
        companyId,
        code,
        name,
        ledgerCategory: 'Vendor',
        groupId: effectiveGroupId,
        type: String(type?.accountClass || 'Liability'),
        subType: String(type?.name || ''),
        main: String(type?.main || 'Balance Sheet'),
        balance: Number(vend.balance || 0),
      };
      next.chartOfAccounts.push(newLedger);

      return {
        ...vend,
        groupId: effectiveGroupId,
        accountId: newLedger.id,
      };
    });
  }

  // Ensure GST ledgers exist and keep their balances in sync (derived from saved voucher GST totals)
  {
    const coa = Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : [];
    const groups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const types = Array.isArray(next.accountTypes) ? next.accountTypes : [];
    const typeById = new Map(types.map((t) => [String(t.id), t]));

    const sumDocs = (docs, companyId) => {
      const list = Array.isArray(docs) ? docs : [];
      return list.reduce(
        (acc, d) => {
          if (Number(d?.companyId) !== Number(companyId)) return acc;
          acc.cgst += Number(d?.cgstTotal ?? 0);
          acc.sgst += Number(d?.sgstTotal ?? 0);
          acc.igst += Number(d?.igstTotal ?? 0);
          return acc;
        },
        { cgst: 0, sgst: 0, igst: 0 }
      );
    };

    const ensureLedger = ({ companyId, groupId, code, name }) => {
      const group = groups.find((g) => Number(g.companyId) === Number(companyId) && !g.isLegacy && Number(g.id) === Number(groupId)) || null;
      if (!group) return null;
      const type = typeById.get(String(group.typeId)) || null;

      const byCode = coa.find((a) => Number(a.companyId) === Number(companyId) && String(a.code || '').trim().toLowerCase() === String(code || '').trim().toLowerCase());
      if (byCode) {
        return {
          ...byCode,
          name: String(name || '').trim() || byCode.name,
          isSystem: true,
          groupId: Number(group.id),
          ledgerCategory: String(byCode.ledgerCategory || '').trim() || 'General',
          type: String(type?.accountClass || byCode.type || ''),
          subType: String(type?.name || byCode.subType || ''),
          main: String(type?.main || byCode.main || ''),
        };
      }

      const byName = coa.find(
        (a) =>
          Number(a.companyId) === Number(companyId) &&
          String(a.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase() &&
          Number(a.groupId) === Number(group.id)
      );
      if (byName) {
        return {
          ...byName,
          code: String(byName.code || '').trim() || String(code || '').trim(),
          isSystem: true,
          groupId: Number(group.id),
          ledgerCategory: String(byName.ledgerCategory || '').trim() || 'General',
          type: String(type?.accountClass || byName.type || ''),
          subType: String(type?.name || byName.subType || ''),
          main: String(type?.main || byName.main || ''),
        };
      }

      const nextId = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0) + 1;
      const created = {
        id: nextId,
        companyId: Number(companyId),
        code: String(code || '').trim(),
        name: String(name || '').trim(),
        isSystem: true,
        ledgerCategory: 'General',
        groupId: Number(group.id),
        type: String(type?.accountClass || ''),
        subType: String(type?.name || ''),
        main: String(type?.main || ''),
        balance: 0,
      };
      coa.push(created);
      return created;
    };

    const companies = Array.isArray(next.companies) ? next.companies : [];
    for (const c of companies) {
      const companyId = Number(c?.id);
      if (!companyId) continue;

      const info = templateInfoByCompany.get(companyId) || {};
      const inputGstGroup = info.inputGstGroup && !info.inputGstGroup.isLegacy ? info.inputGstGroup : groups.find((g) => Number(g.companyId) === companyId && !g.isLegacy && String(g.name || '').trim().toLowerCase() === 'input gst');
      const outputGstGroup = info.outputGstGroup && !info.outputGstGroup.isLegacy ? info.outputGstGroup : groups.find((g) => Number(g.companyId) === companyId && !g.isLegacy && String(g.name || '').trim().toLowerCase() === 'output gst');

      if (!inputGstGroup || !outputGstGroup) continue;

      const outCgst = ensureLedger({ companyId, groupId: outputGstGroup.id, code: 'GST-OUT-CGST', name: 'Output CGST' });
      const outSgst = ensureLedger({ companyId, groupId: outputGstGroup.id, code: 'GST-OUT-SGST', name: 'Output SGST' });
      const outIgst = ensureLedger({ companyId, groupId: outputGstGroup.id, code: 'GST-OUT-IGST', name: 'Output IGST' });

      const inCgst = ensureLedger({ companyId, groupId: inputGstGroup.id, code: 'GST-IN-CGST', name: 'Input CGST' });
      const inSgst = ensureLedger({ companyId, groupId: inputGstGroup.id, code: 'GST-IN-SGST', name: 'Input SGST' });
      const inIgst = ensureLedger({ companyId, groupId: inputGstGroup.id, code: 'GST-IN-IGST', name: 'Input IGST' });

      // Persist any ensureLedger updates back into next.chartOfAccounts
      const replaceById = new Map();
      for (const l of [outCgst, outSgst, outIgst, inCgst, inSgst, inIgst]) {
        if (!l) continue;
        replaceById.set(String(l.id), l);
      }
      if (replaceById.size) {
        next.chartOfAccounts = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).map((a) => {
          if (Number(a.companyId) !== companyId) return a;
          const repl = replaceById.get(String(a.id));
          return repl ? { ...a, ...repl } : a;
        });
      }

      // Compute balances from vouchers (matches GSTR-3B logic + DN/CN adjustments)
      const inv = sumDocs(next.invoices, companyId);
      const cn = sumDocs(next.creditNotes, companyId);
      const bills = sumDocs(next.bills, companyId);
      const exp = sumDocs(next.expenses, companyId);
      const dn = sumDocs(next.debitNotes, companyId);

      const output = {
        cgst: Math.max(0, Number(inv.cgst) - Number(cn.cgst)),
        sgst: Math.max(0, Number(inv.sgst) - Number(cn.sgst)),
        igst: Math.max(0, Number(inv.igst) - Number(cn.igst)),
      };
      const input = {
        cgst: Math.max(0, Number(bills.cgst) + Number(exp.cgst) - Number(dn.cgst)),
        sgst: Math.max(0, Number(bills.sgst) + Number(exp.sgst) - Number(dn.sgst)),
        igst: Math.max(0, Number(bills.igst) + Number(exp.igst) - Number(dn.igst)),
      };

      const updateBalance = (ledger, nextBal) => {
        if (!ledger) return;
        const idStr = String(ledger.id);
        next.chartOfAccounts = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).map((a) => {
          if (Number(a.companyId) !== companyId) return a;
          if (String(a.id) !== idStr) return a;
          return { ...a, balance: Number.isFinite(nextBal) ? nextBal : 0 };
        });
      };

      updateBalance(outCgst, Number(output.cgst) || 0);
      updateBalance(outSgst, Number(output.sgst) || 0);
      updateBalance(outIgst, Number(output.igst) || 0);
      updateBalance(inCgst, Number(input.cgst) || 0);
      updateBalance(inSgst, Number(input.sgst) || 0);
      updateBalance(inIgst, Number(input.igst) || 0);
    }
  }

  // Cleanup: remove legacy/demo ledgers completely (after ensuring contacts are linked)
  // This rewires references first (journals/customers/vendors) and then removes the old ledgers.
  const cleanupLegacyDemoLedgers = (company) => {
    const companyId = Number(company?.id);
    if (!companyId) return;

    const { docSettings, migrations } = getCompanyDocSettings(company);
    const alreadyApplied = Boolean(migrations.coaTemplateCleanupV1Applied);
    if (alreadyApplied) return;

    const coa = Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : [];
    const groups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const types = Array.isArray(next.accountTypes) ? next.accountTypes : [];

    const typeById = new Map(types.map((t) => [String(t.id), t]));
    const groupsByName = new Map();
    for (const g of groups) {
      if (Number(g.companyId) !== companyId) continue;
      if (g.isLegacy) continue;
      groupsByName.set(String(g.name || '').trim().toLowerCase(), g);
    }

    const groupCategoryToLedgerCategoryLocal = (c) => {
      if (c === 'Customer') return 'Customer';
      if (c === 'Vendor') return 'Vendor';
      if (c === 'Expense') return 'Expense';
      return 'General';
    };

    const nextCoaIdBase = coa.reduce((m, a) => Math.max(m, Number(a?.id || 0)), 0);
    let nextCoaId = nextCoaIdBase + 1;

    const ensureLedgerInGroup = ({ name, groupNameLower }) => {
      const group = groupsByName.get(String(groupNameLower || '').trim().toLowerCase()) || null;
      if (!group) return null;

      const existing = coa.find(
        (a) =>
          Number(a.companyId) === companyId &&
          String(a.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase() &&
          Number(a.groupId) === Number(group.id)
      );
      if (existing) return existing;

      const type = typeById.get(String(group.typeId)) || null;
      const newLedger = {
        id: nextCoaId++,
        companyId,
        code: `SYS-${String(groupNameLower || '').trim().toUpperCase().replace(/\s+/g, '-')}`,
        name: String(name || '').trim(),
        ledgerCategory: groupCategoryToLedgerCategoryLocal(group.groupCategory),
        groupId: Number(group.id),
        type: String(type?.accountClass || ''),
        subType: String(type?.name || ''),
        main: String(type?.main || ''),
        balance: 0,
      };
      coa.push(newLedger);
      return newLedger;
    };

    const purgeNames = new Set(['accounts receivable', 'accounts payable', 'inventory', 'fixed assets']);
    const candidates = coa.filter((a) => Number(a.companyId) === companyId && purgeNames.has(String(a.name || '').trim().toLowerCase()));
    if (!candidates.length) {
      const appliedAt = new Date().toISOString();
      const nextMigrations = { ...migrations, coaTemplateCleanupV1Applied: true, coaTemplateCleanupV1AppliedAt: appliedAt };
      const nextDocSettings = { ...docSettings, migrations: nextMigrations };
      next.companies = (Array.isArray(next.companies) ? next.companies : []).map((c) =>
        Number(c.id) === companyId ? { ...c, docSettings: nextDocSettings } : c
      );
      return;
    }

    const replacementByName = new Map();
    replacementByName.set('accounts receivable', ensureLedgerInGroup({ name: 'Sundry Debtors', groupNameLower: 'sundry debtors' }));
    replacementByName.set('accounts payable', ensureLedgerInGroup({ name: 'Sundry Creditors', groupNameLower: 'sundry creditors' }));
    replacementByName.set('inventory', ensureLedgerInGroup({ name: 'Stock-in-Hand', groupNameLower: 'stock-in-hand' }));
    replacementByName.set('fixed assets', ensureLedgerInGroup({ name: 'Plant & Machinery', groupNameLower: 'plant & machinery' }));

    const idMap = new Map();
    for (const oldLedger of candidates) {
      const key = String(oldLedger.name || '').trim().toLowerCase();
      const replacement = replacementByName.get(key) || null;
      if (!replacement) continue;
      idMap.set(String(oldLedger.id), String(replacement.id));
    }

    const remapAccountId = (rawId) => {
      const k = String(rawId || '').trim();
      return idMap.get(k) || k;
    };

    if (Array.isArray(next.customers) && idMap.size) {
      next.customers = next.customers.map((c) => {
        if (Number(c.companyId) !== companyId) return c;
        const nextAccountId = remapAccountId(c.accountId);
        return nextAccountId !== String(c.accountId || '') ? { ...c, accountId: nextAccountId } : c;
      });
    }

    if (Array.isArray(next.vendors) && idMap.size) {
      next.vendors = next.vendors.map((v) => {
        if (Number(v.companyId) !== companyId) return v;
        const nextAccountId = remapAccountId(v.accountId);
        return nextAccountId !== String(v.accountId || '') ? { ...v, accountId: nextAccountId } : v;
      });
    }

    if (Array.isArray(next.journalEntries) && idMap.size) {
      next.journalEntries = next.journalEntries.map((j) => {
        if (Number(j.companyId) !== companyId) return j;
        const nextLines = (Array.isArray(j.lines) ? j.lines : []).map((l) => {
          const nextId = remapAccountId(l?.accountId);
          if (nextId === String(l?.accountId || '')) return l;
          const acc = coa.find((a) => Number(a.companyId) === companyId && String(a.id) === String(nextId)) || null;
          return {
            ...l,
            accountId: nextId,
            accountName: acc?.name || l?.accountName || '',
            accountCode: acc?.code || l?.accountCode || '',
          };
        });
        return { ...j, lines: nextLines };
      });
    }

    const idsToRemove = new Set(Array.from(idMap.keys()));
    next.chartOfAccounts = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).filter(
      (a) => !(Number(a.companyId) === companyId && idsToRemove.has(String(a.id)))
    );

    const appliedAt = new Date().toISOString();
    const nextMigrations = { ...migrations, coaTemplateCleanupV1Applied: true, coaTemplateCleanupV1AppliedAt: appliedAt };
    const nextDocSettings = { ...docSettings, migrations: nextMigrations };
    next.companies = (Array.isArray(next.companies) ? next.companies : []).map((c) =>
      Number(c.id) === companyId ? { ...c, docSettings: nextDocSettings } : c
    );
  };

  for (const c of companies) cleanupLegacyDemoLedgers(c);

  // Cleanup: purge legacy account types/groups (old COA structure) completely.
  // Safety: before deleting groups/types, ensure all ledgers point to a template group.
  const purgeLegacyCOAStructures = (company) => {
    const companyId = Number(company?.id);
    if (!companyId) return;

    const { docSettings, migrations } = getCompanyDocSettings(company);
    const alreadyApplied = Boolean(migrations.coaTemplatePurgeLegacyStructuresV1Applied);
    if (alreadyApplied) return;

    const allGroups = Array.isArray(next.accountGroups) ? next.accountGroups : [];
    const allTypes = Array.isArray(next.accountTypes) ? next.accountTypes : [];

    const typeById = new Map();
    for (const t of allTypes) {
      if (Number(t.companyId) !== companyId) continue;
      typeById.set(String(t.id), t);
    }

    const groupById = new Map();
    for (const g of allGroups) {
      if (Number(g.companyId) !== companyId) continue;
      groupById.set(String(g.id), g);
    }

    const templateGroupsByName = new Map();
    for (const g of allGroups) {
      if (Number(g.companyId) !== companyId) continue;
      if (g.isLegacy) continue;
      if (String(g.name || '').trim().toLowerCase() === 'primary') continue;
      templateGroupsByName.set(String(g.name || '').trim().toLowerCase(), g);
    }

    const getTemplateGroup = (nameLower) => templateGroupsByName.get(String(nameLower || '').trim().toLowerCase()) || null;

    const updateLedgerToGroup = (ledger, group) => {
      const t = group ? typeById.get(String(group.typeId)) : null;
      const derivedType = String(t?.accountClass || ledger.type || '').trim();
      const derivedSubType = String(t?.name || ledger.subType || '').trim();
      const derivedMain = String(t?.main || ledger.main || '').trim();
      return {
        ...ledger,
        groupId: group ? Number(group.id) : ledger.groupId,
        ledgerCategory: group ? groupCategoryToLedgerCategory(group.groupCategory) : ledger.ledgerCategory,
        type: derivedType || ledger.type,
        subType: derivedSubType || ledger.subType,
        main: derivedMain || ledger.main,
      };
    };

    // Step 1: Ensure no ledger still references a legacy/missing group
    if (Array.isArray(next.chartOfAccounts)) {
      next.chartOfAccounts = next.chartOfAccounts.map((a) => {
        if (Number(a.companyId) !== companyId) return a;
        const gidRaw = a?.groupId !== null && a?.groupId !== undefined && a?.groupId !== '' ? String(a.groupId) : '';
        const currentGroup = gidRaw ? groupById.get(gidRaw) : null;
        const isBadGroup = !currentGroup || Boolean(currentGroup.isLegacy) || String(currentGroup.name || '').trim().toLowerCase() === 'primary';
        if (!isBadGroup) return a;

        const targetName = pickTemplateGroupName(a);
        const targetGroup = getTemplateGroup(targetName) || getTemplateGroup('cash-in-hand');
        if (!targetGroup) return a;
        return updateLedgerToGroup(a, targetGroup);
      });
    }

    // Step 2: Delete legacy groups/types for the company
    next.accountGroups = (Array.isArray(next.accountGroups) ? next.accountGroups : []).filter(
      (g) => !(Number(g.companyId) === companyId && (Boolean(g.isLegacy) || String(g.name || '').trim().toLowerCase() === 'primary'))
    );
    next.accountTypes = (Array.isArray(next.accountTypes) ? next.accountTypes : []).filter(
      (t) => !(Number(t.companyId) === companyId && Boolean(t.isLegacy))
    );

    // Stamp migration
    const appliedAt = new Date().toISOString();
    const nextMigrations = { ...migrations, coaTemplatePurgeLegacyStructuresV1Applied: true, coaTemplatePurgeLegacyStructuresV1AppliedAt: appliedAt };
    const nextDocSettings = { ...docSettings, migrations: nextMigrations };
    next.companies = (Array.isArray(next.companies) ? next.companies : []).map((c) =>
      Number(c.id) === companyId ? { ...c, docSettings: nextDocSettings } : c
    );
  };

  for (const c of companies) purgeLegacyCOAStructures(c);

  if (Array.isArray(next.items)) {
    next.items = next.items.map((it) => {
      const openingQtyRaw = it?.openingQty !== undefined && it?.openingQty !== null && it?.openingQty !== ''
        ? it.openingQty
        : it?.stock;

      const openingQty = Number(openingQtyRaw);
      const normalizedOpeningQty = Number.isFinite(openingQty) ? openingQty : 0;

      return {
        ...it,
        openingQty: normalizedOpeningQty,
      };
    });
  }

  if (!Array.isArray(next.payments)) next.payments = [];
  if (!Array.isArray(next.msmeBankRates)) next.msmeBankRates = [];

  if (Array.isArray(next.invoices)) {
    next.invoices = next.invoices.map((inv) => {
      const raw = String(inv?.status || '').trim();
      const mappedStatus =
        raw === 'Pending'
          ? 'Unpaid'
          : raw === 'Overdue'
            ? 'Over due'
            : raw === 'Over Due'
              ? 'Over due'
              : raw;

      return {
        ...inv,
        paidAmount: Number(inv?.paidAmount ?? 0),
        status: mappedStatus || 'Unpaid',
      };
    });
  }

  if (Array.isArray(next.bills)) {
    next.bills = next.bills.map((b) => {
      const raw = String(b?.status || '').trim();
      const mappedStatus =
        raw === 'Pending'
          ? 'Unpaid'
          : raw === 'Overdue'
            ? 'Over due'
            : raw === 'Over Due'
              ? 'Over due'
              : raw;

      return {
        ...b,
        paidAmount: Number(b?.paidAmount ?? 0),
        status: mappedStatus || 'Unpaid',
      };
    });
  }

  if (Array.isArray(next.expenses)) {
    next.expenses = next.expenses.map((ex) => {
      const raw = String(ex?.status || '').trim();
      const mappedStatus =
        raw === 'Pending'
          ? 'Unpaid'
          : raw === 'Overdue'
            ? 'Over due'
            : raw === 'Over Due'
              ? 'Over due'
              : raw;

      return {
        ...ex,
        paidAmount: Number(ex?.paidAmount ?? 0),
        dueDate: ex?.dueDate || ex?.date || new Date().toISOString().slice(0, 10),
        status: mappedStatus || 'Unpaid',
      };
    });
  }

  {
    /*
     * The statutory GST slabs, per company.
     *
     * This used to run only when gstRates was not an array at all. An
     * authenticated tenant starts from initEmptyDB, which sets it to `[]` — an
     * array, so the backfill never fired and the rate list stayed empty
     * forever. The GST dropdown on an item offered "0%" and nothing else, so a
     * business could not charge tax on its first sale, in a product whose
     * entire purpose is GST.
     *
     * It went unnoticed because the demo seed carried all five rates, and
     * every tenant was demo-seeded. Removing the mock is what exposed it.
     *
     * Missing slabs are added, existing ones left alone — 0, 5, 12, 18 and 28
     * are set by statute, not preference, so a company holding none of them is
     * misconfigured rather than opinionated.
     */
    const companies = Array.isArray(next.companies) ? next.companies : [];
    const statutory = [0, 5, 12, 18, 28];
    const rates = Array.isArray(next.gstRates) ? [...next.gstRates] : [];
    let nextId = rates.reduce((m, r) => Math.max(m, Number(r?.id || 0)), 0) + 1;

    for (const c of companies) {
      const have = new Set(
        rates.filter((r) => r.companyId === c.id).map((r) => Number(r.rate))
      );
      for (const rate of statutory) {
        if (have.has(rate)) continue;
        rates.push({ id: nextId++, companyId: c.id, rate });
      }
    }
    next.gstRates = rates;
  }

  if (!Array.isArray(next.uoms)) {
    const companies = Array.isArray(next.companies) ? next.companies : [];
    const defaultUoms = ['Pcs', 'Hours'];
    let nextId = 1;

    next.uoms = companies.flatMap((c) => {
      const fromItems = Array.isArray(next.items)
        ? next.items
            .filter((i) => i.companyId === c.id)
            .map((i) => String(i?.unit || '').trim())
            .filter(Boolean)
        : [];

      const names = Array.from(new Set([...defaultUoms, ...fromItems]));

      return names.map((name) => ({
        id: nextId++,
        companyId: c.id,
        name,
      }));
    });
  }

  // Seed demo vouchers/transactions (one-time per company)
  {
    /**
     * Retired. The books start empty.
     *
     * This seeded two invoices, a receipt and matching vouchers into any
     * company that had not been stamped yet — which is why a brand new guest
     * book opened with INV-1001 and INV-1002 already in it, and why figures
     * appeared on the dashboard of a business that had never traded. Removing
     * the demo parties and products earlier left this seeder running, so the
     * documents kept coming back.
     *
     * Kept as a stamping no-op rather than deleted outright: the migration flag
     * is what stops this being reconsidered, and other code reads these keys.
     *
     * Rows it seeded before today are deliberately left alone. They carry no
     * marker, so purging them would mean matching on "INV-1001" — and deleting
     * a real invoice that happens to be numbered that way is far worse than
     * leaving demo data in a book somebody can clear themselves.
     */
    const seedDemoTransactionsV1 = (company) => {
      const companyId = Number(company?.id);
      if (!companyId) return;

      const { docSettings, migrations } = getCompanyDocSettings(company);
      if (migrations.demoTransactionsV1Applied) return;

      const nextMigrations = {
        ...migrations,
        demoTransactionsV1Applied: true,
        demoTransactionsV1Disabled: true,
      };
      next.companies = (Array.isArray(next.companies) ? next.companies : []).map((c) =>
        Number(c.id) === companyId ? { ...c, docSettings: { ...docSettings, migrations: nextMigrations } } : c
      );
    };

    const companies = Array.isArray(next.companies) ? next.companies : [];
    for (const c of companies) seedDemoTransactionsV1(c);
  }

  // Ensure openingBalance exists and keep ledger balances in sync with vouchers/payments/journals.
  // This makes Trial Balance / P&L / Balance Sheet reflect operational data.
  {
    const safeArray = (v) => (Array.isArray(v) ? v : []);
    const lower = (s) => String(s || '').trim().toLowerCase();
    const r2 = (n) => {
      const x = Number(n ?? 0);
      if (!Number.isFinite(x)) return 0;
      return Math.round(x * 100) / 100;
    };
    const isDebitNature = (type) => ['asset', 'expense'].includes(lower(type));

    const nextId = (arr) => safeArray(arr).reduce((m, x) => Math.max(m, Number(x?.id || 0)), 0) + 1;

    const findGroupIdByName = (companyId, nameLower) => {
      const groups = safeArray(next.accountGroups).filter((g) => Number(g?.companyId) === Number(companyId));
      const hit = groups.find((g) => lower(g?.name) === lower(nameLower));
      return hit ? Number(hit.id) : null;
    };

    const ensureControlAccount = (companyId, { code, name, type, subType, main, groupId }) => {
      const accounts = safeArray(next.chartOfAccounts);
      const existing = accounts.find(
        (a) =>
          Number(a?.companyId) === Number(companyId) &&
          ((code && lower(a?.code) === lower(code)) || (name && lower(a?.name) === lower(name)))
      );
      if (existing) {
        next.chartOfAccounts = accounts.map((account) =>
          String(account.id) === String(existing.id) ? { ...account, isSystem: true } : account
        );
        return String(existing.id);
      }

      const created = {
        id: nextId(next.chartOfAccounts),
        companyId: Number(companyId),
        code: String(code || ''),
        name: String(name || ''),
        type,
        subType,
        main,
        groupId: groupId ?? null,
        balance: 0,
        openingBalance: 0,
        isSystem: true,
      };
      next.chartOfAccounts = [...accounts, created];
      return String(created.id);
    };

    // Migration: remove old demo seed balances (Cash 50k etc) that otherwise show up in Trial Balance.
    // Safe: only applies when balances/openingBalance match the known old demo seed amounts.
    const getCompanyDocSettingsSafe = (company) => {
      const doc = company?.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
      const migrations = doc?.migrations && typeof doc.migrations === 'object' ? doc.migrations : {};
      return { docSettings: doc, migrations };
    };

    {
      const companies = safeArray(next.companies);
      for (const c of companies) {
        const companyId = Number(c?.id);
        if (!companyId) continue;

        const { docSettings, migrations } = getCompanyDocSettingsSafe(c);
        if (migrations.demoSeedOpeningBalancesResetV1Applied) continue;

        const seedRules = [
          { code: '1000', amount: 50000 },
          { code: '1010', amount: 120000 },
          { code: '2100', amount: 20000 },
          { code: '3000', amount: 130000 },
        ];
        const seedByCode = new Map(seedRules.map((r) => [String(r.code), Number(r.amount)]));

        let changed = false;
        next.chartOfAccounts = safeArray(next.chartOfAccounts).map((a) => {
          if (Number(a?.companyId) !== companyId) return a;
          const code = String(a?.code || '').trim();
          if (!seedByCode.has(code)) return a;

          const expected = Number(seedByCode.get(code) ?? 0);
          const bal = Number(a?.balance ?? 0);
          const opening = a?.openingBalance !== undefined && a?.openingBalance !== null ? Number(a.openingBalance) : null;

          const balMatches = Number.isFinite(bal) && Math.abs(bal - expected) < 0.01;
          // Only consider openingBalance a match if it actually exists.
          // If openingBalance is missing, we rely on balance matching the known legacy demo amount.
          const openingMatches = opening === null ? false : (Number.isFinite(opening) && Math.abs(opening - expected) < 0.01);

          if (!balMatches && !openingMatches) return a;

          changed = true;
          return {
            ...a,
            openingBalance: 0,
            balance: 0,
          };
        });

        if (changed) {
          const appliedAt = new Date().toISOString();
          const nextMigrations = { ...migrations, demoSeedOpeningBalancesResetV1Applied: true, demoSeedOpeningBalancesResetV1AppliedAt: appliedAt };
          const nextDocSettings = { ...docSettings, migrations: nextMigrations };
          next.companies = safeArray(next.companies).map((cc) => (Number(cc?.id) === companyId ? { ...cc, docSettings: nextDocSettings } : cc));
        }
      }
    }

    // One-time-ish migration: capture current balance as openingBalance if missing.
    // GST ledgers are always derived, so their openingBalance is forced to 0.
    next.chartOfAccounts = safeArray(next.chartOfAccounts).map((a) => {
      const codeLower = lower(a?.code);
      const isGst = codeLower.startsWith('gst-');
      const currentBalance = Number(a?.balance ?? 0);
      const existingOpening = a?.openingBalance;
      const opening = existingOpening !== undefined && existingOpening !== null ? Number(existingOpening) : currentBalance;

      return {
        ...a,
        openingBalance: isGst ? 0 : Number.isFinite(opening) ? opening : 0,
        balance: Number.isFinite(currentBalance) ? currentBalance : 0,
      };
    });

    /* The built-in Cash ledger has no user ledger code. Older books seeded it
       as 1000, which then leaked into Receipt/Payment labels as though the user
       had assigned it. Restrict this cleanup to the exact legacy default. */
    next.chartOfAccounts = safeArray(next.chartOfAccounts).map((account) =>
      lower(account?.name) === 'cash' && String(account?.code || '').trim() === '1000'
        ? { ...account, code: '' }
        : account
    );

    // Ensure every company has AR/AP control ledgers so accrual postings always hit chartOfAccounts.
    // Also auto-link customers/vendors to these control ledgers when they don't have accountId.
    {
      const companies = safeArray(next.companies);
      for (const c of companies) {
        const companyId = Number(c?.id);
        if (!companyId) continue;

        const debtorsGroupId = findGroupIdByName(companyId, 'sundry debtors');
        const creditorsGroupId = findGroupIdByName(companyId, 'sundry creditors');
        const outstandingExpensesGroupId = findGroupIdByName(companyId, 'outstanding expenses');
        const depositsGroupId = findGroupIdByName(companyId, 'deposits (asset)');

        const arId = ensureControlAccount(companyId, {
          code: '1100',
          name: 'Accounts Receivable',
          type: 'Asset',
          subType: 'Current Assets',
          main: 'Balance Sheet',
          groupId: debtorsGroupId,
        });

        const apId = ensureControlAccount(companyId, {
          code: '2000',
          name: 'Accounts Payable',
          type: 'Liability',
          subType: 'Current Liabilities',
          main: 'Balance Sheet',
          groupId: creditorsGroupId,
        });

        // Used when an expense/payment has no vendor.
        ensureControlAccount(companyId, {
          code: '2050',
          name: 'Outstanding Expenses',
          type: 'Liability',
          subType: 'Current Liabilities',
          main: 'Balance Sheet',
          groupId: outstandingExpensesGroupId,
        });

        // Fallback account to keep double-entry balanced when some reference is missing/invalid.
        ensureControlAccount(companyId, {
          code: '9999',
          name: 'Suspense / Uncategorised',
          type: 'Asset',
          subType: 'Current Assets',
          main: 'Balance Sheet',
          groupId: depositsGroupId,
        });

        /**
         * The P&L side of the chart, which a real company never got.
         *
         * These four are looked up by exact name when a document is posted —
         * `findAccountIdByName('sales revenue')`, `'purchase accounts'`,
         * `'operating expenses'`, `'cash'`. A signed-up company had none of
         * them: only the GST accounts, the two control accounts and Suspense
         * were ever created, and the Income and Expense sides of its chart
         * were empty. So every posting to them resolved to an empty id, was
         * dropped, and the residual landed in Suspense — an *asset*.
         *
         * On a ₹2,950 invoice that meant Dr customer 2,950 / Cr Output CGST
         * 225 / Cr Output SGST 225 / Cr Suspense 2,500. The trial balance
         * still footed, which is precisely why it went unnoticed: the ₹2,500
         * of revenue never reached the P&L, and the balance sheet carried it
         * as an asset instead.
         *
         * They exist in DEFAULT_DB, so the guest book was correct and only
         * real tenants were wrong. The groups are already created by
         * TEMPLATE_GROUPS; only the ledgers under them were missing.
         */
        ensureControlAccount(companyId, {
          code: '4000',
          name: 'Sales Revenue',
          type: 'Income',
          subType: 'Income',
          main: 'P&L',
          groupId: findGroupIdByName(companyId, 'sales accounts'),
        });

        ensureControlAccount(companyId, {
          code: '5000',
          name: 'Purchase Accounts',
          type: 'Expense',
          subType: 'Expenses',
          main: 'P&L',
          groupId: findGroupIdByName(companyId, 'purchase accounts'),
        });

        ensureControlAccount(companyId, {
          code: '5100',
          name: 'Operating Expenses',
          type: 'Expense',
          subType: 'Expenses',
          main: 'P&L',
          groupId: findGroupIdByName(companyId, 'indirect expenses'),
        });

        // Named exactly "Cash" because that is the name receipts and payments
        // look for; the group it sits in is Cash-in-Hand.
        ensureControlAccount(companyId, {
          code: '',
          name: 'Cash',
          type: 'Asset',
          subType: 'Current Assets',
          main: 'Balance Sheet',
          groupId: findGroupIdByName(companyId, 'cash-in-hand'),
        });

        /* Standard statutory ledgers for the common purchase-side TDS
           deductions. TDS Payable is already a system group; these ordinary
           ledgers give a fresh or existing company usable section accounts. */
        const tdsPayableGroupId = findGroupIdByName(companyId, 'tds payable');
        if (tdsPayableGroupId) {
          [
            { name: 'TDS 194C - Contract', oldName: 'TDS on Contractors', section: '194C' },
            { name: 'TDS 194J - Professional', oldName: 'TDS on Professional Fees', section: '194J(b)' },
            { name: 'TDS 194J - Technical', oldName: 'TDS on Technical Services', section: '194J(a)' },
            { name: 'TDS 194H - Commission', oldName: 'TDS on Commission or Brokerage', section: '194H' },
            { name: 'TDS 194I - Rent', oldName: 'TDS on Rent', section: '194I(b)' },
          ].forEach(({ name, oldName, section }) => {
            const existing = safeArray(next.chartOfAccounts).find(
              (account) =>
                Number(account?.companyId) === companyId &&
                Number(account?.groupId) === Number(tdsPayableGroupId) &&
                (String(account?.tdsSection || '') === section || lower(account?.name) === lower(oldName) || lower(account?.name) === lower(name))
            );
            const id = existing?.id || ensureControlAccount(companyId, {
              code: '',
              name,
              type: 'Liability',
              subType: 'Current Liabilities',
              main: 'Balance Sheet',
              groupId: tdsPayableGroupId,
            });
            next.chartOfAccounts = safeArray(next.chartOfAccounts).map((account) =>
              String(account.id) === String(id)
                ? { ...account, name, groupId: tdsPayableGroupId, tdsSection: section, tdsSide: 'PAYABLE', isSystem: true }
                : account
            );
          });
        }

        /**
         * The ledger stock is carried in.
         *
         * "Stock-in-Hand" existed only as a *group*; a company could have no
         * account under it, and then there was nowhere for inventory to post
         * even once something wanted to post there.
         */
        ensureControlAccount(companyId, {
          code: '1400',
          name: 'Stock-in-Hand',
          type: 'Asset',
          subType: 'Current Assets',
          main: 'Balance Sheet',
          groupId: findGroupIdByName(companyId, 'stock-in-hand'),
        });

        /**
         * Where opening stock comes from.
         *
         * Opening stock is entered as a quantity on the item and has never had
         * an accounting entry behind it, so the goods a company already owned
         * on day one existed in the stock report and nowhere in the books.
         * Capitalising them needs somewhere to credit — they were not bought
         * through a bill, so crediting Purchases would invent a negative
         * expense. This is that account, and it is what every accounting
         * package uses for the same job.
         */
        ensureControlAccount(companyId, {
          code: '3000',
          name: 'Opening Balance Equity',
          type: 'Equity',
          subType: 'Capital & Equity',
          main: 'Balance Sheet',
          groupId: findGroupIdByName(companyId, 'capital accounts'),
        });

        const validAccountIds = new Set(
          safeArray(next.chartOfAccounts)
            .filter((a) => Number(a?.companyId) === companyId)
            .map((a) => String(a.id))
        );

        next.customers = safeArray(next.customers).map((cu) => {
          if (Number(cu?.companyId) !== companyId) return cu;
          const cur = cu?.accountId !== undefined && cu?.accountId !== null ? String(cu.accountId).trim() : '';
          if (cur && validAccountIds.has(cur)) return cu;
          return { ...cu, accountId: Number(arId) };
        });

        next.vendors = safeArray(next.vendors).map((v) => {
          if (Number(v?.companyId) !== companyId) return v;
          const cur = v?.accountId !== undefined && v?.accountId !== null ? String(v.accountId).trim() : '';
          if (cur && validAccountIds.has(cur)) return v;
          return { ...v, accountId: Number(apId) };
        });
      }
    }

    const companies = safeArray(next.companies);
    const allAccounts = safeArray(next.chartOfAccounts);
    const allCustomers = safeArray(next.customers);
    const allVendors = safeArray(next.vendors);
    const allInvoices = safeArray(next.invoices);
    const allCreditNotes = safeArray(next.creditNotes);
    const allBills = safeArray(next.bills);
    const allDebitNotes = safeArray(next.debitNotes);
    const allExpenses = safeArray(next.expenses);
    const allJournals = safeArray(next.journalEntries);
    const allPayments = safeArray(next.payments);
    const allBankTxns = safeArray(next.bankTransactions);

    const computedBalanceByAccountId = new Map();

    for (const company of companies) {
      const companyId = Number(company?.id);
      if (!companyId) continue;

      const accounts = allAccounts.filter((a) => Number(a.companyId) === companyId);
      const accountById = new Map(accounts.map((a) => [String(a.id), a]));

      const customers = allCustomers.filter((c) => Number(c.companyId) === companyId);
      const customerById = new Map(customers.map((c) => [String(c.id), c]));

      const vendors = allVendors.filter((v) => Number(v.companyId) === companyId);
      const vendorById = new Map(vendors.map((v) => [String(v.id), v]));

      const findAccountIdByName = (nameLower) => {
        const hit = accounts.find((a) => lower(a.name) === String(nameLower || '').trim().toLowerCase());
        return hit ? String(hit.id) : '';
      };
      const findAccountIdByCode = (codeLower) => {
        const hit = accounts.find((a) => lower(a.code) === String(codeLower || '').trim().toLowerCase());
        return hit ? String(hit.id) : '';
      };

      const cashAccountId = findAccountIdByName('cash');
      const defaultBankAccountId =
        findAccountIdByName('hdfc bank') ||
        String(accounts.find((a) => lower(a.name).includes('bank'))?.id || '') ||
        cashAccountId;

      const salesRevenueId = findAccountIdByName('sales revenue') || String(accounts.find((a) => lower(a.type) === 'income')?.id || '');
      const purchaseAccountsId =
        findAccountIdByName('purchase accounts') || String(accounts.find((a) => lower(a.name).includes('purchase'))?.id || '');
      const stockInHandId = findAccountIdByName('stock-in-hand') || findAccountIdByName('stock in hand');
      const openingEquityId = findAccountIdByName('opening balance equity');

      // Opening and closing stock value, valued exactly as the Inventory
      // screen values it — quantity at purchase price — so the balance sheet
      // and that screen can never disagree.
      let openingStockValue = 0;
      let closingStockValue = 0;
      try {
        const summary = computeInventorySummaryByItemId({ db: next, companyId });
        for (const item of safeArray(next.items)) {
          if (Number(item?.companyId) !== companyId) continue;
          if (!isStockItem(item)) continue;
          const rate = Number(item?.purchasePrice ?? 0);
          if (!Number.isFinite(rate)) continue;
          const row = summary.get(String(item.id));
          const closingQty = Number(row?.closingQty ?? 0);
          const openingQty = Number(getItemOpeningQty(item) ?? 0);
          if (Number.isFinite(closingQty)) closingStockValue += closingQty * rate;
          if (Number.isFinite(openingQty)) openingStockValue += openingQty * rate;
        }
      } catch {
        // A stock helper that throws must not take the ledger with it; the
        // books simply carry no stock entry that pass.
        openingStockValue = 0;
        closingStockValue = 0;
      }
      openingStockValue = r2(openingStockValue);
      closingStockValue = r2(closingStockValue);
      const operatingExpensesId =
        findAccountIdByName('operating expenses') || String(accounts.find((a) => lower(a.type) === 'expense')?.id || '');
      const suspenseAccountId =
        findAccountIdByCode('9999') ||
        findAccountIdByName('suspense / uncategorised') ||
        findAccountIdByName('suspense');
      const outstandingExpensesId = findAccountIdByName('outstanding expenses') || findAccountIdByCode('2050') || suspenseAccountId;

      const gstOutCgstId = findAccountIdByCode('gst-out-cgst') || findAccountIdByName('output cgst');
      const gstOutSgstId = findAccountIdByCode('gst-out-sgst') || findAccountIdByName('output sgst');
      const gstOutIgstId = findAccountIdByCode('gst-out-igst') || findAccountIdByName('output igst');

      const gstInCgstId = findAccountIdByCode('gst-in-cgst') || findAccountIdByName('input cgst');
      const gstInSgstId = findAccountIdByCode('gst-in-sgst') || findAccountIdByName('input sgst');
      const gstInIgstId = findAccountIdByCode('gst-in-igst') || findAccountIdByName('input igst');

      const deltaById = new Map();
      const addDelta = (accountId, debit, credit) => {
        const id = String(accountId || '').trim();
        if (!id) return;
        const acc = accountById.get(id);
        if (!acc) return;

        const d = r2(Number(debit ?? 0));
        const c = r2(Number(credit ?? 0));
        if (!d && !c) return;

        const cur = Number(deltaById.get(id) ?? 0);
        const effect = isDebitNature(acc.type) ? d - c : c - d;
        deltaById.set(id, r2(cur + effect));
      };

      const post = (accountId, debit, credit) => addDelta(accountId, debit, credit);

      // Journal Entries (direct postings)
      for (const j of allJournals) {
        if (Number(j?.companyId) !== companyId) continue;
        const lines = safeArray(j?.lines);
        let totalDebit = 0;
        let totalCredit = 0;
        for (const l of lines) {
          const rawId = String(l?.accountId || '').trim();
          const id = rawId && accountById.has(rawId) ? rawId : suspenseAccountId;

          const d = Number(l?.debit ?? 0);
          const c = Number(l?.credit ?? 0);
          totalDebit += Number.isFinite(d) ? d : 0;
          totalCredit += Number.isFinite(c) ? c : 0;

          post(id, d, c);
        }

        const diff = r2(totalDebit - totalCredit);
        if (diff > 0.009) {
          post(suspenseAccountId, 0, diff);
        } else if (diff < -0.009) {
          post(suspenseAccountId, -diff, 0);
        }
      }

      // Invoices (accrual)
      for (const inv of allInvoices) {
        if (Number(inv?.companyId) !== companyId) continue;
        const st = lower(inv?.status);
        if (st === 'draft' || st === 'cancelled') continue;

        const customerId = String(inv?.customerId || '').trim();
        const customer = customerById.get(customerId) || null;
        const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
        const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : suspenseAccountId;

        const subtotal = Number(inv?.subtotal ?? inv?.taxableTotal ?? 0);
        const cgst = Number(inv?.cgstTotal ?? 0);
        const sgst = Number(inv?.sgstTotal ?? 0);
        const igst = Number(inv?.igstTotal ?? 0);
        const total = r2(subtotal + cgst + sgst + igst);

        post(customerAccountId, total, 0);
        post(salesRevenueId, 0, subtotal);
        post(gstOutCgstId, 0, cgst);
        post(gstOutSgstId, 0, sgst);
        post(gstOutIgstId, 0, igst);
      }

      // Credit Notes (reverse sales)
      for (const cn of allCreditNotes) {
        if (Number(cn?.companyId) !== companyId) continue;
        const st = lower(cn?.status);
        if (st === 'draft' || st === 'cancelled') continue;

        const customerId = String(cn?.customerId || '').trim();
        const customer = customerById.get(customerId) || null;
        const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
        const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : suspenseAccountId;

        const subtotal = Number(cn?.subtotal ?? cn?.taxableTotal ?? 0);
        const cgst = Number(cn?.cgstTotal ?? 0);
        const sgst = Number(cn?.sgstTotal ?? 0);
        const igst = Number(cn?.igstTotal ?? 0);
        const total = r2(subtotal + cgst + sgst + igst);

        post(customerAccountId, 0, total);
        post(salesRevenueId, subtotal, 0);
        post(gstOutCgstId, cgst, 0);
        post(gstOutSgstId, sgst, 0);
        post(gstOutIgstId, igst, 0);
      }

      // Bills (accrual purchases)
      for (const b of allBills) {
        if (Number(b?.companyId) !== companyId) continue;
        const st = lower(b?.status);
        if (st === 'draft' || st === 'cancelled') continue;

        const vendorId = String(b?.vendorId || '').trim();
        const vendor = vendorById.get(vendorId) || null;
        const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
        const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : suspenseAccountId;

        const subtotal = Number(b?.subtotal ?? b?.taxableTotal ?? 0);
        const cgst = Number(b?.cgstTotal ?? 0);
        const sgst = Number(b?.sgstTotal ?? 0);
        const igst = Number(b?.igstTotal ?? 0);
        const total = r2(subtotal + cgst + sgst + igst);

        post(purchaseAccountsId, subtotal, 0);
        post(gstInCgstId, cgst, 0);
        post(gstInSgstId, sgst, 0);
        post(gstInIgstId, igst, 0);
        post(vendorAccountId, 0, total);
      }

      // Debit Notes (reverse purchases)
      for (const dn of allDebitNotes) {
        if (Number(dn?.companyId) !== companyId) continue;
        const st = lower(dn?.status);
        if (st === 'draft' || st === 'cancelled') continue;

        const vendorId = String(dn?.vendorId || '').trim();
        const vendor = vendorById.get(vendorId) || null;
        const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
        const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : suspenseAccountId;

        const subtotal = Number(dn?.subtotal ?? dn?.taxableTotal ?? 0);
        const cgst = Number(dn?.cgstTotal ?? 0);
        const sgst = Number(dn?.sgstTotal ?? 0);
        const igst = Number(dn?.igstTotal ?? 0);
        const total = r2(subtotal + cgst + sgst + igst);

        post(vendorAccountId, total, 0);
        post(purchaseAccountsId, 0, subtotal);
        post(gstInCgstId, 0, cgst);
        post(gstInSgstId, 0, sgst);
        post(gstInIgstId, 0, igst);
      }

      // Expenses (accrual)
      for (const ex of allExpenses) {
        if (Number(ex?.companyId) !== companyId) continue;
        const st = lower(ex?.status);
        if (st === 'draft' || st === 'cancelled') continue;

        const taxable = Number(ex?.taxableTotal ?? ex?.amount ?? 0);
        const cgst = Number(ex?.cgstTotal ?? 0);
        const sgst = Number(ex?.sgstTotal ?? 0);
        const igst = Number(ex?.igstTotal ?? 0);
        const total = r2(taxable + cgst + sgst + igst);

        const vendorId = String(ex?.vendorId || '').trim();
        const vendor = vendorById.get(vendorId) || null;
        const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
        const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : '';
        const creditAccountId = vendorAccountId || outstandingExpensesId || suspenseAccountId;

        post(operatingExpensesId, taxable, 0);
        post(gstInCgstId, cgst, 0);
        post(gstInSgstId, sgst, 0);
        post(gstInIgstId, igst, 0);
        post(creditAccountId, 0, total);
      }

      // Payments / Receipts (settlement)
      const resolveCashBankAccountId = (p) => {
        const explicit = p?.cashBankAccountId !== undefined && p?.cashBankAccountId !== null ? String(p.cashBankAccountId) : '';
        if (explicit && accountById.has(explicit)) return explicit;
        const mode = lower(p?.mode);
        if (mode === 'cash') return cashAccountId;
        return defaultBankAccountId || cashAccountId;
      };

      const invoiceById = new Map(
        allInvoices
          .filter((i) => Number(i?.companyId) === companyId)
          .map((i) => [String(i.id), i])
      );
      const billById = new Map(
        allBills
          .filter((b) => Number(b?.companyId) === companyId)
          .map((b) => [String(b.id), b])
      );
      const expenseById = new Map(
        allExpenses
          .filter((e) => Number(e?.companyId) === companyId)
          .map((e) => [String(e.id), e])
      );

      for (const p of allPayments) {
        if (Number(p?.companyId) !== companyId) continue;

        const dir = lower(p?.direction);
        const amount = Number(p?.amount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const cashBankId = resolveCashBankAccountId(p);

        if (dir === 'in') {
          // Credit customer (reduce receivable / create advance), Debit cash/bank
          let customerId = p?.customerId !== undefined && p?.customerId !== null ? String(p.customerId) : '';
          if (!customerId && p?.voucherType === 'invoice') {
            const inv = invoiceById.get(String(p?.voucherId || '')) || null;
            customerId = inv ? String(inv.customerId || '') : '';
          }

          const customer = customerById.get(String(customerId || '').trim()) || null;
          const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
          const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : suspenseAccountId;

          post(cashBankId, amount, 0);
          post(customerAccountId, 0, amount);
        } else if (dir === 'out') {
          // Debit vendor (reduce payable / create advance), Credit cash/bank
          let vendorId = p?.vendorId !== undefined && p?.vendorId !== null ? String(p.vendorId) : '';

          if (!vendorId && p?.voucherType === 'bill') {
            const bill = billById.get(String(p?.voucherId || '')) || null;
            vendorId = bill ? String(bill.vendorId || '') : '';
          }
          if (!vendorId && p?.voucherType === 'expense') {
            const ex = expenseById.get(String(p?.voucherId || '')) || null;
            vendorId = ex ? String(ex.vendorId || '') : '';
          }

          const vendor = vendorById.get(String(vendorId || '').trim()) || null;
          const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
          const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : '';
          const debitAccountId = vendorAccountId || outstandingExpensesId || suspenseAccountId;

          post(debitAccountId, amount, 0);
          post(cashBankId, 0, amount);
        }
      }

      // Cash/Bank module transactions (only when not already linked to a payment/receipt record)
      for (const t of allBankTxns) {
        if (Number(t?.companyId) !== companyId) continue;
        const linked = t?.linkedPaymentId !== undefined && t?.linkedPaymentId !== null ? Number(t.linkedPaymentId) : null;
        if (linked) continue;
        const cashBankId = String(t?.cashBankAccountId || '').trim();
        const counterIdRaw = String(t?.ledgerId || '').trim();
        if (!cashBankId) continue;
        const counterId = counterIdRaw && accountById.has(counterIdRaw) ? counterIdRaw : suspenseAccountId;
        const amt = Number(t?.amount ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const dir = lower(t?.direction);
        if (dir === 'in') {
          post(cashBankId, amt, 0);
          post(counterId, 0, amt);
        } else if (dir === 'out') {
          post(counterId, amt, 0);
          post(cashBankId, 0, amt);
        }
      }

      /**
       * Stock, without which neither statement is true.
       *
       * Purchases are expensed straight to Purchase Accounts — a periodic
       * inventory system — and the entry that makes a periodic system correct,
       * carrying unsold stock out of cost and onto the balance sheet, was
       * never made. Nothing had ever posted to Stock-in-Hand: the ledger was
       * created at setup and sat at zero for the life of the company.
       *
       * So a business that had bought 150 units and sold one showed an
       * ₹87,500 loss and a balance sheet with no inventory on it, while the
       * Inventory screen correctly reported ₹2.68L of stock. Both headline
       * statements were wrong for anyone holding stock.
       *
       *   Dr Stock-in-Hand          closing value
       *     Cr Opening Balance Equity   opening value
       *     Cr Purchase Accounts        closing - opening
       *
       * Two credits because the two halves have different origins. Opening
       * stock was never bought through this ledger, so crediting it to
       * Purchases would drive that expense negative and invent profit — which
       * is exactly what a first, simpler version of this did. Only the
       * movement since day one belongs against Purchases, and what is left
       * there is then the cost of what actually sold.
       *
       * Worked through on the books this was found in: opening 100 units and
       * 50 bought at ₹1,800, one sold. Stock 268,200. Purchases 90,000 -
       * 88,200 = 1,800, the cost of the single unit sold. Profit 2,500 - 1,800
       * = ₹700, which is the truth.
       *
       * Derived here rather than stored, like everything else in this ledger:
       * a saved closing-stock voucher goes stale the moment a back-dated bill
       * arrives.
       */
      if (stockInHandId && (closingStockValue || openingStockValue)) {
        post(stockInHandId, closingStockValue, 0);
        if (openingEquityId) post(openingEquityId, 0, openingStockValue);
        if (purchaseAccountsId) post(purchaseAccountsId, 0, r2(closingStockValue - openingStockValue));
      }

      // Compute final balances for this company
      for (const acc of accounts) {
        const id = String(acc.id);
        const opening = Number(acc?.openingBalance ?? 0);
        const delta = Number(deltaById.get(id) ?? 0);
        computedBalanceByAccountId.set(id, r2(opening + delta));
      }

      // Ensure Trial Balance balances by absorbing any residual difference into Suspense.
      // This covers legacy/partial data (e.g., opening balances without equity offset) and rounding drift.
      if (suspenseAccountId) {
        const suspenseAcc = accountById.get(String(suspenseAccountId)) || null;
        const suspenseSign = suspenseAcc ? (isDebitNature(suspenseAcc.type) ? 1 : -1) : 1;

        const diff = r2(
          accounts.reduce((sum, acc) => {
            const bal = Number(computedBalanceByAccountId.get(String(acc.id)) ?? 0);
            const sign = isDebitNature(acc.type) ? 1 : -1;
            return sum + sign * bal;
          }, 0)
        );

        if (Math.abs(diff) > 0.01) {
          const current = Number(computedBalanceByAccountId.get(String(suspenseAccountId)) ?? 0);
          // New diff = diff + suspenseSign * adjustment => 0 => adjustment = -diff / suspenseSign
          const adjustment = suspenseSign === -1 ? diff : -diff;
          computedBalanceByAccountId.set(String(suspenseAccountId), r2(current + adjustment));
        }
      }
    }

    if (computedBalanceByAccountId.size) {
      next.chartOfAccounts = safeArray(next.chartOfAccounts).map((a) => {
        const id = String(a?.id);
        if (!computedBalanceByAccountId.has(id)) return a;
        return { ...a, balance: computedBalanceByAccountId.get(id) };
      });
    }
  }


  /*
   * Purge the demo seed.
   *
   * Every authenticated tenant used to be handed seventy-five invented
   * customers, vendors and items plus a year of invented invoices, bills,
   * estimates and journals. It made the product impossible to evaluate: every
   * list, total, ageing bucket and chart was fiction, and a real transaction
   * entered beside it was lost in the noise.
   *
   * The seed is deterministic, which is what makes removing it safe. Generated
   * parties and items are named `Customer 001`, `Vendor 044`, `Product 002`,
   * `Service 006`; generated documents all carry a `-D` infix — `INV-D00018`,
   * `BILL-D00003`. Anything a person actually typed matches neither, so this
   * takes the fiction and leaves the facts.
   *
   * Documents that reference a purged party go too. Keeping an invoice whose
   * customer no longer exists would trade invented data for broken data.
   */
  {
    const arr = (v) => (Array.isArray(v) ? v : []);
    const DEMO_PARTY = /^(Customer|Vendor|Product|Service)\s+\d{3}$/;
    const DEMO_DOC = /-D\d{5}$/;
    const DOC_LISTS = [
      'invoices', 'bills', 'estimates', 'salesOrders', 'deliveryChallans',
      'creditNotes', 'debitNotes', 'purchaseOrders', 'expenses',
      'journalEntries', 'receipts', 'payments', 'warehouseTransfers',
      'branchTransfers', 'stockTransfers',
    ];

    const demoParty = (row) => DEMO_PARTY.test(String(row?.name || '').trim());
    const purgedIds = { customers: new Set(), vendors: new Set(), items: new Set() };

    for (const listName of ['customers', 'vendors', 'items']) {
      const rows = arr(next[listName]);
      const keep = [];
      for (const row of rows) {
        if (demoParty(row)) purgedIds[listName].add(String(row?.id));
        else keep.push(row);
      }
      if (keep.length !== rows.length) next[listName] = keep;
    }

    const orphaned = (doc) => {
      const c = String(doc?.customerId ?? '');
      const v = String(doc?.vendorId ?? '');
      return (c && purgedIds.customers.has(c)) || (v && purgedIds.vendors.has(v));
    };

    for (const listName of DOC_LISTS) {
      const rows = arr(next[listName]);
      if (!rows.length) continue;
      const keep = rows.filter((d) => !DEMO_DOC.test(String(d?.number || '').trim()) && !orphaned(d));
      if (keep.length !== rows.length) next[listName] = keep;
    }
  }

  // Heal companies whose registered address only ever reached the profile blob.
  //
  // Company Profile writes `profile.companySettings.reg*`, but every consumer of
  // a company address — both print views and the e-invoice payload — reads the
  // root `address` / `city` / `pincode`. Only `state` was mirrored, so a company
  // could fill the page in, be told "Company settings saved.", and still print a
  // GST invoice with no supplier address on it.
  //
  // Only fills a blank root key: a value already at the root was put there by
  // something else and is not this migration's to overwrite.
  {
    const companies = Array.isArray(next.companies) ? next.companies : [];
    let changed = false;
    const healed = companies.map((c) => {
      const cs = c?.profile?.companySettings;
      if (!cs || typeof cs !== 'object') return c;
      const blank = (v) => String(v ?? '').trim() === '';
      const line = [cs.regAddress1, cs.regAddress2].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const patch = {};
      if (blank(c.address) && line) patch.address = line;
      if (blank(c.city) && !blank(cs.regCity)) patch.city = String(cs.regCity).trim();
      if (blank(c.pincode) && !blank(cs.regPincode)) patch.pincode = String(cs.regPincode).trim();
      if (blank(c.country) && !blank(cs.regCountry)) patch.country = String(cs.regCountry).trim();
      if (blank(c.state) && !blank(cs.regStateName)) patch.state = String(cs.regStateName).trim();
      if (!Object.keys(patch).length) return c;
      changed = true;
      return { ...c, ...patch };
    });
    if (changed) next.companies = healed;
  }

  /*
   * Replace the old visible chart once with the compact hierarchy requested
   * for new books. Existing technical accounts remain available to historic
   * postings, but are retired from selectors and the Chart of Accounts list;
   * deleting their ids would orphan saved vouchers. Cash is the only opening
   * ledger in the visible chart and deliberately has no ledger code.
   */
  {
    const targetGroupNames = new Set([
      'current assets', 'bank accounts', 'cash-in-hand', 'deposits (asset)',
      'tds receivable', 'loans & advances (asset)', 'inventory', 'sundry debtors',
      'fixed assets', 'investments', 'capital account', 'reserves & surplus',
      'current liabilities', 'duties & taxes', 'tds payable', 'provisions',
      'sundry creditors', 'loans (liability)', 'bank od a/c', 'secured loans',
      'unsecured loans', 'suspense a/c', 'profit & loss a/c', 'direct expenses',
      'indirect expenses', 'purchase accounts', 'direct incomes', 'indirect incomes',
      'sales accounts',
    ]);

    for (const company of Array.isArray(next.companies) ? next.companies : []) {
      const companyId = Number(company?.id);
      if (!companyId) continue;
      const settings = company?.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
      const migrations = settings.migrations && typeof settings.migrations === 'object' ? settings.migrations : {};
      if (migrations.coaCompactHierarchyV2Applied) continue;

      next.accountGroups = (Array.isArray(next.accountGroups) ? next.accountGroups : []).map((group) => {
        if (Number(group?.companyId) !== companyId) return group;
        const keep = targetGroupNames.has(String(group?.name || '').trim().toLowerCase());
        return { ...group, isLegacy: !keep, isSystem: keep || Boolean(group?.isSystem) };
      });

      const cashGroup = (Array.isArray(next.accountGroups) ? next.accountGroups : []).find(
        (group) =>
          Number(group?.companyId) === companyId &&
          !group?.isLegacy &&
          String(group?.name || '').trim().toLowerCase() === 'cash-in-hand'
      );
      let cashKept = false;
      next.chartOfAccounts = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).map((account) => {
        if (Number(account?.companyId) !== companyId) return account;
        const isCash = !cashKept && String(account?.name || '').trim().toLowerCase() === 'cash';
        if (isCash) {
          cashKept = true;
          return {
            ...account,
            code: '',
            groupId: cashGroup?.id ?? account.groupId,
            type: 'Asset',
            subType: 'Assets',
            main: 'Balance Sheet',
            ledgerCategory: 'General',
            hiddenFromChart: false,
          };
        }
        return { ...account, hiddenFromChart: true };
      });

      if (!cashKept && cashGroup) {
        const nextId = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).reduce(
          (max, account) => Math.max(max, Number(account?.id || 0)),
          0
        ) + 1;
        next.chartOfAccounts.push({
          id: nextId,
          companyId,
          code: '',
          name: 'Cash',
          ledgerCategory: 'General',
          groupId: cashGroup.id,
          type: 'Asset',
          subType: 'Assets',
          main: 'Balance Sheet',
          openingBalance: 0,
          balance: 0,
          isSystem: true,
          hiddenFromChart: false,
        });
      }

      const appliedAt = new Date().toISOString();
      const nextSettings = {
        ...settings,
        migrations: { ...migrations, coaCompactHierarchyV2Applied: true, coaCompactHierarchyV2AppliedAt: appliedAt },
      };
      next.companies = next.companies.map((row) =>
        Number(row?.id) === companyId ? { ...row, docSettings: nextSettings } : row
      );
    }
  }

  /*
   * The compact chart migration retired the old technical ledgers from the
   * master list. Standard TDS section ledgers were created just before that
   * migration and were accidentally retired with them, even though purchase
   * and expense deductions still offered those exact rows. Restore every
   * ledger filed under TDS Payable / Receivable (including nested groups), so
   * the deduction picker and Chart of Accounts expose one shared master.
   */
  for (const company of Array.isArray(next.companies) ? next.companies : []) {
    const companyId = Number(company?.id);
    if (!companyId) continue;
    const settings = company?.docSettings && typeof company.docSettings === 'object' ? company.docSettings : {};
    const migrations = settings.migrations && typeof settings.migrations === 'object' ? settings.migrations : {};
    if (migrations.tdsLedgersVisibleV1Applied) continue;

    const groups = (Array.isArray(next.accountGroups) ? next.accountGroups : []).filter(
      (group) => Number(group?.companyId) === companyId
    );
    const byId = new Map(groups.map((group) => [String(group.id), group]));
    const belongsToTds = (groupId) => {
      const seen = new Set();
      let group = byId.get(String(groupId || '')) || null;
      while (group && !seen.has(String(group.id))) {
        seen.add(String(group.id));
        if (/\btds\b/i.test(String(group.name || ''))) return true;
        group = byId.get(String(group.parentGroupId || '')) || null;
      }
      return false;
    };

    next.chartOfAccounts = (Array.isArray(next.chartOfAccounts) ? next.chartOfAccounts : []).map((account) =>
      Number(account?.companyId) === companyId && belongsToTds(account?.groupId)
        ? { ...account, hiddenFromChart: false }
        : account
    );
    next.companies = next.companies.map((row) =>
      Number(row?.id) === companyId
        ? {
            ...row,
            docSettings: {
              ...(row.docSettings || {}),
              migrations: {
                ...((row.docSettings && row.docSettings.migrations) || {}),
                tdsLedgersVisibleV1Applied: true,
                tdsLedgersVisibleV1AppliedAt: new Date().toISOString(),
              },
            },
          }
        : row
    );
  }

  return next;
};

export const buildLedgerStatement = (db, companyId, accountId) => {
  const safeArray = (v) => (Array.isArray(v) ? v : []);
  const lower = (s) => String(s || '').trim().toLowerCase();
  const r2 = (n) => {
    const x = Number(n ?? 0);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  };
  const isDebitNature = (type) => ['asset', 'expense'].includes(lower(type));

  const safeText = (v) => String(v ?? '').trim();
  const joinAddress = (addr) => {
    const a = addr && typeof addr === 'object' ? addr : {};
    const parts = [a.line1, a.line2, a.city, a.district, a.state, a.pincode, a.country].map((x) => safeText(x)).filter(Boolean);
    return parts.join(', ');
  };
  const truncate = (s, max = 160) => {
    const str = String(s ?? '');
    if (str.length <= max) return str;
    return `${str.slice(0, Math.max(0, max - 1))}…`;
  };

  const cid = Number(companyId);
  const targetId = String(accountId || '').trim();
  if (!cid || !targetId) return { account: null, rows: [] };

  const accounts = safeArray(db?.chartOfAccounts).filter((a) => Number(a?.companyId) === cid);
  const accountById = new Map(accounts.map((a) => [String(a.id), a]));
  const target = accountById.get(targetId) || null;
  if (!target) return { account: null, rows: [] };

  const findAccountIdByName = (nameLower) => {
    const hit = accounts.find((a) => lower(a?.name) === lower(nameLower));
    return hit ? String(hit.id) : '';
  };
  const findAccountIdByCode = (codeLower) => {
    const hit = accounts.find((a) => lower(a?.code) === lower(codeLower));
    return hit ? String(hit.id) : '';
  };

  const suspenseId = findAccountIdByCode('9999') || findAccountIdByName('suspense / uncategorised') || findAccountIdByName('suspense');
  const arId = findAccountIdByCode('1100') || findAccountIdByName('accounts receivable') || findAccountIdByName('sundry debtors');
  const apId = findAccountIdByCode('2000') || findAccountIdByName('accounts payable') || findAccountIdByName('sundry creditors');
  const outstandingExpensesId = findAccountIdByCode('2050') || findAccountIdByName('outstanding expenses') || suspenseId;

  const customers = safeArray(db?.customers).filter((c) => Number(c?.companyId) === cid);
  const customerById = new Map(customers.map((c) => [String(c.id), c]));
  const vendors = safeArray(db?.vendors).filter((v) => Number(v?.companyId) === cid);
  const vendorById = new Map(vendors.map((v) => [String(v.id), v]));

  const items = safeArray(db?.items).filter((i) => Number(i?.companyId) === cid);
  const itemById = new Map(items.map((i) => [String(i.id), i]));

  const summarizeItems = (lines) => {
    const list = safeArray(lines);
    if (!list.length) return '';
    const parts = list
      .map((l) => {
        const item = l?.itemId ? itemById.get(String(l.itemId)) : null;
        const name = safeText(item?.name || l?.description);
        const qty = Number(l?.quantity ?? 0);
        const rate = Number(l?.rate ?? 0);
        const hsn = safeText(l?.hsnSac || item?.hsnSac);
        const base = name || 'Item';
        const qtyRate = Number.isFinite(qty) && Number.isFinite(rate) ? `${r2(qty)} x ${r2(rate)}` : '';
        const suffix = [qtyRate, hsn ? `HSN/SAC ${hsn}` : ''].filter(Boolean).join(', ');
        return suffix ? `${base} (${suffix})` : base;
      })
      .filter(Boolean);
    return truncate(parts.join(' | '), 260);
  };

  const labelForAccountId = (id) => {
    const a = accountById.get(String(id)) || null;
    return a ? String(a.name || '') : '';
  };

  const rows = [];
  const pushRow = ({ date, particulars, voucherType, voucherNo, narration, debit, credit, meta }) => {
    const d = r2(debit);
    const c = r2(credit);
    if (!d && !c) return;
    rows.push({
      date: String(date || ''),
      particulars: String(particulars || ''),
      voucherType: String(voucherType || ''),
      voucherNo: String(voucherNo || ''),
      narration: String(narration || ''),
      debit: d,
      credit: c,
      ...(meta && typeof meta === 'object' ? meta : {}),
    });
  };

  const addPostingIfMatches = ({ date, voucherType, voucherNo, narration, debitId, creditId, amount, debitParticulars, creditParticulars, meta }) => {
    const amt = r2(amount);
    if (!amt) return;

    if (String(debitId) === targetId) {
      pushRow({
        date,
        particulars: debitParticulars || labelForAccountId(creditId),
        voucherType,
        voucherNo,
        narration,
        debit: amt,
        credit: 0,
        meta,
      });
    }
    if (String(creditId) === targetId) {
      pushRow({
        date,
        particulars: creditParticulars || labelForAccountId(debitId),
        voucherType,
        voucherNo,
        narration,
        debit: 0,
        credit: amt,
        meta,
      });
    }
  };

  const resolveCashBankAccountId = (p) => {
    const explicit = p?.cashBankAccountId !== undefined && p?.cashBankAccountId !== null ? String(p.cashBankAccountId) : '';
    if (explicit && accountById.has(explicit)) return explicit;
    const mode = lower(p?.mode);
    if (mode === 'cash') return findAccountIdByName('cash');
    return findAccountIdByName('hdfc bank') || String(accounts.find((a) => lower(a?.name).includes('bank'))?.id || '') || findAccountIdByName('cash');
  };

  // Journal Entries
  for (const j of safeArray(db?.journalEntries)) {
    if (Number(j?.companyId) !== cid) continue;
    const st = lower(j?.status);
    if (st === 'cancelled') continue;
    const date = j?.date || j?.createdAt || '';
    const voucherNo = j?.number || j?.voucherNo || String(j?.id || '');
    const narration = j?.narration || j?.notes || '';
    const lines = safeArray(j?.lines);

    for (const l of lines) {
      const rawId = String(l?.accountId || '').trim();
      const id = rawId && accountById.has(rawId) ? rawId : suspenseId;
      if (String(id) !== targetId) continue;
      pushRow({
        date,
        particulars: 'Journal',
        voucherType: 'Journal',
        voucherNo,
        narration,
        debit: Number(l?.debit ?? 0),
        credit: Number(l?.credit ?? 0),
        meta: {
          voucherKey: 'journalEntry',
          voucherId: j?.id ?? null,
          reference: safeText(j?.refNo || ''),
        },
      });
    }
  }

  // Invoices
  for (const inv of safeArray(db?.invoices)) {
    if (Number(inv?.companyId) !== cid) continue;
    const st = lower(inv?.status);
    if (st === 'draft' || st === 'cancelled') continue;

    const date = inv?.date || inv?.issueDate || inv?.createdAt || '';
    const voucherNo = inv?.number || String(inv?.id || '');
    const narration = String(inv?.notes || inv?.narration || `Invoice ${voucherNo}`);

    const subtotal = Number(inv?.subtotal ?? inv?.taxableTotal ?? 0);
    const cgst = Number(inv?.cgstTotal ?? 0);
    const sgst = Number(inv?.sgstTotal ?? 0);
    const igst = Number(inv?.igstTotal ?? 0);
    const total = r2(subtotal + cgst + sgst + igst);

    const customerId = String(inv?.customerId || '').trim();
    const customer = customerById.get(customerId) || null;
    const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
    const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : arId || suspenseId;

    const salesRevenueId = findAccountIdByName('sales revenue') || String(accounts.find((a) => lower(a?.type) === 'income')?.id || '');
    const gstOutCgstId = findAccountIdByCode('gst-out-cgst') || findAccountIdByName('output cgst');
    const gstOutSgstId = findAccountIdByCode('gst-out-sgst') || findAccountIdByName('output sgst');
    const gstOutIgstId = findAccountIdByCode('gst-out-igst') || findAccountIdByName('output igst');

    const invoiceMeta = {
      voucherKey: 'invoice',
      voucherId: inv?.id ?? null,
      partyType: 'Customer',
      partyId: customer ? customer.id : customerId || null,
      partyName: safeText(customer?.displayName || customer?.name || inv?.customerName || ''),
      partyGstin: safeText(customer?.gstin || inv?.customerGstin || ''),
      partyPan: safeText(customer?.pan || ''),
      partyBillingAddress: joinAddress(customer?.billingAddress),
      partyShippingAddress: joinAddress(customer?.shippingAddress),
      placeOfSupply: safeText(inv?.placeOfSupplyState || ''),
      taxable: r2(subtotal),
      cgst: r2(cgst),
      sgst: r2(sgst),
      igst: r2(igst),
      total: r2(total),
      itemsSummary: summarizeItems(inv?.items),
      reference: safeText(inv?.refNo || ''),
    };

    addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: salesRevenueId || suspenseId, amount: subtotal });
    addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: salesRevenueId || suspenseId, amount: subtotal, meta: invoiceMeta });
    addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: gstOutCgstId || suspenseId, amount: cgst, meta: invoiceMeta });
    addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: gstOutSgstId || suspenseId, amount: sgst, meta: invoiceMeta });
    addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: gstOutIgstId || suspenseId, amount: igst, meta: invoiceMeta });

    // If stored components are empty but total exists, keep the statement readable
    if (!subtotal && !cgst && !sgst && !igst && total) {
      addPostingIfMatches({ date, voucherType: 'Invoice', voucherNo, narration, debitId: customerAccountId, creditId: salesRevenueId || suspenseId, amount: total, meta: invoiceMeta });
    }
  }

  // Credit Notes
  for (const cn of safeArray(db?.creditNotes)) {
    if (Number(cn?.companyId) !== cid) continue;
    const st = lower(cn?.status);
    if (st === 'draft' || st === 'cancelled') continue;

    const date = cn?.date || cn?.issueDate || cn?.createdAt || '';
    const voucherNo = cn?.number || String(cn?.id || '');
    const narration = String(cn?.notes || cn?.narration || `Credit Note ${voucherNo}`);

    const subtotal = Number(cn?.subtotal ?? cn?.taxableTotal ?? 0);
    const cgst = Number(cn?.cgstTotal ?? 0);
    const sgst = Number(cn?.sgstTotal ?? 0);
    const igst = Number(cn?.igstTotal ?? 0);
    const total = r2(subtotal + cgst + sgst + igst);

    const customerId = String(cn?.customerId || '').trim();
    const customer = customerById.get(customerId) || null;
    const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
    const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : arId || suspenseId;

    const salesRevenueId = findAccountIdByName('sales revenue') || String(accounts.find((a) => lower(a?.type) === 'income')?.id || '');
    const gstOutCgstId = findAccountIdByCode('gst-out-cgst') || findAccountIdByName('output cgst');
    const gstOutSgstId = findAccountIdByCode('gst-out-sgst') || findAccountIdByName('output sgst');
    const gstOutIgstId = findAccountIdByCode('gst-out-igst') || findAccountIdByName('output igst');

    const creditNoteMeta = {
      voucherKey: 'creditNote',
      voucherId: cn?.id ?? null,
      partyType: 'Customer',
      partyId: customer ? customer.id : customerId || null,
      partyName: safeText(customer?.displayName || customer?.name || cn?.customerName || ''),
      partyGstin: safeText(customer?.gstin || cn?.customerGstin || ''),
      partyPan: safeText(customer?.pan || ''),
      partyBillingAddress: joinAddress(customer?.billingAddress),
      partyShippingAddress: joinAddress(customer?.shippingAddress),
      placeOfSupply: safeText(cn?.placeOfSupplyState || ''),
      taxable: r2(subtotal),
      cgst: r2(cgst),
      sgst: r2(sgst),
      igst: r2(igst),
      total: r2(total),
      itemsSummary: summarizeItems(cn?.items),
      reference: safeText(cn?.refNo || ''),
    };

    addPostingIfMatches({ date, voucherType: 'Credit Note', voucherNo, narration, debitId: salesRevenueId || suspenseId, creditId: customerAccountId, amount: subtotal, meta: creditNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Credit Note', voucherNo, narration, debitId: gstOutCgstId || suspenseId, creditId: customerAccountId, amount: cgst, meta: creditNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Credit Note', voucherNo, narration, debitId: gstOutSgstId || suspenseId, creditId: customerAccountId, amount: sgst, meta: creditNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Credit Note', voucherNo, narration, debitId: gstOutIgstId || suspenseId, creditId: customerAccountId, amount: igst, meta: creditNoteMeta });

    if (!subtotal && !cgst && !sgst && !igst && total) {
      addPostingIfMatches({ date, voucherType: 'Credit Note', voucherNo, narration, debitId: salesRevenueId || suspenseId, creditId: customerAccountId, amount: total, meta: creditNoteMeta });
    }
  }

  // Bills
  for (const b of safeArray(db?.bills)) {
    if (Number(b?.companyId) !== cid) continue;
    const st = lower(b?.status);
    if (st === 'draft' || st === 'cancelled') continue;

    const date = b?.date || b?.issueDate || b?.createdAt || '';
    const voucherNo = b?.number || String(b?.id || '');
    const narration = String(b?.notes || b?.narration || `Bill ${voucherNo}`);

    const subtotal = Number(b?.subtotal ?? b?.taxableTotal ?? 0);
    const cgst = Number(b?.cgstTotal ?? 0);
    const sgst = Number(b?.sgstTotal ?? 0);
    const igst = Number(b?.igstTotal ?? 0);
    const total = r2(subtotal + cgst + sgst + igst);

    const vendorId = String(b?.vendorId || '').trim();
    const vendor = vendorById.get(vendorId) || null;
    const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
    const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : apId || suspenseId;

    const purchaseAccountsId = findAccountIdByName('purchase accounts') || String(accounts.find((a) => lower(a?.name || '').includes('purchase'))?.id || '');
    const gstInCgstId = findAccountIdByCode('gst-in-cgst') || findAccountIdByName('input cgst');
    const gstInSgstId = findAccountIdByCode('gst-in-sgst') || findAccountIdByName('input sgst');
    const gstInIgstId = findAccountIdByCode('gst-in-igst') || findAccountIdByName('input igst');

    const billMeta = {
      voucherKey: 'bill',
      voucherId: b?.id ?? null,
      partyType: 'Vendor',
      partyId: vendor ? vendor.id : vendorId || null,
      partyName: safeText(vendor?.displayName || vendor?.name || b?.vendorName || ''),
      partyGstin: safeText(vendor?.gstin || b?.vendorGstin || ''),
      partyPan: safeText(vendor?.pan || ''),
      partyBillingAddress: joinAddress(vendor?.billingAddress),
      partyShippingAddress: joinAddress(vendor?.shippingAddress),
      placeOfSupply: safeText(b?.placeOfSupplyState || ''),
      taxable: r2(subtotal),
      cgst: r2(cgst),
      sgst: r2(sgst),
      igst: r2(igst),
      total: r2(total),
      itemsSummary: summarizeItems(b?.items),
      reference: safeText(b?.refNo || ''),
    };

    addPostingIfMatches({ date, voucherType: 'Bill', voucherNo, narration, debitId: purchaseAccountsId || suspenseId, creditId: vendorAccountId, amount: subtotal, meta: billMeta });
    addPostingIfMatches({ date, voucherType: 'Bill', voucherNo, narration, debitId: gstInCgstId || suspenseId, creditId: vendorAccountId, amount: cgst, meta: billMeta });
    addPostingIfMatches({ date, voucherType: 'Bill', voucherNo, narration, debitId: gstInSgstId || suspenseId, creditId: vendorAccountId, amount: sgst, meta: billMeta });
    addPostingIfMatches({ date, voucherType: 'Bill', voucherNo, narration, debitId: gstInIgstId || suspenseId, creditId: vendorAccountId, amount: igst, meta: billMeta });

    if (!subtotal && !cgst && !sgst && !igst && total) {
      addPostingIfMatches({ date, voucherType: 'Bill', voucherNo, narration, debitId: purchaseAccountsId || suspenseId, creditId: vendorAccountId, amount: total, meta: billMeta });
    }
  }

  // Debit Notes
  for (const dn of safeArray(db?.debitNotes)) {
    if (Number(dn?.companyId) !== cid) continue;
    const st = lower(dn?.status);
    if (st === 'draft' || st === 'cancelled') continue;

    const date = dn?.date || dn?.issueDate || dn?.createdAt || '';
    const voucherNo = dn?.number || String(dn?.id || '');
    const narration = String(dn?.notes || dn?.narration || `Debit Note ${voucherNo}`);

    const subtotal = Number(dn?.subtotal ?? dn?.taxableTotal ?? 0);
    const cgst = Number(dn?.cgstTotal ?? 0);
    const sgst = Number(dn?.sgstTotal ?? 0);
    const igst = Number(dn?.igstTotal ?? 0);
    const total = r2(subtotal + cgst + sgst + igst);

    const vendorId = String(dn?.vendorId || '').trim();
    const vendor = vendorById.get(vendorId) || null;
    const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
    const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : apId || suspenseId;

    const purchaseAccountsId = findAccountIdByName('purchase accounts') || String(accounts.find((a) => lower(a?.name || '').includes('purchase'))?.id || '');
    const gstInCgstId = findAccountIdByCode('gst-in-cgst') || findAccountIdByName('input cgst');
    const gstInSgstId = findAccountIdByCode('gst-in-sgst') || findAccountIdByName('input sgst');
    const gstInIgstId = findAccountIdByCode('gst-in-igst') || findAccountIdByName('input igst');

    const debitNoteMeta = {
      voucherKey: 'debitNote',
      voucherId: dn?.id ?? null,
      partyType: 'Vendor',
      partyId: vendor ? vendor.id : vendorId || null,
      partyName: safeText(vendor?.displayName || vendor?.name || dn?.vendorName || ''),
      partyGstin: safeText(vendor?.gstin || dn?.vendorGstin || ''),
      partyPan: safeText(vendor?.pan || ''),
      partyBillingAddress: joinAddress(vendor?.billingAddress),
      partyShippingAddress: joinAddress(vendor?.shippingAddress),
      placeOfSupply: safeText(dn?.placeOfSupplyState || ''),
      taxable: r2(subtotal),
      cgst: r2(cgst),
      sgst: r2(sgst),
      igst: r2(igst),
      total: r2(total),
      itemsSummary: summarizeItems(dn?.items),
      reference: safeText(dn?.refNo || ''),
    };

    addPostingIfMatches({ date, voucherType: 'Debit Note', voucherNo, narration, debitId: vendorAccountId, creditId: purchaseAccountsId || suspenseId, amount: subtotal, meta: debitNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Debit Note', voucherNo, narration, debitId: vendorAccountId, creditId: gstInCgstId || suspenseId, amount: cgst, meta: debitNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Debit Note', voucherNo, narration, debitId: vendorAccountId, creditId: gstInSgstId || suspenseId, amount: sgst, meta: debitNoteMeta });
    addPostingIfMatches({ date, voucherType: 'Debit Note', voucherNo, narration, debitId: vendorAccountId, creditId: gstInIgstId || suspenseId, amount: igst, meta: debitNoteMeta });

    if (!subtotal && !cgst && !sgst && !igst && total) {
      addPostingIfMatches({ date, voucherType: 'Debit Note', voucherNo, narration, debitId: vendorAccountId, creditId: purchaseAccountsId || suspenseId, amount: total, meta: debitNoteMeta });
    }
  }

  // Expenses
  for (const ex of safeArray(db?.expenses)) {
    if (Number(ex?.companyId) !== cid) continue;
    const st = lower(ex?.status);
    if (st === 'draft' || st === 'cancelled') continue;

    const date = ex?.date || ex?.expenseDate || ex?.createdAt || '';
    const voucherNo = ex?.number || String(ex?.id || '');
    const narration = String(ex?.notes || ex?.narration || `Expense ${voucherNo}`);

    const taxable = Number(ex?.taxableTotal ?? ex?.amount ?? 0);
    const cgst = Number(ex?.cgstTotal ?? 0);
    const sgst = Number(ex?.sgstTotal ?? 0);
    const igst = Number(ex?.igstTotal ?? 0);
    const total = r2(taxable + cgst + sgst + igst);

    const vendorId = String(ex?.vendorId || '').trim();
    const vendor = vendorById.get(vendorId) || null;
    const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
    const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : '';
    const creditId = vendorAccountId || outstandingExpensesId || suspenseId;

    const operatingExpensesId = findAccountIdByName('operating expenses') || String(accounts.find((a) => lower(a?.type) === 'expense')?.id || '');
    const gstInCgstId = findAccountIdByCode('gst-in-cgst') || findAccountIdByName('input cgst');
    const gstInSgstId = findAccountIdByCode('gst-in-sgst') || findAccountIdByName('input sgst');
    const gstInIgstId = findAccountIdByCode('gst-in-igst') || findAccountIdByName('input igst');

    const expenseMeta = {
      voucherKey: 'expense',
      voucherId: ex?.id ?? null,
      partyType: vendor ? 'Vendor' : '',
      partyId: vendor ? vendor.id : vendorId || null,
      partyName: safeText(vendor?.displayName || vendor?.name || ex?.vendorName || ''),
      partyGstin: safeText(vendor?.gstin || ex?.vendorGstin || ''),
      partyPan: safeText(vendor?.pan || ''),
      partyBillingAddress: joinAddress(vendor?.billingAddress),
      partyShippingAddress: joinAddress(vendor?.shippingAddress),
      placeOfSupply: safeText(ex?.placeOfSupplyState || ''),
      taxable: r2(taxable),
      cgst: r2(cgst),
      sgst: r2(sgst),
      igst: r2(igst),
      total: r2(total),
      itemsSummary: '',
      reference: safeText(ex?.refNo || ''),
    };

    addPostingIfMatches({ date, voucherType: 'Expense', voucherNo, narration, debitId: operatingExpensesId || suspenseId, creditId, amount: taxable, meta: expenseMeta });
    addPostingIfMatches({ date, voucherType: 'Expense', voucherNo, narration, debitId: gstInCgstId || suspenseId, creditId, amount: cgst, meta: expenseMeta });
    addPostingIfMatches({ date, voucherType: 'Expense', voucherNo, narration, debitId: gstInSgstId || suspenseId, creditId, amount: sgst, meta: expenseMeta });
    addPostingIfMatches({ date, voucherType: 'Expense', voucherNo, narration, debitId: gstInIgstId || suspenseId, creditId, amount: igst, meta: expenseMeta });

    if (!taxable && !cgst && !sgst && !igst && total) {
      addPostingIfMatches({ date, voucherType: 'Expense', voucherNo, narration, debitId: operatingExpensesId || suspenseId, creditId, amount: total, meta: expenseMeta });
    }
  }

  // Payments / Receipts
  for (const p of safeArray(db?.payments)) {
    if (Number(p?.companyId) !== cid) continue;
    const amount = Number(p?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const dir = lower(p?.direction);
    const date = p?.date || p?.paymentDate || p?.createdAt || '';
    const voucherNo = p?.number || String(p?.id || '');
    const narration = String(p?.narration || p?.notes || '');

    const cashBankId = resolveCashBankAccountId(p) || suspenseId;
    const cashBankName = labelForAccountId(cashBankId) || '';

    if (dir === 'in') {
      let customerId = p?.customerId !== undefined && p?.customerId !== null ? String(p.customerId) : '';
      if (!customerId && lower(p?.voucherType) === 'invoice') {
        const inv = safeArray(db?.invoices).find((i) => Number(i?.companyId) === cid && String(i?.id) === String(p?.voucherId || '')) || null;
        customerId = inv ? String(inv?.customerId || '') : '';
      }
      const customer = customerById.get(String(customerId || '').trim()) || null;
      const customerAccountIdRaw = customer?.accountId !== undefined && customer?.accountId !== null ? String(customer.accountId) : '';
      const customerAccountId = customerAccountIdRaw && accountById.has(customerAccountIdRaw) ? customerAccountIdRaw : arId || suspenseId;

      addPostingIfMatches({
        date,
        voucherType: 'Receipt',
        voucherNo,
        narration,
        debitId: cashBankId,
        creditId: customerAccountId,
        amount,
        meta: {
          voucherKey: 'receipt',
          voucherId: p?.id ?? null,
          partyType: 'Customer',
          partyId: customer ? customer.id : customerId || null,
          partyName: safeText(customer?.displayName || customer?.name || ''),
          partyGstin: safeText(customer?.gstin || ''),
          partyPan: safeText(customer?.pan || ''),
          partyBillingAddress: joinAddress(customer?.billingAddress),
          partyShippingAddress: joinAddress(customer?.shippingAddress),
          reference: safeText(p?.refNo || p?.reference || ''),
          cashBank: safeText(cashBankName),
        },
      });
    } else if (dir === 'out') {
      let vendorId = p?.vendorId !== undefined && p?.vendorId !== null ? String(p.vendorId) : '';
      const vt = lower(p?.voucherType);
      if (!vendorId && vt === 'bill') {
        const bill = safeArray(db?.bills).find((b) => Number(b?.companyId) === cid && String(b?.id) === String(p?.voucherId || '')) || null;
        vendorId = bill ? String(bill?.vendorId || '') : '';
      }
      if (!vendorId && vt === 'expense') {
        const ex = safeArray(db?.expenses).find((e) => Number(e?.companyId) === cid && String(e?.id) === String(p?.voucherId || '')) || null;
        vendorId = ex ? String(ex?.vendorId || '') : '';
      }
      const vendor = vendorById.get(String(vendorId || '').trim()) || null;
      const vendorAccountIdRaw = vendor?.accountId !== undefined && vendor?.accountId !== null ? String(vendor.accountId) : '';
      const vendorAccountId = vendorAccountIdRaw && accountById.has(vendorAccountIdRaw) ? vendorAccountIdRaw : '';
      const debitId = vendorAccountId || outstandingExpensesId || apId || suspenseId;

      addPostingIfMatches({
        date,
        voucherType: 'Payment',
        voucherNo,
        narration,
        debitId,
        creditId: cashBankId,
        amount,
        meta: {
          voucherKey: 'payment',
          voucherId: p?.id ?? null,
          partyType: vendor ? 'Vendor' : '',
          partyId: vendor ? vendor.id : vendorId || null,
          partyName: safeText(vendor?.displayName || vendor?.name || ''),
          partyGstin: safeText(vendor?.gstin || ''),
          partyPan: safeText(vendor?.pan || ''),
          partyBillingAddress: joinAddress(vendor?.billingAddress),
          partyShippingAddress: joinAddress(vendor?.shippingAddress),
          reference: safeText(p?.refNo || p?.reference || ''),
          cashBank: safeText(cashBankName),
        },
      });
    }
  }

  // Cash/Bank module transactions (unlinked)
  for (const t of safeArray(db?.bankTransactions)) {
    if (Number(t?.companyId) !== cid) continue;
    const linked = t?.linkedPaymentId !== undefined && t?.linkedPaymentId !== null ? Number(t.linkedPaymentId) : null;
    if (linked) continue;

    const date = t?.date || t?.createdAt || '';
    const voucherNo = String(t?.reference || t?.id || '');
    const narration = String(t?.narration || t?.description || '');

    const cashBankId = String(t?.cashBankAccountId || '').trim();
    const counterRaw = String(t?.ledgerId || '').trim();
    const counterId = counterRaw && accountById.has(counterRaw) ? counterRaw : suspenseId;
    if (!cashBankId) continue;

    const amt = Number(t?.amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const dir = lower(t?.direction);

    if (dir === 'in') {
      addPostingIfMatches({
        date,
        voucherType: 'Cash/Bank',
        voucherNo,
        narration,
        debitId: cashBankId,
        creditId: counterId,
        amount: amt,
        meta: {
          voucherKey: 'cashBank',
          voucherId: t?.id ?? null,
          reference: safeText(t?.reference || ''),
          cashBank: safeText(labelForAccountId(cashBankId) || ''),
        },
      });
    } else if (dir === 'out') {
      addPostingIfMatches({
        date,
        voucherType: 'Cash/Bank',
        voucherNo,
        narration,
        debitId: counterId,
        creditId: cashBankId,
        amount: amt,
        meta: {
          voucherKey: 'cashBank',
          voucherId: t?.id ?? null,
          reference: safeText(t?.reference || ''),
          cashBank: safeText(labelForAccountId(cashBankId) || ''),
        },
      });
    }
  }

  const sorted = rows
    .map((r, idx) => ({ ...r, _idx: idx }))
    .sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      if (ad !== bd) return ad - bd;
      return a._idx - b._idx;
    })
    .map(({ _idx, ...r }) => r);

  const opening = r2(Number(target?.openingBalance ?? 0));
  const debitNature = isDebitNature(target?.type);
  let running = opening;
  const withRunning = sorted.map((r) => {
    const d = Number(r.debit ?? 0);
    const c = Number(r.credit ?? 0);
    running = r2(running + (debitNature ? d - c : c - d));
    return { ...r, runningBalance: running };
  });

  return {
    account: target,
    openingBalance: opening,
    rows: withRunning,
  };
};
