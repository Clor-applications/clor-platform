import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Setting a subscription by hand is CLOR's act, not the customer's. The
 * subscription decides which apps every company in the account may open and
 * switches them on, so an owner who could set it would grant themselves every
 * app on any tier for nothing. Customers read it; CLOR operators
 * (CLOR_OPERATOR_USER_IDS) and the gateway write it.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(): Promise<Ctx> {
  const email = `billing.op.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Billing Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId };
}
const subscription = async (c: Ctx) => (await request(app).get('/api/billing/subscription').set(at(c)).expect(200)).body;
/** Enrol an authenticator for this person and return a fresh step-up token (A-17). */
async function stepUp(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return (await sec('/step-up', { code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
}
const everything = { apps: [{ appCode: 'people', tier: 'FULL' }, { appCode: 'attendance' }, { appCode: 'payroll' }] };

describe('setting a subscription by hand', () => {
  it('is refused to the customer’s own owner, by either route, and changes nothing', async () => {
    const c = await company();
    const before = await subscription(c);

    const own = await request(app).post('/api/billing/subscription').set(at(c)).send(everything).expect(403);
    expect(own.body.code).toBe('OPERATOR_ONLY');
    const direct = await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(at(c)).send(everything).expect(403);
    expect(direct.body.code).toBe('OPERATOR_ONLY');

    expect(await subscription(c)).toEqual(before);
  }, 60_000);

  it('is refused to everybody while no operator is configured', async () => {
    const op = await company();
    const c = await company();
    await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set('Authorization', `Bearer ${op.token}`).send(everything).expect(403);
    await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).send(everything).expect(401);
  }, 60_000);

  it('lets a CLOR operator set another account’s subscription, which the customer then reads', async () => {
    const op = await company();
    const c = await company();
    process.env.CLOR_OPERATOR_USER_IDS = ` someone-else , ${op.userId} `;
    /* A-17: an operator without an authenticator, then without a fresh code, is refused before anything is read. */
    const noTotp = await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set({ Authorization: `Bearer ${op.token}` }).send(everything).expect(403);
    expect(noTotp.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const token = await stepUp(op);
    const noCode = await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set({ Authorization: `Bearer ${op.token}` }).send(everything).expect(403);
    expect(noCode.body.code).toBe('STEP_UP_REQUIRED');
    const auth = { Authorization: `Bearer ${op.token}`, 'x-step-up': token };

    await request(app).post('/api/billing/accounts/no-such-account/subscription').set(auth).send(everything).expect(404);
    await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(auth).send({ apps: [] }).expect(400);

    const res = await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(auth).send(everything).expect(200);
    expect(res.body.subscription.accountId).toBe(c.accountId);

    /* A-17: recorded against the customer's account, with before and after. */
    const event = await platformPrisma.authEvent.findFirst({ where: { accountId: c.accountId, eventType: 'OPERATOR_SUBSCRIPTION_SET', userId: op.userId }, orderBy: { createdAt: 'desc' } });
    expect(event).not.toBeNull();
    expect(JSON.parse(String(event!.detail)).after.apps).toEqual(['attendance', 'payroll', 'people']);

    const seen = await subscription(c);
    expect(seen.subscribedApps).toEqual(expect.arrayContaining(['people', 'attendance', 'payroll']));
    /* The operator's own explicit bootstrap subscription is untouched. */
    expect((await subscription(op)).subscribedApps).toEqual(expect.arrayContaining(['accounting', 'people', 'attendance', 'payroll']));
  }, 60_000);
});
