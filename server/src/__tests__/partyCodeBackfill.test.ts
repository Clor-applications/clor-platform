import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise<void>((done) => app.close(() => done())));

let token = '';
let orgId = '';
let branchId = '';
const headers = () => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId, 'x-branch-id': branchId });
const suffix = () => Math.random().toString(36).slice(2, 9);

beforeAll(async () => {
  const signup = await request(app).post('/api/auth/signup').send({ email: `backfill.${Date.now()}.${suffix()}@example.com`, password: 'Passw0rd!23', name: 'Backfill owner' }).expect(200);
  token = signup.body.token;
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${token}`).send({ companyName: `Backfill ${suffix()}`, state: 'Karnataka' }).expect(200);
  orgId = setup.body.company.orgId;
  branchId = setup.body.branch.id;
}, 60_000);

it('requires confirmation and numbers old customers by creation date in one company', async () => {
  const newer = await request(app).post(`/api/orgs/${orgId}/customers`).set(headers()).send({ name: `Newer ${suffix()}` }).expect(201);
  const older = await request(app).post(`/api/orgs/${orgId}/customers`).set(headers()).send({ name: `Older ${suffix()}` }).expect(201);
  const vendor = await request(app).post(`/api/orgs/${orgId}/vendors`).set(headers()).send({ name: `Vendor ${suffix()}` }).expect(201);
  const codedVendor = await request(app).post(`/api/orgs/${orgId}/vendors`).set(headers()).send({ name: `Coded vendor ${suffix()}` }).expect(201);
  await prisma.party.update({ where: { id: codedVendor.body.party.id }, data: { code: 'LEGACY-V-7' } });
  expect(newer.body.party.code).toBeNull();
  expect(older.body.party.code).toBeNull();
  await prisma.party.update({ where: { id: older.body.party.id }, data: { createdAt: new Date('2025-01-01T00:00:00Z') } });
  await prisma.party.update({ where: { id: newer.body.party.id }, data: { createdAt: new Date('2025-02-01T00:00:00Z') } });

  const url = `/api/orgs/${orgId}/features`;
  await request(app).put(url).set(headers()).send({ features: { customerCodes: true } }).expect(409);
  const enabled = await request(app).put(url).set(headers()).send({ features: { customerCodes: true }, confirmCodeBackfill: true }).expect(200);
  expect(enabled.body.backfilled.map((row: { id: string }) => row.id)).toEqual([older.body.party.id, newer.body.party.id]);
  const [oldRow, newRow, vendorRow] = await Promise.all([older.body.party.id, newer.body.party.id, vendor.body.party.id].map((id) => prisma.party.findUniqueOrThrow({ where: { id } })));
  expect(oldRow.code).toBe('CUST-00001');
  expect(newRow.code).toBe('CUST-00002');
  expect(vendorRow.code).toBeNull();
  const next = await request(app).post(`/api/orgs/${orgId}/customers`).set(headers()).send({ name: `Next ${suffix()}` }).expect(201);
  expect(next.body.party.code).toBe('CUST-00003');

  const enabledVendors = await request(app).put(url).set(headers()).send({ features: { vendorCodes: true }, confirmCodeBackfill: true }).expect(200);
  expect(enabledVendors.body.backfilled.map((row: { id: string }) => row.id)).toEqual([vendor.body.party.id]);
  expect((await prisma.party.findUniqueOrThrow({ where: { id: vendor.body.party.id } })).code).toBe('VEND-00001');
  expect((await prisma.party.findUniqueOrThrow({ where: { id: codedVendor.body.party.id } })).code).toBe('LEGACY-V-7');
});
