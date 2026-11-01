import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave through the company's approval rule, eligibility by department,
 * branch and grade, and a document with a long request (owner, 28 Oct 2026).
 * The rule is the one People's other requests use (Settings → Approval
 * Rules): the manager, their manager, a named person, a role or HR, each
 * step with an optional condition, a due time and what happens when late.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runLeaveRuleDues } = await import('../services/attendance/leaveJobs.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `lr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LR Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: signup.body.user?.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `lrc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: `Colleague ${rnd()}`, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const people = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
/* A type is saved whole: its name and days with the change. */
const setType = (c: Ctx, t: any, patch: Record<string, unknown>) => att(c, 'put', `/leave/types/${t.id}`, { name: t.name, annualDays: t.annualDays, ...patch });
const row = (c: Ctx, id: string) => runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } }));

const APPROVES = ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW', 'PEOPLE::Requests::APPROVE'];
const MY = ['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 certificate').toString('base64')}`;

describe('leave through the approval rule', () => {
  let hr: Ctx;
  let manager: Ctx;
  let skip: Ctx;
  let named: Ctx;
  let me: Ctx;
  let casual: any;
  let emp: any;
  beforeAll(async () => {
    hr = await company();
    manager = await colleague(hr, APPROVES, true);
    skip = await colleague(hr, APPROVES, true);
    /* The named person has no leave rights at all: the step is what lets them decide. */
    named = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    me = await colleague(hr, MY);
    const skipEmp = await person(hr, { name: 'Skip Sunita', code: 'R1' });
    const managerEmp = await person(hr, { name: 'Manager Mohan', code: 'R2', reportingManagerId: skipEmp.id });
    emp = await person(hr, { name: 'Asker Anil', code: 'R3', reportingManagerId: managerEmp.id });
    await link(hr, skipEmp.id, skip.userId!);
    await link(hr, managerEmp.id, manager.userId!);
    await link(hr, emp.id, me.userId!);
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
  }, 120_000);

  it('the rule is set up first; then a type or the company can follow it', async () => {
    const refused = await setType(hr, casual, { approval: 'RULE' }).expect(400);
    expect(refused.body.error).toMatch(/approval rule first/);
    const rules = (await people(hr, 'get', '/approval-rules').expect(200)).body;
    expect(rules.requestTypes).toContain('LEAVE');
    await people(hr, 'post', '/approval-rules', {
      requestType: 'LEAVE', name: 'Leave',
      steps: [
        { approver: { kind: 'MANAGER' }, dueDays: 2 },
        { approver: { kind: 'MANAGER_OF_MANAGER' }, dueDays: 2, condition: { field: 'days', op: 'gt', value: '2' } },
        { approver: { kind: 'USER', id: named.userId }, dueDays: 2, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } },
      ],
    }).expect(201);
    await setType(hr, casual, { approval: 'RULE' }).expect(200);
    /* Leave is never a generic People request: the engine refuses it there. */
    await people(hr, 'post', '/requests', { requestType: 'LEAVE', title: 'x', payload: {} }).expect(400);
  });

  it('one day: the manager, then the named person; the condition skips the skip-level', async () => {
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: '2027-02-02', toDate: '2027-02-02', reason: 'Bank work' }).expect(201)).body.request;
    expect(await row(hr, r.id)).toMatchObject({ status: 'PENDING', ruleStep: 1, stepUserIds: [manager.userId] });
    /* HR is not on this rule: not theirs to decide, and they are told whose it is. */
    const notHr = await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(403);
    expect(notHr.body).toMatchObject({ code: 'NOT_YOUR_STEP' });
    expect(notHr.body.error).toMatch(/Step 1/);
    expect((await att(manager, 'post', `/leave/requests/${r.id}/approve`, { note: 'Fine' }).expect(200)).body.stage).toBe('NEXT');
    const after = await row(hr, r.id);
    expect(after).toMatchObject({ status: 'PENDING', ruleStep: 3, stepUserIds: [named.userId] });
    expect((after.history as any[]).map((h) => h.what)).toEqual(['ASKED', 'STEP_APPROVED', 'STEP_SKIPPED']);
    /* The named person sees it in their inbox and opens it without any leave rights. */
    const inbox = (await people(named, 'get', '/inbox').expect(200)).body;
    expect(inbox.items.find((i: any) => i.id === r.id)).toMatchObject({ kind: 'LEAVE', step: 3 });
    const detail = (await att(named, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(detail.step).toMatchObject({ current: 3, of: 3, yours: true });
    await att(named, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    expect((await row(hr, r.id)).status).toBe('APPROVED');
  });

  it('three days: the manager, the skip-level, then the named person, who refuses', async () => {
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: '2027-02-09', toDate: '2027-02-11', reason: 'Wedding' }).expect(201)).body.request;
    await att(manager, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    expect(await row(hr, r.id)).toMatchObject({ ruleStep: 2, stepUserIds: [skip.userId] });
    /* The manager took their step; the next is not theirs. */
    expect((await att(manager, 'post', `/leave/requests/${r.id}/approve`).expect(403)).body.code).toBe('NOT_YOUR_STEP');
    await att(skip, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    await att(named, 'post', `/leave/requests/${r.id}/reject`, { note: 'Audit week' }).expect(200);
    expect(await row(hr, r.id)).toMatchObject({ status: 'REJECTED', reviewNote: 'Audit week' });
  });

  it('a changed request starts again from the first step', async () => {
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: '2027-03-02', toDate: '2027-03-02', reason: 'Errand' }).expect(201)).body.request;
    await att(manager, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    expect((await row(hr, r.id)).ruleStep).toBe(3);
    await att(me, 'put', `/me/leave/${r.id}`, { leaveTypeId: casual.id, fromDate: '2027-03-03', toDate: '2027-03-03', reason: 'Errand' }).expect(200);
    expect(await row(hr, r.id)).toMatchObject({ ruleStep: 1, stepUserIds: [manager.userId] });
  });

  it('a late step is reminded, then handed on as the rule says', async () => {
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: '2027-04-06', toDate: '2027-04-06', reason: 'Family' }).expect(201)).body.request;
    await att(manager, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    const late = new Date(Date.now() - 86_400_000);
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { stepDueAt: late } }));
    await runLeaveRuleDues();
    const reminded = await row(hr, r.id);
    expect(reminded.stepRemindedAt).toBeTruthy();
    expect(reminded.stepUserIds).toEqual([named.userId]);
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { stepRemindedAt: new Date(Date.now() - 2 * 86_400_000) } }));
    await runLeaveRuleDues();
    const moved = await row(hr, r.id);
    expect(moved.stepUserIds).toContain(hr.userId);
    expect(moved.stepUserIds).not.toContain(named.userId);
    expect((moved.history as any[]).at(-1)).toMatchObject({ what: 'STEP_HANDED_ON' });
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    expect((await row(hr, r.id)).status).toBe('APPROVED');
  });

  it('nobody decides their own leave: a step only they could take goes to the admins', async () => {
    const solo = (await att(hr, 'post', '/leave/types', { name: 'Solo', annualDays: 5 }).expect(201)).body.type;
    await people(hr, 'post', '/approval-rules', { requestType: 'LEAVE', name: 'Leave v2', steps: [{ approver: { kind: 'USER', id: me.userId }, dueDays: 1 }] }).expect(201);
    await setType(hr, solo, { approval: 'RULE' }).expect(200);
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: solo.id, fromDate: '2027-05-04', toDate: '2027-05-04', reason: 'Errand' }).expect(201)).body.request;
    const waiting = await row(hr, r.id);
    expect(waiting.stepUserIds).not.toContain(me.userId);
    expect(waiting.stepUserIds).toContain(hr.userId);
    /* The earlier request keeps the rule version it was asked under. */
    expect(waiting.ruleId).not.toBe((await row(hr, (await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findFirstOrThrow({ where: { orgId: hr.orgId, leaveTypeId: casual.id }, orderBy: { createdAt: 'asc' } }))).id)).ruleId);
  });
});

describe('who a type is for, and the document a long request needs', () => {
  let hr: Ctx;
  let me: Ctx;
  let emp: any;
  let deptA: any;
  let deptB: any;
  beforeAll(async () => {
    hr = await company();
    me = await colleague(hr, MY);
    deptA = (await people(hr, 'post', '/structure/departments', { name: 'Sales' }).expect(201)).body;
    deptB = (await people(hr, 'post', '/structure/departments', { name: 'Stores' }).expect(201)).body;
    deptA = deptA.item || deptA;
    deptB = deptB.item || deptB;
    emp = await person(hr, { name: 'Dept Deepa', code: 'D1', departmentId: deptB.id });
    await link(hr, emp.id, me.userId!);
  }, 120_000);

  it('a type open to one department is not offered to, nor accepted from, another', async () => {
    const sales = (await att(hr, 'post', '/leave/types', { name: 'Field days', annualDays: 6, departmentIds: [deptA.id] }).expect(201)).body.type;
    expect(sales.departmentIds).toEqual([deptA.id]);
    const mine = (await att(me, 'get', '/me/leave').expect(200)).body;
    expect(mine.types.map((t: any) => t.id)).not.toContain(sales.id);
    const refused = await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: sales.id, fromDate: '2027-02-02', toDate: '2027-02-02', reason: 'Visit' }).expect(400);
    expect(refused.body.error).toMatch(/department/);
    await setType(hr, sales, { departmentIds: [deptA.id, deptB.id] }).expect(200);
    await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: sales.id, fromDate: '2027-02-02', toDate: '2027-02-02', reason: 'Visit' }).expect(201);
    await setType(hr, sales, { departmentIds: ['nope'] }).expect(400);
  });

  it('more than two days of sick leave needs a document; it is kept on the file and opens from the request', async () => {
    const sick = (await att(hr, 'post', '/leave/types', { name: 'Sick', annualDays: 10, isPrivate: true, attachmentAfterDays: 2 }).expect(201)).body.type;
    const preview = (await att(me, 'post', '/me/leave/preview', { leaveTypeId: sick.id, fromDate: '2027-02-08', toDate: '2027-02-10' }).expect(200)).body;
    expect(preview).toMatchObject({ ok: true, documentNeeded: true, documentAfterDays: 2 });
    const short = (await att(me, 'post', '/me/leave/preview', { leaveTypeId: sick.id, fromDate: '2027-02-08', toDate: '2027-02-09' }).expect(200)).body;
    expect(short.documentNeeded).toBe(false);
    const missing = await att(me, 'post', '/me/leave', { leaveTypeId: sick.id, fromDate: '2027-02-08', toDate: '2027-02-10' }).expect(400);
    expect(missing.body).toMatchObject({ code: 'DOCUMENT' });
    await att(me, 'post', '/me/leave', { leaveTypeId: sick.id, fromDate: '2027-02-08', toDate: '2027-02-10', attachment: { data: 'data:application/pdf;base64,bm90IGEgcGRm', name: 'x.pdf' } }).expect(400);
    const r = (await att(me, 'post', '/me/leave', { leaveTypeId: sick.id, fromDate: '2027-02-08', toDate: '2027-02-10', attachment: { data: PDF, name: 'certificate.pdf' } }).expect(201)).body.request;
    const saved = await row(hr, r.id);
    expect(saved.attachmentDocId).toBeTruthy();
    const doc = await runInTenant(hr.orgId, () => peoplePrisma.employeeDocument.findUniqueOrThrow({ where: { id: saved.attachmentDocId! } }));
    expect(doc).toMatchObject({ employeeId: emp.id, kind: 'CERTIFICATE', classification: 'CONFIDENTIAL' });
    const detail = (await att(hr, 'get', `/leave/requests/${r.id}`).expect(200)).body;
    expect(detail.document).toMatchObject({ id: doc.id, mime: 'application/pdf' });
    const file = (await att(hr, 'get', `/leave/requests/${r.id}/document`).expect(200)).body.document;
    expect(file.dataUrl).toBe(PDF);
    /* HR entering it after the fact is not held to the document. */
    await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: sick.id, fromDate: '2027-03-08', toDate: '2027-03-10' }).expect(201);
  });
});

describe('a manager decides their step in the employee app', () => {
  let hr: Ctx;
  let casual: any;
  let manager: any;
  let report: any;
  let token: string;
  beforeAll(async () => {
    hr = await company();
    manager = await person(hr, { name: 'App Asha', code: 'M1' });
    report = await person(hr, { name: 'Report Ravi', code: 'M2', reportingManagerId: manager.id });
    casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await people(hr, 'post', '/approval-rules', { requestType: 'LEAVE', name: 'Leave', steps: [{ approver: { kind: 'MANAGER' }, dueDays: 2 }, { approver: { kind: 'HR' }, dueDays: 2 }] }).expect(201);
    await setType(hr, casual, { approval: 'RULE' }).expect(200);
    const companyCode = (await att(hr, 'get', '/portal-access').expect(200)).body.company.code;
    const code = (await att(hr, 'post', '/portal-access/codes', { employeeIds: [manager.id] }).expect(200)).body.codes[0].activationCode;
    await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'M1', activationCode: code, password: 'app pass 12' }).expect(200);
    token = (await request(app).post('/api/portal/login').send({ company: companyCode, employeeCode: 'M1', password: 'app pass 12' }).expect(200)).body.token;
  }, 120_000);
  const app_ = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any);

  it('a manager who can sign in nowhere is passed over: HR takes their step', async () => {
    const offline = await person(hr, { name: 'Offline Om', code: 'M3' });
    const theirs = await person(hr, { name: 'Report Rekha', code: 'M4', reportingManagerId: offline.id });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: theirs.id, leaveTypeId: casual.id, fromDate: '2027-06-08', toDate: '2027-06-08', reason: 'Errand' }).expect(201)).body.request;
    const waiting = await row(hr, r.id);
    expect(waiting.stepUserIds).not.toContain(`portal:${offline.id}`);
    /* HR entered it and HR may decide it: entering leave for someone is not asking for your own. */
    expect(waiting.stepUserIds).toContain(hr.userId);
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    /* The second step would name HR again: HR's one approval is the decision. */
    expect((await row(hr, r.id)).status).toBe('APPROVED');
  });

  it('the manager with no CLOR sign-in sees the step in the app and takes it; HR takes the next', async () => {
    const clerk = await colleague(hr, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::CREATE', 'PEOPLE::Employees::VIEW']);
    const r = (await att(clerk, 'post', '/leave/requests', { employeeId: report.id, leaveTypeId: casual.id, fromDate: '2027-06-01', toDate: '2027-06-01', reason: 'Errand' }).expect(201)).body.request;
    expect(await row(hr, r.id)).toMatchObject({ ruleStep: 1, stepUserIds: [`portal:${manager.id}`] });
    const queue = (await app_('get', '/approvals').expect(200)).body;
    expect(queue.approver).toBe(true);
    expect(queue.leaves.find((x: any) => x.id === r.id)).toMatchObject({ step: 1, employeeName: 'Report Ravi' });
    await app_('post', `/approvals/leave/${r.id}`, { decision: 'reject' }).expect(400);
    expect((await app_('post', `/approvals/leave/${r.id}`, { decision: 'approve' }).expect(200)).body.stage).toBe('NEXT');
    /* HR's step now; the manager's queue no longer holds it. */
    expect((await app_('get', '/approvals').expect(200)).body.leaves.find((x: any) => x.id === r.id)).toBeUndefined();
    await app_('post', `/approvals/leave/${r.id}`, { decision: 'approve' }).expect(403);
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    expect((await row(hr, r.id)).status).toBe('APPROVED');
  });
});
