import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Joining plans with named owners (docs/people/02-PRD.md LIFE-02) and tasks
 * done from Home or from the e-mail link (LIFE-07): the IT task lands on the
 * named IT person, the manager's on the manager, each sees their own on
 * "my tasks", ticks it, and the tick is logged.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { taskDoneToken } = await import('../services/people/checklists.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
/* A joining two weeks from today in India's time: a due date before today is moved up to today (it was a fixed 2 Nov 2026). */
const day = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `plan.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Plan Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', email };
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
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  patch: (path: string, body: unknown) => request(app).patch(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
let itAdmin: Ctx;
let manager: Ctx;
let managerEmp: any;
let joiner: any;
beforeAll(async () => {
  hr = await owner();
  itAdmin = await colleague(hr, 'Imran', ['PEOPLE::Employees::VIEW', 'PEOPLE::Assets::VIEW', 'PEOPLE::Assets::EDIT']);
  manager = await colleague(hr, 'Ravi', ['PEOPLE::Employees::VIEW']);
  managerEmp = (await people(hr).post('/employees', { name: 'Ravi Kumar', code: 'P-1' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { userId: manager.userId } }));
  /* A company template with an IT task due the day before joining, a manager task on the day, and an HR one. */
  await request(app).put(`/api/orgs/${hr.orgId}/people/checklist-templates/JOINING`).set(at(hr)).send({ items: [
    { title: 'Laptop ready', owner: 'IT', dueDays: -1 },
    { title: 'Welcome and desk', owner: 'MANAGER', dueDays: 0 },
    { title: 'Collect ID proof', owner: 'HR', dueDays: 0 },
  ] }).expect(200);
}, 120_000);

describe('a joining plan with named owners', () => {
  it('each task lands on the named person for its role, with its due date from the joining date', async () => {
    joiner = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'P-2', dateOfJoining: day(14), reportingManagerId: managerEmp.id }).expect(201)).body.employee;
    const plan = (await people(hr).get(`/employees/${joiner.id}/checklist`).expect(200)).body.joining;
    const byTitle = Object.fromEntries(plan.tasks.map((t: any) => [t.title, t]));
    expect(byTitle['Laptop ready']).toMatchObject({ owner: 'IT', ownerName: 'Imran', dueDate: day(13) });
    expect(byTitle['Welcome and desk']).toMatchObject({ owner: 'MANAGER', ownerName: 'Ravi', dueDate: day(14) });
    expect(byTitle['Collect ID proof']).toMatchObject({ owner: 'HR', ownerName: 'Asha HR', dueDate: day(14) });
    /* Told: a bell for each owner, and an e-mail with the done link. */
    const bells = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, kind: 'people.task' } });
    expect(bells.map((b) => b.userId).sort()).toEqual([itAdmin.userId, manager.userId].sort());
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { orgId: hr.orgId, templateKey: 'people.task_assigned', toEmail: itAdmin.email } });
    expect(mail!.bodyText).toMatch(/\/api\/people\/task-links\//);
  });

  it('shows on the owner’s own list, overdue when late, and only to them; they tick it without the Employees grant', async () => {
    const mine = (await people(itAdmin).get('/tasks/mine').expect(200)).body.tasks;
    expect(mine.map((t: any) => t.title)).toEqual(['Laptop ready']);
    expect(mine[0].employee.name).toBe('Meera Shah');
    expect(mine[0].overdue).toBe(false);
    /* Push the date back: late now. */
    await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.update({ where: { id: mine[0].id }, data: { dueDate: '2026-01-01' } }));
    expect((await people(itAdmin).get('/tasks/mine').expect(200)).body.tasks[0].overdue).toBe(true);
    expect((await people(manager).get('/tasks/mine').expect(200)).body.tasks.map((t: any) => t.title)).toEqual(['Welcome and desk']);
    /* Imran may tick his own task, not Ravi's. */
    const ravis = (await people(manager).get('/tasks/mine').expect(200)).body.tasks[0];
    await people(itAdmin).patch(`/checklist-tasks/${ravis.id}`, { done: true }).expect(403);
    const after = (await people(itAdmin).patch(`/checklist-tasks/${mine[0].id}`, { done: true }).expect(200)).body.joining;
    expect(after.tasks.find((t: any) => t.title === 'Laptop ready')).toMatchObject({ done: true, doneBy: 'Imran' });
    /* Ticking his own task does not show him the rest of Meera's plan. */
    expect(after.tasks.map((t: any) => t.title)).toEqual(['Laptop ready']);
    expect(after.total).toBe(1);
    const log = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { entity: 'ChecklistTask', entityId: mine[0].id } }));
    expect(log).toEqual([expect.objectContaining({ field: 'done', before: 'no', after: 'yes', actorUserId: itAdmin.userId })]);
    /* Only HR may give it to someone else. */
    await people(itAdmin).patch(`/checklist-tasks/${ravis.id}`, { ownerUserId: itAdmin.userId }).expect(403);
    await people(hr).patch(`/checklist-tasks/${ravis.id}`, { ownerUserId: itAdmin.userId }).expect(200);
    expect((await people(itAdmin).get('/tasks/mine').expect(200)).body.tasks.map((t: any) => t.title).sort()).toEqual(['Laptop ready', 'Welcome and desk']);
  });

  it('the e-mail link ticks the task once, only for its owner, by its button, and is logged', async () => {
    const task = await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.findFirstOrThrow({ where: { employeeId: joiner.id, title: 'Collect ID proof' } }));
    const link = `/api/people/task-links/${taskDoneToken(task)}`;
    const wrong = `/api/people/task-links/${taskDoneToken({ ...task, ownerUserId: itAdmin.userId })}`;
    expect((await request(app).get(wrong).expect(403)).text).toMatch(/not yours/);
    /* Opening the link (a mail scanner, a preview) changes nothing; the button does (JCL-A10). */
    expect((await request(app).get(link).expect(200)).text).toMatch(/Mark done/);
    expect((await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.findUniqueOrThrow({ where: { id: task.id } }))).doneAt).toBeNull();
    expect((await request(app).post(wrong).expect(403)).text).toMatch(/not yours/);
    expect((await request(app).post(link).expect(200)).text).toMatch(/is ticked/);
    expect((await request(app).post(link).expect(200)).text).toMatch(/Already done/);
    expect((await request(app).get(link).expect(200)).text).toMatch(/Already done/);
    expect((await request(app).get('/api/people/task-links/not-a-token').expect(400)).text).toMatch(/does not work/);
    const row = await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.findUniqueOrThrow({ where: { id: task.id } }));
    expect(row.doneByUserId).toBe(hr.userId);
    const log = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { entity: 'ChecklistTask', entityId: task.id, field: 'done' } }));
    expect(log).toMatchObject({ after: 'yes', actorUserId: hr.userId, source: 'API' });
  });
});
