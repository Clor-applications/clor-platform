import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Statutory leave, each opt-in on a leave type (TIME-LEAVE-MARKET-RESEARCH.md G1–G3; the rule is written out in
 * services/attendance/daysWorked.ts): earned leave by days worked with the eligibility threshold, from the day
 * record with Attendance and from working days in People only; the OSH carry-forward with refused days carried
 * beyond the cap and the excess paid out at the year end; maternity as one 26-week request counted in calendar
 * days, with 80 days worked in the 12 months before; and the per-worker register.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { creditsFor, balanceFor, carryLimitOf, workedCredit } = await import('../services/attendance/leaveAccrual.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean>): Promise<Ctx> {
  const email = `sl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SL Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
const ledgerOf = async (c: Ctx, employeeId: string, year: number, typeId: string) =>
  (await att(c, 'get', `/leave/ledger?employeeId=${employeeId}&year=${year}`).expect(200)).body.types.find((t: any) => t.type.id === typeId);
const dates = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe('the engine, by itself', () => {
  const base = { id: 't', annualDays: 0, accrual: 'YEARLY', prorateForJoiners: false, carryForwardMax: null as number | null, createdAt: new Date('2020-01-01T00:00:00Z') };
  const w = (worked: number, eligible = worked) => ({ worked, eligible, source: 'RECORD' as const, from: '', to: '' });

  it('earns one day per 20 worked the period before, credited at the period start, half a day or more rounding up', () => {
    const t = { ...base, accrualBasis: 'PER_DAYS_WORKED', perDaysWorked: 20, minDaysWorked: 180 };
    expect(creditsFor(t, 2026, '2020-01-01', { workedIn: () => w(250) })).toEqual([{ date: '2026-01-01', days: 13, total: 13, from: '2026-01-01', to: '2026-12-31' }]);
    expect(workedCredit(t, w(249))!.days).toBe(12);
    /* Under the threshold: nothing, however close. */
    expect(creditsFor(t, 2026, '2020-01-01', { workedIn: () => w(179) })).toEqual([]);
    /* Paid leave counts towards the threshold, but does not earn. */
    expect(workedCredit(t, w(170, 185))).toMatchObject({ days: 9, eligible: true });
    /* No days known: nothing, not the type's annual days. */
    expect(creditsFor({ ...t, annualDays: 15 }, 2026, '2020-01-01', {})).toEqual([]);
  });

  it('a calendar type is untouched by the new options', () => {
    const t = { ...base, annualDays: 12 };
    expect(creditsFor(t, 2026, null, { workedIn: () => w(300) })).toEqual(creditsFor(t, 2026, null));
    expect(carryLimitOf({ carryForwardMax: 30 }, 12)).toBe(30);
  });

  it('the OSH rule carries refused days beyond the cap', () => {
    const t = { ...base, annualDays: 10, carryForwardMax: 2, oshCarry: true };
    const refusedIn = (y: number) => (y === 2025 ? 3 : 0);
    expect(balanceFor(t, 2026, null, '2026-06-01', new Map(), new Map(), { refusedIn }).carriedIn).toBe(5);
    expect(balanceFor({ ...t, oshCarry: false }, 2026, null, '2026-06-01', new Map(), new Map(), { refusedIn }).carriedIn).toBe(2);
    /* Never more than was left. */
    expect(balanceFor(t, 2026, null, '2026-06-01', new Map(), new Map([[2025, 11]]), { refusedIn }).carriedIn).toBe(1);
  });
});

describe('earned leave by days worked, with Attendance: the day record', () => {
  let c: Ctx;
  let el: any;
  let sick: any;
  let full: any;
  let mixed: any;
  let few: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
    el = (await att(c, 'post', '/leave/types', { name: 'Earned (OSH)', code: 'EL', annualDays: 0, accrualBasis: 'PER_DAYS_WORKED', perDaysWorked: 20, minDaysWorked: 180, carryForwardMax: 30 }).expect(201)).body.type;
    sick = (await att(c, 'post', '/leave/types', { name: 'Sick', annualDays: 12 }).expect(201)).body.type;
    full = await person(c, { name: 'Full Year', code: 'A1' });
    mixed = await person(c, { name: 'Mixed', code: 'A2' });
    few = await person(c, { name: 'Few Days', code: 'A3' });
    const days = dates('2025-01-01', '2025-12-31').filter((d) => weekday(d) !== 0);
    const rec = (employeeId: string, date: string, status: string) => ({ accountId: el.accountId, orgId: c.orgId, employeeId, date, status, source: 'IMPORT', createdByUserId: 'test' });
    await runInTenant(c.orgId, async () => {
      /* 200 present and 10 half days: 205 worked. */
      await peoplePrisma.attendanceRecord.createMany({ data: [...days.slice(0, 200).map((d) => rec(full.id, d, 'PRESENT')), ...days.slice(200, 210).map((d) => rec(full.id, d, 'HALF_DAY'))] });
      /* 170 present, plus 15 days of paid sick leave: 170 earn, 185 meet the threshold. */
      await peoplePrisma.attendanceRecord.createMany({ data: days.slice(0, 170).map((d) => rec(mixed.id, d, 'PRESENT')) });
      await peoplePrisma.leaveRequest.create({ data: { accountId: el.accountId, orgId: c.orgId, employeeId: mixed.id, leaveTypeId: sick.id, fromDate: '2025-11-03', toDate: '2025-11-19', days: 15, reason: 'Unwell', status: 'APPROVED', requestedByUserId: 'test' } });
      /* 100 present: under 180. */
      await peoplePrisma.attendanceRecord.createMany({ data: days.slice(0, 100).map((d) => rec(few.id, d, 'PRESENT')) });
    });
  }, 90_000);

  it('credits 2026 from the days worked in 2025', async () => {
    const t = await ledgerOf(c, full.id, 2026, el.id);
    expect(t.balance.earned).toBe(10);
    expect(t.balance.worked.previous).toMatchObject({ worked: 205, source: 'RECORD' });
    expect(t.entries.find((e: any) => e.kind === 'CREDIT' || e.kind === 'UPCOMING')).toMatchObject({ date: '2026-01-01', days: 10 });
    expect(t.explain.join(' ')).toContain('from the attendance record');
  });

  it('paid leave counts towards the 180 but does not earn; under the threshold earns nothing and says why', async () => {
    const m = await ledgerOf(c, mixed.id, 2026, el.id);
    expect(m.balance.worked.previous).toMatchObject({ worked: 170, eligible: 185 });
    expect(m.balance.earned).toBe(9);
    const f = await ledgerOf(c, few.id, 2026, el.id);
    expect(f.balance.earned).toBe(0);
    expect(f.explain.join(' ')).toContain('is under 180, so nothing is earned');
  });

  it('days worked earn nothing on a calendar type, and the type is a financial setting once in use', async () => {
    expect((await ledgerOf(c, full.id, 2026, sick.id)).explain).toEqual([]);
    await att(c, 'put', '/leave/allocations', { employeeId: few.id, leaveTypeId: el.id, year: 2026, days: 1 }).expect(200);
    expect((await att(c, 'put', `/leave/types/${el.id}`, { name: el.name, code: 'EL', annualDays: 0, accrualBasis: 'PER_DAYS_WORKED', perDaysWorked: 15, minDaysWorked: 180, carryForwardMax: 30 }).expect(409)).body.code).toBe('LEAVE_POLICY_IN_USE');
    expect((await att(c, 'post', '/leave/types', { name: 'No rate', annualDays: 0, accrualBasis: 'PER_DAYS_WORKED' }).expect(400)).body.error).toContain('how many days worked');
  });
});

describe('earned leave by days worked, People only: working days less leave', () => {
  let c: Ctx;
  let el: any;
  let unpaid: any;
  let ravi: any;
  let late: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0,6' }).expect(200);
    el = (await att(c, 'post', '/leave/types', { name: 'Earned (Factories)', annualDays: 0, accrualBasis: 'PER_DAYS_WORKED', perDaysWorked: 20, minDaysWorked: 240 }).expect(201)).body.type;
    unpaid = (await att(c, 'post', '/leave/types', { name: 'Unpaid', isPaid: false }).expect(201)).body.type;
    ravi = await person(c, { name: 'Ravi', code: 'B1' });
    late = await person(c, { name: 'Late Joiner', code: 'B2', dateOfJoining: '2025-07-01' });
    /* Five unpaid days in 2025, Monday to Friday. */
    const r = (await att(c, 'post', '/leave/requests', { employeeId: ravi.id, leaveTypeId: unpaid.id, fromDate: '2025-03-03', toDate: '2025-03-07', reason: 'Village' }).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${r.id}/approve`).expect(200);
  }, 90_000);

  it('counts the working week less holidays less leave, and says it is not from attendance', async () => {
    const holidays = await runInTenant(c.orgId, () => peoplePrisma.holiday.findMany({ where: { orgId: c.orgId, isOptional: false, areaId: null, branchId: null, date: { gte: '2025-01-01', lte: '2025-12-31' } }, select: { date: true } }));
    const off = new Set(holidays.map((h) => h.date));
    const working = dates('2025-01-01', '2025-12-31').filter((d) => ![0, 6].includes(weekday(d)) && !off.has(d)).length;
    const t = await ledgerOf(c, ravi.id, 2026, el.id);
    expect(t.balance.worked.previous).toMatchObject({ worked: working - 5, eligible: working - 5, source: 'WORKING_DAYS' });
    expect(t.balance.earned).toBe(Math.floor((working - 5) / 20 + 0.5));
    expect(t.explain.join(' ')).toContain('there is no attendance record (People only)');
  });

  it('a joiner in July does not reach 240', async () => {
    const t = await ledgerOf(c, late.id, 2026, el.id);
    expect(t.balance.worked.previous.eligible).toBeLessThan(240);
    expect(t.balance.earned).toBe(0);
  });
});

