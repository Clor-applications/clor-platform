import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { policyProblem } from '../services/people/leavePolicy.js';

/**
 * Leave and holidays belong to HR (founder, 22 Oct 2026) and stay in step
 * with Attendance: the same tables either way. HR alone runs leave, holidays,
 * a basic check-in and the employee app; a type carries the policy HR sets;
 * a balance is a ledger HR can adjust and pay out, and explain line by line.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(features: Record<string, boolean>): Promise<Ctx> {
  const email = `hrleave.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `HR Leave Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  if (Object.keys(features).length) await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;

describe('who may use leave', () => {
  it('HR alone runs leave, holidays, check-in and the employee app; neither app on is refused', async () => {
    /* A fresh account owns every sellable app (explicit bootstrap subscription), so
       "off" is now the customer turning the apps off, not a catalog default. */
    const none = await company({ people: false, attendance: false });
    expect((await att(none, 'get', '/leave/types').expect(403)).body.code).toBe('TIME_OFF_DISABLED');

    /* A fresh account owns every sellable app (explicit bootstrap subscription), so
       Attendance must be switched off here, not left to a catalog default. */
    const hr = await company({ people: true, attendance: false });
    const casual = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await att(hr, 'post', '/holidays', { date: '2026-11-02', name: 'Kannada Rajyotsava' }).expect(201);
    const p = await person(hr, { name: 'Asha', code: 'H1' });
    const r = (await att(hr, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-09-01', toDate: '2026-09-02', reason: 'Family function' }).expect(201)).body.request;
    await att(hr, 'post', `/leave/requests/${r.id}/approve`).expect(200);
    /* The same day records Attendance would read, were it switched on. */
    const days = (await att(hr, 'get', `/records?from=2026-09-01&to=2026-09-02&employeeId=${p.id}`).expect(200)).body.records;
    expect(days.map((d: any) => d.status)).toEqual(['ON_LEAVE', 'ON_LEAVE']);

    /* The employee app signs in with HR alone. */
    const access = await att(hr, 'get', '/portal-access').expect(200);
    const code = (await att(hr, 'post', '/portal-access/codes', { employeeIds: [p.id] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: 'H1', activationCode: code, password: 'mine pass 1' }).expect(200)).body.token;
    expect((await request(app).get('/api/portal/leave').set('Authorization', `Bearer ${token}`).expect(200)).body).toBeTruthy();

    /* Readers and shifts stay Attendance's. */
    await att(hr, 'get', '/devices').expect(403);
  }, 60_000);
});

