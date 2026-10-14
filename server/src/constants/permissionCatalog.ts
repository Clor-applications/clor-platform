import { PermissionAction } from './enums.js';

/**
 * The permission catalog: the single source of truth for what can be granted.
 *
 * Shape mirrors ERPNext's Role Permission Manager — a module holds resources
 * (ERPNext calls them DocTypes), and each resource declares which actions are
 * meaningful for it. A report has no CREATE; a voucher has no APPROVE unless it
 * runs through an approval step.
 *
 * The API serves this to the UI so the permission matrix is rendered from server
 * truth rather than a hardcoded client list that can drift.
 */

export type FieldDef = {
  key: string;
  label: string;
  /** 0 = ordinary. Above 0 requires a rule granting at least this level. */
  permLevel: number;
};

export type ResourceDef = {
  key: string; // subModule value stored on Permission
  label: string;
  description?: string;
  actions: string[];
  /** Fields worth restricting individually. Anything unlisted is level 0. */
  fields?: FieldDef[];
};

export type ModuleDef = {
  key: string; // module value stored on Permission
  label: string;
  description?: string;
  resources: ResourceDef[];
};

const A = PermissionAction;

// Common action sets, named so the intent is readable at each call site.
const DOCUMENT = [A.VIEW, A.CREATE, A.EDIT, A.DELETE, A.EXPORT];
const DOCUMENT_APPROVAL = [A.VIEW, A.CREATE, A.EDIT, A.DELETE, A.APPROVE, A.EXPORT];
const MASTER = [A.VIEW, A.CREATE, A.EDIT, A.DELETE];
const REPORT = [A.VIEW, A.EXPORT];
const SETTING = [A.VIEW, A.EDIT];

