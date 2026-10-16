import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Pay-run days taken from Attendance: payable days and loss of pay come from
 * the attendance summary for the pay period instead of being typed in, and
 * days somebody entered by hand are not replaced unless asked.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
};

async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `pfa.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `PFA Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

/** One person on a simple structure, and a September 2026 run with them in it. */
async function setUp(c: Ctx) {
  const basic = await pay.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await pay
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] })
    .expect(201);
  const person = await pay
    .post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } })
    .expect(201);
  const employeeId = person.body.employee.id;
  await pay.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  const period = await pay.post(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = await pay.post(c, '/runs', { periodId: period.body.period.id }).expect(201);
  return { employeeId, runId: run.body.run.id };
}
const inputOf = (runId: string, employeeId: string) => payrollPrisma.payrollInput.findUnique({ where: { runId_employeeId: { runId, employeeId } } });

/* September 2026: 30 days, 4 Sundays (6, 13, 20, 27), so 26 working days on the standard shift. */

describe('days from Attendance', () => {
  it('pays the days Attendance counts, and loss of pay for the rest', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    await request(app)
      .put(`/api/orgs/${c.orgId}/attendance/records`)
      .set(at(c))
      .send({ employeeId, date: '2026-09-01', checkIn: '09:00', checkOut: '18:00' })
      .expect(200);

    const r = await pay.post(c, `/runs/${runId}/inputs/from-attendance`).expect(200);
    expect(r.body.saved).toBe(1);
    const input = await inputOf(runId, employeeId);
    /* One day present, 25 absent: 25 days' loss of pay, 30 − 25 = 5 payable (the present day and four Sundays). */
    expect(input).toMatchObject({ source: 'ATTENDANCE' });
    expect(Number(input!.workingDays)).toBe(30);
    expect(Number(input!.lwpDays)).toBe(25);
    expect(Number(input!.payableDays)).toBe(5);
    expect(input!.notes).toContain('25 absent');
  });

  it('keeps days entered by hand unless asked to replace them, and keeps amounts', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    await pay.put(c, `/runs/${runId}/inputs`, { inputs: [{ employeeId, workingDays: 30, payableDays: 30, lwpDays: 0, variablePay: 1500 }] }).expect(200);

    const kept = await pay.post(c, `/runs/${runId}/inputs/from-attendance`).expect(200);
    expect(kept.body).toMatchObject({ saved: 0, keptManual: 1 });
    expect(Number((await inputOf(runId, employeeId))!.payableDays)).toBe(30);

    await pay.post(c, `/runs/${runId}/inputs/from-attendance`, { overwrite: true }).expect(200);
    const replaced = await inputOf(runId, employeeId);
    expect(replaced).toMatchObject({ source: 'ATTENDANCE' });
    expect(Number(replaced!.payableDays)).toBe(4);
    expect(Number(replaced!.variablePay)).toBe(1500);
  });

  it('is refused when Attendance is off', async () => {
    const c = await makeOwner({ payroll: true, people: true });
    const { runId } = await setUp(c);
    expect((await pay.post(c, `/runs/${runId}/inputs/from-attendance`).expect(409)).body.code).toBe('ATTENDANCE_DISABLED');
  });
});
