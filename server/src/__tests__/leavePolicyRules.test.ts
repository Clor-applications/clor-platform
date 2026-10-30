import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave policy rules owners expect from Keka, Zoho and greytHR
 * (TIME-LEAVE-DECISIONS.md, "Leave policy rules"): hourly leave, days over
 * the balance as loss of pay, clubbing, sandwich options, leave while serving
 * notice, and a state's minimum of holidays. Half days at the ends, documents
 * above N days and carried days that expire are main's own rules, tested in
 * leaveHalfDays, leaveAuditFixes and carryExpiry.
 *
 * The calendar: 27 Oct 2026 is a Tuesday; the default week has Sunday off.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { overBalance, planLeave } = await import('../routes/leave.js');
const { DEFAULT_SHIFT } = await import('../services/attendance/compute.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `lpr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LPR Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => {
  const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
  c.accountId = e.accountId;
  return e;
};
const type = async (c: Ctx, body: Record<string, unknown>) => (await att(c, 'post', '/leave/types', { annualDays: 12, ...body }).expect(201)).body.type;
const ask = (c: Ctx, body: Record<string, unknown>) => att(c, 'post', '/leave/requests', { reason: 'Family matter', ...body });
const days = async (c: Ctx, employeeId: string, from: string, to: string) => (await att(c, 'get', `/records?from=${from}&to=${to}&employeeId=${employeeId}`).expect(200)).body.records;

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('hourly leave', () => {
  it('is hours on one day, inside the shift, charged as their share of it, and excuses those hours', async () => {
    const hourly = await type(c, { name: `Hourly ${rnd()}`, code: `H${rnd().slice(0, 3)}`, unit: 'HOUR', annualDays: 3 });
    const p = await person(c, { name: 'Hours' });
    expect((await ask(c, { employeeId: p.id, leaveTypeId: hourly.id, fromDate: '2026-11-02', toDate: '2026-11-03', fromTime: '09:00', toTime: '11:00' }).expect(400)).body.error).toMatch(/one day/);
    expect((await ask(c, { employeeId: p.id, leaveTypeId: hourly.id, fromDate: '2026-11-02', toDate: '2026-11-02', fromTime: '09:10', toTime: '11:00' }).expect(400)).body.error).toMatch(/15 minutes/);
    expect((await ask(c, { employeeId: p.id, leaveTypeId: hourly.id, fromDate: '2026-11-02', toDate: '2026-11-02', fromTime: '05:00', toTime: '07:00' }).expect(400)).body.error).toMatch(/inside the shift/);
    /* No shift set up: the company default, 09:00 to 18:00 (compute.ts DEFAULT_SHIFT). */
    const shift = DEFAULT_SHIFT;
    const r = (await ask(c, { employeeId: p.id, leaveTypeId: hourly.id, fromDate: '2026-10-20', toDate: '2026-10-20', fromTime: shift.startTime, toTime: `${String(Number(shift.startTime.slice(0, 2)) + 2).padStart(2, '0')}:${shift.startTime.slice(3)}` }).expect(201)).body.request;
    expect(r.minutes).toBe(120);
    expect(r.days).toBeGreaterThan(0);
    expect(r.days).toBeLessThan(0.5);
    await att(c, 'post', `/leave/requests/${r.id}/approve`, {}).expect(200);
    /* Clocked in two hours late: the late minutes are the leave's, not lateness. */
    const lateIn = `${String(Number(shift.startTime.slice(0, 2)) + 2).padStart(2, '0')}:${shift.startTime.slice(3)}`;
    await att(c, 'put', '/records', { employeeId: p.id, date: '2026-10-20', checkIn: lateIn, checkOut: shift.endTime }).expect(200);
    const [day] = await days(c, p.id, '2026-10-20', '2026-10-20');
    expect(day.lateMinutes).toBe(0);
    expect(day.leaveRequestId).toBe(r.id);
    expect(day.status).toBe('PRESENT');
  }, 60_000);
});

