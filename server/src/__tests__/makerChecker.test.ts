import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-13: separation of duties. Seven approval steps let the person who
 * prepared something approve it, and nothing stopped an approver approving
 * money to themselves. Scenarios, through payroll adjustments (the same rule
 * guards pay runs, salary revisions, tax declarations, bank changes and leave):
 *
 *   one administrator, AUTO (default)   → may approve their own work, audited
 *   a second approver exists, AUTO      → must leave it to the other person
 *   STRICT                              → never, even alone
 *   ALLOW                               → may, audited
 *   about yourself (own pay), any mode  → never
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
};

async function makeOwner(): Promise<Ctx> {
  const email = `mc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'MC owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `MC Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** A second administrator in the same company. */
async function secondAdmin(c: Ctx): Promise<Ctx> {
  const email = `mc2.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Second approver', password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const admin = await platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, roleType: 'ADMIN' }, select: { id: true } });
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: admin.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: c.orgId, branchId: c.branchId, userId: made.body.user.id };
}

async function setMode(c: Ctx, makerChecker: string) {
  const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
  await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...current, makerChecker }).expect(200);
}

/** An employee on payroll, a bonus component and a period: enough to raise an adjustment. */
async function setUp(c: Ctx) {
  const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const bonus = await api.post(c, '/components', { name: 'Bonus', code: 'BONUS', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 50 }).expect(201);
  const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: bonus.body.component.id, displayOrder: 50 }] }).expect(201);
  const period = await api.post(c, '/periods', { name: `March ${rnd()}`, startDate: '2026-03-01', endDate: '2026-03-31', paymentDate: '2026-03-31' }).expect(201);
  const person = await api.post(c, '/employees', { name: 'Nivedita Rao', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL' } }).expect(201);
  await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);
  const raise = async (maker: Ctx) =>
    (await api.post(maker, '/adjustments', { employeeId: person.body.employee.id, componentId: bonus.body.component.id, periodId: period.body.period.id, amount: 5_000, reason: 'Bonus' }).expect(201)).body.adjustment.id as string;
  return { employeeId: person.body.employee.id as string, raise };
}

const selfApprovals = (c: Ctx, entityId: string) => platformPrisma.auditLog.count({ where: { orgId: c.orgId, entityId, action: 'SELF_APPROVED' } });

describe('approving your own work', () => {
  it('is allowed, and audited, for a company with one administrator (AUTO)', async () => {
    const c = await makeOwner();
    const { raise } = await setUp(c);
    const id = await raise(c);
    await api.post(c, `/adjustments/${id}/approve`).expect(200);
    expect(await selfApprovals(c, id)).toBe(1);
  });

  it('is left to the other person once there is a second approver (AUTO)', async () => {
    const c = await makeOwner();
    const other = await secondAdmin(c);
    const { raise } = await setUp(c);
    const id = await raise(c);
    const mine = await api.post(c, `/adjustments/${id}/approve`);
    expect(mine.status).toBe(403);
    expect(mine.body.code).toBe('MAKER_CHECKER');
    await api.post(other, `/adjustments/${id}/approve`).expect(200);
  });

  it('is never allowed under "always a second person" (STRICT), even alone', async () => {
    const c = await makeOwner();
    await setMode(c, 'STRICT');
    const { raise } = await setUp(c);
    const id = await raise(c);
    const mine = await api.post(c, `/adjustments/${id}/approve`);
    expect(mine.status).toBe(403);
    expect(mine.body.code).toBe('MAKER_CHECKER');
  });

  it('is allowed, and audited, under "the same person may" (ALLOW), even with a second approver', async () => {
    const c = await makeOwner();
    await secondAdmin(c);
    await setMode(c, 'ALLOW');
    const { raise } = await setUp(c);
    const id = await raise(c);
    await api.post(c, `/adjustments/${id}/approve`).expect(200);
    expect(await selfApprovals(c, id)).toBe(1);
  });
});

describe('approving something about yourself', () => {
  it('is refused in every mode — even ALLOW — when the money is your own', async () => {
    const c = await makeOwner();
    const other = await secondAdmin(c);
    await setMode(c, 'ALLOW');
    const { employeeId, raise } = await setUp(c);
    /* The approver is the employee: their own bonus, raised by someone else. */
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: c.userId } });
    const id = await raise(other);
    const res = await api.post(c, `/adjustments/${id}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWN_RECORD');
  });
});
