import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { buildApp } from '../app.js';

/*
 * A-19: a grant was bounded by what the caller held in the branch the request
 * was working in, which includes roles held for that branch alone. Somebody
 * who managed users in one branch could hand out company-wide roles — to
 * themselves too — and so carry their one-branch access across the company;
 * somebody who edited roles in one branch could add to roles everybody holds.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const INVOICE_CREATE = 'SALES::Invoices::CREATE';
const MANAGES = ['SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT', 'SETTINGS::Roles::VIEW', 'SETTINGS::Roles::EDIT', INVOICE_CREATE];

let owner: Ctx;
let branchB: string;

async function makeRole(permissions: string[]) {
  const role = await request(app).post(`/api/orgs/${owner.orgId}/roles`).set(at(owner)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`).set(at(owner)).send({ permissions }).expect(200);
  return role.body.role.id as string;
}

/** A member of both branches; `role` given for `branch` (null: company-wide). */
async function member(roleId: string | null, branch: string | null): Promise<Ctx> {
  const email = `gs.${Date.now()}.${rnd()}@example.com`;
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
  const email = `gs.owner.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'GS owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `GS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
  const b = await request(app).post(`/api/orgs/${owner.orgId}/branches`).set(at(owner)).send({ branchCode: `B${rnd()}`, branchName: 'Branch B', addressLine1: '2 Layout', state: 'Karnataka' }).expect(201);
  branchB = String(b.body.branch?.id || b.body.id);
}, 60_000);

describe('somebody who manages users in one branch', () => {
  let manager: Ctx;
  let managerRole: string;
  let invoicesRole: string;
  let other: Ctx;

  beforeAll(async () => {
    managerRole = await makeRole(MANAGES);
    invoicesRole = await makeRole([INVOICE_CREATE]);
    manager = await member(managerRole, branchB);
    other = await member(null, null);
  }, 60_000);

  it('cannot give themselves their branch role company-wide', async () => {
    const res = await request(app).put(`/api/orgs/${owner.orgId}/users/${manager.userId}/role`).set(at(manager)).send({ roleId: managerRole });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_company_wide');
  });

  it('cannot hand anybody else a company-wide role', async () => {
    const res = await request(app).put(`/api/orgs/${owner.orgId}/users/${other.userId}/role`).set(at(manager)).send({ roleId: invoicesRole });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_company_wide');
  });

  it('cannot add to a role that people hold across the company', async () => {
    const res = await request(app).put(`/api/orgs/${owner.orgId}/roles/${invoicesRole}/permissions`).set(at(manager)).send({ permissions: [INVOICE_CREATE, 'SETTINGS::Users::EDIT'] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_company_wide');
  });

  it('may still give somebody else a role in their own branch', async () => {
    await request(app).post(`/api/orgs/${owner.orgId}/users/${other.userId}/roles`).set(at(manager)).send({ roleId: invoicesRole, branchId: branchB }).expect(201);
  });

  it('cannot give a role in a branch they do not manage', async () => {
    const res = await request(app).post(`/api/orgs/${owner.orgId}/users/${other.userId}/roles`).set(at(manager)).send({ roleId: invoicesRole, branchId: owner.branchId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_in_branch');
  });

  it('cannot change their own roles, even within their branch', async () => {
    const res = await request(app).post(`/api/orgs/${owner.orgId}/users/${manager.userId}/roles`).set(at(manager)).send({ roleId: invoicesRole, branchId: branchB });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('own_access');
  });
});

describe('somebody who manages users across the company', () => {
  it('still assigns company-wide roles they hold, but not to themselves', async () => {
    const managerRole = await makeRole(MANAGES);
    const invoicesRole = await makeRole([INVOICE_CREATE]);
    const manager = await member(managerRole, null);
    const other = await member(null, null);
    await request(app).put(`/api/orgs/${owner.orgId}/users/${other.userId}/role`).set(at(manager)).send({ roleId: invoicesRole }).expect(200);
    const self = await request(app).put(`/api/orgs/${owner.orgId}/users/${manager.userId}/role`).set(at(manager)).send({ roleId: invoicesRole });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('own_access');
  });
});
