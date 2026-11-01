import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Grant leave to many (owner, 29 Oct 2026, from ERPNext's Leave Control
 * Panel): one HR change per person, the same reason, for the people chosen;
 * who it skips is said before anything is saved.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);

describe('grant leave to many', () => {
  let hr: Ctx;
  let stores: any;
  let a: any;
  let b: any;
  let c: any;
  let type: any;
  let womenOnly: any;
  beforeAll(async () => {
    const email = `lbg.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LBG Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
    stores = (await request(app).post(`/api/orgs/${hr.orgId}/people/structure/departments`).set(at(hr)).send({ name: `Stores ${rnd()}` }).expect(201)).body.item;
    const person = async (body: Record<string, unknown>) => (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
    a = await person({ name: 'Asha Grant', code: 'G1', departmentId: stores.id, gender: 'FEMALE' });
    b = await person({ name: 'Bala Grant', code: 'G2', departmentId: stores.id, gender: 'MALE' });
    c = await person({ name: 'Chitra Grant', code: 'G3', gender: 'FEMALE' });
    type = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    womenOnly = (await att(hr, 'post', '/leave/types', { name: 'Women only', annualDays: 6, gender: 'FEMALE' }).expect(201)).body.type;
  }, 120_000);

  it('previews who it goes to, writing nothing', async () => {
    const p = (await att(hr, 'post', '/leave/adjustments/bulk', { leaveTypeId: type.id, year: 2026, days: 2, reason: 'Festival', departmentIds: [stores.id], preview: true }).expect(200)).body;
    expect(p.count).toBe(2);
    expect(p.names).toEqual(['Asha Grant', 'Bala Grant']);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.count({ where: { orgId: hr.orgId } }))).toBe(0);
  });

  it('grants to everyone the type is for, skips the rest, and refuses the same grant twice in a minute', async () => {
    const out = (await att(hr, 'post', '/leave/adjustments/bulk', { leaveTypeId: womenOnly.id, year: 2026, days: 1.5, reason: 'Extra day for the move' }).expect(201)).body;
    expect(out.granted).toBe(2);
    expect(out.skipped.map((x: any) => x.name)).toContain('Bala Grant');
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.findMany({ where: { orgId: hr.orgId, leaveTypeId: womenOnly.id } }));
    expect(rows.map((r) => r.employeeId).sort()).toEqual([a.id, c.id].sort());
    expect(rows.every((r) => r.days === 1.5 && r.reason === 'Extra day for the move')).toBe(true);
    const again = await att(hr, 'post', '/leave/adjustments/bulk', { leaveTypeId: womenOnly.id, year: 2026, days: 1.5, reason: 'Extra day for the move' }).expect(409);
    expect(again.body.code).toBe('ALREADY_GRANTED');
    /* The balance shows it. */
    const bal = (await att(hr, 'get', `/leave/ledger?employeeId=${a.id}&year=2026`).expect(200)).body;
    expect(JSON.stringify(bal)).toMatch(/Extra day for the move/);
  });

  it('refuses nothing to give and half-days that are not halves', async () => {
    await att(hr, 'post', '/leave/adjustments/bulk', { leaveTypeId: type.id, year: 2026, days: 0.3, reason: 'Odd' }).expect(400);
    await att(hr, 'post', '/leave/adjustments/bulk', { leaveTypeId: type.id, year: 2026, days: 1, reason: 'Nobody', departmentIds: ['none'] }).expect(400);
  });
});
