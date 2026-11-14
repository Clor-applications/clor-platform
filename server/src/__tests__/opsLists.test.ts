import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The operator console's lists across every account (routes/opsLists.ts):
 * organisations, users, entitlement denials, feature switches and an
 * account's seats. CLOR staff only, read-only, paged, never a secret — and a
 * refusal anywhere in the product lands on the denials list with its reason
 * code and correlation id (services/ops/denials.ts).
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { resetDenialWindow } = await import('../services/ops/denials.js');
const { at, bearer, opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);

const LISTS = ['/api/ops/organisations', '/api/ops/users', '/api/ops/denials', '/api/ops/feature-switches'];

/* The note is written after the answer goes out: wait for it. */
async function denialFor(requestId: string) {
  for (let i = 0; i < 40; i++) {
    const row = await platformPrisma.entitlementDenial.findFirst({ where: { requestId } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe('operator lists across accounts', () => {
  it('refuses a customer on every list and on the account entitlements', async () => {
    const c = await company('outsider');
    for (const url of [...LISTS, `/api/ops/accounts/${c.accountId}/entitlements`]) {
      const r = await request(app).get(url).set(bearer(c)).expect(403);
      expect(r.body.code).toBe('OPERATOR_ONLY');
    }
    await request(app).get('/api/ops/organisations').expect(401);
  }, 120_000);

  it('lists every organisation with its account, members and apps, searchable and paged', async () => {
    const reader = await staff('READ_ONLY');
    const c = await company('orgs');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'GROWTH' }], status: 'active' });
    const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId }, select: { name: true } });

    const r = (await request(app).get('/api/ops/organisations').query({ q: org.name }).set(reader.h).expect(200)).body;
    expect(r).toMatchObject({ total: 1, page: 0, pageSize: 50 });
    expect(r.organisations[0]).toMatchObject({ id: c.orgId, name: org.name, account: { id: c.accountId }, members: 1, status: 'active' });
    expect(r.organisations[0].apps).toEqual(['accounting']);

    const byAccount = (await request(app).get('/api/ops/organisations').query({ account: c.accountId }).set(reader.h).expect(200)).body;
    expect(byAccount.organisations.map((o: any) => o.id)).toEqual([c.orgId]);
    await request(app).get('/api/ops/organisations').query({ status: 'nonsense' }).set(reader.h).expect(400);
  }, 120_000);

  it('lists users across accounts with role, sign-in and state, and never a secret', async () => {
    const reader = await staff('READ_ONLY');
    const c = await company('people');
    const r = (await request(app).get('/api/ops/users').query({ q: c.email }).set(reader.h).expect(200)).body;
    expect(r.total).toBe(1);
    expect(r.users[0]).toMatchObject({ id: c.userId, email: c.email, role: 'OWNER', signIn: { method: 'password', twoFactor: false }, accounts: [{ id: c.accountId }] });
    expect(['active', 'never']).toContain(r.users[0].status);
    const raw = JSON.stringify(r);
    for (const secret of ['passwordHash', 'totpSecretEnc', 'totpRecoveryJson', 'totpLastStep']) expect(raw).not.toContain(secret);

    /* The staff member themselves has an authenticator: the 2FA filter finds them and not the customer. */
    const twoFactor = (await request(app).get('/api/ops/users').query({ q: reader.email, signIn: 'twofactor' }).set(reader.h).expect(200)).body;
    expect(twoFactor.users[0]).toMatchObject({ id: reader.userId, staff: 'READ_ONLY', signIn: { twoFactor: true } });
    expect((await request(app).get('/api/ops/users').query({ q: c.email, signIn: 'twofactor' }).set(reader.h).expect(200)).body.total).toBe(0);
  }, 120_000);

  it('notes a refusal with its reason code and correlation id, and lists it for staff and on the account', async () => {
    resetDenialWindow();
    const reader = await staff('READ_ONLY');
    const c = await company('denied');
    await setSubscription(c.accountId, { apps: [{ appCode: 'people', tier: 'FULL' }], status: 'active' });
    const requestId = `deny-${Date.now()}-${rnd()}`;
    const refused = await request(app).get(`/api/orgs/${c.orgId}/invoices`).set({ ...at(c), 'x-request-id': requestId }).expect(402);
    expect(refused.body.code).toBe('APP_NOT_SUBSCRIBED');

    const row = await denialFor(requestId);
    expect(row).toMatchObject({ accountId: c.accountId, orgId: c.orgId, userId: c.userId, code: 'APP_NOT_SUBSCRIBED', status: 402, app: 'accounting', method: 'GET' });
    expect(row!.route).toBe('/api/orgs/:id/invoices');

    const list = (await request(app).get('/api/ops/denials').query({ q: requestId }).set(reader.h).expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.denials[0]).toMatchObject({ code: 'APP_NOT_SUBSCRIBED', status: 402, requestId, who: { id: c.userId, email: c.email }, account: { id: c.accountId }, org: { id: c.orgId } });
    expect(list.today.byCode.APP_NOT_SUBSCRIBED).toBeGreaterThanOrEqual(1);
    expect(list.codes).toContain('APP_NOT_SUBSCRIBED');
    expect((await request(app).get('/api/ops/denials').query({ q: requestId, code: 'NO_ROLE_GRANT' }).set(reader.h).expect(200)).body.total).toBe(0);
    expect((await request(app).get('/api/ops/denials').query({ q: c.email, since: 'hour' }).set(reader.h).expect(200)).body.total).toBeGreaterThanOrEqual(1);

    const ent = (await request(app).get(`/api/ops/accounts/${c.accountId}/entitlements`).set(reader.h).expect(200)).body;
    expect(ent).toMatchObject({ explicit: true, legacyFailOpen: false });
    expect(ent.apps.find((a: any) => a.app === 'people')).toMatchObject({ owned: true, tier: 'FULL', standing: 'entitled' });
    expect(ent.apps.find((a: any) => a.app === 'accounting')).toMatchObject({ owned: false, standing: 'none' });
    expect(ent.apps.find((a: any) => a.app === 'projects')).toMatchObject({ owned: false, standing: 'none' });
    expect(ent.denials[0]).toMatchObject({ code: 'APP_NOT_SUBSCRIBED', requestId, org: expect.any(String) });
    await request(app).get('/api/ops/accounts/no-such-account/entitlements').set(reader.h).expect(404);
  }, 120_000);

  it('does not note a staff member being asked for a code, or a person who is not signed in', async () => {
    resetDenialWindow();
    const fin = await staff('BILLING');
    const c = await company('nostep');
    const requestId = `step-${Date.now()}-${rnd()}`;
    /* Billing without a step-up token: asked for a code (STEP_UP_REQUIRED), not refused. */
    await request(app).post(`/api/ops/accounts/${c.accountId}/limits`).set({ ...bearer(fin), 'x-request-id': requestId }).send({ maxCompanies: null, maxUsers: 3, reason: 'Test' });
    await new Promise((r) => setTimeout(r, 300));
    expect(await platformPrisma.entitlementDenial.count({ where: { requestId, code: 'STEP_UP_REQUIRED' } })).toBe(0);
  }, 120_000);

  it('lists feature switches with the accounts CLOR changed them for', async () => {
    const fin = await staff('BILLING');
    const c = await company('switch');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'GROWTH' }], status: 'active' });
    const limits = (await request(app).get(`/api/ops/accounts/${c.accountId}/limits`).set(fin.h).expect(200)).body;
    const on = limits.features.find((f: any) => f.state === 'plan');
    expect(on).toBeTruthy();
    await request(app).post(`/api/ops/accounts/${c.accountId}/features/${on.key}`).set(fin.h).send({ state: 'off', reason: 'Asked to hide it' }).expect(200);

    const r = (await request(app).get('/api/ops/feature-switches').query({ q: on.key }).set(fin.h).expect(200)).body;
    const row = r.switches.find((s: any) => s.key === on.key);
    expect(row).toMatchObject({ key: on.key, app: 'accounting', offFor: { count: expect.any(Number) } });
    expect(row.offFor.accounts.map((a: any) => a.id)).toContain(c.accountId);
    const all = (await request(app).get('/api/ops/feature-switches').set(fin.h).expect(200)).body;
    expect(all.total).toBeGreaterThan(10);
    expect(all.switches.find((s: any) => s.key === 'people')).toMatchObject({ appSwitch: true, app: 'people' });
  }, 120_000);

  it('gives Subscriptions its four figures', async () => {
    const reader = await staff('READ_ONLY');
    const r = (await request(app).get('/api/ops/subscriptions').set(reader.h).expect(200)).body;
    expect(r.summary).toMatchObject({ mrr: expect.any(Number), pastDue: expect.any(Number), pastDueAtRisk: expect.any(Number), trialsEndingThisWeek: expect.any(Number), legacyFailOpen: expect.any(Number) });
  }, 60_000);
});
