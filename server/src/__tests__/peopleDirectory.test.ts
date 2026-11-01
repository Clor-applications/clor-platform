import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Directory (docs/people/02-PRD.md CORE-01): 2,000 people reachable;
 * a bulk department change writes a change-log line for each under one
 * correlation id; refused under a job-change rule; saved views are own or
 * shared, and only the maker changes a shared one.
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
async function owner(): Promise<Ctx> {
  const email = `dir.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Directory Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});

let boss: Ctx;
beforeAll(async () => {
  boss = await owner();
}, 120_000);

describe('directory (CORE-01)', () => {
  it('reaches 2,000 people, and a bulk department change writes one change per person under one correlation id', async () => {
    const ops = (await people(boss).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    const sales = (await people(boss).post('/structure/departments', { name: 'Sales' }).expect(201)).body.item;
    const accountId = (await runInTenant(boss.orgId, () => peoplePrisma.department.findUniqueOrThrow({ where: { id: ops.id } }))).accountId;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.createMany({ data: Array.from({ length: 2000 }, (_, i) => ({ accountId, orgId: boss.orgId, name: `Person ${i + 1}`, code: `D-${String(i + 1).padStart(4, '0')}`, status: 'ACTIVE', departmentId: ops.id, department: 'Operations', createdByUserId: boss.userId })) as any }));
    let seen = 0;
    let total = 0;
    do {
      const page = (await people(boss).get(`/employees?limit=500&offset=${seen}`).expect(200)).body;
      total = page.total;
      seen += page.employees.length;
      if (!page.employees.length) break;
    } while (seen < total);
    expect(total).toBe(2000);
    expect(seen).toBe(2000);
    const ids = (await runInTenant(boss.orgId, () => peoplePrisma.employee.findMany({ where: { orgId: boss.orgId }, select: { id: true } }))).map((e) => e.id);

    const started = Date.now();
    const done = (await people(boss).post('/employees/bulk', { ids, set: { departmentId: sales.id }, reason: 'Ops folded into Sales' }).expect(200)).body;
    const took = Date.now() - started;
    expect(done).toMatchObject({ asked: 2000, changed: 2000, notFound: 0 });
    const lines = await runInTenant(boss.orgId, () => peoplePrisma.changeLog.findMany({ where: { orgId: boss.orgId, correlationId: done.correlationId, field: 'departmentId' }, select: { entityId: true, source: true, reason: true } }));
    expect(new Set(lines.map((l) => l.entityId)).size).toBe(2000);
    expect(lines.every((l) => l.source === 'BULK' && l.reason === 'Ops folded into Sales')).toBe(true);
    expect(await runInTenant(boss.orgId, () => peoplePrisma.employee.count({ where: { orgId: boss.orgId, department: 'Sales' } }))).toBe(2000);
    console.log(`[bulk] 2000 people in ${took} ms`);

    await people(boss).post('/employees/bulk', { ids, set: { status: 'LEFT' } }).expect(400);
    await people(boss).post('/employees/bulk', { ids: ids.concat(['x']).concat(Array.from({ length: 1 }, () => 'y')), set: { departmentId: ops.id } }).expect(400);
    const viewer = await colleague(boss, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).post('/employees/bulk', { ids: ids.slice(0, 2), set: { departmentId: ops.id } }).expect(403);
    const someone = await colleague(boss, 'Head', []);
    await people(boss).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'USER', id: someone.userId }, dueDays: 3 }] }).expect(201);
    expect((await people(boss).post('/employees/bulk', { ids: ids.slice(0, 2), set: { departmentId: ops.id } }).expect(409)).body.code).toBe('RULE_IN_FORCE');
    /* 2,000 events from this company would crowd the shared outbox for later test files; they are not under test here. */
    await runInTenant(boss.orgId, () => peoplePrisma.outboxEvent.updateMany({ where: { orgId: boss.orgId, deliveredAt: null }, data: { deliveredAt: new Date() } }));
  }, 600_000);

  it('a bulk manager change skips anyone it would put in a reporting loop', async () => {
    /* Its own company: the test above leaves a job-change rule in force. */
    const own = await owner();
    const top = (await people(own).post('/employees', { name: 'Loop Top', code: 'L-1' }).expect(201)).body.employee;
    const mid = (await people(own).post('/employees', { name: 'Loop Mid', code: 'L-2', reportingManagerId: top.id }).expect(201)).body.employee;
    const low = (await people(own).post('/employees', { name: 'Loop Low', code: 'L-3', reportingManagerId: mid.id }).expect(201)).body.employee;
    const other = (await people(own).post('/employees', { name: 'Loop Other', code: 'L-4' }).expect(201)).body.employee;
    const r = (await people(own).post('/employees/bulk', { ids: [top.id, other.id], set: { reportingManagerId: low.id } }).expect(200)).body;
    expect(r.changed).toBe(1);
    expect(r.skipped).toEqual([expect.objectContaining({ id: top.id, why: 'would make a reporting loop' })]);
  });

  it('saved views are the maker\'s own unless shared; only the maker changes a shared one', async () => {
    const a = await colleague(boss, 'Asha', ['PEOPLE::Employees::VIEW']);
    const b = await colleague(boss, 'Bala', ['PEOPLE::Employees::VIEW']);
    await people(a).post('/saved-views', { screen: 'nope', name: 'x', filters: {} }).expect(400);
    const mine = (await people(a).post('/saved-views', { screen: 'employees', name: 'Sales on notice', filters: { status: 'ON_NOTICE', departmentId: 'd1', 'bad key': 'x' } }).expect(201)).body.view;
    expect(mine.filters).toEqual({ status: 'ON_NOTICE', departmentId: 'd1' });
    const shared = (await people(a).post('/saved-views', { screen: 'employees', name: 'Everyone in Pune', filters: { establishmentId: 'e1' }, shared: true }).expect(201)).body.view;
    const forB = (await people(b).get('/saved-views?screen=employees').expect(200)).body.views;
    expect(forB.map((v: any) => [v.name, v.mine])).toEqual([['Everyone in Pune', false]]);
    await people(b).post('/saved-views', { id: shared.id, name: 'Mine now' }).expect(403);
    await people(b).del(`/saved-views/${shared.id}`).expect(403);
    await people(b).del(`/saved-views/${mine.id}`).expect(404);
    await people(a).del(`/saved-views/${mine.id}`).expect(200);
  });

  it('bulk moves location and hours; a department is never cleared in bulk (Workforce audit O20)', async () => {
    /* A company of its own: the one above has a job-change rule, which rightly stops bulk job moves. */
    const boss = await owner();
    const area = (await people(boss).post('/structure/areas', { name: `Bulk area ${Date.now()}` }).expect(201)).body.item;
    const a = (await people(boss).post('/employees', { name: 'Bulk One', code: `BK-${Date.now()}-1` }).expect(201)).body.employee;
    const b = (await people(boss).post('/employees', { name: 'Bulk Two', code: `BK-${Date.now()}-2` }).expect(201)).body.employee;
    await people(boss).post('/employees/bulk', { ids: [a.id, b.id], set: { areaId: area.id } }).expect(200);
    await people(boss).post('/employees/bulk', { ids: [a.id, b.id], set: { hours: 'PART_TIME' } }).expect(200);
    const after = (await people(boss).get(`/employees/${a.id}`).expect(200)).body.employee;
    expect(after).toMatchObject({ areaId: area.id, hours: 'PART_TIME' });
    await people(boss).post('/employees/bulk', { ids: [a.id], set: { hours: 'SOMETIMES' } }).expect(400);
    await people(boss).post('/employees/bulk', { ids: [a.id], set: { departmentId: null } }).expect(400);
  });

  it('a dated bulk move waits for its day on each record; hours change from today only (Workforce audit O20)', async () => {
    const boss = await owner();
    const area = (await people(boss).post('/structure/areas', { name: `Later area ${Date.now()}` }).expect(201)).body.item;
    const a = (await people(boss).post('/employees', { name: 'Later One', code: `LT-${Date.now()}-1` }).expect(201)).body.employee;
    const b = (await people(boss).post('/employees', { name: 'Later Two', code: `LT-${Date.now()}-2` }).expect(201)).body.employee;
    const day = new Date(Date.now() + 330 * 60_000 + 10 * 86_400_000).toISOString().slice(0, 10);
    const r = (await people(boss).post('/employees/bulk', { ids: [a.id, b.id], set: { areaId: area.id }, effectiveFrom: day }).expect(200)).body;
    expect(r).toMatchObject({ scheduled: 2, changed: 0, effectiveFrom: day });
    const rec = (await people(boss).get(`/employees/${a.id}`).expect(200)).body;
    expect(rec.employee.areaId).toBeNull();
    expect(rec.scheduledChanges).toEqual([expect.objectContaining({ field: 'areaId', toValue: area.id, effectiveOn: day })]);
    await people(boss).post('/employees/bulk', { ids: [a.id], set: { hours: 'PART_TIME' }, effectiveFrom: day }).expect(400);
    await people(boss).post('/employees/bulk', { ids: [a.id], set: { areaId: area.id }, effectiveFrom: '2026-02-31' }).expect(400);
  });
});
