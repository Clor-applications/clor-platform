import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The approval engine (docs/people/02-PRD.md APR-01..07): rules with
 * versions and conditions, who decides, self skipped, stand-ins, due times
 * with reminders and hand-on, double submits, and what approval does.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { runApprovalDues } = await import('../services/people/approvals/engine.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `apr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Apr Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
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
const people = (c: Ctx, extra: Record<string, string> = {}) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }).send(body as any),
});
const MANAGER_PERMS = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx;
let manager: Ctx;
let head: Ctx;
let managerEmp: any;
let meera: any;
let design: any;
let security: any;
let g2: any;
let g3: any;
beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, 'Ravi', MANAGER_PERMS);
  head = await colleague(hr, 'Priya', MANAGER_PERMS);
  design = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
  security = (await people(hr).post('/structure/departments', { name: 'Security' }).expect(201)).body.item;
  g2 = (await people(hr).post('/structure/grades', { name: 'G2' }).expect(201)).body.item;
  g3 = (await people(hr).post('/structure/grades', { name: 'G3' }).expect(201)).body.item;
  managerEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'A-1' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { userId: manager.userId } }));
  meera = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'A-2', departmentId: design.id, gradeId: g2.id, reportingManagerId: managerEmp.id }).expect(201)).body.employee;
  /* Promotions: the manager, then the HR head only when the grade changes; 2 working days each; overdue hands on to HR. */
  await people(hr).post('/approval-rules', {
    requestType: 'JOB_CHANGE', name: 'Job changes',
    steps: [
      { approver: { kind: 'MANAGER' }, dueDays: 2, overdue: { action: 'HAND_ON', to: { kind: 'HR' } } },
      { approver: { kind: 'USER', id: head.userId }, condition: { field: 'gradeId', op: 'changed' }, dueDays: 2 },
    ],
  }).expect(201);
}, 120_000);

