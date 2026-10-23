import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Leave, basic (after Horilla). Types, balances, requests, and what approving
 * one does to attendance and the month for payroll.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `leave.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Leave owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Leave Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}

const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const leaveType = async (c: Ctx, body: Record<string, unknown>) => (await api(c).post('/leave/types', body).expect(201)).body.type;

/*
 * September 2026: the 1st is a Tuesday; Sundays are the 6th, 13th, 20th, 27th.
 * Friday 11th to Tuesday 15th is 11, 12 (Saturday works on the standard
 * shift), 14, 15 — four days, the Sunday skipped.
 */

describe('the switch', () => {
  /* Leave is HR's as much as Attendance's (founder, 22 Oct 2026): either switch opens it (hrLeave.test.ts). */
  it('is refused while neither People nor Attendance is on, and opens with either', async () => {
    /* A fresh account owns every sellable app (explicit bootstrap subscription), so
       "off" is now the customer turning the apps off, not a catalog default. */
    const off = await makeOwner({ people: false, attendance: false });
    expect((await api(off).get('/leave/types').expect(403)).body.code).toBe('TIME_OFF_DISABLED');
    await api(await makeOwner({ people: true })).get('/leave/types').expect(200);
    await api(await makeOwner({ attendance: true })).get('/leave/types').expect(200);
  });
});

describe('types and balances', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeOwner();
  }, 60_000);

  it('gives everyone the type’s days, unless an allocation says otherwise', async () => {
    const casual = await leaveType(c, { name: 'Casual', annualDays: 12 });
    const lop = await leaveType(c, { name: 'Loss of pay', isPaid: false });
    const a = await person(c, { name: 'Default Days' });
    const b = await person(c, { name: 'Joined Late' });
    await api(c).put('/leave/allocations', { employeeId: b.id, leaveTypeId: casual.id, year: 2026, days: 4 }).expect(200);
    await api(c).put('/leave/allocations', { employeeId: b.id, leaveTypeId: lop.id, year: 2026, days: 4 }).expect(400);

    const res = (await api(c).get('/leave/balances?year=2026').expect(200)).body;
    const row = (id: string) => res.rows.find((r: any) => r.employeeId === id).balances;
    expect(row(a.id)[casual.id]).toMatchObject({ allocated: 12, used: 0, pending: 0, available: 12 });
    expect(row(b.id)[casual.id]).toMatchObject({ allocated: 4, available: 4 });
    expect(row(a.id)[lop.id]).toMatchObject({ allocated: null, available: null });

    // null puts them back on the type's days.
    await api(c).put('/leave/allocations', { employeeId: b.id, leaveTypeId: casual.id, year: 2026, days: null }).expect(200);
    expect((await api(c).get('/leave/balances?year=2026').expect(200)).body.rows.find((r: any) => r.employeeId === b.id).balances[casual.id].allocated).toBe(12);
  });

  it('will not delete a type that has been used', async () => {
    const t = await leaveType(c, { name: `Used ${rnd()}`, annualDays: 5 });
    const p = await person(c, { name: 'User Of Type' });
    await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-01', toDate: '2026-09-01', reason: 'Errand' }).expect(201);
    await api(c).del(`/leave/types/${t.id}`).expect(409);
    const spare = await leaveType(c, { name: `Spare ${rnd()}` });
    await api(c).del(`/leave/types/${spare.id}`).expect(200);
  });
});

describe('requests', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeOwner();
  }, 60_000);

  it('counts working days only, and refuses more than the balance or an overlap', async () => {
    const t = await leaveType(c, { name: 'Earned', annualDays: 3 });
    const p = await person(c, { name: 'Counted' });
    await api(c).post('/holidays', { date: '2026-09-14', name: 'Test holiday' }).expect(201);

    // 11, 12, 15 — the Sunday and the holiday are not leave.
    const r = (await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-11', toDate: '2026-09-15', reason: 'Trip' }).expect(201)).body.request;
    expect(r.days).toBe(3);
    expect(r.status).toBe('PENDING');

    // Balance is 3, all pending now.
    const more = await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-21', toDate: '2026-09-21', reason: 'More' }).expect(400);
    expect(more.body.code).toBe('NO_BALANCE');
    await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-15', toDate: '2026-09-16', reason: 'Clash' }).expect(409);
    await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-20', toDate: '2026-09-20', reason: 'Sunday' }).expect(400);
    await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-12-31', toDate: '2027-01-01', reason: 'New year' }).expect(400);
  });

  it('approving marks the days on leave; cancelling clears them', async () => {
    const t = await leaveType(c, { name: 'Casual', annualDays: 10 });
    const p = await person(c, { name: 'On Leave' });
    const r = (await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-01', toDate: '2026-09-02', reason: 'Fever' }).expect(201)).body.request;
    await api(c).post(`/leave/requests/${r.id}/approve`).expect(200);
    await api(c).post(`/leave/requests/${r.id}/approve`).expect(409);

    const days = (await api(c).get(`/records?from=2026-09-01&to=2026-09-02&employeeId=${p.id}`).expect(200)).body.records;
    expect(days.map((d: any) => [d.date, d.status, d.source])).toEqual(
      expect.arrayContaining([
        ['2026-09-01', 'ON_LEAVE', 'LEAVE'],
        ['2026-09-02', 'ON_LEAVE', 'LEAVE'],
      ])
    );
    const bal = (await api(c).get('/leave/balances?year=2026').expect(200)).body.rows.find((x: any) => x.employeeId === p.id).balances[t.id];
    expect(bal).toMatchObject({ used: 2, pending: 0, available: 8 });

    await api(c).post(`/leave/requests/${r.id}/cancel`).expect(200);
    expect((await api(c).get(`/records?from=2026-09-01&to=2026-09-02&employeeId=${p.id}`).expect(200)).body.records).toHaveLength(0);
    expect((await api(c).get('/leave/balances?year=2026').expect(200)).body.rows.find((x: any) => x.employeeId === p.id).balances[t.id].available).toBe(10);
  });

  it('will not approve leave over a day someone clocked in', async () => {
    const t = await leaveType(c, { name: `Sick ${rnd()}`, annualDays: 10 });
    const p = await person(c, { name: 'Came In' });
    await api(c).put('/records', { employeeId: p.id, date: '2026-09-03', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    const r = (await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-03', toDate: '2026-09-03', reason: 'Late ask' }).expect(201)).body.request;
    expect((await api(c).post(`/leave/requests/${r.id}/approve`).expect(409)).body.error).toMatch(/2026-09-03/);
    await api(c).post(`/leave/requests/${r.id}/reject`).expect(200);
  });
});

describe('the month for payroll', () => {
  it('counts approved unpaid leave as loss of pay, paid leave as paid', async () => {
    const c = await makeOwner();
    const paid = await leaveType(c, { name: 'Casual', annualDays: 10 });
    const unpaid = await leaveType(c, { name: 'Loss of pay', isPaid: false });
    const p = await person(c, { name: 'Payroll Month' });
    for (const [type, from, to] of [
      [paid.id, '2026-09-01', '2026-09-02'],
      [unpaid.id, '2026-09-03', '2026-09-04'],
    ]) {
      const r = (await api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: type, fromDate: from, toDate: to, reason: 'Away' }).expect(201)).body.request;
      await api(c).post(`/leave/requests/${r.id}/approve`).expect(200);
    }
    const row = (await api(c).get('/summary?month=2026-09').expect(200)).body.rows.find((r: any) => r.employeeId === p.id);
    /* 30 days, 4 Sundays, 4 on leave (2 unpaid), the other 22 absent. */
    expect(row).toMatchObject({ totalDays: 30, leave: 4, unpaidLeaveDays: 2, weeklyOffs: 4, absent: 22 });
    expect(row.lossOfPayDays).toBe(22 + 2);
    expect(row.payableDays).toBe(30 - 24);
  });
});

describe('my leave', () => {
  it('lets someone see balances, apply, and cancel what has not started', async () => {
    const c = await makeOwner();
    const t = await leaveType(c, { name: 'Casual', annualDays: 6 });
    const me = await person(c, { name: 'Self Service', workEmail: c.email });

    const mine = (await api(c).get('/me/leave?year=2026').expect(200)).body;
    expect(mine.employee.id).toBe(me.id);
    expect(mine.types.find((x: any) => x.id === t.id)).toMatchObject({ allocated: 6, available: 6 });

    const pending = (await api(c).post('/me/leave', { leaveTypeId: t.id, fromDate: '2026-12-01', toDate: '2026-12-01', reason: 'Wedding' }).expect(201)).body.request;
    await api(c).post(`/me/leave/${pending.id}/cancel`).expect(200);

    const past = (await api(c).post('/me/leave', { leaveTypeId: t.id, fromDate: '2026-09-01', toDate: '2026-09-01', reason: 'Was ill' }).expect(201)).body.request;
    await api(c).post(`/leave/requests/${past.id}/approve`).expect(200);
    await api(c).post(`/me/leave/${past.id}/cancel`).expect(409);
  });
});

describe('two requests at the same moment', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await makeOwner();
  }, 60_000);

  it('saves a double tap once', async () => {
    const t = await leaveType(c, { name: 'Casual', annualDays: 12 });
    const p = await person(c, { name: 'Double Tap' });
    const body = { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-09-11', toDate: '2026-09-11', reason: 'Family function' };
    const [a, b] = await Promise.all([api(c).post('/leave/requests', body), api(c).post('/leave/requests', body)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('does not overdraw a balance across two different requests', async () => {
    const t = await leaveType(c, { name: 'Earned', annualDays: 12 });
    const p = await person(c, { name: 'Two Requests' });
    await api(c).put('/leave/allocations', { employeeId: p.id, leaveTypeId: t.id, year: 2026, days: 1 }).expect(200);
    const one = (fromDate: string) => api(c).post('/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate, toDate: fromDate, reason: 'Errand' });
    const [a, b] = await Promise.all([one('2026-09-14'), one('2026-09-15')]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect([a, b].find((r) => r.status === 400)!.body.code).toBe('NO_BALANCE');
  });
});
