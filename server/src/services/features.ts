import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { FEATURE_CATALOG, resolveFeatures } from '../constants/featureCatalog.js';
import { entitlementFor, upgradeHintFor } from './entitlements.js';

/**
 * Effective feature flags for an organisation.
 *
 * Read on the server before doing anything a disabled feature would imply, and
 * served to the client so navigation and forms hide the same things.
 */
/** The menus' reading of simple mode: detailed People screens shown. Not a catalog switch; it follows `peopleSimpleMode`. */
export const DETAILED_KEY = 'peopleDetailed';

export async function getFeatures(accountId: string, orgId: string) {
  const rows = await platformPrisma.featureSetting.findMany({
    where: { accountId, orgId },
    select: { key: true, enabled: true },
  });

  const overrides: Record<string, boolean> = {};
  for (const r of rows) overrides[r.key] = r.enabled;

  const resolved = resolveFeatures(overrides);

  /*
   * The entitlement is a ceiling, not a switch.
   *
   * A feature is on only if the account may have it AND the org has turned it
   * on. The org's own preference is left exactly as it was underneath — so a
   * downgrade closes the ceiling without erasing what the customer chose, and
   * an upgrade gives it back as they left it rather than as a default.
   *
   * An account with no entitlement row is on the default plan, which entitles
   * everything, so this changes nothing for anyone until a plan is assigned.
   */
  const entitlement = await entitlementFor(accountId);
  const effective: Record<string, boolean> = {};
  for (const [key, on] of Object.entries(resolved)) {
    effective[key] = on && entitlement.features.has(key);
  }
  /* Derived, not stored: what the menus check (nav `feature: 'peopleDetailed'`), on unless simple mode is. */
  effective[DETAILED_KEY] = !effective.peopleSimpleMode;
  return effective;
}

export async function isFeatureEnabled(accountId: string, orgId: string, key: string) {
  const features = await getFeatures(accountId, orgId);
  return Boolean(features[key]);
}

/** Data that would become unreachable if a feature were hidden. These checks
 * run on the server, so every client and every entry point gets the same
 * protection. A feature with no persisted data dependency is safe to hide. */
export async function featureDisableBlocker(accountId: string, orgId: string, key: string) {
  const where = { accountId, orgId };
  const checks: Record<string, () => Promise<number>> = {
    branches: () => platformPrisma.branch.count({ where }), // branches live in the platform database
    warehouses: () => prisma.warehouse.count({ where }),
    inventory: async () =>
      (await prisma.stockBalance.count({ where: { ...where, qtyOnHand: { not: 0 } } })) +
      (await prisma.inventoryAdjustment.count({ where })),
    stockTransfers: () => prisma.interBranchTransfer.count({ where }),
    batchSerial: async () =>
      (await prisma.batch.count({ where })) + (await prisma.serialNumber.count({ where })),
    batchExpiry: () => prisma.batch.count({ where: { ...where, expiryDate: { not: null } } }),
    salesOrders: () => prisma.salesOrderDoc.count({ where }),
    deliveryChallans: () => prisma.deliveryChallan.count({ where }),
    purchaseOrders: () => prisma.purchaseOrderDoc.count({ where }),
    expenses: () => prisma.expense.count({ where }),
    recurringInvoices: () => prisma.recurringSchedule.count({ where }),
    approvals: async () =>
      (await prisma.approvalRule.count({ where })) + (await prisma.approvalRequest.count({ where })),
    multiCurrency: () => prisma.invoice.count({ where: { ...where, currency: { not: 'INR' } } }),
  };
  const check = checks[key];
  if (!check) return null;
  const count = await check();
  /* A company always has one head-office branch and usually one main
     warehouse. Those defaults do not make their selectors necessary. */
  const used = key === 'branches' || key === 'warehouses' ? count > 1 : count > 0;
  if (!used) return null;
  const labels: Record<string, string> = {
    branches: 'multiple branches', warehouses: 'multiple warehouses', inventory: 'stock records',
    stockTransfers: 'stock transfers', batchSerial: 'batch or serial records', batchExpiry: 'expiry-dated batches',
    salesOrders: 'sales orders', deliveryChallans: 'delivery challans', purchaseOrders: 'purchase orders',
    expenses: 'expense entries', recurringInvoices: 'recurring schedules', approvals: 'approval rules or requests',
    multiCurrency: 'foreign-currency invoices',
  };
  return `Cannot disable this feature while ${labels[key] || 'related records'} exist. Archive or resolve them first.`;
}

/**
 * Catalog plus current values, for the Settings screen.
 *
 * A feature the account is not entitled to is returned marked, not omitted. A
 * module that simply is not there reads as a product that cannot do it; one
 * that says which plan carries it is the only version of this that can ever
 * sell anything.
 */
export async function getFeatureCatalogWithValues(accountId: string, orgId: string) {
  const values = await getFeatures(accountId, orgId);
  const entitlement = await entitlementFor(accountId);
  return {
    features: FEATURE_CATALOG.map((f) => {
      const entitled = entitlement.features.has(f.key);
      return {
        ...f,
        enabled: values[f.key],
        entitled,
        upgradeHint: entitled ? null : upgradeHintFor(f.key),
      };
    }),
    values,
    plan: { key: entitlement.planKey, name: entitlement.planName, status: entitlement.status },
  };
}
