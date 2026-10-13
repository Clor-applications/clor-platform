import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { FEATURE_CATALOG } from '../constants/featureCatalog.js';
import { DEFAULT_PLAN_KEY, lowestPlanWith, planFor } from '../constants/planCatalog.js';

/**
 * What an account is ALLOWED to have — the ceiling above the per-org settings.
 *
 * Two layers, deliberately: a feature setting is the customer's preference, an
 * entitlement is what they bought. Keeping them apart means a downgrade moves
 * the ceiling without touching the preferences underneath it, and an upgrade
 * gives them back exactly as they were.
 *
 * An account with no entitlement row is on the default plan, which entitles
 * everything. That is what makes introducing this layer a no-op for every
 * account that exists today.
 */

export type Entitlement = {
  planKey: string;
  planName: string;
  status: string;
  /** Every feature key the account may use. */
  features: Set<string>;
  limits: { maxCompanies: number | null; maxUsers: number | null };
  /** True while the plan is being honoured — trial and active both count. */
  inGoodStanding: boolean;
};

const ALL_KEYS = FEATURE_CATALOG.map((f) => f.key);

export async function entitlementFor(accountId: string): Promise<Entitlement> {
  const row = await platformPrisma.accountEntitlement.findUnique({ where: { accountId } });
  const plan = planFor(row?.planKey ?? DEFAULT_PLAN_KEY);

  const status = String(row?.status || 'ACTIVE');
  const expired = row?.validUntil ? row.validUntil.getTime() < Date.now() : false;
  const inGoodStanding = !expired && (status === 'ACTIVE' || status === 'TRIAL');

  const base = plan.features === '*' ? ALL_KEYS : plan.features;

  /*
   * Extras are things sold on top of a plan, and they are the first thing to
   * fall away when an account stops being in good standing — the plan itself
   * is honoured a little longer than the add-ons.
   */
  const extras = inGoodStanding
    ? String(row?.extraFeatures || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  return {
    planKey: plan.key,
    planName: plan.name,
    status,
    features: new Set([...base, ...extras]),
    limits: {
      maxCompanies: row?.maxCompanies ?? plan.limits.maxCompanies,
      maxUsers: row?.maxUsers ?? plan.limits.maxUsers,
    },
    inGoodStanding,
  };
}

/** Whether the account may use this feature at all, before the org's own switch. */
export async function isEntitled(accountId: string, key: string) {
  const e = await entitlementFor(accountId);
  return e.features.has(key);
}

/**
 * The upgrade line for a module the account cannot have.
 *
 * Returned rather than hiding the module: a module that simply is not there is
 * a lost sale, and one that looks broken is worse. "On the Growth plan" is the
 * whole reason this layer exists.
 */
export function upgradeHintFor(key: string): string | null {
  const plan = lowestPlanWith(key);
  return plan ? `Available on the ${plan.name} plan` : null;
}

/**
 * Whether the account may add another company.
 *
 * @returns null when it may, or the reason it may not.
 */
export async function companyLimitReason(accountId: string): Promise<string | null> {
  const e = await entitlementFor(accountId);
  if (e.limits.maxCompanies == null) return null;
  const count = await platformPrisma.org.count({ where: { accountId } });
  if (count < e.limits.maxCompanies) return null;
  return `The ${e.planName} plan includes ${e.limits.maxCompanies} ${
    e.limits.maxCompanies === 1 ? 'company' : 'companies'
  }, and this account has ${count}.`;
}

/** Same question for users. */
export async function userLimitReason(accountId: string): Promise<string | null> {
  const e = await entitlementFor(accountId);
  if (e.limits.maxUsers == null) return null;
  const count = await platformPrisma.user.count({ where: { accountId, isActive: true } });
  if (count < e.limits.maxUsers) return null;
  return `The ${e.planName} plan includes ${e.limits.maxUsers} users, and this account has ${count}.`;
}
