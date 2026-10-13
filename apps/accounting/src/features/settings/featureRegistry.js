import {
  BadgePercent,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  FileSignature,
  FileStack,
  GitBranch,
  Landmark,
  Layers,
  MonitorSmartphone,
  Network,
  Package,
  PackageSearch,
  Percent,
  RefreshCw,
  Repeat,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Table2,
  Tags,
  Undo2,
  Upload,
  UserRoundCheck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

/**
 * The Features screen, in the six groups the business thinks in.
 *
 * The catalogue's own `category` was written for the server — Operations,
 * Accounting, Governance, Data — and nineteen of thirty-nine switches land in
 * "Operations", which tells the person reading it nothing. These are the
 * groups the setting-up conversation actually has: what kind of organisation
 * is this, what does it sell, what does it buy, what does it stock, what tax
 * does it answer to.
 *
 * A view over the catalogue, not a second source of truth. The server still
 * decides which features exist, their defaults, and whether one is locked.
 *
 * Anything not named here falls to "Other", deliberately: a capability added
 * on the server later must appear somewhere without a matching edit here, or
 * it is invisible until somebody notices.
 */

export const FEATURE_GROUPS = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'general', label: 'General' },
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases & Expenses' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'cashbank', label: 'Cash & Bank' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'taxation', label: 'Taxation' },
  { key: 'governance', label: 'Users & Permissions' },
  { key: 'communication', label: 'Notifications' },
  { key: 'other', label: 'Other' },
];

/* Only capabilities that visibly change this application belong on the
   Features page. Internal/platform flags remain server-known for backward
   compatibility, but are not presented as switches until the product has a
   real consumer for them. */
export const DISPLAY_FEATURE_KEYS = new Set([
  'branches', 'warehouses', 'multiCurrency', 'companyGroups',
  'paymentReminders', 'costCenters', 'gridTools', 'imports',
  'pos', 'estimates', 'salesOrders', 'deliveryChallans',
  'recurringInvoices', 'creditNotes', 'salesmen', 'discountRules', 'priceLists',
  'purchaseOrders', 'debitNotes', 'expenses',
  'inventory', 'stockTransfers', 'batchSerial', 'batchExpiry', 'reorderAlerts',
  'bankReconciliation', 'standaloneReceiptsPayments', 'paymentTerms',
  'einvoice', 'approvals',
]);

/**
 * feature key → group key.
 *
 * Where a switch changes the shape of the organisation rather than a single
 * screen, `settingsKey` names the screen to go to once it is on — a branch
 * switch is useless until there are branches.
 */
