import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Shift change requests (owner, 29 Oct 2026, from ERPNext's Shift Request):
 * a person asks to work another shift for some days. Approved, it is a
 * temporary schedule, which wins over every other schedule; cancelled, the
 * schedule goes and the days have their old shift again.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { shiftFor } = await import('../services/attendance/days.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const from = plus(today, 10);
const to = plus(today, 16);

describe('shift change requests', () => {
  let hr: Ctx;
  let emp: any;
  let night: any;
  beforeAll(async () => {
    const email = `scr.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SCR Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
    emp = (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name: 'Shift Shanti', code: 'S1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    night = (await att(hr, 'post', '/shifts', { name: `Late ${rnd()}`, startTime: '14:00', endTime: '22:00' }).expect(201)).body.shift;
  }, 120_000);

  it('is off until the company switches it on', async () => {
    const off = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: from, toDate: to, shiftId: night.id, reason: 'Project' }).expect(400);
    expect(off.body.code).toBe('KIND_OFF');
    await att(hr, 'put', '/request-rules', { SHIFT_CHANGE: { on: true } }).expect(200);
  });

  it('needs a shift, one in use, and one that changes something', async () => {
    const none = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: from, toDate: to, reason: 'Project' }).expect(400);
    expect(none.body.error).toMatch(/Choose the shift/);
    const wrong = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: from, toDate: to, shiftId: 'nope', reason: 'Project' }).expect(400);
    expect(wrong.body.error).toMatch(/not in use/);
    const long = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: from, toDate: plus(from, 40), shiftId: night.id, reason: 'Project' }).expect(400);
    expect(long.body.error).toMatch(/31 days/);
  });

  it('approved, the days run on the asked shift; cancelled, they go back', async () => {
    const before = await runInTenant(hr.orgId, () => shiftFor(hr.orgId, emp.id, from));
    expect(before.shiftId).not.toBe(night.id);
    const asked = (await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: from, toDate: to, shiftId: night.id, reason: 'Project cover' }).expect(201)).body.request;
    expect(asked.shiftId).toBe(night.id);
    /* A second one over the same days is refused while the first is open. */
    const twice = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: plus(from, 2), shiftId: night.id, reason: 'Again' }).expect(409);
    expect(twice.body.code).toBe('OVERLAP');
    await att(hr, 'post', `/requests/${asked.id}/approve`).expect(200);
    const row = await runInTenant(hr.orgId, () => peoplePrisma.attendanceRequest.findUniqueOrThrow({ where: { id: asked.id } }));
    expect(row.status).toBe('APPROVED');
    expect(row.temporaryScheduleId).toBeTruthy();
    for (const d of [from, plus(from, 3), to]) expect((await runInTenant(hr.orgId, () => shiftFor(hr.orgId, emp.id, d))).shiftId).toBe(night.id);
    expect((await runInTenant(hr.orgId, () => shiftFor(hr.orgId, emp.id, plus(to, 1)))).shiftId).toBe(before.shiftId);
    /* Asking for the shift already worked then is refused: nothing would change. */
    const same = await att(hr, 'post', '/requests', { employeeId: emp.id, kind: 'SHIFT_CHANGE', date: plus(from, 1), shiftId: night.id, reason: 'Same' });
    expect([400, 409]).toContain(same.status);
    await att(hr, 'post', `/requests/${asked.id}/cancel`, { note: 'Project moved' }).expect(200);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.temporarySchedule.count({ where: { id: row.temporaryScheduleId! } }))).toBe(0);
    expect((await runInTenant(hr.orgId, () => shiftFor(hr.orgId, emp.id, from))).shiftId).toBe(before.shiftId);
  });
});
