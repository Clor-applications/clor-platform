import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People plan 8 Nov 2026, step 2: one waiting number for Home, the rail
 * badge, the bell and the Inbox (approvals plus the reader's own open tasks),
 * and overtime reaching the step's approver whatever their role.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `wc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `WC Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
/** A colleague holding one of the company's stock roles, as an owner gives it on Users. */
async function withRole(boss: Ctx, label: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  const email = `wcr.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: label, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const pastTuesday = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
async function overtimeAsk(c: Ctx, employeeId: string) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  return runInTenant(c.orgId, () => peoplePrisma.overtimeRequest.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId, date: pastTuesday, kind: 'OVERTIME', minutes: 90, reason: 'Stock count' } }));
}
async function taskFor(c: Ctx, employeeId: string, ownerUserId: string, title: string) {
  const e = await runInTenant(c.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } }));
  return runInTenant(c.orgId, () => peoplePrisma.checklistTask.create({ data: { accountId: e.accountId, orgId: c.orgId, employeeId, kind: 'JOINING', title, owner: 'HR', ownerUserId, dueDate: '2026-12-01' } }));
}
const setChain = (c: Ctx, employeeId: string, v: string) =>
  runInTenant(c.orgId, async () => {
    const e = await peoplePrisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    await peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId: e.accountId, orgId: c.orgId, overtimeApproval: v, updatedByUserId: 'u' }, update: { overtimeApproval: v } });
  });

describe('one waiting count', () => {
  it('counts requests to approve plus the reader’s own open tasks, the same on Home and in the Inbox', async () => {
    const hr = await company();
    const casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const asha = await person(hr, { name: 'Asha', code: 'W1' });
    /* A new employee's joining plan already puts tasks on the owner's name: the count moves from there. */
    const before = (await ppl(hr, 'get', '/inbox/waiting').expect(200)).body;
    await att(hr, 'post', '/leave/requests', { employeeId: asha.id, leaveTypeId: casual.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Errand' }).expect(201);
    await taskFor(hr, asha.id, hr.userId, 'Collect the signed offer');
    const done = await taskFor(hr, asha.id, hr.userId, 'Order the laptop');
    await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.update({ where: { id: done.id }, data: { doneAt: new Date() } }));
    /* Somebody else's task does not count towards mine. */
    await taskFor(hr, asha.id, 'someone-else', 'Not mine');

    const count = (await ppl(hr, 'get', '/inbox/waiting').expect(200)).body;
    expect(count).toMatchObject({ waiting: before.waiting + 2, approvals: before.approvals + 1, tasks: before.tasks + 1 });
    expect(count.waiting).toBe(count.approvals + count.tasks);
    const inbox = (await ppl(hr, 'get', '/inbox').expect(200)).body;
    expect(inbox.counts).toMatchObject({ all: count.approvals, TASK: count.tasks, waiting: count.waiting });
    const titles = inbox.tasks.map((t: any) => t.title);
    expect(titles).toContain('Collect the signed offer');
    expect(titles).not.toContain('Order the laptop');
    expect(titles).not.toContain('Not mine');
    const home = (await ppl(hr, 'get', '/home').expect(200)).body;
    expect(home.waiting).toBe(count.waiting);
    expect(home.todos.find((t: any) => t.key === 'myTasks')).toMatchObject({ count: count.tasks, screen: 'approvals', params: { tab: 'tasks' } });
  });

  it('a Team Manager under a manager-first chain sees their report’s overtime and approves it, without the Records right', async () => {
    const hr = await company();
    const mgr = await withRole(hr, 'Team Manager');
    const lead = await person(hr, { name: 'Rahul Lead', code: 'TM-0' });
    const report = await person(hr, { name: 'Team Member', code: 'TM-1', reportingManagerId: lead.id });
    const outsider = await person(hr, { name: 'Not In Team', code: 'TM-2' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    await setChain(hr, lead.id, 'MANAGER');
    const mine = await overtimeAsk(hr, report.id);
    const theirs = await overtimeAsk(hr, outsider.id);

    /* The row is theirs by identity: it is in their inbox, counted, and HR's inbox leaves it alone while the manager decides. */
    const box = (await ppl(mgr, 'get', '/inbox').expect(200)).body;
    expect(box.items.filter((i: any) => i.kind === 'OVERTIME').map((i: any) => i.id)).toEqual([mine.id]);
    expect(box.items.find((i: any) => i.id === mine.id)).toMatchObject({ bulk: true, employeeName: 'Team Member' });
    expect(box.counts.OVERTIME).toBe(1);
    expect((await ppl(mgr, 'get', '/inbox/waiting').expect(200)).body.waiting).toBe(1);
    const hrBox = (await ppl(hr, 'get', '/inbox').expect(200)).body;
    expect(hrBox.items.map((i: any) => i.id)).toEqual([theirs.id]);

    /* Not theirs: the outsider's row is refused. Theirs: approved as the manager, from the inbox's bulk route. */
    const refused = (await att(mgr, 'post', '/overtime/requests/bulk-review', { ids: [theirs.id], approve: true }));
    expect(refused.status).toBe(403);
    const out = (await att(mgr, 'post', '/overtime/requests/bulk-review', { ids: [mine.id], approve: true }).expect(200)).body;
    expect(out).toMatchObject({ done: 1, failed: 0 });
    expect((await runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id: mine.id } }))).status).toBe('APPROVED');
    expect((await ppl(mgr, 'get', '/inbox').expect(200)).body.counts.OVERTIME).toBe(0);
  });

  it('under manager-then-HR the manager’s single decision hands the request on, and HR then sees it', async () => {
    const hr = await company();
    const mgr = await withRole(hr, 'Team Manager');
    const lead = await person(hr, { name: 'Lead Two', code: 'TM-3' });
    const report = await person(hr, { name: 'Member Two', code: 'TM-4', reportingManagerId: lead.id });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: mgr.userId } }));
    await setChain(hr, lead.id, 'MANAGER_THEN_HR');
    const r = await overtimeAsk(hr, report.id);
    expect((await ppl(hr, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toEqual([]);
    expect((await ppl(mgr, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toEqual([r.id]);
    const after = (await att(mgr, 'post', `/overtime/requests/${r.id}/approve`, {}).expect(200)).body.request;
    expect(after.status).toBe('PENDING');
    expect(after.managerApprovedAt).toBeTruthy();
    /* Handed on: no longer the manager's, now HR's. */
    expect((await ppl(mgr, 'get', '/inbox').expect(200)).body.items.map((i: any) => i.id)).toEqual([]);
    expect((await ppl(hr, 'get', '/inbox').expect(200)).body.items.find((i: any) => i.id === r.id)).toMatchObject({ managerApproved: true });
    await att(mgr, 'post', `/overtime/requests/${r.id}/approve`, {}).expect(403);
  });
});
