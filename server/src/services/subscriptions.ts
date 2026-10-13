import { platformPrisma } from '../utils/platformPrisma.js';
import { APP_CODES, SELLABLE_APP_CODES, appByCode, appForFeature, isSellableApp } from '../constants/appCatalog.js';
import { getGateway, type NormalizedEvent } from '../billing/gateway.js';

/**
 * A tenant's subscription: which apps it bought, and where it sits in the
 * billing cycle. This is the COMMERCIAL truth. The existing entitlement layer
 * (AccountEntitlement + PLAN_CATALOG) is the ACCOUNTING-FEATURE truth, and this
 * feeds it: the accounting item's tier is written down as the account's plan,
 * so every feature check already in the code keeps working unchanged.
 *
 * App-level access (which tiles the shell lights up) is answered here, by app
 * code, which the feature layer never modelled.
 *
 * Deliberately gateway-agnostic: a subscription is honoured on its own fields,
 * whether a provider backs it or it was granted by hand.
 */

const GOOD = new Set(['trialing', 'active']);

export function inGoodStanding(sub: { status: string; currentPeriodEnd: Date | null; trialEndsAt: Date | null }): boolean {
  if (!GOOD.has(sub.status)) return false;
  const now = Date.now();
  if (sub.status === 'trialing' && sub.trialEndsAt) return sub.trialEndsAt.getTime() > now;
  if (sub.currentPeriodEnd) return sub.currentPeriodEnd.getTime() > now;
  return true; // open-ended / manual
}

export async function getSubscription(accountId: string) {
  return platformPrisma.subscription.findUnique({ where: { accountId }, include: { items: true } });
}