export const PERMISSION_CATALOG: ModuleDef[] = [
  {
    key: 'SALES',
    label: 'Sales',
    description: 'Customer-facing documents and collections',
    resources: [
      {
        key: 'Invoices',
        label: 'Invoices',
        actions: DOCUMENT,
        // Pricing and settlement are held above the ordinary level: a clerk may
        // raise an invoice without being able to discount it or mark it paid.
        fields: [
          { key: 'discount', label: 'Discount', permLevel: 1 },
          { key: 'paidAmount', label: 'Amount paid', permLevel: 1 },
          { key: 'status', label: 'Status', permLevel: 1 },
        ],
      },
      { key: 'Receipts', label: 'Receipts', actions: DOCUMENT },
      { key: 'Estimates', label: 'Estimates / Quotes', actions: DOCUMENT },
      { key: 'Credit Notes', label: 'Credit Notes', actions: DOCUMENT_APPROVAL },
      /*
       * These two have had routes for a while and no entry here, which meant
       * nobody could be granted them deliberately — the authorisation
       * middleware quietly created and granted them when the org creator first
       * hit one. Now that a denial is a denial, an endpoint that guards a
       * resource must have that resource in this catalogue.
       */
      { key: 'Sales Orders', label: 'Sales Orders', actions: DOCUMENT_APPROVAL },
      { key: 'Delivery Challans', label: 'Delivery Challans', actions: DOCUMENT },
      // The till count at the end of a POS day. Viewing it and doing it are
      // separate rights on purpose: the owner reads the over/short figure that
      // the cashier produces.
      { key: 'POS Day Close', label: 'POS Day Close', actions: [A.VIEW, A.CREATE, A.EXPORT] },
    ],
  },
  {
    key: 'PURCHASE',
    label: 'Purchases',
    description: 'Vendor documents and payments',
    resources: [
      { key: 'Bills', label: 'Bills', actions: DOCUMENT },
      { key: 'Payments', label: 'Payments', actions: DOCUMENT_APPROVAL },
      { key: 'Purchase Orders', label: 'Purchase Orders', actions: DOCUMENT_APPROVAL },
      { key: 'Debit Notes', label: 'Debit Notes', actions: DOCUMENT_APPROVAL },
    ],
  },
  {
    key: 'INVENTORY',
    label: 'Inventory',
    description: 'Stock on hand and its movements',
    resources: [
      { key: 'Stock Adjustment', label: 'Stock Adjustment', actions: DOCUMENT_APPROVAL },
      { key: 'Stock Transfer', label: 'Stock Transfer', actions: DOCUMENT_APPROVAL },
      { key: 'Inter-branch transfer', label: 'Inter-branch Transfer', actions: DOCUMENT_APPROVAL },
    ],
  },
  {
    key: 'ACCOUNTING',
    label: 'Accounting',
    description: 'The general ledger and its entries',
    resources: [
      {
        key: 'Ledger',
        label: 'General Ledger',
        description: 'Post and reverse journal entries; lock periods',
        actions: [A.VIEW, A.CREATE, A.EDIT, A.APPROVE, A.EXPORT],
      },
      { key: 'Journal Entries', label: 'Journal Entries', actions: DOCUMENT },
      { key: 'Chart of Accounts', label: 'Chart of Accounts', actions: MASTER },
    ],
  },
  {
    key: 'CASHBANK',
    label: 'Cash & Bank',
    resources: [
      { key: 'Cash & Bank', label: 'Cash & Bank', actions: DOCUMENT },
      { key: 'Bank Transactions', label: 'Bank Transactions', actions: DOCUMENT },
    ],
  },
  {
    key: 'EXPENSES',
    label: 'Expenses',
    resources: [{ key: 'Expenses', label: 'Expenses', actions: DOCUMENT_APPROVAL }],
  },
  {
    key: 'MASTERS',
    label: 'Master Data',
    description: 'Reference data shared across documents',
    resources: [
      { key: 'Customers', label: 'Customers', actions: MASTER },
      { key: 'Vendors', label: 'Vendors', actions: MASTER },
      { key: 'Items', label: 'Items', actions: MASTER },
      { key: 'GST Rates', label: 'GST Rates', actions: MASTER },
      { key: 'Units of Measure', label: 'Units of Measure', actions: MASTER },
      { key: 'Salesmen', label: 'Salesmen', actions: MASTER },
      {
        key: 'Masters',
        label: 'Units, categories, price lists & groups',
        description: 'The six reference lists shared by every document',
        actions: MASTER,
      },
      {
        key: 'Company/Branch setup',
        label: 'Company, Branch & Warehouse',
        description: 'Create and edit branches and warehouses',
        actions: MASTER,
      },
    ],
  },
  {
    key: 'REPORTS',
    label: 'Reports',
    resources: [
      { key: 'Trial Balance', label: 'Trial Balance', actions: REPORT },
      { key: 'Profit & Loss', label: 'Profit & Loss', actions: REPORT },
      { key: 'Balance Sheet', label: 'Balance Sheet', actions: REPORT },
      { key: 'Cash Flow', label: 'Cash Flow', actions: REPORT },
      { key: 'Sales Reports', label: 'Sales Reports', actions: REPORT },
      { key: 'GSTR-1', label: 'GSTR-1', actions: REPORT },
      { key: 'GSTR-3B', label: 'GSTR-3B', actions: REPORT },
    ],
  },
  {
    key: 'SETTINGS',
    label: 'Settings',
    description: 'Administration. Grant with care.',
    resources: [
      { key: 'Users', label: 'Users', actions: MASTER },
      { key: 'Roles', label: 'Roles & Permissions', actions: MASTER },
      { key: 'Company Profile', label: 'Company Profile', actions: SETTING },
      { key: 'Tax Settings', label: 'Tax Settings', actions: SETTING },
      { key: 'Document Numbering', label: 'Document Numbering', actions: SETTING },
      { key: 'Document Templates', label: 'Document Templates', actions: SETTING },
      {
        key: 'Company data',
        label: 'Company Data Export',
        description:
          'Take a copy of everything this company holds. Deliberately separate from Company Profile: ' +
          'somebody who may correct an address should not thereby be able to walk out with the customer list.',
        actions: [A.VIEW, A.EXPORT],
      },
      {
        key: 'Audit trail',
        label: 'Audit Trail',
        description: 'Read who changed what. There is nothing to grant beyond viewing: the trail cannot be edited.',
        actions: [A.VIEW, A.EXPORT],
      },
    ],
  },
  {
    key: 'PAYROLL',
    label: 'Payroll',
    description: 'Salaries, statutory deductions and what they post to the books',
    resources: [
      {
        key: 'Salary Structures',
        label: 'Salary structures',
        description: 'Reusable salary templates and the components on them',
        actions: MASTER,
      },
      {
        key: 'Salary Assignments',
        label: 'Salary assignments',
        description: 'What an individual is paid, and from when',
        actions: MASTER,
        /*
         * Seeing that somebody has a salary is not the same as seeing the
         * figure. A payroll clerk preparing a run needs the list; only a
         * payroll manager needs the amounts. The same reasoning the invoice
         * resource already uses for discount and settlement.
         */
        fields: [
          { key: 'annualCtc', label: 'Salary amount', permLevel: 1 },
          { key: 'monthlyCtc', label: 'Monthly salary', permLevel: 1 },
        ],
      },
      {
        key: 'Salary Revisions',
        label: 'Salary revisions',
        description: 'Proposed raises, and approving them',
        actions: DOCUMENT_APPROVAL,
      },
      {
        key: 'Payroll Runs',
        label: 'Pay runs',
        description: 'Preparing, calculating, reviewing and approving a payroll',
        actions: DOCUMENT_APPROVAL,
      },
      {
        key: 'Salary Slips',
        label: 'Salary slips',
        description: 'Payslips and how each figure on them was reached',
        actions: [A.VIEW, A.EXPORT],
      },
      {
        key: 'Payroll Adjustments',
        label: 'Payroll adjustments',
        description: 'One-off bonuses, arrears and recoveries',
        actions: DOCUMENT_APPROVAL,
      },
      {
        key: 'Payroll Loans',
        label: 'Loans and advances',
        description: 'Money lent to staff and recovered from pay',
        actions: DOCUMENT_APPROVAL,
      },
      {
        key: 'Payroll Payments',
        label: 'Salary payments',
        description: 'Bank advice, payment files and marking salaries paid',
        actions: [A.VIEW, A.CREATE, A.EDIT, A.EXPORT],
      },
      {
        key: 'Payroll Posting',
        label: 'Payroll posting',
        description: 'Writing the payroll journal into the ledger',
        actions: [A.VIEW, A.CREATE],
      },
      {
        key: 'Employee Payroll Profile',
        label: 'Employee payroll details',
        description: 'Bank account, PAN, UAN and the statutory numbers',
        actions: MASTER,
        /*
         * A bank account number and a PAN are the two fields payroll holds
         * that are worth stealing. They are masked for everybody and revealed
         * only at this level, separately from the ordinary profile.
         */
        fields: [
          { key: 'bankAccountNumber', label: 'Bank account number', permLevel: 1 },
          { key: 'pan', label: 'PAN', permLevel: 1 },
          { key: 'taxDetails', label: 'Tax declaration details', permLevel: 1 },
        ],
      },
      {
        key: 'Payroll Settings',
        label: 'Payroll settings',
        description: 'Components, pay groups, periods, ledger mapping and statutory rules',
        actions: SETTING,
      },
      {
        key: 'Payroll Reports',
        label: 'Payroll reports',
        description: 'Salary register, cost summaries and statutory returns',
        actions: REPORT,
      },
    ],
  },
];

