import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Two fixes from the People review:
 * - People approvals decided several at once (POST /people/approvals/bulk-decide):
 *   each through the same decision as one, so the approver, maker-checker, the
 *   step that waits now and the reason rule hold per request, and one refusal
 *   never stops the rest.
 * - Audit lines that say what a setting was as well as what it is now, and a
 *   year-end undo that leaves each pay-out it took back on record.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `bda.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `BDA Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.userId = me.body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const att = (c: Ctx, m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const MANAGER_PERMS = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

/** The newest audit line for an entity, with its metadata read back. */
async function lastAudit(c: Ctx, entity: string, action?: string) {
  const row = await runInTenant(c.orgId, () => platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity, ...(action ? { action } : {}) }, orderBy: { createdAt: 'desc' } }));
  expect(row, `${entity} ${action || ''} audit line`).toBeTruthy();
  return { ...row!, meta: JSON.parse(row!.metadata || '{}') };
}

describe('People approvals decided several at once', () => {
  let hr: Ctx;
  let manager: Ctx;
  let head: Ctx;
  let reader: Ctx;
  const staff: any[] = [];
  let g2: any;
  let g3: any;
  let security: any;
  const status = (id: string) => runInTenant(hr.orgId, () => peoplePrisma.approvalRequest.findUniqueOrThrow({ where: { id }, include: { steps: { orderBy: { order: 'asc' } } } }));

  beforeAll(async () => {
    hr = await owner();
    manager = await colleague(hr, 'Ravi', MANAGER_PERMS);
    head = await colleague(hr, 'Priya', MANAGER_PERMS);
    reader = await colleague(hr, 'Kiran', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW']);
    security = (await people(hr).post('/structure/departments', { name: 'Security' }).expect(201)).body.item;
    g2 = (await people(hr).post('/structure/grades', { name: 'G2' }).expect(201)).body.item;
    g3 = (await people(hr).post('/structure/grades', { name: 'G3' }).expect(201)).body.item;
    const managerEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'B-1' }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { userId: manager.userId } }));
    for (const [i, name] of ['Meera Shah', 'Arjun Rao', 'Divya Nair', 'Sunil Das', 'Leela Iyer'].entries()) {
      staff.push((await people(hr).post('/employees', { name, code: `B-${i + 2}`, gradeId: g2.id, reportingManagerId: managerEmp.id }).expect(201)).body.employee);
    }
    await people(hr).post('/approval-rules', {
      requestType: 'JOB_CHANGE', name: 'Job changes',
      steps: [
        { approver: { kind: 'MANAGER' }, dueDays: 2 },
        { approver: { kind: 'USER', id: head.userId }, condition: { field: 'gradeId', op: 'changed' }, dueDays: 2 },
      ],
    }).expect(201);
  }, 120_000);

  it('decides the ones that are the approver’s, refuses the rest one by one, and one refusal stops nothing', async () => {
    const move = (await people(hr).put(`/employees/${staff[0].id}`, { departmentId: security.id, changeNote: 'Night team' }).expect(200)).body.request;
    /* A grade change: once Ravi approves step 1, step 2 waits for Priya, not him. */
    const grade = (await people(hr).put(`/employees/${staff[1].id}`, { gradeId: g3.id, changeNote: 'Promotion' }).expect(200)).body.request;
    await people(manager).post(`/requests/${grade.id}/approve`, {}).expect(200);
    /* Already decided: nothing waits. */
    const gone = (await people(hr).put(`/employees/${staff[2].id}`, { departmentId: security.id }).expect(200)).body.request;
    await people(manager).post(`/requests/${gone.id}/reject`, { comment: 'Not now' }).expect(200);
    const second = (await people(hr).put(`/employees/${staff[3].id}`, { departmentId: security.id }).expect(200)).body.request;

    const out = (await people(manager).post('/approvals/bulk-decide', { ids: [move.id, grade.id, gone.id, 'no-such-request', second.id], action: 'approve' }).expect(200)).body;
    expect(out.done).toBe(2);
    expect(out.failed).toBe(3);
    expect(out.results).toEqual([
      expect.objectContaining({ id: grade.id, code: 'NOT_APPROVER', error: 'This is not yours to decide.' }),
      expect.objectContaining({ id: gone.id, code: 'NOT_WAITING' }),
      expect.objectContaining({ id: 'no-such-request', code: 'NOT_FOUND' }),
    ]);
    /* The same decision as one: the change is applied, the step names who decided. */
    const moved = await status(move.id);
    expect(moved.status).toBe('APPROVED');
    expect(moved.steps[0]).toMatchObject({ status: 'APPROVED', decidedByUserId: manager.userId });
    expect((await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: staff[0].id } }))).departmentId).toBe(security.id);
    expect((await status(second.id)).status).toBe('APPROVED');
    /* The refused ones are left as they were. */
    expect((await status(grade.id)).steps.map((s) => [s.order, s.status])).toEqual([[1, 'APPROVED'], [2, 'WAITING']]);
    expect((await status(gone.id)).status).toBe('REJECTED');
    /* Step order holds the other way too: Priya decides step 2. */
    expect((await people(head).post('/approvals/bulk-decide', { ids: [grade.id], approve: true }).expect(200)).body).toEqual({ done: 1, failed: 0, results: [] });
  });

  it('rejecting needs one note, which every request carries; the reason rule and the permission are the single route’s', async () => {
    const r = (await people(hr).put(`/employees/${staff[4].id}`, { departmentId: security.id }).expect(200)).body.request;
    expect((await people(manager).post('/approvals/bulk-decide', { ids: [r.id], action: 'reject' }).expect(400)).body.error).toBe('Say why it is not approved.');
    expect((await people(manager).post('/approvals/bulk-decide', { ids: [r.id], action: 'more-info', comment: '  ' }).expect(400)).body.error).toBe('Say what more is needed.');
    await people(manager).post('/approvals/bulk-decide', { ids: [], action: 'approve' }).expect(400);
    await people(manager).post('/approvals/bulk-decide', { ids: [r.id], action: 'delete' }).expect(400);
    /* Seeing requests is not deciding them. */
    await people(reader).post('/approvals/bulk-decide', { ids: [r.id], action: 'approve' }).expect(403);
    /* Maker-checker: HR asked for this one and is not its approver. */
    expect((await people(hr).post('/approvals/bulk-decide', { ids: [r.id], action: 'approve' }).expect(200)).body).toMatchObject({ done: 0, failed: 1, results: [expect.objectContaining({ id: r.id })] });
    expect((await status(r.id)).status).toBe('WAITING');

    const out = (await people(manager).post('/approvals/bulk-decide', { ids: [r.id], approve: false, comment: 'Year-end week' }).expect(200)).body;
    expect(out).toEqual({ done: 1, failed: 0, results: [] });
    const rejected = await status(r.id);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.steps[0]).toMatchObject({ status: 'REJECTED', comment: 'Year-end week' });
  });

  it('a request someone asked for themselves is not theirs to decide in bulk either', async () => {
    /* Ravi, Meera's manager, asks to change her grade himself. */
    const own = (await people(manager).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: staff[0].id, title: 'Grade for Meera', payload: { employeeId: staff[0].id, fields: { gradeId: { before: g2.id, after: g3.id } }, reason: 'Correction' } }).expect(201)).body.request;
    /* Ravi asked, so his step is skipped and Priya's waits; Ravi cannot decide it in bulk. */
    const out = (await people(manager).post('/approvals/bulk-decide', { ids: [own.id], action: 'approve' }).expect(200)).body;
    expect(out.done).toBe(0);
    expect(out.results[0].id).toBe(own.id);
  });
});

