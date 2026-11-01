import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { buildApp } from '../app.js';

/*
 * A-20: anybody who could edit users could remove their own record
 * restrictions (or add a second customer to them, which widens them), could
 * fence an administrator off from records, and could lift "own documents
 * only" from a role they hold themselves.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const MANAGES = ['SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT', 'SETTINGS::Roles::VIEW', 'SETTINGS::Roles::EDIT', 'SALES::Invoices::CREATE'];

let owner: Ctx;
let branchB: string;

async function makeRole(permissions: string[]) {
  const role = await request(app).post(`/api/orgs/${owner.orgId}/roles`).set(at(owner)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`).set(at(owner)).send({ permissions }).expect(200);
  return role.body.role.id as string;
}

/** A member of both branches; `role` given for `branch` (null: company-wide). */
async function member(roleId: string | null, branch: string | null): Promise<Ctx> {
  const email = `rr.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app)
    .post('/api/users')
    .set(at(owner))
    .send({ email, fullName: 'Member', password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId, branchB] } })
    .expect(201);
  const id = made.body.user.id as string;
  if (roleId) await request(app).post(`/api/orgs/${owner.orgId}/users/${id}/roles`).set(at(owner)).send({ roleId, branchId: branch }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: owner.orgId, branchId: branch || owner.branchId, userId: id };
}

beforeAll(async () => {
  const email = `rr.owner.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'RR owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `RR Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
  const b = await request(app).post(`/api/orgs/${owner.orgId}/branches`).set(at(owner)).send({ branchCode: `B${rnd()}`, branchName: 'Branch B', addressLine1: '2 Layout', state: 'Karnataka' }).expect(201);
  branchB = String(b.body.branch?.id || b.body.id);
}, 60_000);

/* A restriction names a real customer of the company (GAP-010): 'cust-a' and 'cust-b' are made once. */
const customers: Record<string, string> = {};
const customer = async (key: string) =>
  (customers[key] ||= String(
    ((r) => r.body.customer?.id || r.body.party?.id || r.body.id)(await request(app).post(`/api/orgs/${owner.orgId}/customers`).set(at(owner)).send({ name: `${key} ${rnd()}` }).expect(201))
  ));
const restrict = async (as: Ctx, userId: string, key: string) =>
  request(app).post(`/api/orgs/${owner.orgId}/users/${userId}/permissions`).set(at(as)).send({ entityType: 'CUSTOMER', entityId: await customer(key) });

describe('record restrictions', () => {
  let manager: Ctx;
  let other: Ctx;

  beforeAll(async () => {
    manager = await member(await makeRole(MANAGES), null);
    other = await member(null, null);
  }, 60_000);

  it('cannot be lifted, or widened, by the person they restrict', async () => {
    const mine = await restrict(owner, manager.userId, 'cust-a');
    expect(mine.status).toBe(201);
    const lift = await request(app).delete(`/api/orgs/${owner.orgId}/users/${manager.userId}/permissions/${mine.body.permission.id}`).set(at(manager));
    expect(lift.status).toBe(403);
    expect(lift.body.code).toBe('own_access');
    const widen = await restrict(manager, manager.userId, 'cust-b');
    expect(widen.status).toBe(403);
    expect(widen.body.code).toBe('own_access');
  });

  it('cannot be put on an administrator by somebody who is not one', async () => {
    const res = await restrict(manager, owner.userId, 'cust-a');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('admin_only');
  });

  it('are still set and removed on other people by somebody who manages users', async () => {
    const row = await restrict(manager, other.userId, 'cust-a');
    expect(row.status).toBe(201);
    await request(app).delete(`/api/orgs/${owner.orgId}/users/${other.userId}/permissions/${row.body.permission.id}`).set(at(manager)).expect(200);
  });
});

describe('"own documents only" on a role', () => {
  it('cannot be lifted by somebody who holds that role', async () => {
    const role = await makeRole(MANAGES);
    await request(app).patch(`/api/orgs/${owner.orgId}/roles/${role}`).set(at(owner)).send({ ownDocumentsOnly: true }).expect(200);
    const manager = await member(role, null);
    const res = await request(app).patch(`/api/orgs/${owner.orgId}/roles/${role}`).set(at(manager)).send({ ownDocumentsOnly: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('own_access');
    /* A role they do not hold is theirs to edit as before. */
    const otherRole = await makeRole(['SALES::Invoices::CREATE']);
    await request(app).patch(`/api/orgs/${owner.orgId}/roles/${otherRole}`).set(at(manager)).send({ ownDocumentsOnly: true }).expect(200);
  });
});