/** Flat list of every grantable permission, as (module, subModule, action). */
/** Field definitions for a resource, or an empty list. */
export const fieldsFor = (module: string, resource: string): FieldDef[] => {
  const mod = PERMISSION_CATALOG.find((m) => m.key === module);
  return mod?.resources.find((r) => r.key === resource)?.fields || [];
};

export const flattenCatalog = () => {
  const rows: Array<{ module: string; subModule: string; action: string }> = [];
  for (const m of PERMISSION_CATALOG) {
    for (const r of m.resources) {
      for (const a of r.actions) {
        rows.push({ module: m.key, subModule: r.key, action: a });
      }
    }
  }
  return rows;
};

/** `MODULE::Resource::ACTION` — the wire format used by the UI and /auth/me. */
export const permKey = (module: string, subModule: string | null, action: string) =>
  `${module}::${subModule || ''}::${action}`;

/** Guards writes: a role may only be granted permissions that exist in the catalog. */
const CATALOG_KEYS = new Set(flattenCatalog().map((r) => permKey(r.module, r.subModule, r.action)));
export const isKnownPermission = (module: string, subModule: string | null, action: string) =>
  CATALOG_KEYS.has(permKey(module, subModule, action));

/**
 * Preset role templates, equivalent to ERPNext's stock roles. Each lists the
 * permissions granted; anything not listed is denied.
 */
