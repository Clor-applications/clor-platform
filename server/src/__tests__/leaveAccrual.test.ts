import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Leave accrual and carry-forward: monthly credits, joiners prorated, unused
 * days carried into the next year up to a limit, and a request checked against
 * what will have been earned by its first day.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { balanceFor, earned, firstMonth, creditsFor } = await import('../services/attendance/leaveAccrual.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const type = (over: Record<string, unknown> = {}) => ({
  id: 't', annualDays: 12, accrual: 'YEARLY', prorateForJoiners: false, carryForwardMax: null as number | null, createdAt: new Date('2020-01-01T00:00:00Z'), ...over,
});

describe('earned days', () => {
  it('counts the joining month only when joined by the 15th', () => {
    expect(firstMonth(2026, '2026-03-15')).toBe(3);
    expect(firstMonth(2026, '2026-03-16')).toBe(4);
    expect(firstMonth(2026, '2025-07-01')).toBe(1);
    expect(firstMonth(2026, '2027-01-01')).toBe(13);
  });

  it('credits a twelfth a month, from the joining month, to the half day', () => {
    const monthly = type({ accrual: 'MONTHLY', annualDays: 18 });
    expect(earned(monthly, 2026, '2020-01-01', '2026-01-10')).toBe(1.5);
    expect(earned(monthly, 2026, '2020-01-01', '2026-10-17')).toBe(15);
    expect(earned(monthly, 2026, '2026-04-20', '2026-10-17')).toBe(9); // May–October, 6 × 1.5
    expect(earned(monthly, 2025, '2020-01-01', '2026-10-17')).toBe(18);
  });

  it('gives yearly days at once, prorated for joiners only when the type says so', () => {
    expect(earned(type(), 2026, '2026-07-01', '2026-07-01')).toBe(12);
    expect(earned(type({ prorateForJoiners: true }), 2026, '2026-07-01', '2026-07-01')).toBe(6);
    expect(earned(type({ prorateForJoiners: true }), 2026, '2026-08-20', '2026-09-01')).toBe(4); // September–December, 4 of 12
  });

  it('never earns anything before the person has joined', () => {
    const joiner = type({ prorateForJoiners: true, creditOn: 'DAY', creditDay: 15 });
    expect(earned(joiner, 2026, '2026-11-02', '2026-10-22')).toBe(0); // the audit repro: 2 days dated January
    for (const c of creditsFor(joiner, 2026, '2026-11-02')) expect(c.date >= '2026-11-02').toBe(true);
  });
});

describe('carry-forward', () => {
  it('carries what was left, up to the limit, and rolls it year to year', () => {
    const t = type({ carryForwardMax: 10, createdAt: new Date('2024-01-01T00:00:00Z') });
    // 2024: 12, 4 taken: 8 left → 8 into 2025. 2025: 12 + 8 = 20, 5 taken: 15 → 10 (the limit) into 2026.
    const b = balanceFor(t, 2026, '2023-01-01', '2026-10-17', new Map(), new Map([[2024, 4], [2025, 5]]));
    expect(b).toMatchObject({ carriedIn: 10, earned: 12, allocated: 22 });
  });

  it('lets unused days lapse when the type carries nothing, and takes HR’s allocation as the year’s total', () => {
    expect(balanceFor(type(), 2026, '2020-01-01', '2026-10-17', new Map(), new Map()).carriedIn).toBe(0);
    const t = type({ carryForwardMax: 30 });
    // 2025 set by hand to 20, 2 taken: 18 into 2026.
    expect(balanceFor(t, 2026, '2020-01-01', '2026-10-17', new Map([[2025, 20]]), new Map([[2025, 2]])).carriedIn).toBe(18);
    expect(balanceFor(t, 2026, '2020-01-01', '2026-10-17', new Map([[2026, 7]]), new Map()).allocated).toBe(7);
  });

  it('carries nothing from before the type existed, or before the person joined', () => {
    const t = type({ carryForwardMax: 30, createdAt: new Date('2026-02-01T00:00:00Z') });
    expect(balanceFor(t, 2026, '2020-01-01', '2026-10-17', new Map(), new Map()).carriedIn).toBe(0);
    expect(balanceFor(type({ carryForwardMax: 30 }), 2026, '2026-03-01', '2026-10-17', new Map(), new Map()).carriedIn).toBe(0);
  });
});

/* --------------------------------------------------------------------------- */

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

async function makeOwner(): Promise<Ctx> {
  const email = `accr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Accrual Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}

describe('balances on the API', () => {
  it('shows last year’s carry-in and refuses leave beyond what is earned by its first day', async () => {
    const c = await makeOwner();
    const person = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi', code: 'L1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
    const t = (await api(c).post('/leave/types', { name: 'Earned', annualDays: 12, accrual: 'MONTHLY', carryForwardMax: 6 }).expect(201)).body.type;
    expect(t).toMatchObject({ accrual: 'MONTHLY', carryForwardMax: 6 });
    /* Next year, seen from before it starts, whatever today is (a fixed 2027 started earning on 1 Jan 2027). */
    const next = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4)) + 1;
    // The type existed the year before this one, whose balance was 12 with none taken: 6 carry into this year.
    await peoplePrisma.leaveType.update({ where: { id: t.id }, data: { createdAt: new Date(`${next - 2}-01-01T00:00:00Z`) } });

    const b = (await api(c).get(`/leave/balances?year=${next}`).expect(200)).body.rows.find((r: any) => r.employeeId === person.id).balances[t.id];
    /* Next year seen from its first day: January's credit (1) and this year's 12 + 6 carried = 18, capped to 6 carried in. */
    expect(b).toMatchObject({ carriedIn: 6, earned: 1, allocated: 7, fullYear: 18 });

    /* A request in March next year is checked against January–March (3 days) plus the 6 carried. From its first Monday (Sunday is off): */
    let monday = Date.parse(`${next}-03-01T00:00:00Z`);
    while (new Date(monday).getUTCDay() !== 1) monday += 86_400_000;
    const on = (n: number) => new Date(monday + n * 86_400_000).toISOString().slice(0, 10);
    const ask = (from: string, to: string) => api(c).post('/leave/requests', { employeeId: person.id, leaveTypeId: t.id, fromDate: from, toDate: to, reason: 'Family visit' });
    expect((await ask(on(0), on(11)).expect(400)).body.code).toBe('NO_BALANCE'); // 11 working days
    await ask(on(0), on(8)).expect(201); // 8 working days
  });
});
