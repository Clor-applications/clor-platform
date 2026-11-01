import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Health check (docs/people/02-PRD.md HLTH-01..04): the new items, a reason
 * on every item, snooze with a reason and a date (logged, returns on its
 * date), and headcount and movements that agree with the change log.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `hlth.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Health Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('health check', () => {
  it('lists people without a manager, late plan tasks and changes waiting; every item says why; a snooze takes it aside until its date, logged', async () => {
    const boss = (await people(hr).post('/employees', { name: 'Imran Patil', code: 'H-1', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const a = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'H-2', dateOfJoining: '2025-01-05', reportingManagerId: boss.id }).expect(201)).body.employee;
    const b = (await people(hr).post('/employees', { name: 'Ravi Das', code: 'H-3', dateOfJoining: plus(-40) }).expect(201)).body.employee;
    const dept = (await people(hr).post('/structure/departments', { name: 'Design' }).expect(201)).body.item;
    await people(hr).put(`/employees/${a.id}`, { departmentId: dept.id, effectiveFrom: plus(30) }).expect(200);
    /* A plan is never late on the day it is made (checklists.ts); one of Ravi's tasks has since gone past its date. */
    await runInTenant(hr.orgId, () => peoplePrisma.checklistTask.updateMany({ where: { orgId: hr.orgId, employeeId: b.id, kind: 'JOINING', sortOrder: 0 }, data: { dueDate: plus(-5) } }));

    const health = (await people(hr).get('/data-health').expect(200)).body;
    const ids = health.checks.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['no-manager', 'overdue-tasks', 'scheduled']));
    /* The top of the tree has no manager and is not listed; Ravi is. */
    expect(health.checks.find((c: any) => c.id === 'no-manager').people.map((p: any) => p.name)).toEqual(['Ravi Das']);
    expect(health.checks.find((c: any) => c.id === 'overdue-tasks').people.map((p: any) => p.name)).toContain('Ravi Das');
    expect(health.checks.find((c: any) => c.id === 'scheduled').people[0]).toMatchObject({ name: 'Kavya Reddy', detail: expect.stringContaining(plus(30)) });
    /* HLTH-02: no item without a reason or a fix. */
    for (const c of health.checks) {
      expect(c.why.length, c.id).toBeGreaterThan(20);
      expect(c.fix.length, c.id).toBeGreaterThan(5);
    }

    /* HLTH-03: snooze needs a reason and a date after today, six months at most. */
    await people(hr).post('/data-health/no-manager/snooze', { until: plus(10) }).expect(400);
    await people(hr).post('/data-health/no-manager/snooze', { reason: 'Hiring a lead', until: plus(-1) }).expect(400);
    await people(hr).post('/data-health/no-manager/snooze', { reason: 'Hiring a lead', until: plus(400) }).expect(400);
    await people(hr).post('/data-health/no-manager/snooze', { reason: 'A team lead joins next month', until: plus(10) }).expect(201);
    const after = (await people(hr).get('/data-health').expect(200)).body;
    expect(after.checks.map((c: any) => c.id)).not.toContain('no-manager');
    expect(after.snoozed).toEqual([expect.objectContaining({ id: 'no-manager', snooze: expect.objectContaining({ reason: 'A team lead joins next month', until: plus(10) }) })]);
    const line = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findFirst({ where: { orgId: hr.orgId, entity: 'HealthCheck', entityId: 'no-manager' } }));
    expect(line?.after).toBe(`until ${plus(10)}: A team lead joins next month`);
    /* It comes back on its date. */
    await runInTenant(hr.orgId, () => peoplePrisma.healthSnooze.updateMany({ where: { orgId: hr.orgId, checkId: 'no-manager' }, data: { until: plus(0) } }));
    expect((await people(hr).get('/data-health').expect(200)).body.checks.map((c: any) => c.id)).toContain('no-manager');
    /* And can be ended early, logged. */
    await people(hr).post('/data-health/scheduled/snooze', { reason: 'Known', until: plus(5) }).expect(201);
    expect((await people(hr).del('/data-health/scheduled/snooze').expect(200)).body.ended).toBe(1);
    expect((await people(hr).get('/data-health').expect(200)).body.checks.map((c: any) => c.id)).toContain('scheduled');
    expect((await people(hr).get('/data-health/snoozes').expect(200)).body.snoozes.length).toBeGreaterThanOrEqual(2);
  });

  it('headcount as of a day and movements by month and establishment agree with the stints and the history (HLTH-04)', async () => {
    const c = await owner();
    const entity = (await people(c).post('/structure/legal-entities', { name: 'HC Co' }).expect(201)).body.item;
    const blr = (await people(c).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const pune = (await people(c).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id }).expect(201)).body.item;
    await people(c).post('/employees', { name: 'One', code: 'M-1', dateOfJoining: '2026-03-10', establishmentId: blr.id }).expect(201);
    const two = (await people(c).post('/employees', { name: 'Two', code: 'M-2', dateOfJoining: '2026-03-20', establishmentId: blr.id }).expect(201)).body.employee;
    const three = (await people(c).post('/employees', { name: 'Three', code: 'M-3', dateOfJoining: '2026-05-02', establishmentId: pune.id }).expect(201)).body.employee;
    await people(c).post(`/employees/${three.id}/resign`, { lastDay: '2026-06-30', leavingType: 'RESIGNED' }).expect(200);
    await people(c).put(`/employees/${two.id}`, { establishmentId: pune.id, effectiveFrom: '2026-07-01' }).expect(200);

    const r = (await people(c).get('/headcount?from=2026-03-01&to=2026-07-31&asOf=2026-06-15').expect(200)).body;
    expect(r.headcount).toBe(3);
    expect(r.byEstablishment).toEqual({ 'Bengaluru office (Karnataka)': 2, 'Pune shop (Maharashtra)': 1 });
    const m = (k: string) => r.months.find((x: any) => x.month === k);
    expect(m('2026-03')).toMatchObject({ joiners: 2, leavers: 0, transfers: 0, headcountAtEnd: 2 });
    expect(m('2026-05')).toMatchObject({ joiners: 1, headcountAtEnd: 3 });
    /* Their last day is 30 June: they still count on it, as "as of" does; July starts without them. */
    expect(m('2026-06')).toMatchObject({ leavers: 1, headcountAtEnd: 3 });
    expect(m('2026-07')).toMatchObject({ transfers: 1, transfersIn: { 'Pune shop (Maharashtra)': 1 }, transfersOut: { 'Bengaluru office (Karnataka)': 1 }, headcountAtEnd: 2 });
    /* Attrition (gap 21): leavers over the month's average headcount; the range's over the mean of the months. */
    expect(m('2026-03')).toMatchObject({ headcountAtStart: 0, averageHeadcount: 1, attritionPct: 0 });
    expect(m('2026-06')).toMatchObject({ headcountAtStart: 3, headcountAtEnd: 3, attritionPct: 33.3, leaversByReason: { RESIGNED: 1 } });
    expect(m('2026-07')).toMatchObject({ headcountAtStart: 2, leavers: 0, attritionPct: 0 });
    expect(r.totals).toMatchObject({ joiners: 3, leavers: 1, transfers: 1, headcountAtStart: 0, headcountAtEnd: 2, averageHeadcount: 2.1, attritionPct: 47.6 });
    /* Before anyone joined there is nothing to measure against: no figure, not 0%. */
    expect((await people(c).get('/headcount?from=2026-01-01&to=2026-02-28').expect(200)).body.months[0]).toMatchObject({ headcountAtStart: 0, headcountAtEnd: 0, attritionPct: null });
    /* As of after the transfer, Two counts in Pune. */
    const later = (await people(c).get('/headcount?asOf=2026-07-15').expect(200)).body;
    expect(later.byEstablishment).toEqual({ 'Bengaluru office (Karnataka)': 1, 'Pune shop (Maharashtra)': 1 });
    await people(c).get('/headcount?from=2026-08-01&to=2026-01-01').expect(400);
  });
});
