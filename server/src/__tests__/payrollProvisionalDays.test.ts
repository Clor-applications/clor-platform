import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Paying before the month ends (payrollProvisionalDays, closure audit O-11,
 * TLA-004). Off by default. On, a September run with a 25th cut-off counts
 * 26–30 September as present for everyone not on approved leave, keeps
 * approved unpaid leave as loss of pay, records what it assumed, and the
 * October pull books a correction for each assumed day that turned out
 * otherwise. The loss-of-pay check reads the assumed days as the pull did.
 *
 * September 2026: 30 days, Sundays 6, 13, 20 and 27. Up to the 25th that is
 * 22 working days; after it, 26, 28, 29 and 30 are working days (27 is a
 * Sunday). The tests run after September, so a day with no record in it is
 * an absence.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any);
const payGet = (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c));
const payPut = (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any);
const att = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)).send(body as any);

async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `ppd.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PPD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

/** Basic = monthly CTC, ₹30,000; a day's pay in September is 30,000 / 30 = ₹1,000. */
async function structure(c: Ctx) {
  const basic = await pay(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const s = await pay(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  return s.body.structure.id as string;
}
async function staff(c: Ctx, structureId: string, name: string) {
  const person = await pay(c, '/employees', { name, code: `P${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await pay(c, '/assignments', { employeeId, structureId, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  return employeeId;
}
async function runFor(c: Ctx, name: string, startDate: string, endDate: string) {
  const period = await pay(c, '/periods', { name: `${name} ${rnd()}`, startDate, endDate, paymentDate: endDate }).expect(201);
  return (await pay(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id as string;
}
const inputOf = (runId: string, employeeId: string) => payrollPrisma.payrollInput.findUnique({ where: { runId_employeeId: { runId, employeeId } } });
const record = (c: Ctx, employeeId: string, date: string, checkOut = '18:00') =>
  request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId, date, checkIn: '09:00', checkOut }).expect(200);
const switchOn = (c: Ctx, cutoffDay = 25) => payPut(c, '/settings/provisional-days', { enabled: true, cutoffDay }).expect(200);

describe('the switch', () => {
  it('is off by default, needs Attendance, and keeps the cut-off day', async () => {
    const off = await makeOwner({ payroll: true, people: true, attendance: false });
    expect((await payGet(off, '/settings/provisional-days').expect(200)).body).toMatchObject({ enabled: false, cutoffDay: 25, attendance: false });
    expect((await payPut(off, '/settings/provisional-days', { enabled: true, cutoffDay: 25 }).expect(409)).body.code).toBe('ATTENDANCE_DISABLED');

    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    expect((await payPut(c, '/settings/provisional-days', { enabled: true, cutoffDay: 31 }).expect(400)).body.error).toMatch(/1 to 30/);
    expect((await switchOn(c, 24)).body).toMatchObject({ enabled: true, cutoffDay: 24 });
    const features = (await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200)).body.features;
    expect(features.payrollProvisionalDays).toBe(true);

    /* Attendance switched off takes the feature with it. */
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { attendance: false } }).expect(200);
    expect((await payGet(c, '/settings/provisional-days').expect(200)).body).toMatchObject({ enabled: false, cutoffDay: 24 });
  }, 60_000);
});

