/**
 * Plans: what a customer is ALLOWED to have.
 *
 * This is the layer above the feature catalogue, and the two answer different
 * questions. A feature setting is a preference — the customer turned warehouses
 * off because they have one shop. A plan is a commercial ceiling — the customer
 * may not turn manufacturing on because they did not buy it.
 *
 * Merging the two is the mistake this file exists to avoid. With one layer,
 * every plan needs its own copy of every switch, and cancelling a subscription
 * means somebody turning forty settings off by hand. With two, the plan changes
 * and the ceiling moves; the customer's own preferences underneath it are
 * untouched and come back if they upgrade again.
 *
 * Plans are defined here rather than in the database on purpose. A plan is a
 * product decision that ships with the code and wants to be reviewable in a
 * diff; only *which plan an account is on* is data.
 *
 * `features: '*'` entitles everything. FULL is the default for an account with
 * no entitlement row, which is every account that exists today — so introducing
 * this layer changes nothing until a plan is deliberately assigned.
 */

export type PlanDef = {
  key: string;
  name: string;
  description: string;
  /** Feature keys this plan entitles, or '*' for all of them. */
  features: string[] | '*';
  limits: {
    /** Companies (orgs) the account may hold. null = unlimited. */
    maxCompanies: number | null;
    /** Users the account may hold. null = unlimited. */
    maxUsers: number | null;
  };
  /** Shown in the upgrade path when a module is not entitled. */
  order: number;
};

/**
 * The module packs a business actually recognises. A shop owner does not know
 * whether they want `batchSerial`; they know whether they hold stock.
 */
export const MODULE_PACKS: { key: string; label: string; description: string; features: string[] }[] = [
  {
    key: 'sales',
    label: 'Sales & Receivables',
    description: 'Invoices, quotations, sales orders, credit notes and collections.',
    features: ['estimates', 'salesOrders', 'deliveryChallans', 'creditNotes', 'paymentTerms', 'recurringInvoices'],
  },
  {
    key: 'purchases',
    label: 'Purchases & Payables',
    description: 'Bills, purchase orders, debit notes and vendor payments.',
    features: ['purchaseOrders', 'debitNotes', 'expenses'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Stock, warehouses, transfers, batches and serial numbers.',
    features: ['inventory', 'warehouses', 'stockTransfers', 'batchSerial', 'reorderAlerts'],
  },
  {
    key: 'compliance',
    label: 'e-Invoicing & Controls',
    description: 'Registering invoices with the IRP, approvals, and locking a filed period.',
    /*
     * Only the switchable ones. GSTR export, e-way bills and TDS are part of
     * the product rather than options — naming them here made the pack look
     * richer and made it permanently un-entitled, because a pack is only fully
     * entitled when every key under it is real.
     */
    features: ['einvoice', 'approvals', 'periodLock'],
  },
  {
    key: 'multiLocation',
    label: 'Branches & Multi-company',
    description: 'More than one location, and more than one company under one login.',
    features: ['branches', 'companyGroups'],
  },
];

export const PLAN_CATALOG: PlanDef[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    description: 'One company, one location. Invoices, bills and the books.',
    features: ['expenses', 'creditNotes', 'debitNotes', 'paymentTerms'],
    limits: { maxCompanies: 1, maxUsers: 3 },
    order: 1,
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    description: 'Stock, branches and compliance for a business that has outgrown one shop.',
    features: [
      'expenses',
      'creditNotes',
      'debitNotes',
      'paymentTerms',
      'estimates',
      'salesOrders',
      'deliveryChallans',
      'purchaseOrders',
      'inventory',
      'warehouses',
      'stockTransfers',
      'branches',
      'bankReconciliation',
    ],
    limits: { maxCompanies: 3, maxUsers: 10 },
    order: 2,
  },
  {
    key: 'PRACTICE',
    name: 'Practice',
    description: 'For a CA firm: many client companies under one login, with staff assigned per client.',
    features: '*',
    limits: { maxCompanies: 50, maxUsers: 25 },
    order: 3,
  },
  {
    key: 'FULL',
    name: 'Full',
    description: 'Everything, unlimited. The default until a plan is assigned.',
    features: '*',
    limits: { maxCompanies: null, maxUsers: null },
    order: 4,
  },
];

/**
 * What an account gets when it has no entitlement row.
 *
 * FULL on purpose. Every account that exists today has no row, and this layer
 * must not take anything away from anyone the day it ships. A restriction is
 * something you assign, never something a deploy does to you.
 */
export const DEFAULT_PLAN_KEY = 'FULL';

export const planFor = (key: string | null | undefined): PlanDef =>
  PLAN_CATALOG.find((p) => p.key === String(key || '').trim()) ||
  PLAN_CATALOG.find((p) => p.key === DEFAULT_PLAN_KEY)!;

/** The lowest plan that entitles a feature, for the "upgrade to…" line. */
export const lowestPlanWith = (featureKey: string): PlanDef | null => {
  const ranked = [...PLAN_CATALOG].sort((a, b) => a.order - b.order);
  return ranked.find((p) => p.features === '*' || p.features.includes(featureKey)) || null;
};