describe('audit lines carry the old value', () => {
  let c: Ctx;
  let casual: any;
  let asha: any;
  beforeAll(async () => {
    c = await owner();
    casual = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    asha = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha', code: 'A1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  }, 60_000);

  it('the leave period: before and after', async () => {
    /* First, before any balance or request exists. */
    await att(c, 'put', '/leave/settings', { startMonth: 4, startDay: 1 }).expect(200);
    const line = await lastAudit(c, 'LeaveSettings');
    expect(line.meta.before).toEqual({ startMonth: 1, startDay: 1 });
    expect(line.meta.after).toEqual({ startMonth: 4, startDay: 1 });
    await att(c, 'put', '/leave/settings', { startMonth: 1, startDay: 1 }).expect(200);
    expect((await lastAudit(c, 'LeaveSettings')).meta).toMatchObject({ before: { startMonth: 4, startDay: 1 }, after: { startMonth: 1, startDay: 1 } });
  });

  it('the working week: before and after', async () => {
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0,6' }).expect(200);
    const first = await lastAudit(c, 'WorkingWeek');
    expect(first.meta.after).toMatchObject({ weeklyOffDays: '0,6', offSaturdays: '' });
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0', offSaturdays: '2,4', restrictedHolidayQuota: 2 }).expect(200);
    const line = await lastAudit(c, 'WorkingWeek');
    expect(line.meta.before).toMatchObject({ weeklyOffDays: '0,6', offSaturdays: '' });
    expect(line.meta.after).toMatchObject({ weeklyOffDays: '0', offSaturdays: '2,4', restrictedHolidayQuota: 2 });
  });

  it('a leave allocation set, changed and cleared: before and after each time', async () => {
    const year = new Date().getFullYear();
    const at3 = { employeeId: asha.id, leaveTypeId: casual.id, year };
    await att(c, 'put', '/leave/allocations', { ...at3, days: 10, note: 'Joined late' }).expect(200);
    expect((await lastAudit(c, 'LeaveAllocation', 'UPDATE')).meta).toMatchObject({ before: null, after: { days: 10, note: 'Joined late' } });
    await att(c, 'put', '/leave/allocations', { ...at3, days: 8 }).expect(200);
    expect((await lastAudit(c, 'LeaveAllocation', 'UPDATE')).meta).toMatchObject({ before: { days: 10, note: 'Joined late' }, after: { days: 8, note: null } });
    await att(c, 'put', '/leave/allocations', { ...at3, days: null }).expect(200);
    expect((await lastAudit(c, 'LeaveAllocation', 'DELETE')).meta).toMatchObject({ before: { days: 8 }, after: null });
  });

  it('an adjustment removed: what it was', async () => {
    const year = new Date().getFullYear();
    const adj = (await att(c, 'post', '/leave/adjustments', { employeeId: asha.id, leaveTypeId: casual.id, year, days: 2, reason: 'Worked the fair' }).expect(201)).body.adjustment;
    await att(c, 'delete', `/leave/adjustments/${adj.id}`).expect(200);
    const line = await lastAudit(c, 'LeaveAdjustment', 'DELETE');
    expect(line.entityId).toBe(adj.id);
    expect(line.meta).toMatchObject({ before: { employeeId: asha.id, leaveTypeId: casual.id, year, days: 2, kind: 'ADJUST', reason: 'Worked the fair' }, after: null });
  });

  it('the overtime rules and the field-punch setting: before and after', async () => {
    const before = (await att(c, 'get', '/overtime/rules').expect(200)).body.rules;
    await att(c, 'put', '/overtime/rules', { ...before, overtimeRequests: false, confirmCutoffDay: 5 }).expect(200);
    const line = await lastAudit(c, 'ATTENDANCE_OVERTIME_RULES');
    expect(line.meta.before).toEqual(before);
    expect(line.meta.after).toMatchObject({ overtimeRequests: false, confirmCutoffDay: 5 });
    expect(line.message).toContain('overtimeRequests');

    await att(c, 'put', '/phone-punches/settings', { fieldPunchApproval: false }).expect(200);
    expect((await lastAudit(c, 'ATTENDANCE_SETTINGS')).meta).toEqual({ before: { fieldPunchApproval: true }, after: { fieldPunchApproval: false } });
    await att(c, 'put', '/phone-punches/settings', { fieldPunchApproval: true }).expect(200);
    expect((await lastAudit(c, 'ATTENDANCE_SETTINGS')).meta).toEqual({ before: { fieldPunchApproval: false }, after: { fieldPunchApproval: true } });
  });
});

