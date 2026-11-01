import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A Team Manager's joining and leaving tasks (QA, manager persona, 1 Nov 2026):
 * Home's "Joining and leaving tasks" tile counted the whole company's tasks,
 * so Rahul saw a figure for people he does not manage. The tile, and the
 * Joining & leaving task queue, hold to his team.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
/* India's date, as the server counts it; joining in a few days keeps every step due this week, whatever today is. */
const day = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});

async function owner(): Promise<Ctx> {
  const email = `tm.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Team Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function teamManager(boss: Ctx): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === 'Team Manager');
  const email = `rahul.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Rahul Lead', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}

describe('a Team Manager’s joining and leaving tasks', () => {
  it('Home’s tile and the task queue count his team only; HR still sees the company', async () => {
    const boss = await owner();
    const rahul = await teamManager(boss);
    const lead = (await people(boss).post('/employees', { name: 'Rahul Lead', code: 'TM-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: rahul.userId } }));
    const mine = (await people(boss).post('/employees', { name: 'Priya Report', code: 'TM-2', dateOfJoining: day(3), reportingManagerId: lead.id }).expect(201)).body.employee;
    const other = (await people(boss).post('/employees', { name: 'Arjun Other', code: 'TM-3', dateOfJoining: day(3) }).expect(201)).body.employee;

    const open = await runInTenant(boss.orgId, () => peoplePrisma.checklistTask.findMany({ where: { orgId: boss.orgId, doneAt: null }, select: { employeeId: true, dueDate: true } }));
    const week = day(7);
    const dueOf = (id: string) => open.filter((t) => t.employeeId === id && t.dueDate && t.dueDate <= week).length;
    expect(dueOf(mine.id)).toBeGreaterThan(0);
    expect(dueOf(other.id)).toBeGreaterThan(0);

    /* His team is himself and whoever reports to him (scope.ts). */
    const team = new Set([lead.id, mine.id]);
    const teamDue = dueOf(lead.id) + dueOf(mine.id);

    /* The queue (a route open to anyone signed in, so no permission check has set the scope yet): his team's tasks, nobody else's. */
    const queue = (await people(rahul).get('/lifecycle/tasks?view=open&limit=100').expect(200)).body;
    expect(queue.rows.some((t: any) => t.employee.id === mine.id)).toBe(true);
    expect(queue.rows.every((t: any) => team.has(t.employee.id))).toBe(true);
    expect(queue.counts.open).toBe(open.filter((t) => team.has(t.employeeId)).length);

    /* Home's tile: his team's count, not the company's. */
    const tile = (await people(rahul).get('/home').expect(200)).body.todos.find((t: any) => t.key === 'checklists');
    expect(tile?.count).toBe(teamDue);

    /* HR (the owner) still counts everyone. */
    const all = (await people(boss).get('/home').expect(200)).body.todos.find((t: any) => t.key === 'checklists');
    expect(all.count).toBe(teamDue + dueOf(other.id));
  }, 60_000);
});
