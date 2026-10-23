import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { buildApp } from '../app.js';

/*
 * A-24: invoices, bills, orders and POS sales stored whatever `warehouseId`
 * the body carried — another company's warehouse, or one this person had
 * never been given — and the stock check read and moved stock there. And the
 * "reaches every warehouse without a grant" safety net belonged to whoever
 * created the company, whatever their role now.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(label: string): Promise<Ctx> {
  const email = `wb.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `WB ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
}

const newWarehouse = async (c: Ctx, name: string) =>
  String((await request(app).post(`/api/orgs/${c.orgId}/warehouses`).set(at(c)).send({ branchId: c.branchId, name, code: `W${rnd()}` }).expect(201)).body.warehouse.id);

const roleId = async (c: Ctx, name: string) =>
  ((await request(app).get(`/api/orgs/${c.orgId}/roles`).set(at(c)).expect(200)).body.roles as Array<{ id: string; name: string }>).find((r) => r.name === name)!.id;

async function colleague(c: Ctx, role: string): Promise<Ctx> {
  const email = `wb.m.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: await roleId(c, role) }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { ...c, token: login.body.token, userId: made.body.user.id };
}

const invoice = (c: Ctx, warehouseId: string) =>
  request(app)
    .post(`/api/orgs/${c.orgId}/invoices`)
    .set(at(c))
    .send({ date: '2026-09-09', customerName: 'Acme', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180, warehouseId, items: [{ description: 'Service', quantity: 1, rate: 1000, gstRate: 18 }] });

const bill = (c: Ctx, warehouseId: string) =>
  request(app)
    .post(`/api/orgs/${c.orgId}/bills`)
    .set(at(c))
    .send({ date: '2026-04-10', partyName: 'Supplier Co', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180, warehouseId, items: [{ description: 'Material', quantity: 1, rate: 1000, gstRate: 18 }] });

let mine: Ctx;
let theirs: Ctx;
let theirWarehouse: string;

beforeAll(async () => {
  mine = await company('mine');
  theirs = await company('theirs');
  theirWarehouse = await newWarehouse(theirs, 'Their store');
}, 60_000);

describe("another company's warehouse", () => {
  it('cannot be named on an invoice', async () => {
    const res = await invoice(mine, theirWarehouse);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WAREHOUSE_NOT_IN_COMPANY');
  });

  it('cannot be named on a bill', async () => {
    const res = await bill(mine, theirWarehouse);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WAREHOUSE_NOT_IN_COMPANY');
  });
});

describe("a warehouse of this company somebody was not given", () => {
  it('cannot be named on their invoice', async () => {
    const store = await newWarehouse(mine, `Back store ${rnd()}`);
    const clerk = await colleague(mine, 'Billing Clerk');
    const res = await invoice(clerk, store);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_WAREHOUSE_ACCESS');
  });

  it('is reached by an administrator of the company without a grant', async () => {
    const store = await newWarehouse(mine, `Admin store ${rnd()}`);
    await invoice(mine, store).expect(201);
  });

  it('is not reached by the creator once they are no longer an administrator', async () => {
    const c = await company('stepped-down');
    const store = await newWarehouse(c, 'Main store');
    const admin = await colleague(c, 'Administrator');
    await request(app).put(`/api/orgs/${c.orgId}/users/${c.userId}/role`).set(at(admin)).send({ roleId: await roleId(c, 'Billing Clerk') }).expect(200);
    const res = await invoice(c, store);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_WAREHOUSE_ACCESS');
    /* The administrator now running it reaches it. */
    await invoice(admin, store).expect(201);
  });
});