describe('the policy on a type', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
  }, 60_000);

  it('keeps its policy when Attendance’s form, which does not show it, saves the type', async () => {
    const t = (await att(c, 'post', '/leave/types', { name: `Sick ${rnd()}`, annualDays: 8, maxDaysPerRequest: 3, color: '#2f855a', allowHalfDay: false }).expect(201)).body.type;
    expect(t).toMatchObject({ maxDaysPerRequest: 3, color: '#2f855a', allowHalfDay: false });
    const saved = (await att(c, 'put', `/leave/types/${t.id}`, { name: t.name, annualDays: 10, isPaid: true, accrual: 'YEARLY', prorateForJoiners: false, carryForwardMax: null }).expect(200)).body.type;
    expect(saved).toMatchObject({ annualDays: 10, maxDaysPerRequest: 3, color: '#2f855a', allowHalfDay: false });
    await att(c, 'put', `/leave/types/${t.id}`, { name: t.name, color: 'green' }).expect(400);
  });

  it('applies who it is for, half days and the longest request', async () => {
    const maternity = (await att(c, 'post', '/leave/types', { name: `Maternity ${rnd()}`, annualDays: 182, gender: 'FEMALE' }).expect(201)).body.type;
    const he = await person(c, { name: 'Ravi', gender: 'MALE' });
    const she = await person(c, { name: 'Meera', gender: 'FEMALE' });
    const ask = (e: any, t: any, extra: Record<string, unknown> = {}) => att(c, 'post', '/leave/requests', { employeeId: e.id, leaveTypeId: t.id, fromDate: '2026-09-01', toDate: '2026-09-01', reason: 'Policy check', ...extra });
    expect((await ask(he, maternity).expect(400)).body.code).toBe('LEAVE_POLICY');
    await ask(she, maternity).expect(201);

    const whole = (await att(c, 'post', '/leave/types', { name: `Whole ${rnd()}`, annualDays: 10, allowHalfDay: false, maxDaysPerRequest: 2 }).expect(201)).body.type;
    expect((await ask(he, whole, { halfDay: 'FIRST' }).expect(400)).body.error).toMatch(/whole days/);
    expect((await ask(he, whole, { toDate: '2026-09-04' }).expect(400)).body.error).toMatch(/at most 2 days/);

    const contract = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/employee-types`).set(at(c)).send({ name: `Contract ${rnd()}` }).expect(201)).body.item;
    const permanent = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/employee-types`).set(at(c)).send({ name: `Permanent ${rnd()}` }).expect(201)).body.item;
    const earned = (await att(c, 'post', '/leave/types', { name: `Earned ${rnd()}`, annualDays: 15, employeeTypeIds: [permanent.id], availableAfterDays: 180 }).expect(201)).body.type;
    const temp = await person(c, { name: 'Temp', employeeTypeId: contract.id });
    const perm = await person(c, { name: 'Perm', employeeTypeId: permanent.id, dateOfJoining: '2026-06-01' });
    expect((await ask(temp, earned).expect(400)).body.error).toMatch(/employee type/);
    expect((await ask(perm, earned).expect(400)).body.error).toMatch(/2026-11-28/);
    await att(c, 'post', '/leave/types', { name: `Bad ${rnd()}`, employeeTypeIds: ['nope'] }).expect(400);
  }, 60_000);

  it('the sandwich rule counts the Sunday between, and advance leave goes below zero', async () => {
    const plain = (await att(c, 'post', '/leave/types', { name: `Plain ${rnd()}`, annualDays: 10 }).expect(201)).body.type;
    const sandwich = (await att(c, 'post', '/leave/types', { name: `Sandwich ${rnd()}`, annualDays: 10, sandwich: true }).expect(201)).body.type;
    const p = await person(c, { name: 'Weekender' });
    /* Saturday 12 to Monday 14 September 2026; Sunday 13 is the weekly off. */
    expect((await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: plain.id, fromDate: '2026-09-12', toDate: '2026-09-14', reason: 'Trip' }).expect(201)).body.request.days).toBe(2);
    const s = (await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: sandwich.id, fromDate: '2026-10-03', toDate: '2026-10-05', reason: 'Trip' }).expect(201)).body.request;
    expect(s.days).toBe(3);
    await att(c, 'post', `/leave/requests/${s.id}/approve`).expect(200);
    const days = (await att(c, 'get', `/records?from=2026-10-03&to=2026-10-05&employeeId=${p.id}`).expect(200)).body.records;
    expect(days.map((d: any) => d.status)).toEqual(['ON_LEAVE', 'ON_LEAVE', 'ON_LEAVE']);

    const advance = (await att(c, 'post', '/leave/types', { name: `Advance ${rnd()}`, annualDays: 1, negativeDays: 2 }).expect(201)).body.type;
    await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: advance.id, fromDate: '2026-09-01', toDate: '2026-09-03', reason: 'Three days' }).expect(201);
    expect((await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: advance.id, fromDate: '2026-09-21', toDate: '2026-09-21', reason: 'One more' }).expect(400)).body.code).toBe('NO_BALANCE');
  }, 60_000);
});