describe('the OSH carry-forward: refused days carry beyond the cap, the excess is paid out', () => {
  let c: Ctx;
  let osh: any;
  let plain: any;
  let meera: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    osh = (await att(c, 'post', '/leave/types', { name: 'EL OSH', annualDays: 10, carryForwardMax: 2, oshCarry: true }).expect(201)).body.type;
    plain = (await att(c, 'post', '/leave/types', { name: 'EL plain', annualDays: 10, carryForwardMax: 2 }).expect(201)).body.type;
    meera = await person(c, { name: 'Meera', code: 'C1', dateOfJoining: '2026-01-01' });
    for (const t of [osh, plain]) {
      const r = (await att(c, 'post', '/leave/requests', { employeeId: meera.id, leaveTypeId: t.id, fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Wedding' }).expect(201)).body.request;
      await att(c, 'post', `/leave/requests/${r.id}/reject`, { note: 'Year-end audit' }).expect(200);
    }
  }, 90_000);

  it('carries the cap plus the 3 refused days into the next period; the plain type carries the cap', async () => {
    expect((await ledgerOf(c, meera.id, 2027, osh.id)).balance.carriedIn).toBe(5);
    expect((await ledgerOf(c, meera.id, 2027, plain.id)).balance.carriedIn).toBe(2);
    const now = await ledgerOf(c, meera.id, 2026, osh.id);
    expect(now.balance).toMatchObject({ refused: 3, carryLimit: 5 });
    expect(now.explain.join(' ')).toContain('asked for and refused this period (3)');
  });

  it('the year end pays out what is over the limit for the OSH type, without encashment switched on', async () => {
    const rows = (await att(c, 'get', '/leave/year-end?year=2026').expect(200)).body.rows.filter((r: any) => r.employeeId === meera.id);
    expect(rows.find((r: any) => r.leaveTypeId === osh.id)).toMatchObject({ closing: 10, carry: 5, lapse: 5, payOut: 5 });
    expect(rows.find((r: any) => r.leaveTypeId === plain.id)).toMatchObject({ closing: 10, carry: 2, lapse: 8, payOut: 0 });
  });

  it('the register book lists the refused dates', async () => {
    const book = (await att(c, 'get', `/leave/register/book?year=2026&employeeId=${meera.id}`).expect(200)).body;
    expect(book.format).toContain('Form XX');
    const line = book.workers[0].leave.find((l: any) => l.leaveTypeId === osh.id);
    expect(line).toMatchObject({ opening: 0, earned: 10, availedDays: 0, refusedDays: 3, refused: [{ from: '2026-12-01', to: '2026-12-03', days: 3 }], closing: 10 });
    expect(book.workers[0].daysWorked.source).toBe('WORKING_DAYS');
  });
});

describe('maternity as one request, in calendar days', () => {
  let c: Ctx;
  let asha: any;
  let newcomer: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    await att(c, 'put', '/leave/working-week', { weeklyOffDays: '0' }).expect(200);
    asha = await person(c, { name: 'Asha', code: 'D1', gender: 'FEMALE', dateOfJoining: '2024-01-01' });
    newcomer = await person(c, { name: 'Newcomer', code: 'D2', gender: 'FEMALE', dateOfJoining: '2025-12-01' });
  }, 90_000);

  const ask = (employeeId: string, leaveTypeId: string) => ({ employeeId, leaveTypeId, fromDate: '2026-02-02', toDate: '2026-08-02', reason: 'Maternity' });

  it('the 60-day span stands for a type without its own longest request', async () => {
    const t = (await att(c, 'post', '/leave/types', { name: 'Long leave', annualDays: 200 }).expect(201)).body.type;
    expect((await att(c, 'post', '/leave/requests/preview', ask(asha.id, t.id)).expect(200)).body.problems[0].message).toContain('at most 60 days');
    await att(c, 'post', '/leave/requests', ask(asha.id, t.id)).expect(400);
    await att(c, 'post', '/leave/types', { name: 'Too long', annualDays: 200, maxDaysPerRequest: 200 }).expect(400);
  });

  it('26 weeks is one request, every date counted, weekly offs and holidays included', async () => {
    const ml = (await att(c, 'post', '/leave/types', { name: 'Maternity', annualDays: 182, gender: 'FEMALE', allowHalfDay: false, isPrivate: true, maxDaysPerRequest: 182, countsCalendarDays: true, availableAfterDays: 80, availableAfterBasis: 'DAYS_WORKED' }).expect(201)).body.type;
    const preview = (await att(c, 'post', '/leave/requests/preview', ask(asha.id, ml.id)).expect(200)).body;
    expect(preview.total).toBe(182);
    expect(preview.problems).toEqual([]);
    const sunday = preview.parts[0].dates.find((d: any) => d.date === '2026-02-08');
    expect(sunday).toMatchObject({ counted: true, why: 'Weekly off, counted (calendar days)' });
    const saved = (await att(c, 'post', '/leave/requests', ask(asha.id, ml.id)).expect(201)).body.request;
    expect(saved.days).toBe(182);
    const approved = (await att(c, 'post', `/leave/requests/${saved.id}/approve`).expect(200)).body;
    expect(approved.request?.days ?? approved.days ?? 182).toBe(182);
    /* The same span on a working-day type of the same length charges fewer days. */
    const working = (await att(c, 'post', '/leave/types', { name: 'Long working days', annualDays: 182, maxDaysPerRequest: 182 }).expect(201)).body.type;
    expect((await att(c, 'post', '/leave/requests/preview', { ...ask(asha.id, working.id), employeeId: newcomer.id }).expect(200)).body.total).toBeLessThan(182);
  });

  it('80 days worked in the 12 months before: refused with the count, for someone who joined in December', async () => {
    const ml = (await att(c, 'get', '/leave/types').expect(200)).body.types.find((t: any) => t.name === 'Maternity');
    const preview = (await att(c, 'post', '/leave/requests/preview', ask(newcomer.id, ml.id)).expect(200)).body;
    const problem = preview.problems.find((p: any) => p.code === 'LEAVE_POLICY');
    expect(problem.message).toMatch(/needs 80 days worked in the 12 months before it starts; this person has \d+ to 2026-02-01/);
    expect((await att(c, 'post', '/leave/requests', ask(newcomer.id, ml.id)).expect(400)).body.code).toBe('LEAVE_POLICY');
  });
});
