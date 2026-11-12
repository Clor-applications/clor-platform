import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { platformPrisma } from '../utils/platformPrisma.js';
import { setSubscription } from '../services/subscriptions.js';

/**
 * Modules on and off by subscription (founder, 22 Oct 2026). Apps follow the
 * subscription: one added is switched on for the account's companies, one
 * taken away is switched off. People's modules have their own switches, and
 * the People tier decides which may be on. The Accounting plan no longer
 * decides whether People, Attendance or Payroll may be used.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(): Promise<Ctx> {
  const email = `modules.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Modules Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}
const features = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
const setFeatures = (c: Ctx, f: Record<string, boolean>) => request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: f });
/* Customers cannot set their own subscription (billingOperator.test.ts); set it as CLOR would. */
const subscribe = (c: Ctx, apps: Array<{ appCode: string; tier?: string }>) =>
  setSubscription((jwt.decode(c.token) as { accountId: string }).accountId, { apps });
const workspace = (c: Ctx, kind: string) => request(app).get(`/api/orgs/${c.orgId}/people/workspace/${kind}`).set(at(c));
/* Hiring is Talent's (routes/peopleTalent.ts), switched by the same Hiring module. */
const talent = (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/people/talent/${path}`).set(at(c));

describe('People modules', () => {
  it('are on by default, and a module switched off takes no work and leaves the rest', async () => {
    const c = await company();
    await setFeatures(c, { people: true }).expect(200);
    expect(await features(c)).toMatchObject({ people: true, peopleHiring: true, peoplePerformance: true, peopleEngage: true, peopleBenefits: true });
    await talent(c, 'openings').expect(200);

    await setFeatures(c, { peopleHiring: false }).expect(200);
    expect((await talent(c, 'candidates').expect(403)).body.code).toBe('MODULE_OFF');
    await workspace(c, 'announcements').expect(200);
    await setFeatures(c, { peopleHiring: true }).expect(200);
    await talent(c, 'openings').expect(200);
  }, 60_000);
});

describe('apps follow the subscription', () => {
  it('signs every new account up to an explicit subscription, never the legacy rule', async () => {
    const c = await company();
    const accountId = (jwt.decode(c.token) as { accountId: string }).accountId;
    const sub = await platformPrisma.subscription.findFirst({ where: { accountId }, include: { items: true } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe('trialing'); // /signup starts a dated trial (platform audit, 11 Nov 2026)
    expect(sub!.items.map((i) => i.appCode)).toEqual(expect.arrayContaining(['accounting', 'payroll', 'attendance', 'people']));
    expect(sub!.items.find((i) => i.appCode === 'projects')).toBeUndefined();
    const acct = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { legacyUnrestrictedAt: true } });
    expect(acct?.legacyUnrestrictedAt).toBeNull();
  }, 60_000);

  it('blocks direct Accounting APIs when Accounting is removed', async () => {
    const c = await company();
    await subscribe(c, [{ appCode: 'people', tier: 'FULL' }]);
    const denied = await request(app).get(`/api/orgs/${c.orgId}/invoices`).set(at(c)).expect(402);
    expect(denied.body).toMatchObject({ code: 'APP_NOT_SUBSCRIBED', app: 'accounting' });
  }, 60_000);

  it('switches bought apps on, keeps unbought ones shut, and the People tier limits its modules', async () => {
    const c = await company();
    /* Accounting on its smallest plan does not stop People being bought on its own. */
    await subscribe(c, [{ appCode: 'accounting', tier: 'STARTER' }, { appCode: 'people', tier: 'CORE' }]);
    let f = await features(c);
    expect(f).toMatchObject({ people: true, attendance: false, peopleHiring: false });
    expect((await setFeatures(c, { peopleHiring: true }).expect(403)).body.code).toBe('NOT_ENTITLED');
    expect((await setFeatures(c, { attendance: true }).expect(402)).body.code).toBe('APP_NOT_SUBSCRIBED');

    /* Adding Attendance and the full People tier opens both. */
    await subscribe(c, [{ appCode: 'accounting', tier: 'STARTER' }, { appCode: 'people', tier: 'FULL' }, { appCode: 'attendance' }]);
    f = await features(c);
    expect(f).toMatchObject({ people: true, attendance: true, peopleHiring: true });

    /* A company that switched an owned app off keeps it off when something else changes. */
    await setFeatures(c, { attendance: false }).expect(200);
    await subscribe(c, [{ appCode: 'accounting', tier: 'STARTER' }, { appCode: 'people', tier: 'FULL' }, { appCode: 'attendance' }, { appCode: 'payroll' }]);
    f = await features(c);
    expect(f).toMatchObject({ attendance: false, payroll: true });

    /* Taken away: switched off. */
    await subscribe(c, [{ appCode: 'accounting', tier: 'STARTER' }, { appCode: 'attendance' }, { appCode: 'payroll' }]);
    expect((await features(c)).people).toBe(false);
  }, 60_000);
});