const ASSIGNMENT = {
  /* Organisation — the shape of the business */
  branches:        { group: 'organisation', icon: GitBranch,   config: 'settingsBranches',   configLabel: 'Configure' },
  warehouses:      { group: 'organisation', icon: Warehouse,   config: 'settingsWarehouses', configLabel: 'Configure' },
  multiCurrency:   { group: 'organisation', icon: Coins,       config: 'settingsCurrencies', configLabel: 'Configure' },
  companyGroups:   { group: 'organisation', icon: Building2 },

  /* General */
  paymentReminders:{ group: 'general', icon: BellRing },
  costCenters:     { group: 'general', icon: Network },
  insights:        { group: 'general', icon: Table2 },
  gridTools:       { group: 'general', icon: Table2 },
  imports:         { group: 'general', icon: Upload },
  partyCodes:      { group: 'general', icon: UserRoundCheck },

  /* Sales */
  pos:             { group: 'sales', icon: MonitorSmartphone },
  estimates:       { group: 'sales', icon: FileSignature },
  salesOrders:     { group: 'sales', icon: ClipboardList },
  deliveryChallans:{ group: 'sales', icon: Package },
  recurringInvoices:{ group: 'sales', icon: RefreshCw },
  creditNotes:     { group: 'sales', icon: Undo2 },
  salesmen:        { group: 'sales', icon: Users },
  discountRules:   { group: 'sales', icon: Tags },
  priceLists:      { group: 'sales', icon: Tags },

  /* Payroll */
  payroll:              { group: 'payroll', icon: Wallet,       config: 'payrollComponents', configLabel: 'Set up' },
  payrollCompensation:  { group: 'payroll', icon: Layers,       config: 'payrollComponents', configLabel: 'Configure' },
  payrollAdjustments:   { group: 'payroll', icon: Percent },
  payrollLoans:         { group: 'payroll', icon: Landmark },
  payrollPf:            { group: 'payroll', icon: BadgePercent, config: 'payrollCompliance', configLabel: 'Configure' },
  payrollEsi:           { group: 'payroll', icon: BadgePercent, config: 'payrollCompliance', configLabel: 'Configure' },
  payrollProfessionalTax:{ group: 'payroll', icon: BadgePercent, config: 'payrollCompliance', configLabel: 'Configure' },
  payrollTds:           { group: 'payroll', icon: BadgePercent, config: 'payrollCompliance', configLabel: 'Configure' },
  payrollPayments:      { group: 'payroll', icon: Landmark },
  payrollAccounting:    { group: 'payroll', icon: Landmark,     config: 'payrollLedgerMapping', configLabel: 'Map ledgers' },
  payrollReports:       { group: 'payroll', icon: Table2 },

  /* Purchases & Expenses */
  purchaseOrders:  { group: 'purchases', icon: ShoppingCart },
  debitNotes:      { group: 'purchases', icon: Undo2 },
  expenses:        { group: 'purchases', icon: Repeat },

  /* Inventory */
  inventory:       { group: 'inventory', icon: Boxes },
  stockTransfers:  { group: 'inventory', icon: Warehouse },
  batchSerial:     { group: 'inventory', icon: Layers },
  batchExpiry:     { group: 'inventory', icon: CalendarClock },
  reorderAlerts:   { group: 'inventory', icon: PackageSearch },

  /* Cash & Bank */
  bankReconciliation:        { group: 'cashbank', icon: Landmark },
  standaloneReceiptsPayments:{ group: 'cashbank', icon: Landmark },
  paymentTerms:              { group: 'cashbank', icon: CalendarClock },

  /* Accounting */
  ledger:     { group: 'accounting', icon: ScrollText },
  periodLock: { group: 'accounting', icon: ShieldCheck },

  /* Taxation */
  einvoice: { group: 'taxation', icon: FileStack, config: 'settingsTax', configLabel: 'Configure' },

  /* Governance */
  roleProfiles:     { group: 'governance', icon: ShieldCheck, config: 'settingsRoles',       configLabel: 'Configure' },
  fieldPermissions: { group: 'governance', icon: ShieldCheck },
  approvals:        { group: 'governance', icon: ShieldCheck },
  userPermissions:  { group: 'governance', icon: ShieldCheck },

  /* Communication */
  emailVerification:{ group: 'communication', icon: BellRing },
  notifications:    { group: 'communication', icon: BellRing, config: 'settingsEmail', configLabel: 'Configure' },
  customSmtp:       { group: 'communication', icon: BellRing, config: 'settingsEmail', configLabel: 'Configure' },
};

/**
 * The three tax capabilities, which are NOT in the server catalogue.
 *
 * Their state lives in `company.profile.taxCompliances`, and `gstEnabled` is
 * read by document logic — so this screen reflects them and links to the page
 * that owns them rather than writing a second copy. Adapter, not a store.
 */
export const TAX_FEATURES = [
  { key: 'gst', label: 'GST', icon: Percent,       config: 'settingsTax', read: (tc) => tc?.gstEnabled === true },
  { key: 'tds', label: 'TDS', icon: BadgePercent,  config: 'settingsTds', read: (tc) => Boolean(tc?.tds?.enabled) },
  { key: 'tcs', label: 'TCS', icon: Percent,       config: '',            read: (tc) => Boolean(tc?.tcs?.enabled) },
];

export const groupForFeature = (key) => ASSIGNMENT[String(key || '')]?.group || 'other';
export const iconForFeature = (key) => ASSIGNMENT[String(key || '')]?.icon || null;

export const settingsLinkFor = (key) => {
  const a = ASSIGNMENT[String(key || '')];
  return a?.config ? { key: a.config, label: a.configLabel || 'Configure' } : null;
};
export const groupMeta = (key) => FEATURE_GROUPS.find((g) => g.key === key) || null;

export default FEATURE_GROUPS;