export type AppAccess = {
  /** False when the account has no subscription row: nothing is restricted. */
  restricted: boolean;
  inGoodStanding: boolean;
  status: string | null;
  /** Apps the account owns, whatever its standing. Drives what the shell shows. */
  ownedApps: string[];
  /** Apps it may use right now (owned AND in good standing). Drives enforcement. */
  entitledApps: string[];
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

/**
 * What the account may have, at the level of whole apps.
 *
 * No subscription row means NO restriction — every sellable app — for the same
 * reason the entitlement layer defaults to FULL: every account that exists
 * today has no row, and introducing subscriptions must not take anything away
 * from anyone the day it ships. A restriction is something you assign (a
 * signup, a sale), never something a deploy does to you.
 *
 * Lapsing does not hide owned apps: the shell keeps showing them (the data is
 * the customer's) and warns; enforcement uses entitledApps.
 */
export async function appAccess(accountId: string): Promise<AppAccess> {
  const sub = await getSubscription(accountId);
  if (!sub) {
    return {
      restricted: false,
      inGoodStanding: true,
      status: null,
      ownedApps: [...SELLABLE_APP_CODES],
      entitledApps: [...SELLABLE_APP_CODES],
      trialEndsAt: null,
      currentPeriodEnd: null,
    };
  }
  const good = inGoodStanding(sub);
  const owned = sub.items.map((i) => i.appCode);
  return {
    restricted: true,
    inGoodStanding: good,
    status: sub.status,
    ownedApps: owned,
    entitledApps: good ? owned : [],
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}

/** App codes the account may use right now. */
export async function subscribedAppCodes(accountId: string): Promise<string[]> {
  return (await appAccess(accountId)).entitledApps;
}

/**
 * Whether switching a feature flag ON would open an app the account has not
 * bought. null = allowed (not an app switch, or the app is owned and usable).
 */
export async function appOwnershipReason(accountId: string, featureKey: string): Promise<string | null> {
  const app = appForFeature(featureKey);
  if (!app) return null;
  const access = await appAccess(accountId);
  if (access.entitledApps.includes(app.code)) return null;
  if (access.ownedApps.includes(app.code)) return `The subscription is ${access.status}; ${app.name} is paused until it is renewed.`;
  return `${app.name} is not on this account's subscription.`;
}

export async function isAppEntitled(accountId: string, appCode: string): Promise<boolean> {
  return (await subscribedAppCodes(accountId)).includes(appCode);
}

export type SetSubscriptionInput = {
  apps: { appCode: string; tier?: string | null; seats?: number | null; priceModel?: string | null; unitAmount?: number | null }[];
  status?: string;
  billingInterval?: string | null;
  trialDays?: number | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
};

/**
 * Create or replace a subscription by hand (the admin/manual path, and what the
 * gateway adapters call after a provider confirms). Pricing fields are optional
 * because no pricing model is chosen yet.
 */
export async function setSubscription(accountId: string, input: SetSubscriptionInput) {
  const apps = (input.apps || []).filter((a) => isSellableApp(a.appCode));
  const trialEndsAt =
    input.trialEndsAt ??
    (input.trialDays && input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86400000) : null);
  const status = input.status || (trialEndsAt ? 'trialing' : 'active');

  const sub = await platformPrisma.subscription.upsert({
    where: { accountId },
    create: {
      accountId,
      status,
      billingInterval: input.billingInterval ?? null,
      trialEndsAt,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
    },
    update: {
      status,
      billingInterval: input.billingInterval ?? undefined,
      trialEndsAt: trialEndsAt ?? undefined,
      currentPeriodEnd: input.currentPeriodEnd ?? undefined,
    },
  });

  // Replace items wholesale — simplest correct semantics for a manual set.
  await platformPrisma.subscriptionItem.deleteMany({ where: { subscriptionId: sub.id } });
  for (const a of apps) {
    await platformPrisma.subscriptionItem.create({
      data: {
        subscriptionId: sub.id,
        appCode: a.appCode,
        tier: a.tier ?? null,
        seats: a.seats ?? null,
        priceModel: a.priceModel ?? null,
        unitAmount: a.unitAmount ?? null,
      },
    });
  }

  await syncAccountEntitlement(accountId);
  return getSubscription(accountId);
}

/**
 * Bridge to the existing feature-entitlement layer. The accounting item's tier
 * becomes the account's plan + status + validUntil, so entitlementFor() and
 * every feature gate already in the app reflect the subscription with no change
 * to that code.
 */
export async function syncAccountEntitlement(accountId: string) {
  const sub = await getSubscription(accountId);
  const acct = sub?.items.find((i) => i.appCode === 'accounting');
  if (!acct) return; // no accounting item -> leave entitlement at its default (FULL)
  const planKey = acct.tier || 'FULL';
  const status = sub && inGoodStanding(sub) ? (sub.status === 'trialing' ? 'TRIAL' : 'ACTIVE') : 'PAST_DUE';
  const validUntil = sub?.trialEndsAt ?? sub?.currentPeriodEnd ?? null;
  await platformPrisma.accountEntitlement.upsert({
    where: { accountId },
    create: { accountId, planKey, status, validUntil },
    update: { planKey, status, validUntil },
  });
}

/** Seat check for an app, if that app is seat-metered. null = may add. */
export async function seatLimitReason(accountId: string, appCode: string, currentCount: number): Promise<string | null> {
  const sub = await getSubscription(accountId);
  const item = sub?.items.find((i) => i.appCode === appCode);
  if (!item || item.seats == null) return null; // not seat-metered
  if (currentCount < item.seats) return null;
  return `Your ${appCode} plan includes ${item.seats} seats, and this account is using ${currentCount}.`;
}

/**
 * Apply a verified, normalized gateway event. Idempotent: the same provider
 * event id is recorded once and replays are no-ops.
 */
export async function applyGatewayEvent(ev: NormalizedEvent): Promise<{ applied: boolean }> {
  try {
    await platformPrisma.paymentEvent.create({
      data: { gateway: ev.gateway, eventId: ev.eventId, type: ev.type, accountId: ev.accountId ?? null, payload: JSON.stringify(ev.raw) },
    });
  } catch {
    return { applied: false }; // unique(gateway,eventId) -> already seen
  }
  if (ev.accountId && ev.subscription) {
    const s = ev.subscription;
    await platformPrisma.subscription.updateMany({
      where: { accountId: ev.accountId },
      data: {
        status: s.status ?? undefined,
        currentPeriodEnd: s.currentPeriodEnd ?? undefined,
        gatewayName: ev.gateway,
        gatewaySubscriptionId: s.gatewaySubscriptionId ?? undefined,
      },
    });
    await syncAccountEntitlement(ev.accountId);
  }
  await platformPrisma.paymentEvent.updateMany({
    where: { gateway: ev.gateway, eventId: ev.eventId },
    data: { processed: true },
  });
  return { applied: true };
}

export { APP_CODES, appByCode };