describe('hourly leave in hours (review of PR #75)', () => {
  it('an hour is 1/hoursPerDay of a day, kept to four places, whatever the shift', async () => {
    const t = await type(c, { name: `Hours ${rnd()}`, code: `Q${rnd().slice(0, 3)}`, unit: 'HOUR', hoursPerDay: 7.5, annualDays: 2 });
    expect(t.hoursPerDay).toBe(7.5);
    const p = await person(c, { name: 'Hours two' });
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03', fromTime: '10:00', toTime: '11:00', reason: 'Bank' }).expect(200)).body;
    expect(preview.total).toBe(0.1333);
    expect(preview.type.hoursPerDay).toBe(7.5);
    const r = (await ask(c, { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03', fromTime: '10:00', toTime: '11:00' }).expect(201)).body.request;
    expect(r.days).toBe(0.1333);
    expect(r.minutes).toBe(60);
    /* Unset, a day is eight hours: two hours are a quarter of one. */
    const plain = await type(c, { name: `Hours ${rnd()}`, code: `R${rnd().slice(0, 3)}`, unit: 'HOUR', annualDays: 2 });
    const r2 = (await ask(c, { employeeId: p.id, leaveTypeId: plain.id, fromDate: '2026-11-04', toDate: '2026-11-04', fromTime: '10:00', toTime: '12:00' }).expect(201)).body.request;
    expect(r2.days).toBe(0.25);
    expect((await att(c, 'post', '/leave/types', { name: `Bad ${rnd()}`, unit: 'HOUR', hoursPerDay: 30, annualDays: 1 }).expect(400)).body.error).toMatch(/24 hours/);
  }, 60_000);
});

describe('days over the balance', () => {
  it('become a linked loss-of-pay request when the type says so, decided with the paid one', async () => {
    const lop = await type(c, { name: `Loss of Pay ${rnd()}`, code: 'LOP', isPaid: false, annualDays: 0 });
    const earned = await type(c, { name: `Earned ${rnd()}`, code: `E${rnd().slice(0, 3)}`, annualDays: 2, overBalance: 'LOSS_OF_PAY' });
    const p = await person(c, { name: 'Over balance' });
    /* Monday 2 Nov to Thursday 5 Nov: 4 days, 2 in the balance. */
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: earned.id, fromDate: '2026-11-02', toDate: '2026-11-05', reason: 'Travel' }).expect(200)).body;
    expect(preview.ok).toBe(true);
    expect(preview.parts[0].overflow).toMatchObject({ days: 2, typeName: lop.name, from: '2026-11-04', to: '2026-11-05' });
    expect(preview.warnings.map((w: any) => w.code)).toContain('LOSS_OF_PAY');
    const made = (await ask(c, { employeeId: p.id, leaveTypeId: earned.id, fromDate: '2026-11-02', toDate: '2026-11-05', reason: 'Travel' }).expect(201)).body;
    const rows = await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: c.orgId, employeeId: p.id }, orderBy: { fromDate: 'asc' } }));
    expect(rows.map((x) => [x.leaveTypeId, x.fromDate, x.toDate, x.days])).toEqual([[earned.id, '2026-11-02', '2026-11-03', 2], [lop.id, '2026-11-04', '2026-11-05', 2]]);
    expect(rows[1].overflowOfId).toBe(rows[0].id);
    expect(rows[0].groupId).toBeTruthy();
    expect(rows[1].groupId).toBe(rows[0].groupId);
    await att(c, 'post', `/leave/requests/${(made.request || made.requests[0]).id}/approve`, {}).expect(200);
    const after = await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: c.orgId, employeeId: p.id } }));
    expect(after.every((x) => x.status === 'APPROVED')).toBe(true);
    /* Ending at lunch: the half day is its own row, and it is the part over the balance. */
    const q = await person(c, { name: 'Over by a half' });
    await ask(c, { employeeId: q.id, leaveTypeId: earned.id, fromDate: '2026-11-02', toDate: '2026-11-04', endHalf: true, reason: 'Travel' }).expect(201);
    const halves = await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: c.orgId, employeeId: q.id }, orderBy: { fromDate: 'asc' } }));
    expect(halves.map((x) => [x.leaveTypeId, x.fromDate, x.toDate, x.days, x.halfDay])).toEqual([[earned.id, '2026-11-02', '2026-11-03', 2, null], [lop.id, '2026-11-04', '2026-11-04', 0.5, 'FIRST']]);
    expect(halves[1].overflowOfId).toBe(halves[0].id);
    /* A request that ran into loss of pay is withdrawn and asked again, not edited. */
    expect((await att(c, 'put', `/leave/requests/${halves[0].id}`, { leaveTypeId: earned.id, fromDate: '2026-11-02', toDate: '2026-11-03', reason: 'Travel' }).expect(409)).body.code).toBe('LOSS_OF_PAY_EDIT');
    /* Without the rule it is still refused. */
    const strict = await type(c, { name: `Strict ${rnd()}`, code: `T${rnd().slice(0, 3)}`, annualDays: 1 });
    expect((await ask(c, { employeeId: p.id, leaveTypeId: strict.id, fromDate: '2026-11-16', toDate: '2026-11-18' }).expect(400)).body.code).toBe('NO_BALANCE');
  }, 60_000);
});