export type RolePreset = {
  label: string;
  description: string;
  /** Seeded role type: ADMIN | ACCOUNTANT | SALES | CUSTOM. */
  roleType: string;
  /** Odoo's "own documents only": reads are limited to rows the holder created. */
  ownDocumentsOnly?: boolean;
  /** The team heading the role picker files it under. */
  group: string;
  grants: Array<[string, string, string[]]>;
};

/*
 * The preset list follows the tiers the established products use, so a
 * business moving from them finds the roles it expects:
 *
 *   Odoo       — per app: User (own documents) / User (all documents) /
 *                Administrator; Accounting: Billing / Accountant / Adviser.
 *   ERPNext    — Manager / User per module, plus Auditor, HR & Payroll.
 *   QuickBooks — Reports only.
 *   Zoho Books — Admin, Staff, custom roles.
 *
 * "User" raises and edits; "Manager" additionally approves, deletes, exports
 * and maintains the module's masters. Every grant is a catalogue row, so a
 * preset can only ever hand out something a route actually checks.
 */
const USER = [A.VIEW, A.CREATE, A.EDIT];
const USER_EXPORT = [A.VIEW, A.CREATE, A.EDIT, A.EXPORT];
const READ = [A.VIEW, A.EXPORT];
// Branch/warehouse lists are reference data every document form needs.
const REFERENCE_DATA: Array<[string, string, string[]]> = [
  ['MASTERS', 'Company/Branch setup', [A.VIEW]],
  ['MASTERS', 'Items', [A.VIEW]],
  ['MASTERS', 'GST Rates', [A.VIEW]],
  ['MASTERS', 'Units of Measure', [A.VIEW]],
];

