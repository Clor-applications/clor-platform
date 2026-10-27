import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
const { buildApp } = await import('../app.js');
const { peoplePrisma, peopleWrite, afterPeopleCommit } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { approveLeave } = await import('../routes/leave.js');
import { earned } from '../services/attendance/leaveAccrual.js';

const app = buildApp().listen(0);
let token: string, orgId: string, branchId: string;
const auth = () => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId, 'x-branch-id': branchId });
const api = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: any) => request(app)[method](`/api/orgs/${orgId}${path}`).set(auth()).send(body);
const leave = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: any) => api(method, `/attendance/leave${path}`, body);
let n = 0;
const person = async (extra = {}) => (await api('post', '/people/employees', { name: `Workflow ${++n}`, code: `WF${n}`, dateOfJoining: '2025-01-01', ...extra }).expect(201)).body.employee;
const type = async (extra = {}) => (await leave('post', '/types', { name: `Type ${++n}`, annualDays: 20, ...extra }).expect(201)).body.type;
const ask = async (p: any, t: any, date = '2026-09-01', extra = {}) => (await leave('post', '/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: date, toDate: date, reason: 'Regression check', ...extra }).expect(201)).body.request;

beforeAll(async () => {
  const signup = await request(app).post('/api/auth/signup').send({ email: `workflow.${Date.now()}@example.com`, password: 'Passw0rd!23', name: 'Owner' });
  expect(signup.status, JSON.stringify(signup.body)).toBe(200);
  token = signup.body.token;
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${token}`).send({ companyName: `Workflow ${Date.now()}`, state: 'Karnataka' }).expect(200);
  orgId = setup.body.company.orgId; branchId = setup.body.branch.id;
  await api('put', '/features', { features: { people: true, attendance: true, payroll: true } }).expect(200);
});
afterAll(async () => { await new Promise((done) => app.close(done)); });

describe('leave workflow invariants', () => {
  it('never credits entitlement before joining', () => {
    const t = { id: 'x', annualDays: 12, accrual: 'YEARLY', prorateForJoiners: true, carryForwardMax: null, createdAt: new Date('2026-01-01') };
    expect(earned(t, 2026, '2026-11-02', '2026-10-22')).toBe(0);
    expect(earned(t, 2026, '2026-11-02', '2026-11-02')).toBe(2);
  });

  it('requires a linked leave decision for manual and imported register marks', async () => {
    const p = await person();
    await api('put', '/attendance/records', { employeeId: p.id, date: '2026-09-01', status: 'ON_LEAVE' }).expect(409);
    expect(await peoplePrisma.attendanceRecord.count({ where: { orgId, employeeId: p.id } })).toBe(0);
  });

  it('preserves half-day leave across corrections and counts unpaid half days', async () => {
    const p = await person(); const t = await type({ isPaid: false });
    const r = await ask(p, t, '2026-09-01', { halfDay: 'FIRST' });
    await leave('post', `/requests/${r.id}/approve`).expect(200);
    const day = (await api('put', '/attendance/records', { employeeId: p.id, date: '2026-09-01', checkIn: '14:00', checkOut: '18:00' }).expect(200)).body.record;
    expect(day).toMatchObject({ status: 'PRESENT', leaveRequestId: r.id, lateMinutes: 0 });
    const summary = (await api('get', '/attendance/summary?month=2026-09').expect(200)).body.rows.find((x: any) => x.employeeId === p.id);
    expect(summary.unpaidLeaveDays).toBe(0.5);
    await leave('post', `/requests/${r.id}/cancel`).expect(200);
    const after = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: p.id, date: '2026-09-01' } } });
    expect(after?.leaveRequestId).toBeNull();
    expect(after?.checkIn).not.toBeNull();
  });

  it('rolls back day postings, final status and notifications when the transaction fails', async () => {
    const p = await person(); const t = await type(); const r = await ask(p, t, '2026-09-02', { toDate: '2026-09-03' });
    let notifications = 0;
    await expect(peopleWrite(orgId, async () => {
      await approveLeave(p.accountId, orgId, r, 'test', null);
      afterPeopleCommit(() => { notifications += 1; });
      throw new Error('Simulated downstream failure');
    })).rejects.toThrow('Simulated downstream failure');
    expect((await peoplePrisma.leaveRequest.findUnique({ where: { id: r.id } }))?.status).toBe('PENDING');
    expect(await peoplePrisma.attendanceRecord.count({ where: { orgId, leaveRequestId: r.id } })).toBe(0);
    expect(notifications).toBe(0);
  });

  it('allows only one concurrent final decision', async () => {
    const p = await person(); const t = await type(); const r = await ask(p, t);
    const results = await Promise.all([leave('post', `/requests/${r.id}/approve`), leave('post', `/requests/${r.id}/reject`)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const final = await peoplePrisma.leaveRequest.findUnique({ where: { id: r.id } });
    const count = await peoplePrisma.attendanceRecord.count({ where: { orgId, leaveRequestId: r.id } });
    expect(count).toBe(final?.status === 'APPROVED' ? 1 : 0);
  });

  it('refuses full-day cancellation in a closed month without changing any rows', async () => {
    const p = await person(); const t = await type(); const r = await ask(p, t);
    await leave('post', `/requests/${r.id}/approve`).expect(200);
    await api('post', '/attendance/months/2026-09/close', { acknowledge: true }).expect(200);
    await leave('post', `/requests/${r.id}/cancel`).expect(409);
    expect((await peoplePrisma.leaveRequest.findUnique({ where: { id: r.id } }))?.status).toBe('APPROVED');
    expect(await peoplePrisma.attendanceRecord.count({ where: { orgId, leaveRequestId: r.id } })).toBe(1);
    await api('post', '/attendance/months/2026-09/reopen', { reason: 'Test reopens to check again' }).expect(200);
  });

  it('keeps approved leave linked and treated the same for a punch from any source', async () => {
    const p = await person(); const cas = await type();
    /* Three approved first-half leaves, one per source, with four hours worked each second half;
       the first half keeps its punches, so worked past the half mark the day ends PRESENT. */
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
    const reqs: Record<string, string> = {};
    for (const d of dates) {
      const r = (await leave('post', '/requests', { employeeId: p.id, leaveTypeId: cas.id, fromDate: d, toDate: d, halfDay: 'FIRST', reason: 'Family' }).expect(201)).body.request;
      await leave('post', `/requests/${r.id}/approve`).expect(200);
      reqs[d] = r.id;
    }
    /* Manual. */
    await api('put', '/attendance/records', { employeeId: p.id, date: '2026-09-01', checkIn: '14:00', checkOut: '18:00' }).expect(200);
    /* Import. */
    await api('post', '/attendance/records/import', { rows: [{ employeeCode: p.code, date: '2026-09-02', checkIn: '14:00', checkOut: '18:00' }] }).expect(200);
    /* A correction request. */
    const corr = (await api('post', '/attendance/requests', { employeeId: p.id, date: '2026-09-03', checkIn: '14:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201)).body.request;
    await api('post', `/attendance/requests/${corr.id}/approve`).expect(200);
    /* A biometric reader, and its punch is the worked half of a fresh half-day leave. */
    const sn = `TST${Date.now().toString(36).toUpperCase()}`;
    await api('post', '/attendance/devices', { serialNumber: sn, name: 'Gate' }).expect(201);
    const r4 = (await leave('post', '/requests', { employeeId: p.id, leaveTypeId: cas.id, fromDate: '2026-09-04', toDate: '2026-09-04', halfDay: 'FIRST', reason: 'Family' }).expect(201)).body.request;
    await leave('post', `/requests/${r4.id}/approve`).expect(200);
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain')
      .send([`${p.code}\t2026-09-04 14:00:00\t0\t1\t0`, `${p.code}\t2026-09-04 18:00:00\t1\t1\t0`].join('\n')).expect(200);

    for (const d of [...dates, '2026-09-04']) {
      const day = (await api('get', `/attendance/records?from=${d}&to=${d}&employeeId=${p.id}`).expect(200)).body.records[0];
      expect(day).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
      expect(day.leaveRequestId).toBe(d in reqs ? reqs[d] : r4.id);
    }

    /* A full-day leave keeps its day: a punch from any source cannot undo it. */
    const full = (await leave('post', '/requests', { employeeId: p.id, leaveTypeId: cas.id, fromDate: '2026-09-05', toDate: '2026-09-05', reason: 'Marriage' }).expect(201)).body.request;
    await leave('post', `/requests/${full.id}/approve`).expect(200);
    await api('put', '/attendance/records', { employeeId: p.id, date: '2026-09-05', checkIn: '14:00', checkOut: '18:00' }).expect(409);
    const corr2 = (await api('post', '/attendance/requests', { employeeId: p.id, date: '2026-09-05', checkIn: '14:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201)).body.request;
    await api('post', `/attendance/requests/${corr2.id}/approve`).expect(409);
    await request(app).post(`/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain')
      .send([`${p.code}\t2026-09-05 14:00:00\t0\t1\t0`].join('\n')).then((res: any) => expect(res.status).toBeLessThan(500));
    const kept = (await api('get', `/attendance/records?from=2026-09-05&to=2026-09-05&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(kept).toMatchObject({ status: 'ON_LEAVE' });
    expect(kept.leaveRequestId).toBe(full.id);
  });

  it('separates API application permission from decisions and enforces manager first', async () => {
    const manager = await person(); const p = await person({ reportingManagerId: manager.id }); const t = await type(); const r = await ask(p, t);
    const rules = (await api('get', '/attendance/rules').expect(200)).body.rules;
    await api('put', '/attendance/rules', { ...rules, leaveApproval: 'MANAGER_THEN_HR' }).expect(200);
    const key = async (scopes: string[]) => (await api('post', '/attendance/integrations/keys', { name: `Key ${++n}`, scopes }).expect(201)).body.token;
    const writer = await key(['leave:write']); const approver = await key(['leave:approve']);
    await request(app).post(`/v1/leave/requests/${r.id}/approve`).set('Authorization', `Bearer ${writer}`).send({}).expect(403);
    const refused = await request(app).post(`/v1/leave/requests/${r.id}/approve`).set('Authorization', `Bearer ${approver}`).send({}).expect(409);
    expect(refused.body.code).toBe('MANAGER_FIRST');
    await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { managerApprovedAt: new Date(), managerApprovedById: manager.id } });
    await request(app).post(`/v1/leave/requests/${r.id}/approve`).set('Authorization', `Bearer ${approver}`).send({}).expect(200);
    await api('put', '/attendance/rules', { ...rules, leaveApproval: 'HR' }).expect(200);
  });

  it('does not let a bulk change mark a day on leave, in preview or apply', async () => {
    const p = await person(); const t = await type(); const r = await ask(p, t);
    await leave('post', `/requests/${r.id}/approve`).expect(200);
    const day = (await api('get', `/attendance/records?from=2026-09-01&to=2026-09-01&employeeId=${p.id}`).expect(200)).body.records[0];
    expect(day).toMatchObject({ status: 'ON_LEAVE', leaveRequestId: r.id });
    for (const preview of [true, false]) {
      const out = await api('post', '/attendance/records/bulk', { ids: [day.id], operation: 'SET_STATUS', status: 'ON_LEAVE', reason: 'Bulk test', preview });
      expect(out.status).toBe(200);
      const row = preview ? out.body.rows[0] : out.body.results[0];
      expect(row).toMatchObject({ ok: false, error: expect.stringContaining('leave request') });
    }
    const kept = await peoplePrisma.attendanceRecord.findUnique({ where: { id: day.id } });
    expect(kept).toMatchObject({ status: 'ON_LEAVE', leaveRequestId: r.id });
  });

  it('refuses half-day cancellation in a closed month without changing any rows', async () => {
    const p = await person(); const t = await type(); const r = await ask(p, t, '2026-09-01', { halfDay: 'FIRST' });
    await leave('post', `/requests/${r.id}/approve`).expect(200);
    await api('post', '/attendance/months/2026-09/close', { acknowledge: true }).expect(200);
    await leave('post', `/requests/${r.id}/cancel`).expect(409);
    const day = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: p.id, date: '2026-09-01' } } });
    expect(day).toMatchObject({ leaveRequestId: r.id, status: 'HALF_DAY' });
    expect((await peoplePrisma.leaveRequest.findUnique({ where: { id: r.id } }))?.status).toBe('APPROVED');
    await api('post', '/attendance/months/2026-09/reopen', { reason: 'Test reopens to check again' }).expect(200);
  });

  it('does not restate entitlement or periods once balances have activity', async () => {
    const p = await person(); const t = await type(); await ask(p, t);
    const changed = await leave('put', `/types/${t.id}`, { ...t, annualDays: 40 }).expect(409);
    expect(changed.body.code).toBe('LEAVE_POLICY_IN_USE');
    await leave('put', '/settings', { startMonth: 4, startDay: 1 }).expect(409);
    expect((await peoplePrisma.leaveType.findUnique({ where: { id: t.id } }))?.annualDays).toBe(20);
  });

  it('serializes encashment caps and links one debit to one approved payroll earning', async () => {
    const p = await person(); const t = await type({ encashable: true, maxEncashDays: 10 });
    /* The run covers the whole staff list; earlier tests leave people on it
       without payroll profiles, so take them out of payroll before running. */
    const staff = await peoplePrisma.employee.findMany({ where: { orgId, id: { not: p.id } }, select: { id: true, name: true, code: true, dateOfJoining: true } });
    for (const s of staff) {
      await api('put', `/payroll/employees/${s.id}`, { name: s.name, code: s.code, dateOfJoining: s.dateOfJoining, payroll: { payrollStatus: 'EXCLUDED' } }).expect(200);
    }
    const payload = { employeeId: p.id, leaveTypeId: t.id, year: 2026, days: 6, kind: 'ENCASH', reason: 'Pay out leave' };
    const results = await Promise.all([leave('post', '/adjustments', payload), leave('post', '/adjustments', payload)]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 400]);
    const encash = results.find((x) => x.status === 201)!.body.adjustment;
    const component = (await api('post', '/payroll/components', { name: `Encash ${++n}`, code: `ENC${n}`, type: 'EARNING', calculationMethod: 'FIXED', isVariable: true }).expect(201)).body.component;
    const period = (await api('post', '/payroll/periods', { name: `September ${++n}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201)).body.period;
    const earning = { employeeId: p.id, componentId: component.id, periodId: period.id, amount: 6000, leaveEncashmentId: encash.id, reason: '6 days at approved daily rate 1000' };
    const first = (await api('post', '/payroll/adjustments', earning).expect(201)).body.adjustment;
    const retry = (await api('post', '/payroll/adjustments', earning).expect(201)).body.adjustment;
    expect(retry.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'DRAFT', reference: `leave-encash:${encash.id}` });
    expect(await payrollPrisma.payrollAdjustment.count({ where: { id: first.id } })).toBe(1);
    await leave('delete', `/adjustments/${encash.id}`).expect(409);
    await api('post', `/payroll/adjustments/${first.id}/approve`).expect(200);
    expect((await payrollPrisma.payrollAdjustment.findUnique({ where: { id: first.id } }))?.status).toBe('APPROVED');
    await api('put', `/payroll/employees/${p.id}`, { name: p.name, dateOfJoining: '2025-01-01', payroll: { payrollStatus: 'IN_PAYROLL' } }).expect(200);
    const basic = (await api('post', '/payroll/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC' }).expect(201)).body.component;
    const structure = (await api('post', '/payroll/structures', { name: 'Workflow salary', frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.id, displayOrder: 1 }] }).expect(201)).body.structure;
    await api('post', '/payroll/assignments', { employeeId: p.id, structureId: structure.id, effectiveFrom: '2026-01-01', annualCtc: 360000 }).expect(201);
    const run = (await api('post', '/payroll/runs', { periodId: period.id }).expect(201)).body.run;
    const calculation = await api('post', `/payroll/runs/${run.id}/calculate`);
    expect(calculation.status, JSON.stringify(calculation.body)).toBe(200);
    await api('post', `/payroll/runs/${run.id}/calculate`).expect(200);
    const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId, runId: run.id, employeeId: p.id }, include: { lines: true } });
    expect(slip?.lines.filter((l) => l.componentId === component.id).map((l) => Number(l.amount))).toEqual([6000]);
    expect((await peoplePrisma.leaveAdjustment.findUnique({ where: { id: encash.id } }))?.paidInRunId).toBe(run.id);
    await leave('delete', `/adjustments/${encash.id}`).expect(409);

  });
});
