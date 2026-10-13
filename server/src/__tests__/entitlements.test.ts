import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * Plans and entitlements — the ceiling above the per-org feature settings.
 *
 * The two layers answer different questions. A feature setting is the
 * customer's preference: warehouses are off because they have one shop. An
 * entitlement is what they bought: manufacturing is unavailable because it is
 * not in their plan. Merging them means every plan needs its own copy of every
 * switch, and cancelling a subscription means turning forty settings off by
 * hand.
 *
 * The rule that makes this safe to ship: an account with no entitlement row is
 * on the default plan, which entitles everything. Introducing this layer takes
 * nothing away from anyone. A restriction is assigned, never inflicted by a
 * deploy.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; accountId: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const newOwner = async (): Promise<Ctx> => {
  const email = `ent.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Ent owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Ent Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const orgId = setup.body.company.orgId as string;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  return { token: signup.body.token, accountId: org!.accountId, orgId, branchId: setup.body.branch.id };
};

const setPlan = (accountId: string, planKey: string, over: Record<string, unknown> = {}) =>
  platformPrisma.accountEntitlement.upsert({
    where: { accountId },
    update: { planKey, ...over },
    create: { accountId, planKey, ...over },
  });

beforeAll(async () => {
  owner = await newOwner();
}, 60_000);

describe('an account with no plan assigned', () => {
  /* The whole reason this can ship: nobody loses anything on deploy day. */
  it('is entitled to everything', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/entitlement`).set(auth(owner)).expect(200);
    expect(res.body.plan.key).toBe('FULL');
    expect(res.body.limits.maxCompanies).toBeNull();

    const cat = await request(app).get(`/api/orgs/${owner.orgId}/features/catalog`).set(auth(owner)).expect(200);
    expect(cat.body.features.every((f: any) => f.entitled)).toBe(true);
  });
});

describe('a plan that does not include a feature', () => {
  it('reports the feature off however the org has it set', async () => {
    const ctx = await newOwner();
    // Turn warehouses on while the account may still have it.
    await request(app)
      .put(`/api/orgs/${ctx.orgId}/features`)
      .set(auth(ctx))
      .send({ features: { warehouses: true } })
      .expect(200);
    const before = await request(app).get(`/api/orgs/${ctx.orgId}/features`).set(auth(ctx)).expect(200);
    expect(before.body.features.warehouses).toBe(true);

    // Starter does not carry warehouses.
    await setPlan(ctx.accountId, 'STARTER');

    const after = await request(app).get(`/api/orgs/${ctx.orgId}/features`).set(auth(ctx)).expect(200);
    expect(after.body.features.warehouses).toBe(false);
  });

  /*
   * The preference underneath the ceiling is not erased. A downgrade closes
   * access; an upgrade must give it back as the customer left it, not as a
   * default.
   */
  it('gives the feature back on upgrade, exactly as it was left', async () => {
    const ctx = await newOwner();
    await request(app)
      .put(`/api/orgs/${ctx.orgId}/features`)
      .set(auth(ctx))
      .send({ features: { warehouses: true } })
      .expect(200);

    await setPlan(ctx.accountId, 'STARTER');
    expect((await request(app).get(`/api/orgs/${ctx.orgId}/features`).set(auth(ctx))).body.features.warehouses).toBe(false);

    await setPlan(ctx.accountId, 'GROWTH');
    expect((await request(app).get(`/api/orgs/${ctx.orgId}/features`).set(auth(ctx))).body.features.warehouses).toBe(true);
  });

  it('refuses to switch on something the plan does not carry, and names the plan that does', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER');

    const res = await request(app)
      .put(`/api/orgs/${ctx.orgId}/features`)
      .set(auth(ctx))
      .send({ features: { warehouses: true } })
      .expect(403);
    expect(res.body.code).toBe('NOT_ENTITLED');
    expect(String(res.body.upgradeHint)).toMatch(/Growth/);
  });

  /* Turning something off is always allowed, whatever the plan says. */
  it('still lets an unentitled feature be switched off', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER');
    await request(app)
      .put(`/api/orgs/${ctx.orgId}/features`)
      .set(auth(ctx))
      .send({ features: { warehouses: false } })
      .expect(200);
  });

  it('marks it in the catalog rather than hiding it', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER');
    const cat = await request(app).get(`/api/orgs/${ctx.orgId}/features/catalog`).set(auth(ctx)).expect(200);
    const wh = cat.body.features.find((f: any) => f.key === 'warehouses');
    expect(wh, 'the feature was hidden instead of marked').toBeTruthy();
    expect(wh.entitled).toBe(false);
    expect(String(wh.upgradeHint)).toMatch(/plan/i);
  });
});