describe('the ledger', () => {
  it('adds, takes away and pays out days with a reason, and explains the balance', async () => {
    const c = await company({ people: true });
    const el = (await att(c, 'post', '/leave/types', { name: 'Earned', annualDays: 12, carryForwardMax: 30 }).expect(201)).body.type;
    const lop = (await att(c, 'post', '/leave/types', { name: 'Loss of pay', isPaid: false }).expect(201)).body.type;
    const p = await person(c, { name: 'Ledger Person' });
    const bal = async (year = 2026) => (await att(c, 'get', `/leave/balances?year=${year}`).expect(200)).body.rows.find((r: any) => r.employeeId === p.id).balances[el.id];

    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: 5, reason: 'Opening balance from the old system' }).expect(201);
    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: -1, reason: 'Counted twice' }).expect(201);
    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: lop.id, year: 2026, days: 2, reason: 'No' }).expect(400);
    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: 0, reason: 'Nothing' }).expect(400);
    expect(await bal()).toMatchObject({ allocated: 16, adjusted: 4, available: 16 });

    /* Paid out only when the policy says so, within its yearly limit and the balance. */
    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: 3, kind: 'ENCASH', reason: 'Year end' }).expect(400);
    await att(c, 'put', `/leave/types/${el.id}`, { name: 'Earned', annualDays: 12, carryForwardMax: 30, encashable: true, maxEncashDays: 5 }).expect(200);
    const paid = (await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: 3, kind: 'ENCASH', reason: 'Year end' }).expect(201)).body.adjustment;
    expect(paid).toMatchObject({ days: -3, kind: 'ENCASH', leaveTypeName: 'Earned' });
    await att(c, 'post', '/leave/adjustments', { employeeId: p.id, leaveTypeId: el.id, year: 2026, days: 3, kind: 'ENCASH', reason: 'Again' }).expect(400);
    expect(await bal()).toMatchObject({ available: 13 });
    /* What is left carries into next year. */
    expect((await bal(2027)).carriedIn).toBe(13);

    const r = (await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: el.id, fromDate: '2026-09-01', toDate: '2026-09-01', reason: 'Errand' }).expect(201)).body.request;
    const ledger = (await att(c, 'get', `/leave/ledger?employeeId=${p.id}&year=2026`).expect(200)).body;
    const lines = ledger.types.find((t: any) => t.type.id === el.id).entries.map((e: any) => [e.kind, e.days]);
    expect(lines).toEqual(expect.arrayContaining([['CREDIT', 12], ['ADJUST', 5], ['ADJUST', -1], ['ENCASH', -3], ['PENDING', -1]]));
    expect(lines.find((l: any) => l[0] === 'PENDING')).toBeTruthy();
    expect(r.days).toBe(1);

    /* A mistaken line goes to the recycle bin, and the balance follows. */
    const adj = (await att(c, 'get', `/leave/adjustments?year=2026&employeeId=${p.id}`).expect(200)).body.adjustments.find((a: any) => a.days === -1);
    await att(c, 'delete', `/leave/adjustments/${adj.id}`).expect(200);
    expect(await bal()).toMatchObject({ available: 13 });
  }, 60_000);

  it('the calendar asks for one month', async () => {
    const c = await company({ people: true });
    const t = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const p = await person(c, { name: 'Month Person' });
    await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-08-31', toDate: '2026-09-01', reason: 'Across months' }).expect(201);
    await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-10-05', toDate: '2026-10-05', reason: 'October' }).expect(201);
    expect((await att(c, 'get', '/leave/requests?month=2026-09').expect(200)).body.requests.map((r: any) => r.fromDate)).toEqual(['2026-08-31']);
  });
});

describe('policyProblem', () => {
  const type = { name: 'Casual', allowHalfDay: true, minNoticeDays: 3, maxDaysPerRequest: null, backdatedDays: 7, gender: null, employeeTypeIds: [], availableAfterDays: null };
  const who = { gender: null, employeeTypeId: null, dateOfJoining: '2025-01-01' };
  it('holds people asking for themselves to notice and how far back, not HR', () => {
    expect(policyProblem(type, who, { fromDate: '2026-10-23', halfDay: null, days: 1 }, '2026-10-22', false)).toMatch(/3 days ahead: the earliest is 2026-10-25/);
    expect(policyProblem(type, who, { fromDate: '2026-10-25', halfDay: null, days: 1 }, '2026-10-22', false)).toBeNull();
    expect(policyProblem(type, who, { fromDate: '2026-10-10', halfDay: null, days: 1 }, '2026-10-22', false)).toMatch(/up to 7 days after/);
    expect(policyProblem(type, who, { fromDate: '2026-10-16', halfDay: null, days: 1 }, '2026-10-22', false)).toBeNull();
    expect(policyProblem(type, who, { fromDate: '2026-10-10', halfDay: null, days: 1 }, '2026-10-22', true)).toBeNull();
    expect(policyProblem({ ...type, backdatedDays: 0 }, who, { fromDate: '2026-10-21', halfDay: null, days: 1 }, '2026-10-22', false)).toMatch(/after the day/);
  });
});