describe('days from Attendance before the month ends', () => {
  it('off: unchanged — the days after the 25th are what Attendance says', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const employeeId = await staff(c, await structure(c), 'Off Person');
    const runId = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');
    await record(c, employeeId, '2026-09-01');

    const r = (await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200)).body;
    expect(r).toMatchObject({ saved: 1, provisionalDays: null, provisionalMessage: null, corrections: [] });
    const input = await inputOf(runId, employeeId);
    /* As before the feature: 25 absent working days, 5 payable (the present day and four Sundays). */
    expect(Number(input!.lwpDays)).toBe(25);
    expect(Number(input!.payableDays)).toBe(5);
    expect(Number(input!.provisionalDays)).toBe(0);
    expect(input!.provisionalDates).toBeNull();
    expect((await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).provisionalDays).toBeNull();
  }, 60_000);

  it('on: the days after the cut-off are counted as present, and the run says so', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    await switchOn(c);
    const employeeId = await staff(c, await structure(c), 'On Person');
    const runId = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');
    await record(c, employeeId, '2026-09-01');

    const r = (await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200)).body;
    expect(r.provisionalDays).toEqual({ cutoffDate: '2026-09-25', from: '2026-09-26', to: '2026-09-30', people: 1, days: 4 });
    expect(r.provisionalMessage).toBe('Days after the 25th counted as present: 1 person, 4 days; corrected next month.');
    const input = await inputOf(runId, employeeId);
    /* 21 absent up to the 25th; 26, 28, 29, 30 assumed present. */
    expect(Number(input!.lwpDays)).toBe(21);
    expect(Number(input!.payableDays)).toBe(9);
    expect(Number(input!.provisionalDays)).toBe(4);
    expect((input!.provisionalDates as any[]).map((d) => d.date)).toEqual(['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']);
    expect(input!.notes).toContain('4 days after the 25th counted as present.');

    /* The run screen reads the same sentence from the run. */
    const detail = (await payGet(c, `/runs/${runId}`).expect(200)).body;
    expect(detail.run.provisionalMessage).toBe('Days after the 25th counted as present: 1 person, 4 days; corrected next month.');
    expect(detail.employees[0].input.provisionalDays).toBe(4);
  }, 60_000);

  it('on: approved unpaid leave after the cut-off is still loss of pay', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    await switchOn(c);
    const employeeId = await staff(c, await structure(c), 'Leave Person');
    const runId = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');
    const unpaid = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const leave = (await att(c, '/leave/requests', { employeeId, leaveTypeId: unpaid.id, fromDate: '2026-09-29', toDate: '2026-09-29', reason: 'Personal' }).expect(201)).body.request;
    await att(c, `/leave/requests/${leave.id}/approve`).expect(200);

    await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200);
    const input = await inputOf(runId, employeeId);
    /* 22 absent up to the 25th, plus the day of unpaid leave; 26, 28 and 30 assumed present. */
    expect(Number(input!.lwpDays)).toBe(23);
    expect(Number(input!.provisionalDays)).toBe(3);
    expect(input!.provisionalDates as any[]).toContainEqual({ date: '2026-09-29', paid: 0, provisional: 0 });

    /* The loss-of-pay check reads the days the way the pull did: 26, 28 and 30 have no record (absent), and that is not a mismatch. */
    const check = (await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body;
    expect(check).toMatchObject({ checked: 1, mismatches: [] });
  }, 60_000);
});