describe('year-end undo leaves a trace per pay-out', () => {
  it('reverses each pay-out instead of deleting it, names each in the audit line, and readers skip reversed rows', async () => {
    const c = await owner({ people: true, attendance: false });
    const earned = (await att(c, 'post', '/leave/types', { name: 'Earned', annualDays: 15, carryForwardMax: 5, encashable: true, maxEncashDays: 10 }).expect(201)).body.type;
    const mk = async (name: string, code: string) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name, code, dateOfJoining: '2020-01-01' }).expect(201)).body.employee;
    const p1 = await mk('Old Hand', 'Y1');
    const p2 = await mk('Older Hand', 'Y2');
    const year = new Date().getFullYear() - 1;
    await runInTenant(c.orgId, () => peoplePrisma.leaveType.update({ where: { id: earned.id }, data: { createdAt: new Date(`${year}-01-01T00:00:00Z`) } }));
    const run = (await att(c, 'post', '/leave/year-end', { year }).expect(201)).body;
    expect(run.paidOut).toBe(2);

    await att(c, 'post', `/leave/year-end/${run.run.id}/undo`, {}).expect(200);
    const rows = await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.findMany({ where: { orgId: c.orgId, kind: 'ENCASH' } }));
    /* Kept, each marked reversed by whom. */
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reversedAt && r.reversedByUserId === c.userId)).toBe(true);
    const line = await lastAudit(c, 'LeaveYearEnd', 'DELETE');
    expect(line.meta.reversed).toHaveLength(2);
    expect(line.meta.reversed).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: p1.id, leaveTypeId: earned.id, kind: 'ENCASH', days: -10, year }),
      expect.objectContaining({ employeeId: p2.id, leaveTypeId: earned.id, kind: 'ENCASH', days: -10, year }),
    ]));
    expect(line.meta).toMatchObject({ before: { undone: false, payOuts: 2 }, after: { undone: true, payOuts: 0 } });

    /* Readers skip them: the preview pays out again, the ledger and Payroll's list do not show them, and the run can run again. */
    const preview = (await att(c, 'get', `/leave/year-end?year=${year}`).expect(200)).body;
    expect(preview.rows.find((r: any) => r.employeeId === p1.id)).toMatchObject({ payOut: 10 });
    const list = (await att(c, 'get', `/leave/adjustments?year=${year}`).expect(200)).body;
    expect(list.adjustments.filter((a: any) => a.kind === 'ENCASH')).toEqual([]);
    await att(c, 'delete', `/leave/adjustments/${rows[0].id}`).expect(404);
    const again = (await att(c, 'post', '/leave/year-end', { year }).expect(201)).body;
    expect(again.paidOut).toBe(2);
    expect(await runInTenant(c.orgId, () => peoplePrisma.leaveAdjustment.count({ where: { orgId: c.orgId, kind: 'ENCASH', reversedAt: null } }))).toBe(2);
  }, 60_000);
});
