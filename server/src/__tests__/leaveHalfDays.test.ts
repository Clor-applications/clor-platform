import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A leave of several days may start after lunch on its first day or end at
 * lunch on its last (owner, 29 Oct 2026, from ERPNext's half-day date). Each
 * such day is saved as a half-day row of its own, linked to the rest.
 */
const { rowsOf } = await import('../routes/leave.js');
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const days = (from: string, to: string, off: string[] = []) => {
  const out: Array<{ date: string; counted: boolean }> = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    out.push({ date, counted: !off.includes(date) });
  }
  return out;
};
const part = (from: string, to: string, off: string[] = []) => ({ from, to, dates: days(from, to, off) });
const ask = (fromDate: string, toDate: string, extra: Record<string, unknown> = {}) => ({ leaveTypeId: 't', fromDate, toDate, ...extra });

describe('half days at either end of a longer leave', () => {
  it('keeps a plain leave as one row', () => {
    expect(rowsOf(part('2026-11-02', '2026-11-04'), ask('2026-11-02', '2026-11-04'))).toEqual([{ from: '2026-11-02', to: '2026-11-04', halfDay: null, days: 3 }]);
  });

  it('keeps a one-day half day as it was', () => {
    expect(rowsOf(part('2026-11-02', '2026-11-02'), ask('2026-11-02', '2026-11-02', { halfDay: 'FIRST' }))).toEqual([{ from: '2026-11-02', to: '2026-11-02', halfDay: 'FIRST', days: 0.5 }]);
  });

  it('starts after lunch: the first day is a second-half row', () => {
    expect(rowsOf(part('2026-11-02', '2026-11-04'), ask('2026-11-02', '2026-11-04', { startHalf: true }))).toEqual([
      { from: '2026-11-02', to: '2026-11-02', halfDay: 'SECOND', days: 0.5 },
      { from: '2026-11-03', to: '2026-11-04', halfDay: null, days: 2 },
    ]);
  });

  it('ends at lunch: the last day is a first-half row', () => {
    expect(rowsOf(part('2026-11-02', '2026-11-04'), ask('2026-11-02', '2026-11-04', { endHalf: true }))).toEqual([
      { from: '2026-11-02', to: '2026-11-03', halfDay: null, days: 2 },
      { from: '2026-11-04', to: '2026-11-04', halfDay: 'FIRST', days: 0.5 },
    ]);
  });

  it('two days, both ends half: one day of leave in two half rows', () => {
    const rows = rowsOf(part('2026-11-02', '2026-11-03'), ask('2026-11-02', '2026-11-03', { startHalf: true, endHalf: true }));
    expect(rows).toEqual([
      { from: '2026-11-02', to: '2026-11-02', halfDay: 'SECOND', days: 0.5 },
      { from: '2026-11-03', to: '2026-11-03', halfDay: 'FIRST', days: 0.5 },
    ]);
  });

  it('a half on a weekly off counts nothing and is left out', () => {
    /* 8 Nov 2026 is a Sunday, off. */
    const rows = rowsOf(part('2026-11-06', '2026-11-08', ['2026-11-07', '2026-11-08']), ask('2026-11-06', '2026-11-08', { endHalf: true }));
    expect(rows).toEqual([{ from: '2026-11-06', to: '2026-11-07', halfDay: null, days: 1 }]);
  });

  it('across the period end, the start half sits only in the first part and the end half only in the last', () => {
    const b = ask('2027-03-30', '2027-04-02', { startHalf: true, endHalf: true });
    expect(rowsOf(part('2027-03-30', '2027-03-31'), b)).toEqual([
      { from: '2027-03-30', to: '2027-03-30', halfDay: 'SECOND', days: 0.5 },
      { from: '2027-03-31', to: '2027-03-31', halfDay: null, days: 1 },
    ]);
    expect(rowsOf(part('2027-04-01', '2027-04-02'), b)).toEqual([
      { from: '2027-04-01', to: '2027-04-01', halfDay: null, days: 1 },
      { from: '2027-04-02', to: '2027-04-02', halfDay: 'FIRST', days: 0.5 },
    ]);
  });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/* A Monday at least a month away, inside this leave period, so Monday to Wednesday are three working days. */
const monday = (() => {
  let d = plus(today, 35);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
})();

describe('a leave with half days at either end, through the API', () => {
  let hr: Ctx;
  let emp: any;
  let type: any;
  beforeAll(async () => {
    const email = `lhd.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LHD Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
    emp = (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ name: 'Half Hema', code: 'H1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    type = (await att(hr, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
  }, 120_000);

  it('previews and saves Monday after lunch to Wednesday at lunch as two days in three linked rows', async () => {
    const body = { employeeId: emp.id, leaveTypeId: type.id, fromDate: monday, toDate: plus(monday, 2), startHalf: true, endHalf: true, reason: 'Family function' };
    const preview = (await att(hr, 'post', '/leave/requests/preview', body).expect(200)).body;
    expect(preview.total).toBe(2);
    expect(preview.parts[0].rows.map((r: any) => r.halfDay)).toEqual(['SECOND', null, 'FIRST']);
    const saved = (await att(hr, 'post', '/leave/requests', body).expect(201)).body;
    expect(saved.requests).toHaveLength(3);
    const rows = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: hr.orgId, employeeId: emp.id }, orderBy: { fromDate: 'asc' } }));
    expect(rows.map((r) => [r.fromDate, r.halfDay, r.days])).toEqual([[monday, 'SECOND', 0.5], [plus(monday, 1), null, 1], [plus(monday, 2), 'FIRST', 0.5]]);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows[0].groupId).toBeTruthy();
    /* Approving it approves every part. */
    await att(hr, 'post', `/leave/requests/${rows[1].id}/approve`).expect(200);
    const after = await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: hr.orgId, employeeId: emp.id } }));
    expect(after.every((r) => r.status === 'APPROVED')).toBe(true);
  });

  it('a type taken in whole days refuses a half at either end, and one day refuses the end halves', async () => {
    const whole = (await att(hr, 'post', '/leave/types', { name: 'Whole', annualDays: 12, allowHalfDay: false }).expect(201)).body.type;
    const refused = await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: whole.id, fromDate: plus(monday, 7), toDate: plus(monday, 8), startHalf: true, reason: 'Trip' }).expect(400);
    expect(refused.body.error).toMatch(/whole days/);
    const one = await att(hr, 'post', '/leave/requests', { employeeId: emp.id, leaveTypeId: type.id, fromDate: plus(monday, 7), toDate: plus(monday, 7), endHalf: true, reason: 'Trip' }).expect(400);
    expect(one.body.error).toMatch(/first or second half/);
  });
});