describe('next month corrects the assumed days', () => {
  it('adds a correction for days that turned out absent or half, none for days worked, and shows it on the payslip', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    await switchOn(c);
    const structureId = await structure(c);
    const worked = await staff(c, structureId, 'Worked Throughout');
    const absent = await staff(c, structureId, 'Absent Twice');
    const half = await staff(c, structureId, 'Half Day');
    const sept = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');

    /* The September run: nothing recorded after the 25th yet, so 26, 28, 29 and 30 are assumed for all three. */
    await pay(c, `/runs/${sept}/inputs/from-attendance`).expect(200);
    for (const id of [worked, absent, half]) expect(Number((await inputOf(sept, id))!.provisionalDays)).toBe(4);
    const lop = (await payGet(c, `/runs/${sept}/lop-check`).expect(200)).body;
    expect(lop.mismatches).toEqual([]);
    await pay(c, `/runs/${sept}/validate`).expect(200);
    await pay(c, `/runs/${sept}/calculate`).expect(200);
    await payrollPrisma.payrollRun.update({ where: { id: sept }, data: { status: 'LOCKED' } });

    /* A day up to the cut-off was taken by the locked run; a day after it was only assumed, and is recorded as it happens. */
    const taken = await request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId: worked, date: '2026-09-24', checkIn: '09:00', checkOut: '18:00' }).expect(409);
    expect(taken.body.code).toBe('PAYROLL_TAKEN');

    /* What happened: worked all four; absent on the 29th and 30th; a half day on the 30th. */
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']) await record(c, worked, d);
    for (const d of ['2026-09-26', '2026-09-28']) await record(c, absent, d);
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29']) await record(c, half, d);
    await record(c, half, '2026-09-30', '13:30');

    const oct = await runFor(c, 'Oct', '2026-10-01', '2026-10-31');
    const r = (await pay(c, `/runs/${oct}/inputs/from-attendance`).expect(200)).body;
    const byPerson = new Map(r.corrections.map((x: any) => [x.employeeId, x]));
    expect(byPerson.has(worked)).toBe(false);
    expect(byPerson.get(absent)).toMatchObject({ type: 'DEDUCTION', days: -2, amount: 2000, reason: 'Correction for 26–30 Sep: 2 days absent' });
    expect(byPerson.get(half)).toMatchObject({ type: 'DEDUCTION', days: -0.5, amount: 500, reason: 'Correction for 26–30 Sep: 1 half day' });

    const octPeriod = (await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: oct } })).periodId;
    const adjustments = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, periodId: octPeriod } });
    expect(adjustments).toHaveLength(2);
    expect(adjustments.every((a) => a.status === 'APPROVED' && a.type === 'DEDUCTION')).toBe(true);

    /* Taking the days again does not book them twice. */
    await pay(c, `/runs/${oct}/inputs/from-attendance`).expect(200);
    expect(await payrollPrisma.payrollAdjustment.count({ where: { orgId: c.orgId, periodId: octPeriod, status: { not: 'CANCELLED' } } })).toBe(2);

    /* The October payslip carries the correction in those words. */
    await pay(c, `/runs/${oct}/validate`).expect(200);
    await pay(c, `/runs/${oct}/calculate`).expect(200);
    const slip = await payrollPrisma.salarySlip.findFirstOrThrow({ where: { runId: oct, employeeId: absent }, include: { lines: true } });
    const line = slip.lines.find((l) => l.componentName.startsWith('Correction for'));
    expect(line).toMatchObject({ componentName: 'Correction for 26–30 Sep: 2 days absent', type: 'DEDUCTION' });
    expect(Number(line!.amount)).toBe(2000);
    const view = (await payGet(c, `/slips/${slip.id}`).expect(200)).body.slip;
    expect(view.deductions.map((d: any) => d.name)).toContain('Correction for 26–30 Sep: 2 days absent');
    const workedSlip = await payrollPrisma.salarySlip.findFirstOrThrow({ where: { runId: oct, employeeId: worked }, include: { lines: true } });
    expect(workedSlip.lines.some((l) => l.componentName.startsWith('Correction for'))).toBe(false);
  }, 120_000);

  it('pays back unpaid leave that was withdrawn and worked', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    await switchOn(c);
    const employeeId = await staff(c, await structure(c), 'Came In After All');
    const unpaid = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const leave = (await att(c, '/leave/requests', { employeeId, leaveTypeId: unpaid.id, fromDate: '2026-09-29', toDate: '2026-09-29', reason: 'Personal' }).expect(201)).body.request;
    await att(c, `/leave/requests/${leave.id}/approve`).expect(200);
    const sept = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');
    await pay(c, `/runs/${sept}/inputs/from-attendance`).expect(200);
    await pay(c, `/runs/${sept}/validate`).expect(200);
    await pay(c, `/runs/${sept}/calculate`).expect(200);
    await payrollPrisma.payrollRun.update({ where: { id: sept }, data: { status: 'LOCKED' } });

    /* The leave is withdrawn and the day worked; the other assumed days were worked too. */
    await att(c, `/leave/requests/${leave.id}/cancel`).expect(200);
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']) await record(c, employeeId, d);

    const oct = await runFor(c, 'Oct', '2026-10-01', '2026-10-31');
    const r = (await pay(c, `/runs/${oct}/inputs/from-attendance`).expect(200)).body;
    expect(r.corrections).toEqual([expect.objectContaining({ employeeId, type: 'EARNING', days: 1, amount: 1000, reason: 'Correction for 26–30 Sep: 1 day worked, paid back' })]);
  }, 120_000);

  it('a run still being prepared is not corrected; nothing is corrected when nothing was assumed', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    await switchOn(c);
    const employeeId = await staff(c, await structure(c), 'Draft Person');
    const sept = await runFor(c, 'Sept', '2026-09-01', '2026-09-30');
    await pay(c, `/runs/${sept}/inputs/from-attendance`).expect(200);
    /* September still a draft: its figures have not gone out, so October has nothing to correct. */
    const oct = await runFor(c, 'Oct', '2026-10-01', '2026-10-31');
    expect((await pay(c, `/runs/${oct}/inputs/from-attendance`).expect(200)).body.corrections).toEqual([]);
    expect(await payrollPrisma.payrollAdjustment.count({ where: { orgId: c.orgId, employeeId } })).toBe(0);
  }, 60_000);
});