describe('where the balance runs out', () => {
  it('ends the paid part on its last working day and starts the unpaid one on the next', () => {
    /* Thursday 26 Nov to Wednesday 2 Dec under the sandwich rule: Sunday 29 counted between. Four days in the balance. */
    const dates = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'].map((date) => ({ date, counted: true, ...(date === '2026-11-29' ? { off: 'WEEKLY_OFF' } : {}) }));
    const rows = [{ from: '2026-11-26', to: '2026-12-02', halfDay: null, days: 7 }];
    const cut = overBalance(rows, dates, 4);
    expect(cut.paid).toEqual([{ from: '2026-11-26', to: '2026-11-28', halfDay: null, days: 3 }]);
    expect(cut.unpaid).toEqual([{ from: '2026-11-30', to: '2026-12-02', halfDay: null, days: 3 }]);
    /* Enough balance: nothing moves. */
    expect(overBalance(rows, dates, 7)).toEqual({ paid: rows, unpaid: [] });
    /* None: all of it is unpaid. */
    expect(overBalance(rows, dates, 0)).toEqual({ paid: [], unpaid: [{ ...rows[0], days: 7 }] });
  });
});

describe('clubbing', () => {
  it('refuses two types that may not sit next to each other, a weekly off between still next to', async () => {
    const earned = await type(c, { name: `Earned C ${rnd()}`, code: `F${rnd().slice(0, 3)}` });
    const casual = await type(c, { name: `Casual C ${rnd()}`, code: `G${rnd().slice(0, 3)}`, notWithTypeIds: [earned.id] });
    const p = await person(c, { name: 'Clubbing' });
    /* Earned on Saturday 7 Nov; Sunday off; casual on Monday 9 Nov is next to it. */
    await ask(c, { employeeId: p.id, leaveTypeId: earned.id, fromDate: '2026-11-07', toDate: '2026-11-07' }).expect(201);
    const refused = await ask(c, { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-11-09', toDate: '2026-11-09' }).expect(400);
    expect(refused.body.code).toBe('CLUBBING');
    expect(refused.body.error).toMatch(/cannot be taken next to/);
    /* The rule works both ways, and a working day between is enough. */
    await ask(c, { employeeId: p.id, leaveTypeId: casual.id, fromDate: '2026-11-11', toDate: '2026-11-11' }).expect(201);
    expect((await ask(c, { employeeId: p.id, leaveTypeId: earned.id, fromDate: '2026-11-12', toDate: '2026-11-12' }).expect(400)).body.code).toBe('CLUBBING');
    await ask(c, { employeeId: p.id, leaveTypeId: earned.id, fromDate: '2026-11-13', toDate: '2026-11-13' }).expect(201);
  }, 60_000);
});

describe('sandwich options', () => {
  it('can leave weekly offs or holidays out, apply only from a length, and ignore a half day at an end', async () => {
    const p = await person(c, { name: 'Sandwich' });
    const plain = await type(c, { name: `Sandwich ${rnd()}`, code: `Q${rnd().slice(0, 3)}`, sandwich: true });
    const noOffs = await type(c, { name: `No offs ${rnd()}`, code: `R${rnd().slice(0, 3)}`, sandwich: true, sandwichWeekOffs: false });
    const longOnly = await type(c, { name: `Long ${rnd()}`, code: `V${rnd().slice(0, 3)}`, sandwich: true, sandwichMinDays: 3 });
    const halfOut = await type(c, { name: `Half out ${rnd()}`, code: `X${rnd().slice(0, 3)}`, sandwich: true, sandwichIgnoreHalf: true });
    const total = async (t: any, extra: Record<string, unknown> = {}) => (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: t.id, fromDate: '2026-11-07', toDate: '2026-11-09', reason: 'Trip', ...extra }).expect(200)).body.total;
    /* Saturday 7, Sunday 8 (off), Monday 9. */
    expect(await total(plain)).toBe(3);
    expect(await total(noOffs)).toBe(2);
    expect(await total(longOnly)).toBe(2);
    /* From the second half of Saturday: the half is not an end of the sandwich, so Sunday is not charged. */
    expect(await total(plain, { startHalf: true })).toBe(2.5);
    expect(await total(halfOut, { startHalf: true })).toBe(1.5);
  }, 60_000);
});