export const ROLE_PRESETS: Record<string, RolePreset> = {
  ADMIN: {
    label: 'Administrator',
    group: 'Administration',
    description: 'Full access to every module, including users and roles',
    roleType: 'ADMIN',
    grants: PERMISSION_CATALOG.map((m) => [m.key, '*', ['*']] as [string, string, string[]]),
  },

  // ---- Accounting (Odoo: Billing / Accountant / Adviser) ----
  BILLING: {
    label: 'Billing Clerk',
    group: 'Accounting',
    description: 'Raise invoices, receipts and estimates; no ledger, no purchases',
    roleType: 'CUSTOM',
    grants: [
      ['SALES', 'Invoices', USER],
      ['SALES', 'Receipts', USER],
      ['SALES', 'Estimates', USER],
      ['SALES', 'Delivery Challans', USER],
      ['MASTERS', 'Customers', USER],
      ...REFERENCE_DATA,
    ],
  },
  ACCOUNTANT: {
    label: 'Accountant',
    group: 'Accounting',
    description: 'Full books and reporting; no user or role administration',
    roleType: 'ACCOUNTANT',
    grants: [
      ['SALES', '*', USER_EXPORT],
      ['PURCHASE', '*', USER_EXPORT],
      ['ACCOUNTING', '*', USER_EXPORT],
      ['CASHBANK', '*', USER_EXPORT],
      ['EXPENSES', '*', USER_EXPORT],
      ['INVENTORY', '*', [A.VIEW]],
      ['MASTERS', '*', USER],
      ['REPORTS', '*', READ],
      ['SETTINGS', 'Company Profile', [A.VIEW]],
      ['SETTINGS', 'Tax Settings', [A.VIEW]],
    ],
  },
  ACCOUNTS_MANAGER: {
    label: 'Accounts Manager',
    group: 'Accounting',
    description: 'Everything an Accountant does, plus approvals, deletions, tax and numbering settings',
    roleType: 'ACCOUNTANT',
    grants: [
      ['SALES', '*', ['*']],
      ['PURCHASE', '*', ['*']],
      ['ACCOUNTING', '*', ['*']],
      ['CASHBANK', '*', ['*']],
      ['EXPENSES', '*', ['*']],
      ['INVENTORY', '*', [A.VIEW, A.APPROVE, A.EXPORT]],
      ['MASTERS', '*', ['*']],
      ['REPORTS', '*', READ],
      ['SETTINGS', 'Company Profile', [A.VIEW]],
      ['SETTINGS', 'Tax Settings', [A.VIEW, A.EDIT]],
      ['SETTINGS', 'Document Numbering', [A.VIEW, A.EDIT]],
      ['SETTINGS', 'Document Templates', [A.VIEW, A.EDIT]],
      ['SETTINGS', 'Audit trail', READ],
    ],
  },

  // ---- Sales (Odoo: own documents / all documents / administrator) ----
  SALES_REP: {
    label: 'Sales Representative',
    group: 'Sales',
    description: 'Raise sales documents, but see only the ones they raised themselves',
    roleType: 'SALES',
    ownDocumentsOnly: true,
    grants: [
      ['SALES', '*', USER],
      ['MASTERS', 'Customers', USER],
      ['INVENTORY', '*', [A.VIEW]],
      ...REFERENCE_DATA,
    ],
  },
  SALES: {
    label: 'Sales User',
    group: 'Sales',
    description: 'Raise sales documents and see customers; no purchase or ledger access',
    roleType: 'SALES',
    grants: [
      ['SALES', '*', USER],
      ['MASTERS', 'Customers', USER],
      ['INVENTORY', '*', [A.VIEW]],
      ['REPORTS', 'Sales Reports', [A.VIEW]],
      ...REFERENCE_DATA,
    ],
  },
  SALES_MANAGER: {
    label: 'Sales Manager',
    group: 'Sales',
    description: 'All sales documents with approval, deletion and export; customers and salesmen',
    roleType: 'SALES',
    grants: [
      ['SALES', '*', ['*']],
      ['MASTERS', 'Customers', ['*']],
      ['MASTERS', 'Salesmen', ['*']],
      ['INVENTORY', '*', [A.VIEW]],
      ['REPORTS', 'Sales Reports', READ],
      ['REPORTS', 'GSTR-1', READ],
      ...REFERENCE_DATA,
    ],
  },

  // ---- Purchase (ERPNext: Purchase User / Purchase Manager) ----
  PURCHASE: {
    label: 'Purchase User',
    group: 'Purchase',
    description: 'Record bills and purchase orders and pay vendors; no sales or ledger access',
    roleType: 'CUSTOM',
    grants: [
      ['PURCHASE', 'Bills', USER],
      ['PURCHASE', 'Purchase Orders', USER],
      ['PURCHASE', 'Payments', USER],
      ['EXPENSES', 'Expenses', USER],
      ['MASTERS', 'Vendors', USER],
      ['INVENTORY', '*', [A.VIEW]],
      ...REFERENCE_DATA,
    ],
  },
  PURCHASE_MANAGER: {
    label: 'Purchase Manager',
    group: 'Purchase',
    description: 'All purchase documents with approval, deletion and export; debit notes and vendors',
    roleType: 'CUSTOM',
    grants: [
      ['PURCHASE', '*', ['*']],
      ['EXPENSES', '*', ['*']],
      ['MASTERS', 'Vendors', ['*']],
      ['INVENTORY', '*', [A.VIEW]],
      ['REPORTS', 'GSTR-3B', READ],
      ...REFERENCE_DATA,
    ],
  },

  // ---- Inventory (Odoo: User / Administrator) ----
  STORE: {
    label: 'Store Keeper',
    group: 'Inventory',
    description: 'Stock movements for the branches and warehouses assigned to the user',
    roleType: 'CUSTOM',
    grants: [
      ['INVENTORY', '*', USER],
      ['SALES', 'Invoices', [A.VIEW]],
      ['SALES', 'Delivery Challans', USER],
      ['PURCHASE', 'Bills', [A.VIEW]],
      ...REFERENCE_DATA,
    ],
  },
  STORE_MANAGER: {
    label: 'Store Manager',
    group: 'Inventory',
    description: 'All stock movements with approval and deletion; maintains items and units',
    roleType: 'CUSTOM',
    grants: [
      ['INVENTORY', '*', ['*']],
      ['SALES', 'Invoices', [A.VIEW]],
      ['SALES', 'Delivery Challans', ['*']],
      ['PURCHASE', 'Bills', [A.VIEW]],
      ['PURCHASE', 'Purchase Orders', [A.VIEW]],
      ['MASTERS', 'Items', ['*']],
      ['MASTERS', 'Units of Measure', ['*']],
      ['MASTERS', 'Company/Branch setup', [A.VIEW]],
      ['MASTERS', 'GST Rates', [A.VIEW]],
    ],
  },

  // ---- Payroll (ERPNext: HR User / HR Manager) ----
  PAYROLL_USER: {
    label: 'Payroll User',
    group: 'Payroll',
    description: 'Prepare payroll: structures, assignments, runs and adjustments; no approval or posting',
    roleType: 'CUSTOM',
    grants: [
      ['PAYROLL', 'Salary Structures', USER],
      ['PAYROLL', 'Salary Assignments', USER],
      ['PAYROLL', 'Salary Revisions', USER],
      ['PAYROLL', 'Payroll Runs', USER],
      ['PAYROLL', 'Salary Slips', READ],
      ['PAYROLL', 'Payroll Adjustments', USER],
      ['PAYROLL', 'Payroll Loans', USER],
      ['PAYROLL', 'Employee Payroll Profile', USER],
      ['PAYROLL', 'Payroll Settings', [A.VIEW]],
      ['PAYROLL', 'Payroll Reports', [A.VIEW]],
      ['MASTERS', 'Company/Branch setup', [A.VIEW]],
    ],
  },
  PAYROLL_MANAGER: {
    label: 'Payroll Manager',
    group: 'Payroll',
    description: 'Run, approve, pay and post payroll; payroll settings and reports',
    roleType: 'CUSTOM',
    grants: [
      ['PAYROLL', '*', ['*']],
      ['MASTERS', 'Company/Branch setup', [A.VIEW]],
    ],
  },

  // ---- Read-only (ERPNext: Auditor; QuickBooks: Reports only) ----
  AUDITOR: {
    label: 'Auditor',
    group: 'Read-only',
    description: 'Read and export every book, document, report and the audit trail; change nothing',
    roleType: 'CUSTOM',
    grants: [
      ['SALES', '*', READ],
      ['PURCHASE', '*', READ],
      ['INVENTORY', '*', READ],
      ['ACCOUNTING', '*', READ],
      ['CASHBANK', '*', READ],
      ['EXPENSES', '*', READ],
      ['MASTERS', '*', [A.VIEW]],
      ['REPORTS', '*', READ],
      ['SETTINGS', 'Company Profile', [A.VIEW]],
      ['SETTINGS', 'Tax Settings', [A.VIEW]],
      ['SETTINGS', 'Company data', READ],
      ['SETTINGS', 'Audit trail', READ],
    ],
  },
  REPORTS_ONLY: {
    label: 'Reports Only',
    group: 'Read-only',
    description: 'Financial and GST reports, nothing else',
    roleType: 'CUSTOM',
    grants: [['REPORTS', '*', READ]],
  },
  VIEWER: {
    label: 'Viewer',
    group: 'Read-only',
    description: 'Read-only across the product',
    roleType: 'CUSTOM',
    grants: PERMISSION_CATALOG.map((m) => [m.key, '*', [A.VIEW]] as [string, string, string[]]),
  },
};