describe('the approval engine', () => {
  it('a job change on the form becomes a request; a grade change adds the second step, a plain move does not', async () => {
    const r1 = await people(hr).put(`/employees/${meera.id}`, { departmentId: security.id, changeNote: 'Night team' }).expect(200);
    expect(r1.body.request).toMatchObject({ requestType: 'JOB_CHANGE', status: 'WAITING', currentStep: 1, ruleVersion: 1 });
    expect(r1.body.employee.department).toBe('Design');
    expect(r1.body.request.steps.map((s: any) => s.status)).toEqual(['WAITING']);

    const r2 = await people(hr).put(`/employees/${meera.id}`, { gradeId: g3.id, changeNote: 'Promotion' }).expect(200);
    expect(r2.body.request.steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'WAITING']]);
    /* The second step opens only after the first is approved; its condition is read then. */
    const approved = (await people(manager).post(`/requests/${r2.body.request.id}/approve`, {}).expect(200)).body.request;
    expect(approved.status).toBe('WAITING');
    expect(approved.currentStep).toBe(2);
    expect(approved.steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'APPROVED'], [2, 'WAITING']]);
    expect(approved.steps[1].candidates).toEqual(['Priya']);

    const done = (await people(head).post(`/requests/${r2.body.request.id}/approve`, { comment: 'Well earned' })).body;
    expect(done.request.status).toBe('APPROVED');
    expect(done.outcome).toMatchObject({ applied: expect.arrayContaining(['gradeId']) });
    const row = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: meera.id } }));
    expect(row.gradeId).toBe(g3.id);
    expect(row.departmentId).toBe(design.id);
    const lines = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId: meera.id, field: 'gradeId' } }));
    expect(lines).toEqual([expect.objectContaining({ before: g2.id, after: g3.id, source: 'APPROVAL', requestId: r2.body.request.id, reason: 'Promotion' })]);

    /* The same notices by email, beside the bell: the approver hears it is waiting, the requester hears the outcome. */
    const mail = (userId: string, templateKey: string) =>
      platformPrisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }).then((u) =>
        platformPrisma.emailOutbox.count({ where: { toEmail: u.email, templateKey, relatedType: 'ApprovalRequest', relatedId: r2.body.request.id } }));
    expect(await mail(manager.userId, 'people.approval_waiting')).toBe(1);
    expect(await mail(head.userId, 'people.approval_waiting')).toBe(1);
    expect(await mail(hr.userId, 'people.approval_decided')).toBe(1);

    /* The plain move: the manager alone, and done. */
    const moved = (await people(manager).post(`/requests/${r1.body.request.id}/approve`, {}).expect(200)).body;
    expect(moved.request.status).toBe('APPROVED');
    expect(moved.request.steps.map((s: any) => s.status)).toEqual(['APPROVED', 'SKIPPED']);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: meera.id } }))).departmentId).toBe(security.id);
  });

  it('only a named approver decides; nobody decides their own request; a decision is one decision', async () => {
    const r = (await people(hr).put(`/employees/${meera.id}`, { departmentId: design.id }).expect(200)).body.request;
    await people(head).post(`/requests/${r.id}/approve`, {}).expect(403);
    await people(hr).post(`/requests/${r.id}/approve`, {}).expect(403);
    await people(manager).post(`/requests/${r.id}/reject`, {}).expect(400);
    const rejected = (await people(manager).post(`/requests/${r.id}/reject`, { comment: 'Not now' }).expect(200)).body.request;
    expect(rejected.status).toBe('REJECTED');
    await people(manager).post(`/requests/${r.id}/approve`, {}).expect(409);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: meera.id } }))).departmentId).toBe(security.id);
  });

  it('a request the requester would decide skips their step; asking for more goes back to the requester', async () => {
    /* Ravi edits his own report: he is the manager, so step 1 is skipped and the grade step goes to Priya. */
    const r = (await people(manager).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: meera.id, title: 'Grade for Meera', payload: { employeeId: meera.id, fields: { gradeId: { before: g3.id, after: g2.id } }, reason: 'Correction' } }).expect(201)).body.request;
    expect(r.steps.map((s: any) => [s.order, s.status])).toEqual([[1, 'SKIPPED'], [2, 'WAITING']]);
    const asked = (await people(head).post(`/requests/${r.id}/more-info`, { comment: 'Why down a grade?' }).expect(200)).body.request;
    expect(asked.status).toBe('MORE_INFO');
    await people(head).post(`/requests/${r.id}/reply`, { note: 'x' }).expect(403);
    const back = (await people(manager).post(`/requests/${r.id}/reply`, { note: 'Entered wrong at joining' }).expect(200)).body.request;
    expect(back.status).toBe('WAITING');
    expect(back.steps.filter((s: any) => s.order === 2).map((s: any) => s.status)).toEqual(['MORE_INFO', 'WAITING']);
    const withdrawn = (await people(manager).post(`/requests/${r.id}/withdraw`, {}).expect(200)).body.request;
    expect(withdrawn.status).toBe('WITHDRAWN');
  });

  it('a stand-in decides in the approver’s place on the dates named', async () => {
    const stand = await colleague(hr, 'Sana', MANAGER_PERMS);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await people(manager).post('/stand-ins', { standInUserId: stand.userId, fromDate: today, toDate: today }).expect(201);
    const r = (await people(hr).put(`/employees/${meera.id}`, { departmentId: design.id }).expect(200)).body.request;
    expect(r.steps[0].candidates.sort()).toEqual(['Ravi', 'Sana']);
    const ok = (await people(stand).post(`/requests/${r.id}/approve`, { comment: 'Standing in' }).expect(200)).body.request;
    expect(ok.status).toBe('APPROVED');
    expect(ok.steps[0]).toMatchObject({ decidedBy: 'Sana', standInFor: 'Ravi' });
  });

  it('two submits with the same key are one request; the list for me is sorted by due date with overdue marked', async () => {
    const key = `k-${rnd()}`;
    const a = await people(hr, { 'Idempotency-Key': key }).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: meera.id, title: 'Twice', payload: { employeeId: meera.id, fields: { departmentId: { before: design.id, after: security.id } } } }).expect(201);
    const b = await people(hr, { 'Idempotency-Key': key }).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: meera.id, title: 'Twice', payload: { employeeId: meera.id, fields: { departmentId: { before: design.id, after: security.id } } } }).expect(200);
    expect(b.body.existed).toBe(true);
    expect(b.body.request.id).toBe(a.body.request.id);
    const list = (await people(manager).get('/requests').expect(200)).body;
    expect(list.waitingForMe.map((r: any) => r.id)).toContain(a.body.request.id);
    const dues = list.waitingForMe.map((r: any) => new Date(r.dueAt).getTime());
    expect([...dues].sort((x, y) => x - y)).toEqual(dues);
    expect(list.waitingForMe.every((r: any) => r.overdue === false)).toBe(true);
  });

  it('an overdue step is reminded, then handed on to the fallback a day later', async () => {
    /* Asked by Priya, so HR (Asha) is free to take it when it is handed on; the requester never decides. */
    /* A different field from the request still waiting above: two job changes on one field cannot wait side by side (Workforce final audit W11). */
    const r = (await people(head).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: meera.id, title: 'Late', payload: { employeeId: meera.id, fields: { gradeId: { before: null, after: null } } } }).expect(201)).body.request;
    const step = await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.findFirstOrThrow({ where: { requestId: r.id, status: 'WAITING' } }));
    const past = new Date(step.dueAt.getTime() + 3_600_000);
    const first = await runApprovalDues(past);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.approvalStep.findUniqueOrThrow({ where: { id: step.id } }))).remindedAt).toBeTruthy();
    /* Same hour again: nothing more. */
    const again = await runApprovalDues(past);
    expect(again.handedOn).toBe(0);
    /* A day later: handed on to HR. */
    const later = await runApprovalDues(new Date(past.getTime() + 25 * 3_600_000));
    expect(later.handedOn).toBeGreaterThanOrEqual(1);
    const shaped = (await people(hr).get(`/requests/${r.id}`).expect(200)).body.request;
    expect(shaped.steps.filter((s: any) => s.order === 1).map((s: any) => s.status)).toEqual(['HANDED_ON', 'WAITING']);
    expect(shaped.steps[1].candidates).toContain('Asha HR');
    const reminders = await platformPrisma.notification.count({ where: { orgId: hr.orgId, title: { startsWith: 'Overdue: Late' } } });
    expect(reminders).toBeGreaterThanOrEqual(1);
  });

  it('a second job change on a field already waiting is refused (Workforce final audit W11)', async () => {
    const clash = await people(head).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: meera.id, title: 'Clash', payload: { employeeId: meera.id, fields: { departmentId: { before: security.id, after: design.id } } } });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('REQUEST_WAITING');
  });

  it('rules are versioned and a request keeps its version', async () => {
    const before = (await people(hr).get('/approval-rules').expect(200)).body.rules.filter((x: any) => x.requestType === 'JOB_CHANGE');
    expect(before.map((x: any) => [x.version, x.active])).toEqual([[1, true]]);
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes v2', steps: [{ approver: { kind: 'HR' }, dueDays: 1 }] }).expect(201);
    const after = (await people(hr).get('/approval-rules').expect(200)).body.rules.filter((x: any) => x.requestType === 'JOB_CHANGE');
    expect(after.map((x: any) => [x.version, x.active])).toEqual([[2, true], [1, false]]);
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Bad', steps: [{ approver: { kind: 'NOBODY' }, dueDays: 1 }] }).expect(400);
    const old = (await people(head).get('/requests').expect(200)).body.mine.find((x: any) => x.title === 'Late');
    expect(old.ruleVersion).toBe(1);
  });
});
