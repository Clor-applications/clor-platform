import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Leave in step with Payroll when there is no Attendance (founder, 22 Oct
 * 2026): approved unpaid leave in the pay period is loss of pay; paid leave
 * is not; leave paid out in HR is listed for the run.
 */
const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any);
const att = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)).send(body as any);

async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `pfl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PFL Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

async function setUp(c: Ctx) {
  const basic = await pay(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await pay(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  const person = await pay(c, '/employees', { name: 'Leave Person', code: `L${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id;
  await pay(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  const period = await pay(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = await pay(c, '/runs', { periodId: period.body.period.id }).expect(201);
  return { employeeId, runId: run.body.run.id };
}
const inputOf = (runId: string, employeeId: string) => payrollPrisma.payrollInput.findUnique({ where: { runId_employeeId: { runId, employeeId } } });

describe('days from leave, without Attendance', () => {
  it('counts approved unpaid leave as loss of pay, not paid leave, and lists pay-outs', async () => {
    /* A fresh account owns every sellable app (explicit bootstrap subscription), so
       "off" is now the customer turning the app off, not a catalog default. */
    const c = await makeOwner({ payroll: true, people: true, attendance: false });
    const { employeeId, runId } = await setUp(c);
    const lop = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const casual = (await att(c, '/leave/types', { name: 'Casual', annualDays: 12, encashable: true }).expect(201)).body.type;
    const unpaid = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-01', toDate: '2026-09-02', reason: 'Personal' }).expect(201)).body.request;
    const paid = (await att(c, '/leave/requests', { employeeId, leaveTypeId: casual.id, fromDate: '2026-09-08', toDate: '2026-09-08', reason: 'Errand' }).expect(201)).body.request;
    await att(c, `/leave/requests/${unpaid.id}/approve`).expect(200);
    await att(c, `/leave/requests/${paid.id}/approve`).expect(200);
    /* Waiting leave is not loss of pay yet. */
    await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-15', toDate: '2026-09-15', reason: 'Maybe' }).expect(201);
    await att(c, '/leave/adjustments', { employeeId, leaveTypeId: casual.id, year: 2026, days: 2, kind: 'ENCASH', reason: 'Year end' }).expect(201);

    const r = (await pay(c, `/runs/${runId}/inputs/from-leave`).expect(200)).body;
    expect(r).toMatchObject({ saved: 1, unpaidLeaveDays: 2 });
    expect(r.encashments).toEqual([expect.objectContaining({ employeeId, days: 2, leaveType: 'Casual' })]);
    const input = await inputOf(runId, employeeId);
    expect(input).toMatchObject({ source: 'LEAVE' });
    expect(Number(input!.lwpDays)).toBe(2);
    expect(Number(input!.payableDays)).toBe(28);
    expect(input!.notes).toContain('Loss of pay');

    /* Taken again after the leave is cancelled: back to full pay, not doubled. */
    await att(c, `/leave/requests/${unpaid.id}/cancel`).expect(200);
    await pay(c, `/runs/${runId}/inputs/from-leave`).expect(200);
    const again = await inputOf(runId, employeeId);
    expect(Number(again!.lwpDays)).toBe(0);
    expect(Number(again!.payableDays)).toBe(30);
  }, 60_000);

  it('a half day of leave without punches costs only its leave half: nobody clocks in without Attendance', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: false });
    const { employeeId, runId } = await setUp(c);
    /* An unpaid half day: the leave half is lost; the other half is an ordinary day, as every unpunched day is here. */
    const lop = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const unpaidHalf = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-03', toDate: '2026-09-03', halfDay: 'FIRST', reason: 'Clinic' }).expect(201)).body.request;
    await att(c, `/leave/requests/${unpaidHalf.id}/approve`).expect(200);
    let r = (await pay(c, `/runs/${runId}/inputs/from-leave`).expect(200)).body;
    expect(r.unpaidLeaveDays).toBe(0.5);
    let input = await inputOf(runId, employeeId);
    expect(Number(input!.lwpDays)).toBe(0.5);
    expect(Number(input!.payableDays)).toBe(29.5);

    /* A paid half day costs nothing. */
    const casual = (await att(c, '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const paidHalf = (await att(c, '/leave/requests', { employeeId, leaveTypeId: casual.id, fromDate: '2026-09-04', toDate: '2026-09-04', halfDay: 'SECOND', reason: 'Errand' }).expect(201)).body.request;
    await att(c, `/leave/requests/${paidHalf.id}/approve`).expect(200);
    r = (await pay(c, `/runs/${runId}/inputs/from-leave`).expect(200)).body;
    expect(r.unpaidLeaveDays).toBe(0.5);
    input = await inputOf(runId, employeeId);
    expect(Number(input!.lwpDays)).toBe(0.5);
    expect(Number(input!.payableDays)).toBe(29.5);
  }, 60_000);

  it('sends a company with Attendance to Attendance, which already counts leave', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { runId } = await setUp(c);
    expect((await pay(c, `/runs/${runId}/inputs/from-leave`).expect(409)).body.code).toBe('USE_ATTENDANCE');
  }, 60_000);

  it('once a payroll run is approved or locked, leave in its period no longer moves: People-only too (closure audit, 27 Oct 2026)', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: false });
    const { employeeId, runId } = await setUp(c);
    const lop = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const taken = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-01', toDate: '2026-09-01', reason: 'Personal' }).expect(201)).body.request;
    await att(c, `/leave/requests/${taken.id}/approve`).expect(200);
    const waiting = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-10', toDate: '2026-09-10', reason: 'Later' }).expect(201)).body.request;
    const run = await payrollPrisma.payrollRun.findFirstOrThrow({ where: { id: runId } });
    const member = await payrollPrisma.payrollRunEmployee.findFirst({ where: { runId, employeeId } });
    if (!member) await payrollPrisma.payrollRunEmployee.create({ data: { accountId: run.accountId, orgId: run.orgId, runId, employeeId, inclusion: 'INCLUDED' } as any });
    await payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'LOCKED' } });
    expect((await att(c, `/leave/requests/${taken.id}/cancel`).expect(409)).body.code).toBe('PAYROLL_TAKEN');
    expect((await att(c, `/leave/requests/${waiting.id}/approve`).expect(409)).body.code).toBe('PAYROLL_TAKEN');
    /* Outside the period, leave goes on as before. */
    const october = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-10-06', toDate: '2026-10-06', reason: 'Next month' }).expect(201)).body.request;
    await att(c, `/leave/requests/${october.id}/approve`).expect(200);
  }, 60_000);
});
