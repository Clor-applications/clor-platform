import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-40: purging a closed company left its account as it was — an active,
 * still-billable subscription and an entitlement for an account with nothing
 * in it. When the account's last company goes, its billing stops; sign-in
 * identities and CLOR's own billing records stay, as the closure policy says.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { deleteCompanyData, closeEmptyAccount } = await import('../services/companyClosure.js');
const { __setGateway } = await import('../billing/gateway.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
afterEach(() => __setGateway(null));
const rnd = () => Math.random().toString(36).slice(2, 8);

async function account() {
  const email = `ea.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'EA owner' }).expect(200);
  const first = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `EA One ${rnd()}`, state: 'Karnataka' }).expect(200);
  const accountId = (jwt.decode(signup.body.token) as any).accountId as string;
  const addCompany = async () =>
    (await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `EA Two ${rnd()}`, state: 'Karnataka' }).expect(200)).body.company.orgId as string;
  await outsideTenant('test: a subscription billed by a gateway', () =>
    platformPrisma.subscription.update({ where: { accountId }, data: { status: 'active', gatewayName: 'test', gatewaySubscriptionId: `sub_${rnd()}` } })
  );
  return { accountId, orgId: first.body.company.orgId as string, addCompany };
}

const state = (accountId: string) =>
  outsideTenant('test: the account', async () => ({
    subscription: (await platformPrisma.subscription.findUnique({ where: { accountId }, select: { status: true } }))?.status,
    entitlement: (await platformPrisma.accountEntitlement.findUnique({ where: { accountId }, select: { status: true } }))?.status ?? null,
    events: await platformPrisma.authEvent.count({ where: { accountId, eventType: 'ACCOUNT_EMPTIED' } }),
    users: await platformPrisma.user.count({ where: { accountId } }),
  }));

describe('an account whose last company is deleted', () => {
  it('stops being billed, at the gateway too, and keeps the person’s sign-in', async () => {
    const cancelled: string[] = [];
    __setGateway({ name: 'test', external: true, cancelSubscription: async (id: string) => void cancelled.push(id) } as any);
    const a = await account();
    await deleteCompanyData(a.orgId);
    const r = await closeEmptyAccount(a.accountId);
    expect(r.closed).toBe(true);
    const after = await state(a.accountId);
    expect(after.subscription).toBe('cancelled');
    expect([null, 'CLOSED']).toContain(after.entitlement);
    expect(after.events).toBe(1);
    expect(after.users).toBe(1);
    expect(cancelled).toHaveLength(1);
  });

  it('records a gateway that would not cancel, and still stops the subscription here', async () => {
    __setGateway({ name: 'test', external: true, cancelSubscription: async () => { throw new Error('gateway down'); } } as any);
    const a = await account();
    await deleteCompanyData(a.orgId);
    const r = await closeEmptyAccount(a.accountId);
    expect(r.closed && r.gatewayError).toMatch(/gateway down/);
    expect((await state(a.accountId)).subscription).toBe('cancelled');
  });
});

describe('an account that still has a company', () => {
  it('is left as it was when one of its companies is deleted', async () => {
    const a = await account();
    await a.addCompany();
    await deleteCompanyData(a.orgId);
    expect((await closeEmptyAccount(a.accountId)).closed).toBe(false);
    const after = await state(a.accountId);
    expect(after.subscription).toBe('active');
    expect(after.events).toBe(0);
  });
});

describe("a deleted company's code", () => {
  it('is never issued to another company', async () => {
    const letters = `Q${rnd().replace(/[^a-z]/g, 'q').slice(0, 3).toUpperCase()}`;
    const make = async () => {
      const email = `ea.code.${Date.now()}.${rnd()}@example.com`;
      const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Code owner' }).expect(200);
      const orgId = (await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `${letters} Traders`, state: 'Karnataka' }).expect(200)).body.company.orgId as string;
      const org = await outsideTenant('test: the code', () => platformPrisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { code: true } }));
      return { orgId, code: org.code };
    };
    const first = await make();
    await deleteCompanyData(first.orgId);
    const second = await make();
    expect(second.code).not.toBe(first.code);
    expect(Number(String(second.code).split('-C')[1])).toBeGreaterThan(Number(String(first.code).split('-C')[1]));
  });
});
