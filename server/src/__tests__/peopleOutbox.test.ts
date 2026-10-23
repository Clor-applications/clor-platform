import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The outbox (docs/people/02-PRD.md FND-05): an event is written with the
 * change, survives a crash before sending, carries the seven envelope
 * fields, and a consumer that sees it twice acts once.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { deliverOutbox, onPeopleEvent, RETRY_MINUTES } = await import('../services/people/outbox.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `box.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Box Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('the outbox', () => {
  it('a change writes its event in the same transaction, with the whole envelope', async () => {
    const dept = (await people(hr).post('/structure/departments', { name: 'Security' }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Imran Patil', code: 'B-1', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}`, { departmentId: dept.id, effectiveFrom: '2026-03-01' }).expect(200);
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findMany({ where: { employeeId: e.id }, orderBy: { occurredAt: 'asc' } }));
    expect(rows.map((r) => r.name)).toEqual(['people.employee.created.v1', 'people.employment.changed.v1', 'people.employee.updated.v1']);
    const changed = rows[1];
    expect(changed).toMatchObject({ orgId: hr.orgId, employeeId: e.id, deliveredAt: null, attempts: 0 });
    expect(changed.accountId).toBeTruthy();
    expect(changed.correlationId).toBeTruthy();
    expect(changed.payload).toMatchObject({ field: 'departmentId', before: null, after: dept.id, effectiveOn: '2026-03-01' });
  });

  it('is delivered after a restart, to every handler, once', async () => {
    const seen: string[] = [];
    const off = onPeopleEvent('people.employee.created.v1', async (ev) => {
      seen.push(ev.eventId);
      expect(ev).toMatchObject({ name: 'people.employee.created.v1', version: 1, orgId: hr.orgId });
      expect(Object.keys(ev).sort()).toEqual(['accountId', 'correlationId', 'data', 'employeeId', 'eventId', 'name', 'occurredAt', 'orgId', 'version']);
    });
    try {
      /* The process "died" before sending: the row is there, undelivered. */
      const e = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'B-2' }).expect(201)).body.employee;
      const before = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findFirstOrThrow({ where: { employeeId: e.id, name: 'people.employee.created.v1' } }));
      expect(before.deliveredAt).toBeNull();

      /* The shared test database holds other suites' events too: drain in big batches. */
      const first = await deliverOutbox(new Date(), 1000);
      expect(first.delivered).toBeGreaterThanOrEqual(1);
      const after = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findUniqueOrThrow({ where: { id: before.id } }));
      expect(after.deliveredAt).toBeTruthy();
      expect(seen.filter((id) => id === before.id)).toHaveLength(1);

      /* A second run finds nothing new for it. */
      await deliverOutbox(new Date(), 1000);
      expect(seen.filter((id) => id === before.id)).toHaveLength(1);
    } finally {
      off();
    }
  });

  it('a handler that fails is tried again later, backing off, and never blocks the others', async () => {
    let calls = 0;
    const off = onPeopleEvent('people.employee.updated.v1', async () => {
      calls += 1;
      throw new Error('consumer down');
    });
    try {
      const e = (await people(hr).post('/employees', { name: 'Nisha Das', code: 'B-3' }).expect(201)).body.employee;
      await people(hr).put(`/employees/${e.id}`, { city: 'Pune' }).expect(200);
      const now = new Date();
      const r = await deliverOutbox(now, 1000);
      expect(r.failed).toBeGreaterThanOrEqual(1);
      const row = await runInTenant(hr.orgId, () => peoplePrisma.outboxEvent.findFirstOrThrow({ where: { employeeId: e.id, name: 'people.employee.updated.v1' } }));
      expect(row.deliveredAt).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain('consumer down');
      expect(row.nextAttemptAt!.getTime() - now.getTime()).toBe(RETRY_MINUTES[0] * 60_000);
      /* Not due yet: left alone. */
      await deliverOutbox(now, 1000);
      expect(calls).toBe(1);
      /* Due: tried again. */
      await deliverOutbox(new Date(now.getTime() + 2 * 60_000), 1000);
      expect(calls).toBe(2);
    } finally {
      off();
    }
  });
});
