import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Two guards between Attendance and a locked payroll (closure audit O-04, O-06).
 *
 * O-04: once every month of the pay period is closed in Attendance, the run
 * takes the figures saved at the close (the latest snapshot), not today's
 * rows, and remembers which version. A month still open gives today's
 * figures, said to be provisional. A month reopened or closed again after the
 * pull stops approve and lock until the figures are taken again.
 *
 * O-06: before lock, per person, approved unpaid leave, loss of pay on the
 * days and loss of pay on the run must agree; otherwise lock asks for an
 * acknowledgement and a reason, which go in the audit log.
 */
const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any);
const payGet = (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c));
const att = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${path}`).set(at(c)).send(body as any);

async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `pgd.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PGD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

/** One person, a September 2026 run with them in it. September 2026 has ended, so it can be closed. */
async function setUp(c: Ctx) {
  const basic = await pay(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await pay(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  const person = await pay(c, '/employees', { name: 'Guard Person', code: `G${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id;
  await pay(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  const period = await pay(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = await pay(c, '/runs', { periodId: period.body.period.id }).expect(201);
  return { employeeId, runId: run.body.run.id as string };
}
const inputOf = (runId: string, employeeId: string) => payrollPrisma.payrollInput.findUnique({ where: { runId_employeeId: { runId, employeeId } } });
const setStatus = (runId: string, status: string) => payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status } });
const closeSept = async (c: Ctx) => att(c, '/months/2026-09/close', { acknowledge: true, ...(await request(app).get(`/api/orgs/${c.orgId}/attendance/months/2026-09/readiness`).set(at(c))).body.noRecordConfirm }).expect(200);
const record = (c: Ctx, employeeId: string, date: string) =>
  request(app).put(`/api/orgs/${c.orgId}/attendance/records`).set(at(c)).send({ employeeId, date, checkIn: '09:00', checkOut: '18:00' }).expect(200);

describe('payroll takes the closed month (O-04)', () => {
  it('a closed month pulls the snapshot saved at the close, and the run keeps its version', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    await record(c, employeeId, '2026-09-01');
    const closed = (await closeSept(c)).body;
    expect(closed.snapshot.version).toBe(1);

    /* The snapshot is what was frozen; make it say something the live rows do not, to see which one Payroll reads. */
    const snap = await peoplePrisma.attendanceMonthSnapshot.findFirstOrThrow({ where: { orgId: c.orgId, month: '2026-09', version: 1 } });
    const rows = JSON.parse(snap.rowsJson).map((r: any) => (r.employeeId === employeeId ? { ...r, lossOfPayDays: 7, absent: 7 } : r));
    await peoplePrisma.attendanceMonthSnapshot.update({ where: { id: snap.id }, data: { rowsJson: JSON.stringify(rows) } });

    const r = (await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200)).body;
    expect(r).toMatchObject({ figuresFrom: 'SNAPSHOT', provisional: false, openMonths: [], warning: null, attendanceClosed: true, saved: 1 });
    expect(r.attendanceSnapshots).toEqual([{ month: '2026-09', version: 1, closed: true }]);
    const input = await inputOf(runId, employeeId);
    expect(Number(input!.lwpDays)).toBe(7);
    expect(Number(input!.payableDays)).toBe(23);
    const run = await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.attendanceSnapshots).toEqual([{ month: '2026-09', version: 1, closed: true }]);
  }, 60_000);

  it('an open month gives today’s figures, marked provisional with a plain warning', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    await record(c, employeeId, '2026-09-01');
    const r = (await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200)).body;
    expect(r).toMatchObject({ figuresFrom: 'LIVE', provisional: true, openMonths: ['2026-09'], attendanceClosed: false });
    expect(r.warning).toBe('September is not closed in Attendance; these figures can still change.');
    expect(Number((await inputOf(runId, employeeId))!.lwpDays)).toBe(25);
    /* The run review says the same, from what the run stored. */
    const check = (await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body;
    expect(check).toMatchObject({ provisional: true, openMonths: ['2026-09'], snapshotChanged: null });
  }, 60_000);

  it('a month reopened, or closed again, after the pull stops approve and lock until the figures are taken again', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    await record(c, employeeId, '2026-09-01');
    await closeSept(c);
    await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200);

    await att(c, '/months/2026-09/reopen', { reason: 'Correcting a missed punch' }).expect(200);
    await setStatus(runId, 'APPROVED');
    const reopened = (await pay(c, `/runs/${runId}/lock`).expect(409)).body;
    expect(reopened).toMatchObject({ code: 'SNAPSHOT_CHANGED', month: '2026-09', reason: 'REOPENED' });
    expect(reopened.error).toMatch(/September 2026 was reopened.*Take the figures from Attendance again/);
    await setStatus(runId, 'REVIEW');
    expect((await pay(c, `/runs/${runId}/approve`).expect(409)).body.code).toBe('SNAPSHOT_CHANGED');

    /* Closed again: a newer snapshot than the one taken. */
    expect((await closeSept(c)).body.snapshot.version).toBe(2);
    await setStatus(runId, 'APPROVED');
    expect((await pay(c, `/runs/${runId}/lock`).expect(409)).body).toMatchObject({ code: 'SNAPSHOT_CHANGED', reason: 'NEWER_SNAPSHOT' });

    /* Taken again: version 2 on the run, and the lock goes through. */
    await setStatus(runId, 'REVIEW');
    await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200);
    expect((await payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).attendanceSnapshots).toEqual([{ month: '2026-09', version: 2, closed: true }]);
    await setStatus(runId, 'APPROVED');
    expect((await pay(c, `/runs/${runId}/lock`).expect(200)).body.run.status).toBe('LOCKED');
  }, 60_000);
});

describe('loss of pay agrees before lock (O-06)', () => {
  it('lists leave, days and run for a person who disagrees; lock needs an acknowledgement and a reason, and is audited', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: false });
    const { employeeId, runId } = await setUp(c);
    const lop = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const leave = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-01', toDate: '2026-09-02', reason: 'Personal' }).expect(201)).body.request;
    await att(c, `/leave/requests/${leave.id}/approve`).expect(200);
    await pay(c, `/runs/${runId}/inputs/from-leave`).expect(200);
    expect(Number((await inputOf(runId, employeeId))!.lwpDays)).toBe(2);

    /* All three agree: nothing listed. */
    expect((await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body).toMatchObject({ checked: 1, source: 'LEAVE', mismatches: [] });

    /* The register loses one of the leave days (drift the check exists to catch). */
    await peoplePrisma.attendanceRecord.deleteMany({ where: { orgId: c.orgId, employeeId, date: '2026-09-02' } });
    const check = (await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body;
    expect(check.mismatches).toEqual([
      expect.objectContaining({ employeeId, name: 'Guard Person', leaveDays: 2, recordsLeaveDays: 1, recordsLossOfPay: 1, inputLwpDays: 2, inputSource: 'LEAVE' }),
    ]);
    expect(check.mismatches[0].problems.length).toBe(2);

    await setStatus(runId, 'APPROVED');
    const refused = (await pay(c, `/runs/${runId}/lock`).expect(409)).body;
    expect(refused.code).toBe('LOP_MISMATCH');
    expect(refused.mismatches).toHaveLength(1);
    expect((await pay(c, `/runs/${runId}/lock`, { acknowledge: true, reason: 'ok' }).expect(400)).body.code).toBe('REASON_NEEDED');

    const locked = (await pay(c, `/runs/${runId}/lock`, { acknowledge: true, reason: 'Leave corrected in October run' }).expect(200)).body;
    expect(locked.run.status).toBe('LOCKED');
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'PAYROLL_RUN', entityId: runId, action: 'LOCK_LOP_ACKNOWLEDGED' } });
    expect(audit).toBeTruthy();
    expect(audit!.message).toContain('Leave corrected in October run');
    const meta = JSON.parse(String(audit!.metadata));
    expect(meta.reason).toBe('Leave corrected in October run');
    expect(meta.mismatches[0]).toMatchObject({ employeeId, leaveDays: 2, recordsLossOfPay: 1, inputLwpDays: 2 });
  }, 60_000);

  it('with Attendance: a typed figure is held only to the approved unpaid leave', async () => {
    const c = await makeOwner({ payroll: true, people: true, attendance: true });
    const { employeeId, runId } = await setUp(c);
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) await record(c, employeeId, d);
    await pay(c, `/runs/${runId}/inputs/from-attendance`).expect(200);
    expect((await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body.mismatches).toEqual([]);

    const lop = (await att(c, '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const leave = (await att(c, '/leave/requests', { employeeId, leaveTypeId: lop.id, fromDate: '2026-09-04', toDate: '2026-09-04', reason: 'Personal' }).expect(201)).body.request;
    await att(c, `/leave/requests/${leave.id}/approve`).expect(200);
    const after = (await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body.mismatches;
    /* 4 Sept was already absent: unpaid leave costs the same day, so leave, days and run still agree. */
    expect(after).toHaveLength(0);

    /* Typed by hand below the approved unpaid leave: listed. */
    await request(app).put(`/api/orgs/${c.orgId}/payroll/runs/${runId}/inputs`).set(at(c)).send({ inputs: [{ employeeId, workingDays: 30, payableDays: 30, lwpDays: 0 }] }).expect(200);
    const typed = (await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body.mismatches;
    expect(typed).toEqual([expect.objectContaining({ employeeId, leaveDays: 1, recordsLeaveDays: 1, inputLwpDays: 0, inputSource: 'MANUAL' })]);
    /* Typed at or above it: a decision about absence, not second-guessed. */
    await request(app).put(`/api/orgs/${c.orgId}/payroll/runs/${runId}/inputs`).set(at(c)).send({ inputs: [{ employeeId, workingDays: 30, payableDays: 29, lwpDays: 1 }] }).expect(200);
    expect((await payGet(c, `/runs/${runId}/lop-check`).expect(200)).body.mismatches).toEqual([]);
  }, 60_000);
});
