import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/*
 * A-11: staff routes refused an app the account had stopped paying for, but
 * everything that is not a member of staff — the employee portal, API keys,
 * readers, connectors, directory sync, share and payment links — asked only
 * whether the app was switched on, or nothing. A cancelled account kept
 * answering its API and its employees kept signing in to the portal.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `pa.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'PA owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `PA Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const accountId = (jwt.decode(signup.body.token) as any).accountId;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId };
}

/** An employee who has activated the portal, and the company code they sign in with. */
async function portalEmployee(c: Ctx) {
  const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', code: 'P101', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  const list = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
  const company = list.body.company.code;
  const code = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [emp.id] }).expect(200)).body.codes[0].activationCode;
  await request(app).post('/api/portal/activate').send({ company, employeeCode: 'P101', activationCode: code, password: 'mine pass 1' }).expect(200);
  return { company };
}

const apiKey = async (c: Ctx) =>
  (await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/keys`).set(at(c)).send({ name: `Key ${rnd()}`, scopes: ['attendance:read'] }).expect(201)).body.token as string;

const lapse = (c: Ctx) => platformPrisma.subscription.updateMany({ where: { accountId: c.accountId }, data: { status: 'cancelled' } });

describe('a lapsed subscription', () => {
  let c: Ctx;
  let company: string;
  let key: string;
  let portalToken: string;

  beforeAll(async () => {
    c = await makeOwner();
    ({ company } = await portalEmployee(c));
    key = await apiKey(c);
    portalToken = (await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'mine pass 1' }).expect(200)).body.token;
    /* Working while paid for. */
    await request(app).get('/v1/ping').set('Authorization', `Bearer ${key}`).expect(200);
    await request(app).get('/api/portal/me').set('Authorization', `Bearer ${portalToken}`).expect(200);
    await lapse(c);
  }, 90_000);

  it('closes the public API', async () => {
    const res = await request(app).get('/v1/ping').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(402);
  });

  it('closes the employee portal, to a signed-in employee and to a new sign-in', async () => {
    const res = await request(app).get('/api/portal/me').set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('APP_NOT_SUBSCRIBED');
    await request(app).post('/api/portal/login').send({ company, employeeCode: 'P101', password: 'mine pass 1' }).expect(401);
  });
});

describe('an invoice share link', () => {
  it('stops being served once Accounting lapses', async () => {
    const c = await makeOwner();
    const inv = (await request(app)
      .post(`/api/orgs/${c.orgId}/invoices`)
      .set(at(c))
      .send({ date: '2026-09-09', customerName: 'Acme', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180, items: [{ description: 'Widget', quantity: 1, rate: 1000, gstRate: 18 }] })
      .expect(201)).body.invoice;
    const link = (await request(app).post(`/api/orgs/${c.orgId}/invoices/${inv.id}/share`).set(at(c)).expect((r) => { if (r.status >= 300) throw new Error(String(r.status)); })).body.token;
    await request(app).get(`/api/public/invoice/${link}`).expect(200);
    await lapse(c);
    await request(app).get(`/api/public/invoice/${link}`).expect(404);
  });
});

describe('a company scheduled for closure', () => {
  it('ends machine access at once', async () => {
    const c = await makeOwner();
    const key = await apiKey(c);
    await request(app).get('/v1/ping').set('Authorization', `Bearer ${key}`).expect(200);
    await platformPrisma.orgClosure.create({
      data: { accountId: c.accountId, orgId: c.orgId, orgName: 'PA', status: 'SCHEDULED', requestedByUserId: (jwt.decode(c.token) as any).userId, requestedAt: new Date(), deleteAfter: new Date(Date.now() + 30 * 864e5) },
    });
    const res = await request(app).get('/v1/ping').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });
});
