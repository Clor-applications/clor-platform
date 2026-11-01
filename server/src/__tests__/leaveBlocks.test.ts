import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave block dates (owner, 29 Oct 2026, from ERPNext's Leave Block List):
 * nobody asks for leave on them, unless the block leaves their department or
 * leave type out, or names them; HR entering leave for someone still may.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/* A Monday a few weeks away: Monday to Wednesday are working days. */
const monday = (() => {
  let d = plus(today, 21);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
})();

describe('leave block dates', () => {
  let hr: Ctx;
  let me: Ctx;
  let emp: any;
  let other: any;
  let casual: any;
  let sick: any;
  let sales: any;
  beforeAll(async () => {
    const email = `lbk.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LBK Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
    sales = (await request(app).post(`/api/orgs/${hr.orgId}/people/structure/departments`).set(at(hr)).send({ name: `Accounts ${rnd()}` }).expect(201)).body.item;
    emp = (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name: 'Block Bina', code: 'B1', dateOfJoining: '2026-01-01', departmentId: sales.id }).expect(201)).body.employee;
    other = (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name: 'Free Farid', code: 'B2', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    /* Bina signs in and asks for her own leave. */
    const role = await request(app).post(`/api/orgs/${hr.orgId}/roles`).set(at(hr)).send({ name: `Self ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: false }).expect(201);
    await request(app).put(`/api/orgs/${hr.orgId}/roles/${role.body.role.id}/permissions`).set(at(hr)).send({ permissions: ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'] }).expect(200);
    const uEmail = `lbku.${Date.now()}.${rnd()}@example.com`;
    const user = await request(app).post('/api/users').set(at(hr)).send({ email: uEmail, fullName: 'Block Bina', password: 'Passw0rd!23', orgIds: [hr.orgId], branchIdsByOrg: { [hr.orgId]: [hr.branchId] } }).expect(201);
    await request(app).post(`/api/orgs/${hr.orgId}/users/${user.body.user.id}/roles`).set(at(hr)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email: uEmail, password: 'Passw0rd!23' }).expect(200);
    me = { token: login.body.token, orgId: hr.orgId, branchId: hr.branchId, userId: user.body.user.id };
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: emp.id }, data: { userId: me.userId } }));
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    sick = (await att(hr, 'post', '/leave/types', { name: 'Sick', annualDays: 12 }).expect(201)).body.type;
  }, 120_000);

  it('checks the block itself: dates in order, ids of this company', async () => {
    expect((await att(hr, 'post', '/leave/blocks', { name: 'Back', fromDate: plus(monday, 2), toDate: monday }).expect(400)).body.error).toMatch(/before the first/);
    expect((await att(hr, 'post', '/leave/blocks', { name: 'Elsewhere', fromDate: monday, toDate: monday, departmentIds: ['nope'] }).expect(400)).body.error).toMatch(/department/);
  });

  it('stops the person asking on blocked days, for the department and type it names; HR may still enter it', async () => {
    const block = (await att(hr, 'post', '/leave/blocks', { name: 'Quarter close', fromDate: plus(monday, 1), toDate: plus(monday, 2), departmentIds: [sales.id], leaveTypeIds: [casual.id] }).expect(201)).body.block;
    const preview = (await att(me, 'post', '/me/leave/preview', { leaveTypeId: casual.id, fromDate: monday, toDate: plus(monday, 2), reason: 'Trip' }).expect(200)).body;
    expect(preview.problems.map((p: any) => p.code)).toContain('LEAVE_BLOCKED');
    const refused = await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: monday, toDate: plus(monday, 2), reason: 'Trip' }).expect(400);
    expect(refused.body.code).toBe('LEAVE_BLOCKED');
    expect(refused.body.error).toMatch(/Quarter close/);
    /* The day before the block is free; so is another leave type. */
    await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: monday, toDate: monday, reason: 'Errand' }).expect(201);
    await att(me, 'post', '/me/leave', { leaveTypeId: sick.id, fromDate: plus(monday, 1), toDate: plus(monday, 1), reason: 'Fever' }).expect(201);
    /* Someone outside the department may take casual leave then. */
    await att(hr, 'post', '/leave/requests', { employeeId: other.id, leaveTypeId: casual.id, fromDate: plus(monday, 2), toDate: plus(monday, 2), reason: 'Visit' }).expect(201);
    /* HR entering it for Bina is not held to the block. */
    await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: casual.id, fromDate: plus(monday, 2), toDate: plus(monday, 2), reason: 'Agreed with HR' }).expect(201);
    /* Named on the block, she may ask herself. */
    await att(hr, 'put', `/leave/blocks/${block.id}`, { ...block, allowedEmployeeIds: [emp.id] }).expect(200);
    const allowed = (await att(me, 'post', '/me/leave/preview', { leaveTypeId: casual.id, fromDate: plus(monday, 7), toDate: plus(monday, 7), reason: 'Trip' }).expect(200)).body;
    expect(allowed.problems.map((p: any) => p.code)).not.toContain('LEAVE_BLOCKED');
    const list = (await att(hr, 'get', '/leave/blocks').expect(200)).body.blocks;
    expect(list.map((b: any) => b.id)).toContain(block.id);
    await att(hr, 'delete', `/leave/blocks/${block.id}`).expect(200);
  });

  it('is HR’s to set: the person cannot', async () => {
    await att(me, 'post', '/leave/blocks', { name: 'Mine', fromDate: monday, toDate: monday }).expect(403);
  });
});
