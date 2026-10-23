import { describe, it, expect, afterAll } from 'vitest';
import { platformPrisma } from '../utils/platformPrisma.js';
import { setSubscription, subscribedAppCodes, isAppEntitled, inGoodStanding, appAccess, appOwnershipReason } from '../services/subscriptions.js';
import { SELLABLE_APP_CODES } from '../constants/appCatalog.js';
import { entitlementFor } from '../services/entitlements.js';

/**
 * The generic business-model layer: subscriptions grant app-level access and
 * feed the entitlement ceiling, with NO payment gateway wired (manual path).
 */
describe('business model — subscriptions (gateway-agnostic)', () => {
  const acct = 'test_acct_bizmodel_1';
  afterAll(async () => {
    await platformPrisma.subscription.deleteMany({ where: { accountId: acct } });
  });

  it('inGoodStanding is correct across states (pure)', () => {
    const future = new Date(Date.now() + 86400000);
    const past = new Date(Date.now() - 86400000);
    expect(inGoodStanding({ status: 'trialing', trialEndsAt: future, currentPeriodEnd: null })).toBe(true);
    expect(inGoodStanding({ status: 'trialing', trialEndsAt: past, currentPeriodEnd: null })).toBe(false);
    expect(inGoodStanding({ status: 'active', trialEndsAt: null, currentPeriodEnd: past })).toBe(false);
    expect(inGoodStanding({ status: 'active', trialEndsAt: null, currentPeriodEnd: null })).toBe(true);
    expect(inGoodStanding({ status: 'cancelled', trialEndsAt: null, currentPeriodEnd: null })).toBe(false);
  });

  it('a manual subscription grants app access with no gateway', async () => {
    await setSubscription(acct, { apps: [{ appCode: 'payroll', seats: 5 }], trialDays: 14 });
    const apps = await subscribedAppCodes(acct);
    expect(apps).toContain('payroll');
    expect(await isAppEntitled(acct, 'payroll')).toBe(true);
    expect(await isAppEntitled(acct, 'accounting')).toBe(false);
    expect((await entitlementFor(acct)).features.has('inventory')).toBe(false);
  });

  it('non-sellable apps (projects, not yet for sale) are rejected; native attendance is sellable', async () => {
    await setSubscription(acct, { apps: [{ appCode: 'payroll' }, { appCode: 'attendance' }, { appCode: 'projects' }], trialDays: 14 });
    const apps = await subscribedAppCodes(acct);
    expect(apps).toContain('payroll');
    expect(apps).toContain('attendance');
    expect(apps).not.toContain('projects');
  });

  it('an unrecognised account with no subscription fails closed', async () => {
    const fresh = 'test_acct_bizmodel_norow';
    const a = await appAccess(fresh);
    expect(a.restricted).toBe(true);
    expect(a.entitledApps).toEqual([]);
    expect(await appOwnershipReason(fresh, 'payroll')).toMatch(/not on this account/);
  });

  it('an explicitly grandfathered account keeps the whole catalogue without a subscription', async () => {
    /* The roll-out migration marked exactly the accounts the old fail-open rule
       covered; their access must survive the fail-closed rule for everyone else. */
    const legacy = await platformPrisma.account.create({
      data: { name: `legacy ${Date.now()}`, legacyUnrestrictedAt: new Date() },
      select: { id: true },
    });
    try {
      const a = await appAccess(legacy.id);
      expect(a.restricted).toBe(false);
      expect(a.inGoodStanding).toBe(true);
      expect(a.entitledApps).toEqual(expect.arrayContaining([...SELLABLE_APP_CODES]));
      expect(a.entitledApps).not.toContain('projects');
    } finally {
      /* The row was created without a subscription and nothing attaches one inside the check. */
      await platformPrisma.account.delete({ where: { id: legacy.id } });
    }
  });

  it('switching on an app the subscription does not own is refused', async () => {
    await setSubscription(acct, { apps: [], status: 'active' });
    expect((await appAccess(acct)).restricted).toBe(true);
    expect(await appOwnershipReason(acct, 'payroll')).toMatch(/not on this account/);
    // A flag that is not an app switch is never this layer's business.
    expect(await appOwnershipReason(acct, 'inventory')).toBeNull();
  });

  it('a lapsed subscription keeps apps visible (owned) but not usable (entitled)', async () => {
    await setSubscription(acct, { apps: [{ appCode: 'payroll' }], status: 'past_due' });
    const a = await appAccess(acct);
    expect(a.ownedApps).toContain('payroll');
    expect(a.entitledApps).toEqual([]);
    expect(a.inGoodStanding).toBe(false);
    expect(await appOwnershipReason(acct, 'payroll')).toMatch(/past_due/);
  });
});

