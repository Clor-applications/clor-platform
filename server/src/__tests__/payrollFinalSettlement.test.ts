import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Full and final settlement: gratuity, leave encashment and loan recovery
 * proposed from the records, corrected by HR as a draft, approved, then paid;
 * due two working days after leaving.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { gratuityFor, serviceYears, settlementDueDate } = await import('../services/payroll/finalSettlement.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
};

async function makeOwner(): Promise<Ctx> {
  const email = `ff.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `FF Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

/** Somebody who joined in March 2020, paid ₹30,000 Basic in September 2026, leaving on 14 October 2026. */
async function leaver(c: Ctx) {
  const basic = await api
    .post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInGratuityWage: true, displayOrder: 1 })
    .expect(201);
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2020-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] })
    .expect(201);
  const person = await api
    .post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2020-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } })
    .expect(201);
  const employeeId = person.body.employee.id;
  await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2020-03-01', annualCtc: 360_000 }).expect(201);
  const period = await api.post(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  await api.post(c, `/runs/${run}/validate`).expect(200);
  await api.post(c, `/runs/${run}/calculate`).expect(200);
  await api.post(c, `/runs/${run}/submit-review`).expect(200);
  await api.post(c, `/runs/${run}/approve`).expect(200);

  /* Twelve days of paid leave a year; none taken. */
  await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Earned', annualDays: 12, encashable: true }).expect(201);
  /* Not paid out on leaving: the settlement must not propose it (HR-view audit, 27 Oct 2026). */
  await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201);
  const { accountId } = (await peoplePrisma.employee.findUnique({ where: { id: employeeId }, select: { accountId: true } }))!;
  await payrollPrisma.payrollLoan.create({
    data: { accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId, type: 'SALARY_ADVANCE', principal: 10_000, startDate: '2026-08-01', outstandingBalance: 4_000, status: 'ACTIVE', createdByUserId: 'test' },
  });
  await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2020-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  return employeeId;
}

describe('the arithmetic', () => {
  it('counts a final part-year over six months as a year', () => {
    expect(serviceYears('2020-03-01', '2026-10-14').years).toBe(7); // 6 years 7 months
    expect(serviceYears('2020-03-01', '2026-08-14').years).toBe(6); // 6 years 5 months
  });
  it('owes no gratuity before five years, and caps it', () => {
    expect(gratuityFor(30_000, '2023-01-01', '2026-10-14').amount).toBe(0);
    expect(gratuityFor(30_000, '2020-03-01', '2026-10-14').amount).toBe(121_153.85); // 30000 × 15 × 7 / 26
    expect(gratuityFor(2_000_000, '1990-01-01', '2026-10-14').amount).toBe(2_000_000);
  });
  it('is due two working days after leaving, skipping Sunday', () => {
    expect(settlementDueDate('2026-10-14')).toBe('2026-10-16'); // Wednesday → Friday
    expect(settlementDueDate('2026-10-17')).toBe('2026-10-20'); // Saturday → Tuesday
  });
});

describe('a settlement', () => {
  it('proposes gratuity, encashment and recovery, and lists who is waiting', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const before = await api.get(c, '/settlements').expect(200);
    expect(before.body.waiting.map((p: { id: string }) => p.id)).toContain(employeeId);

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s).toMatchObject({ status: 'DRAFT', leavingDate: '2026-10-14', dueDate: '2026-10-16' });
    const line = (code: string) => s.lines.find((l: { code: string }) => l.code === code);
    expect(line('GRATUITY').amount).toBe(121_153.85);
    expect(line('LOAN_RECOVERY')).toMatchObject({ kind: 'DEDUCTION', amount: 4000, label: 'Advance recovery' });
    expect(s.lines.filter((l: { code: string }) => l.code.startsWith('LEAVE_')).map((l: { label: string }) => l.label)).toEqual(['Earned encashment']);
    const leave = s.lines.find((l: { code: string }) => l.code.startsWith('LEAVE_'));
    expect(leave.amount).toBe(Math.round(Number(leave.explanation.match(/^([\d.]+) days/)![1]) * 1153.85 * 100) / 100);
    expect(s.netPayable).toBeCloseTo(121_153.85 + leave.amount - 4000, 2);

    await api.post(c, '/settlements', { employeeId }).expect(409);
    const after = await api.get(c, '/settlements').expect(200);
    expect(after.body.waiting.map((p: { id: string }) => p.id)).not.toContain(employeeId);
  });

  it('takes HR’s corrections as a draft, then is approved, audited and paid', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const lines = [
      { code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: 120000, explanation: '' },
      { code: 'NOTICE', label: 'Notice not served', kind: 'DEDUCTION', amount: 15000, explanation: '' },
    ];
    expect((await api.put(c, `/settlements/${s.id}`, { lines }).expect(200)).body.settlement.netPayable).toBe(105000);
    await api.put(c, `/settlements/${s.id}`, { lines: [{ ...lines[0], amount: -5 }] }).expect(400);

    await api.post(c, `/settlements/${s.id}/paid`).expect(409);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    expect((await api.put(c, `/settlements/${s.id}`, { lines }).expect(409)).body.code).toBe('NOT_DRAFT');
    const paid = (await api.post(c, `/settlements/${s.id}/paid`, { reference: 'UTR123' }).expect(200)).body.settlement;
    expect(paid).toMatchObject({ status: 'PAID', paidReference: 'UTR123', overdue: false });
    await api.post(c, `/settlements/${s.id}/cancel`).expect(409);

    await new Promise((r) => setTimeout(r, 150));
    const actions = (await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'PAYROLL_SETTLEMENT' } })).map((e) => e.action).sort();
    expect(actions).toEqual(['APPROVE', 'CREATE', 'PAID', 'UPDATE']);
  });

  it('needs a leaving date', async () => {
    const c = await makeOwner();
    const p = await api.post(c, '/employees', { name: 'Still here', code: `E${rnd()}`, dateOfJoining: '2024-01-01', status: 'ACTIVE' }).expect(201);
    expect((await api.post(c, '/settlements', { employeeId: p.body.employee.id }).expect(400)).body.code).toBe('NO_LEAVING_DATE');
  });
});