describe('leave while serving notice', () => {
  it('is blocked, warned or allowed by the type; HR entering it is told, not stopped', async () => {
    const blocked = await type(c, { name: `Blocked ${rnd()}`, code: `B${rnd().slice(0, 3)}`, onNotice: 'BLOCK' });
    const warned = await type(c, { name: `Warned ${rnd()}`, code: `D${rnd().slice(0, 3)}`, onNotice: 'WARN' });
    const p = await person(c, { name: 'On notice' });
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: p.id }, data: { status: 'ON_NOTICE', dateOfLeaving: '2026-12-31' } }));
    const asker = { id: p.id, branchId: null, status: 'ON_NOTICE' };
    const ask1 = { leaveTypeId: blocked.id, fromDate: '2026-11-16', toDate: '2026-11-16', reason: 'Errand' };
    const own = await planLeave(c.accountId, c.orgId, asker, ask1, false);
    expect('problems' in own && own.problems.map((x) => x.code)).toContain('ON_NOTICE');
    const hr = await planLeave(c.accountId, c.orgId, asker, ask1, true);
    expect('problems' in hr && hr.problems.map((x) => x.code)).not.toContain('ON_NOTICE');
    expect('warnings' in hr && hr.warnings.map((x) => x.code)).toContain('ON_NOTICE');
    const warn = await planLeave(c.accountId, c.orgId, asker, { ...ask1, leaveTypeId: warned.id }, false);
    expect('problems' in warn && warn.problems.map((x) => x.code)).not.toContain('ON_NOTICE');
    expect('warnings' in warn && warn.warnings[0].message).toMatch(/Serving notice \(last day 31 Dec 2026\)/);
  }, 60_000);
});

describe('a state’s minimum of holidays', () => {
  it('is checked per branch on the holidays list (Karnataka: 10)', async () => {
    const k = await company();
    for (const [date, name] of [['2026-01-26', 'Republic Day'], ['2026-08-15', 'Independence Day'], ['2026-10-02', 'Gandhi Jayanti']]) await att(k, 'post', '/holidays', { date, name }).expect(201);
    const out = (await att(k, 'get', '/holidays?year=2026').expect(200)).body;
    expect(out.stateMinimum).toEqual([expect.objectContaining({ state: 'Karnataka', holidays: 3, minimum: 10, short: true })]);
  }, 60_000);
});
