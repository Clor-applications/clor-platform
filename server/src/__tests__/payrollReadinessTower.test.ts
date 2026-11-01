import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Payroll readiness (HR research: the Workforce Control Tower): every issue
 * in the way of a month's payroll, who fixes it, the people blocking close,
 * and the money at stake priced from each person's salary.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('payroll readiness tower', () => {
  it('prices open days from the salary and names who fixes what', async () => {
    const email = `tower.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Tower Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
    const post = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any);

    const basic = await post('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await post('/structures', { name: `S ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const person = await post('/employees', { name: 'Ravi', code: 'T1', dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'SBIN0000001' } }).expect(201);
    const employeeId = person.body.employee.id;
    /* ₹3,60,000 a year: ₹30,000 a month, ₹1,000 a day in a 30-day September. */
    await post('/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    /* One day with a check-in and no check-out. */
    await request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId, date: '2026-09-15', checkIn: '09:05' }).expect(200);

    const r = (await request(app).get(`/api/orgs/${c.orgId}/attendance/months/2026-09/payroll-readiness`).set(at(c)).expect(200)).body;
    expect(r.ready).toBe(false);
    expect(r.payVisible).toBe(true);
    const open = r.issues.find((i: any) => i.key === 'attendance:missingOut');
    expect(open).toMatchObject({ count: 1, money: 1000, blocks: true, screen: 'records' });
    expect(open.owner).toMatch(/manager approves/);
    const none = r.issues.find((i: any) => i.key === 'attendance:noRecord');
    /* Every working day without a record, priced at ₹1,000 a day. */
    expect(none.money).toBe(none.count * 1000);
    expect(r.moneyAtRisk).toBe(1000 + none.money);
    expect(r.blockers[0]).toMatchObject({ employeeId, money: 1000 + none.money, blocking: true });
    expect(r.blockers[0].problems[0]).toBe('1 day without check-out');
    expect(r.people).toEqual({ total: 1, blocking: 1 });
    expect(r.score).toBe(0);
  }, 60_000);
});