describe('limits', () => {
  it('refuses a second company on a one-company plan, and says why', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER'); // maxCompanies: 1, and one exists

    const res = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ companyName: `Second ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(403);
    expect(res.body.code).toBe('COMPANY_LIMIT');
    expect(String(res.body.error)).toMatch(/Starter/);
  });

  it('allows it where the plan does', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'GROWTH'); // 3 companies
    await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ companyName: `Second ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
  });
});

describe('billing state', () => {
  /*
   * Add-ons sold on top of a plan are the first thing to lapse. The plan itself
   * is honoured a little longer than the extras.
   */
  it('drops the extras when the account is past due, keeping the plan', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER', { extraFeatures: 'warehouses', status: 'ACTIVE' });
    let res = await request(app).get(`/api/orgs/${ctx.orgId}/entitlement`).set(auth(ctx)).expect(200);
    expect(res.body.features).toContain('warehouses');

    await setPlan(ctx.accountId, 'STARTER', { extraFeatures: 'warehouses', status: 'PAST_DUE' });
    res = await request(app).get(`/api/orgs/${ctx.orgId}/entitlement`).set(auth(ctx)).expect(200);
    expect(res.body.features).not.toContain('warehouses');
    expect(res.body.features).toContain('expenses'); // still on the plan
  });

  it('treats an expired term as not in good standing', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER', { extraFeatures: 'warehouses', validUntil: new Date('2020-01-01') });
    const res = await request(app).get(`/api/orgs/${ctx.orgId}/entitlement`).set(auth(ctx)).expect(200);
    expect(res.body.plan.inGoodStanding).toBe(false);
    expect(res.body.features).not.toContain('warehouses');
  });
});

describe('seat limits', () => {
  /*
   * `userLimitReason` was written when the plan layer went in and then never
   * called, so the seat allowance existed in the catalogue, was returned by the
   * entitlement endpoint, and enforced nothing. An account on a three-seat plan
   * could add a hundred people.
   */
  it('refuses a new user once the plan\'s seats are used up', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'STARTER', { maxUsers: 1 }); // the owner is the one

    const res = await request(app)
      .post('/api/users')
      .set(auth(ctx))
      .send({
        email: `seat.${Date.now()}.${rnd()}@example.com`,
        fullName: 'One Too Many',
        password: 'Passw0rd!23',
        orgIds: [ctx.orgId],
        branchIdsByOrg: { [ctx.orgId]: [ctx.branchId] },
      })
      .expect(403);
    expect(res.body.code).toBe('USER_LIMIT');
    expect(String(res.body.error)).toMatch(/Starter/);
  });

  it('allows it while seats remain', async () => {
    const ctx = await newOwner();
    await setPlan(ctx.accountId, 'GROWTH'); // 10 seats
    await request(app)
      .post('/api/users')
      .set(auth(ctx))
      .send({
        email: `seat.${Date.now()}.${rnd()}@example.com`,
        fullName: 'Second Person',
        password: 'Passw0rd!23',
        orgIds: [ctx.orgId],
        branchIdsByOrg: { [ctx.orgId]: [ctx.branchId] },
      })
      .expect(201);
  });
});
