import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A customer's limits on the operator console (Ops plan P1, item 5): Billing
 * sets how many companies and users, and turns modules on or off, each with a
 * reason on the record; the customer's own app follows at once, and the
 * setting survives a change to their subscription.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { entitlementFor, userLimitReason } = await import('../services/entitlements.js');
const { at, opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);

describe('customer limits in the operator console', () => {
  it('Billing sets the user limit with a reason; Support cannot; the customer is held to it and it survives a renewal', async () => {
    const fin = await staff('BILLING');
    const sup = await staff('SUPPORT');
    const reader = await staff('READ_ONLY');
    const c = await company('lim');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'GROWTH' }], status: 'active' });

    const before = (await request(app).get(`/api/ops/accounts/${c.accountId}/limits`).set(reader.h).expect(200)).body;
    expect(before.plan).toMatchObject({ key: 'GROWTH', limits: { maxCompanies: 3, maxUsers: 10 } });
    expect(before.used).toEqual({ companies: 1, users: 1 });
    expect(before.set).toEqual({ maxCompanies: null, maxUsers: null });

    const url = `/api/ops/accounts/${c.accountId}/limits`;
    expect((await request(app).post(url).set(sup.h).send({ maxCompanies: null, maxUsers: 1, reason: 'Asked' }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    await request(app).post(url).set(fin.h).send({ maxCompanies: null, maxUsers: 1 }).expect(400);
    await request(app).post(url).set(fin.h).send({ maxCompanies: null, maxUsers: 0, reason: 'Trying zero' }).expect(400);
    const set = (await request(app).post(url).set(fin.h).send({ maxCompanies: 5, maxUsers: 1, reason: 'One seat deal, five companies' }).expect(200)).body;
    expect(set.limits).toEqual({ maxCompanies: 5, maxUsers: 1 });
    await request(app).post(url).set(fin.h).send({ maxCompanies: 5, maxUsers: 1, reason: 'Again' }).expect(409);
    expect((await lastAudit(fin.userId, 'LIMITS_CHANGED'))?.detail).toMatchObject({ companies: 'plan → 5', users: 'plan → 1', reason: 'One seat deal, five companies' });
    expect(await userLimitReason(c.accountId)).toBe('This account may have 1 user, and it has 1.');

    /* A renewal rewrites the plan, not CLOR's limits. */
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'GROWTH' }], status: 'active' });
    expect((await entitlementFor(c.accountId)).limits).toEqual({ maxCompanies: 5, maxUsers: 1 });

    /* Back to the plan's own. */
    await request(app).post(url).set(fin.h).send({ maxCompanies: null, maxUsers: null, reason: 'Deal ended' }).expect(200);
    expect((await entitlementFor(c.accountId)).limits).toEqual({ maxCompanies: 3, maxUsers: 10 });
    expect(await userLimitReason(c.accountId)).toBeNull();

    const seen = await platformPrisma.authEvent.findMany({ where: { accountId: c.accountId, eventType: 'OPERATOR_LIMITS_CHANGED' } });
    expect(seen).toHaveLength(2);
  }, 120_000);

  it('turns a module on or off for one customer; off takes what needs it along; only apps they own', async () => {
    const fin = await staff('BILLING');
    const c = await company('lim');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'GROWTH' }], status: 'active' });
    const f = (key: string, state: string, reason = 'Agreed with the owner') => request(app).post(`/api/ops/accounts/${c.accountId}/features/${key}`).set(fin.h).send({ state, reason });
    const states = async () => Object.fromEntries((await request(app).get(`/api/ops/accounts/${c.accountId}/limits`).set(fin.h).expect(200)).body.features.map((x: any) => [x.key, x]));

    let s = await states();
    expect(s.pos.state).toBe('not-in-plan');
    expect(s.inventory.state).toBe('plan');
    /* Apps are the subscription's business, and so are the modules of apps they do not own. */
    expect(s.people).toBeUndefined();
    expect(s.peopleHiring).toBeUndefined();
    expect((await f('peopleHiring', 'on').expect(404)).body.error).toMatch(/does not have the app/);

    await f('pos', 'on', '').expect(400);
    await f('pos', 'on').expect(200);
    expect((await entitlementFor(c.accountId)).features.has('pos')).toBe(true);
    expect((await lastAudit(fin.userId, 'FEATURE_TURNED_ON'))?.detail).toMatchObject({ feature: 'Point of sale', reason: 'Agreed with the owner' });
    expect((await f('inventory', 'on').expect(409)).body.error).toMatch(/already has it/);

    await f('inventory', 'off').expect(200);
    let e = await entitlementFor(c.accountId);
    expect(e.features.has('inventory')).toBe(false);
    expect(e.features.has('warehouses')).toBe(false);
    s = await states();
    expect(s.inventory.state).toBe('off');
    expect(s.warehouses).toMatchObject({ state: 'plan', offWithParent: true });
    expect((await f('warehouses', 'on').expect(409)).body.error).toMatch(/already has it/);

    /* The customer's own app: closed, and told plainly why — not "upgrade". */
    expect((await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features.inventory).toBe(false);
    const cat = (await request(app).get(`/api/orgs/${c.orgId}/features/catalog`).set(at(c)).expect(200)).body;
    const row = (k: string) => (cat.features || cat.catalog || []).find((x: any) => x.key === k);
    expect(row('warehouses')?.upgradeHint).toMatch(/Turned off by CLOR/);
    const refused = await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { inventory: true } }).expect(403);
    expect(refused.body.error).toMatch(/CLOR has turned this off/);

    await f('inventory', 'plan').expect(200);
    e = await entitlementFor(c.accountId);
    expect(e.features.has('inventory') && e.features.has('warehouses')).toBe(true);
    await f('inventory', 'plan').expect(409);

    await f('pos', 'plan').expect(200);
    expect((await entitlementFor(c.accountId)).features.has('pos')).toBe(false);
  }, 120_000);
});
