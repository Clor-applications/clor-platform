import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { FEATURE_CATALOG } from '../constants/featureCatalog.js';
import { DEFAULT_PLAN_KEY, lowestPlanWith, planFor } from '../constants/planCatalog.js';
import { appByCode, appForFeature, tierAllows } from '../constants/appCatalog.js';
import { appAccess, getSubscription } from './subscriptions.js';

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
  /** Features CLOR turned off for this account (and so not in `features`). */
  removed: Set<string>;
  /** True when CLOR set either limit for this account, not the plan. */
  limitsSetByClor: boolean;
  /** True while the plan is being honoured — trial and active both count. */
  inGoodStanding: boolean;
};

const ALL_KEYS = FEATURE_CATALOG.map((f) => f.key);

/**
 * The app a feature belongs to: an app's own switch (people, payroll,
 * attendance) or one of its modules (payrollPf, peopleHiring), followed up
 * the dependsOn chain. Null for Accounting's features.
 */
export function appOfFeature(key: string): string | null {
  const seen = new Set<string>();
  let k: string | undefined = key;
  while (k && !seen.has(k)) {
    seen.add(k);
    const app = appForFeature(k);
    if (app) return app.code;
    k = FEATURE_CATALOG.find((f) => f.key === k)?.dependsOn;
  }
  return null;
}

/** A comma-separated list of feature keys, as AccountEntitlement keeps them. */
export const splitKeys = (v: string | null | undefined) =>
  String(v || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

/** Whether a feature needs any of these, through its parents or its other needs. */
export function needsAny(key: string, gone: string[]): boolean {
  const seen = new Set<string>();
  const walk = (k: string): boolean => {
    if (seen.has(k)) return false;
    seen.add(k);
    const f = FEATURE_CATALOG.find((x) => x.key === k);
    if (!f) return false;
    const up = [...(f.dependsOn ? [f.dependsOn] : []), ...(f.alsoNeeds || [])];
    return up.some((u) => gone.includes(u) || walk(u));
  };
  return walk(key);
}

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
  const extras = inGoodStanding ? splitKeys(row?.extraFeatures) : [];

  /*
   * The accounting plan is Accounting's ceiling. An app sold on its own
   * (People, Attendance, Payroll) and its modules follow that app's
   * subscription instead: owned, and carried by the item's tier. Owned, not
   * paid up: a lapsed app stays visible (the data is the customer's) and its
   * routes refuse work (isAppEntitled). No subscription row owns everything.
   */
  const [access, sub] = await Promise.all([appAccess(accountId), getSubscription(accountId)]);
  /*
   * Accounting's plan is meaningful only while the account owns Accounting.
   * Before this intersection, removing the Accounting subscription item left
   * AccountEntitlement (often FULL) granting every accounting feature. The
   * subscription is the app-level authority; the plan is the ceiling inside
   * that app.
   */
  const ownsAccounting = access.ownedApps.includes('accounting');
  const fromPlan = new Set(ownsAccounting ? [...base, ...extras] : []);
  const tierOf = (code: string) => sub?.items.find((i) => i.appCode === code)?.tier ?? null;
  const features = new Set<string>();
  for (const k of ALL_KEYS) {
    const app = appOfFeature(k);
    if (!app) {
      if (fromPlan.has(k)) features.add(k);
    } else if (access.ownedApps.includes(app) && tierAllows(app, tierOf(app), k)) {
      features.add(k);
    }
  }
  /*
   * An extra CLOR added (ops Limits) counts only inside an app the account
   * owns: Accounting's for an Accounting feature, that app's for a module.
   */
  for (const k of extras) {
    const app = appOfFeature(k);
    if (app ? access.ownedApps.includes(app) : ownsAccounting) features.add(k);
  }
  /*
   * Turned off by CLOR wins over the plan and the extras, and takes with it
   * everything that needs it: a module whose parent is gone cannot work.
   */
  const removed = splitKeys(row?.removedFeatures);
  if (removed.length) {
    for (const k of removed) features.delete(k);
    for (const k of [...features]) if (needsAny(k, removed)) features.delete(k);
  }
  return {
    planKey: plan.key,
    planName: plan.name,
    status,
    features,
    limits: {
      maxCompanies: row?.maxCompanies ?? plan.limits.maxCompanies,
      maxUsers: row?.maxUsers ?? plan.limits.maxUsers,
    },
    removed: new Set(removed),
    limitsSetByClor: row?.maxCompanies != null || row?.maxUsers != null,
    inGoodStanding,
  };
}

/**
 * The upgrade line for a module the account cannot have.
 *
 * Returned rather than hiding the module: a module that simply is not there is
 * a lost sale, and one that looks broken is worse. "On the Growth plan" is the
 * whole reason this layer exists.
 */
export function upgradeHintFor(key: string): string | null {
  const app = appOfFeature(key);
  if (app) {
    const name = appByCode(app)?.name || app;
    return appByCode(app)?.featureKey === key ? `Add ${name} to your subscription` : `Not in your ${name} plan`;
  }
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
  /* Archived companies (read-only, kept for their records) do not take a place on the plan. */
  const count = await platformPrisma.org.count({ where: { accountId, archivedAt: null } });
  if (count < e.limits.maxCompanies) return null;
  const n = `${e.limits.maxCompanies} ${e.limits.maxCompanies === 1 ? 'company' : 'companies'}`;
  return e.limitsSetByClor ? `This account may have ${n}, and it has ${count}.` : `The ${e.planName} plan includes ${n}, and this account has ${count}.`;
}

/** Same question for users. */
export async function userLimitReason(accountId: string): Promise<string | null> {
  const e = await entitlementFor(accountId);
  if (e.limits.maxUsers == null) return null;
  const count = await platformPrisma.user.count({ where: { accountId, isActive: true } });
  if (count < e.limits.maxUsers) return null;
  return e.limitsSetByClor
    ? `This account may have ${e.limits.maxUsers} ${e.limits.maxUsers === 1 ? 'user' : 'users'}, and it has ${count}.`
    : `The ${e.planName} plan includes ${e.limits.maxUsers} users, and this account has ${count}.`;
}