/**
 * The picker heading for a role: its stock preset's team when it is one,
 * Administration for any other ADMIN role (the auto-created Owner), and
 * Custom for everything an organisation made itself.
 */
export const roleGroup = (role: { name: string; roleType: string }) => {
  const preset = Object.values(ROLE_PRESETS).find((p) => p.label.toLowerCase() === String(role.name).toLowerCase());
  if (preset) return preset.group;
  return role.roleType === 'ADMIN' ? 'Administration' : 'Custom';
};

/** Expands a preset's wildcards into concrete catalog rows. */
export const expandPreset = (presetKey: string) => {
  const preset = ROLE_PRESETS[presetKey];
  if (!preset) return [];

  const out: Array<{ module: string; subModule: string; action: string }> = [];
  for (const [moduleKey, resourceKey, actions] of preset.grants) {
    const mod = PERMISSION_CATALOG.find((m) => m.key === moduleKey);
    if (!mod) continue;
    const resources = resourceKey === '*' ? mod.resources : mod.resources.filter((r) => r.key === resourceKey);
    for (const r of resources) {
      const wanted = actions.includes('*') ? r.actions : r.actions.filter((a) => actions.includes(a));
      for (const a of wanted) out.push({ module: mod.key, subModule: r.key, action: a });
    }
  }
  return out;
};
