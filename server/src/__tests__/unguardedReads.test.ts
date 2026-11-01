import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { runInTenant } from '../utils/tenantScope.js';

/*
 * A-22: three routes answered anybody signed in to the company. The plan,
 * with the payment gateway's customer and subscription ids; the next number
 * of any document type, creating a numbering series for whatever type was
 * sent; and the company's cash and bank accounts.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

let owner: Ctx;
/** Holds one unrelated permission: exporting company data. */
let bystander: Ctx;
/** Takes receipts. */
let cashier: Ctx;

async function member(permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${owner.orgId}/roles`).set(at(owner)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`).set(at(owner)).send({ permissions }).expect(200);
  const email = `ug.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(owner)).send({ email, fullName: 'Member', password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } }).expect(201);
  await request(app).put(`/api/orgs/${owner.orgId}/users/${made.body.user.id}/role`).set(at(owner)).send({ roleId: role.body.role.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId };
}

beforeAll(async () => {
  const email = `ug.owner.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'UG owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `UG Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: setup.body.company.accountId };
  bystander = await member(['SETTINGS::Company data::EXPORT']);
  cashier = await member(['SALES::Receipts::VIEW', 'SALES::Receipts::CREATE']);
}, 60_000);

describe('the subscription', () => {
  it('tells every member which apps the account has, but not the plan', async () => {
    const res = await request(app).get('/api/billing/subscription').set(at(bystander)).expect(200);
    expect(Array.isArray(res.body.ownedApps)).toBe(true);
    expect(res.body.subscription).toBeNull();
  });

  it('shows the plan to whoever looks after the account, without the gateway ids', async () => {
    const res = await request(app).get('/api/billing/subscription').set(at(owner)).expect(200);
    expect(res.body.subscription).toBeTruthy();
    expect(res.body.subscription).not.toHaveProperty('gatewayCustomerId');
    expect(res.body.subscription).not.toHaveProperty('gatewaySubscriptionId');
  });
});

describe('the next document number', () => {
  it('is refused to somebody who cannot raise that document', async () => {
    await request(app).get(`/api/orgs/${owner.orgId}/number-series/next/INVOICE`).set(at(bystander)).expect(403);
    await request(app).get(`/api/orgs/${owner.orgId}/number-series/next/INVOICE`).set(at(cashier)).expect(403);
    await request(app).get(`/api/orgs/${owner.orgId}/number-series/next/RECEIPT`).set(at(cashier)).expect(200);
    await request(app).get(`/api/orgs/${owner.orgId}/number-series/next/INVOICE`).set(at(owner)).expect(200);
  });

  it('makes no numbering series for a document type that does not exist', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/number-series/next/NOT_A_DOCUMENT`).set(at(owner));
    expect(res.status).toBe(400);
    const rows = await runInTenant(owner.orgId, () => prisma.numberSeries.count({ where: { orgId: owner.orgId, docType: 'NOT_A_DOCUMENT' } }));
    expect(rows).toBe(0);
  });
});

describe('the payment modes', () => {
  it('are for whoever takes or pays money, not every member', async () => {
    await request(app).get(`/api/orgs/${owner.orgId}/payment-modes`).set(at(bystander)).expect(403);
    await request(app).get(`/api/orgs/${owner.orgId}/payment-modes`).set(at(cashier)).expect(200);
  });
});
