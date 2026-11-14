import { afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const suffix = () => Math.random().toString(36).slice(2, 9);

it('assigns a branch role and warehouse together without granting other modules', async () => {
  const email = `scope-owner-${suffix()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Scope owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Scope ${suffix()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const branchId = setup.body.branch.id;
  const headers = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': orgId, 'x-branch-id': branchId };
  const roleRes = await request(app).get(`/api/orgs/${orgId}/roles`).set(headers).expect(200);
  const sales = roleRes.body.roles.find((role: any) => role.name === 'Sales User');
  const warehouseRes = await request(app).post(`/api/orgs/${orgId}/warehouses`).set(headers).send({ branchId, code: `W${suffix()}`, name: 'Assigned store', state: 'Karnataka' }).expect(201);
  const warehouseId = warehouseRes.body.warehouse.id;
  const colleagueEmail = `scope-user-${suffix()}@example.com`;
  const created = await request(app).post('/api/users').set(headers).send({ email: colleagueEmail, fullName: 'Sales clerk', password: 'Passw0rd!23', orgIds: [orgId], branchIdsByOrg: { [orgId]: [branchId] } }).expect(201);
  const userId = created.body.user.id;
  await request(app).put(`/api/orgs/${orgId}/users/${userId}/access`).set(headers).send({ branches: [{ branchId, roleId: sales.id }], warehouseIds: [warehouseId] }).expect(200);
  const access = await request(app).get(`/api/orgs/${orgId}/users/${userId}/access`).set(headers).expect(200);
  expect(access.body.branchIds).toEqual([branchId]);
  expect(access.body.warehouseIds).toEqual([warehouseId]);
  // The same list also names each role for the access panel; the editor reads where it applies and which role it is.
  expect(access.body.roles.map((row: any) => ({ branchId: row.branchId, roleId: row.roleId }))).toEqual([{ branchId, roleId: sales.id }]);

  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: colleagueEmail, password: 'Passw0rd!23' }).expect(200);
  const clerk = { Authorization: `Bearer ${login.body.token}`, 'x-org-id': orgId, 'x-branch-id': branchId, 'x-warehouse-id': warehouseId };
  const permissions = await request(app).get(`/api/orgs/${orgId}/permissions/me`).set(clerk).expect(200);
  expect(permissions.body.permissions).toContain('SALES::Invoices::CREATE');
  expect(permissions.body.permissions).not.toContain('PURCHASE::Bills::CREATE');
});

it('adds a warehouse role only in its assigned warehouse', async () => {
  const email = `warehouse-owner-${suffix()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Warehouse owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Warehouse ${suffix()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const branchId = setup.body.branch.id;
  const headers = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': orgId, 'x-branch-id': branchId };
  const roles = (await request(app).get(`/api/orgs/${orgId}/roles`).set(headers).expect(200)).body.roles;
  const viewer = roles.find((role: any) => role.name === 'Viewer');
  const sales = roles.find((role: any) => role.name === 'Sales User');
  const first = (await request(app).post(`/api/orgs/${orgId}/warehouses`).set(headers).send({ branchId, code: `W${suffix()}`, name: 'Sales store', state: 'Karnataka' }).expect(201)).body.warehouse.id;
  const second = (await request(app).post(`/api/orgs/${orgId}/warehouses`).set(headers).send({ branchId, code: `W${suffix()}`, name: 'Other store', state: 'Karnataka' }).expect(201)).body.warehouse.id;
  const colleagueEmail = `warehouse-user-${suffix()}@example.com`;
  const userId = (await request(app).post('/api/users').set(headers).send({ email: colleagueEmail, fullName: 'Warehouse clerk', password: 'Passw0rd!23', orgIds: [orgId], branchIdsByOrg: { [orgId]: [branchId] } }).expect(201)).body.user.id;
  await request(app).put(`/api/orgs/${orgId}/users/${userId}/access`).set(headers).send({ branches: [{ branchId, roleId: viewer.id }], warehouseIds: [first, second], warehouseRoles: [{ warehouseId: first, roleId: sales.id }] }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: colleagueEmail, password: 'Passw0rd!23' }).expect(200);
  const clerk = { Authorization: `Bearer ${login.body.token}`, 'x-org-id': orgId, 'x-branch-id': branchId };
  const baseline = await request(app).get(`/api/orgs/${orgId}/permissions/me`).set(clerk).expect(200);
  const atFirst = await request(app).get(`/api/orgs/${orgId}/permissions/me`).set({ ...clerk, 'x-warehouse-id': first }).expect(200);
  const atSecond = await request(app).get(`/api/orgs/${orgId}/permissions/me`).set({ ...clerk, 'x-warehouse-id': second }).expect(200);
  expect(baseline.body.permissions).not.toContain('SALES::Invoices::CREATE');
  expect(atFirst.body.permissions).toContain('SALES::Invoices::CREATE');
  expect(atSecond.body.permissions).not.toContain('SALES::Invoices::CREATE');
});
