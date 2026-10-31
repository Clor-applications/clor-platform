import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { balanceFor, creditsFor, earned, periodEnd, periodLabel, periodOf } from '../services/attendance/leaveAccrual.js';

/**
 * Leave periods and automatic credits (founder, 22 Oct 2026): a company's own
 * leave year, credits yearly, half-yearly, quarterly or monthly on the dates
 * the policy names — not only the 1st or the last day — and a register of
 * applications and balances worked out from them.
 */
const APRIL = { startMonth: 4, startDay: 1 };
const type = (over: Record<string, unknown> = {}) => ({
  id: 't', annualDays: 12, accrual: 'MONTHLY', prorateForJoiners: false, carryForwardMax: null as number | null, createdAt: new Date('2020-01-01T00:00:00Z'), creditOn: 'START', creditDay: null as number | null, ...over,
});

describe('leave periods', () => {
  it('names and bounds an April–March period by the year it starts in', () => {
    expect(periodOf(APRIL, '2027-02-10')).toBe(2026);
    expect(periodOf(APRIL, '2026-04-01')).toBe(2026);
    expect(periodOf(APRIL, '2026-03-31')).toBe(2025);
    expect(periodEnd(APRIL, 2026)).toBe('2027-03-31');
    expect(periodLabel(APRIL, 2026)).toBe('Apr 2026 – Mar 2027');
    expect(periodLabel({ startMonth: 7, startDay: 15 }, 2026)).toBe('15 Jul 2026 – 14 Jul 2027');
    expect(periodLabel(null, 2026)).toBe('2026');
  });
});

describe('credits on the policy’s dates', () => {
  it('credits monthly on the 10th, from the start of the period', () => {
    const t = type({ creditOn: 'DAY', creditDay: 10 });
    const c = creditsFor(t, 2026, '2020-01-01', { period: APRIL });
    expect(c.map((x) => x.date).slice(0, 3)).toEqual(['2026-04-10', '2026-05-10', '2026-06-10']);
    expect(c).toHaveLength(12);
    expect(earned(t, 2026, '2020-01-01', '2026-05-09', { period: APRIL })).toBe(1);
    expect(earned(t, 2026, '2020-01-01', '2026-05-10', { period: APRIL })).toBe(2);
  });

  it('credits a quarter’s days on its last day, and half a year at a time', () => {
    const q = creditsFor(type({ accrual: 'QUARTERLY', creditOn: 'END' }), 2026, '2020-01-01', { period: APRIL });
    expect(q.map((x) => [x.date, x.days])).toEqual([['2026-06-30', 3], ['2026-09-30', 3], ['2026-12-31', 3], ['2027-03-31', 3]]);
    const h = creditsFor(type({ accrual: 'HALF_YEARLY', annualDays: 15 }), 2026, '2020-01-01');
    expect(h.map((x) => [x.date, x.total])).toEqual([['2026-01-01', 7.5], ['2026-07-01', 15]]);
  });

  it('prorates a joiner’s part when the type says so, and credits nothing after leaving', () => {
    /* Joined 10 May: of the April–June quarter, May and June count. */
    const q = creditsFor(type({ accrual: 'QUARTERLY', prorateForJoiners: true }), 2026, '2026-05-10', { period: APRIL });
    expect(q[0]).toMatchObject({ date: '2026-05-10', days: 2 });
    const m = creditsFor(type(), 2026, '2020-01-01', { period: APRIL, left: '2026-08-20' });
    expect(m.map((x) => x.date)).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('carries what was left from one April–March period into the next', () => {
    const t = type({ accrual: 'YEARLY', carryForwardMax: 5, createdAt: new Date('2025-04-01T00:00:00Z') });
    const b = balanceFor(t, 2026, '2024-01-01', '2026-10-22', new Map(), new Map([[2025, 4]]), { period: APRIL });
    expect(b).toMatchObject({ carriedIn: 5, earned: 12, allocated: 17 });
  });
});

/* --------------------------------------------------------------------------- */

const { buildApp } = await import('../app.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);

describe('an April–March company', () => {
  it('credits on its dates, keeps leave inside a period, and keeps the register', async () => {
    const email = `period.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Period Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true } }).expect(200);

    await att(c, 'put', '/leave/settings', { startMonth: 4, startDay: 29 }).expect(400);
    const set = (await att(c, 'put', '/leave/settings', { startMonth: 4, startDay: 1 }).expect(200)).body;
    /* The April–March period today is in, in India (a fixed 2026 one stopped being current on 1 Apr 2027). */
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const P = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
    const label = `Apr ${P} – Mar ${P + 1}`;
    expect(set.current).toMatchObject({ year: P, from: `${P}-04-01`, to: `${P + 1}-03-31`, label });
    /* Two working days in a row in September, by when six monthly credits are in (Sunday is off). */
    const dayAt = (n: number) => new Date(Date.parse(`${P}-09-01T00:00:00Z`) + n * 86_400_000);
    let n = 0;
    while (dayAt(n).getUTCDay() === 0 || dayAt(n + 1).getUTCDay() === 0) n += 1;
    const [d1, d2] = [dayAt(n), dayAt(n + 1)].map((d) => d.toISOString().slice(0, 10));

    const t = (await att(c, 'post', '/leave/types', { name: 'Casual', annualDays: 12, accrual: 'MONTHLY', creditOn: 'DAY', creditDay: 10 }).expect(201)).body.type;
    await att(c, 'post', '/leave/types', { name: 'Odd', annualDays: 12, creditOn: 'DAY' }).expect(400);
    const p = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Period Person', code: 'P1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;

    /* Today is in period P, which runs to 31 March of the next year; leave across that day is refused. */
    const sep = (await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: d1, toDate: d2, reason: 'Family' }).expect(201)).body.request;
    await att(c, 'post', `/leave/requests/${sep.id}/approve`).expect(200);
    expect((await att(c, 'post', '/leave/requests', { employeeId: p.id, leaveTypeId: t.id, fromDate: `${P + 1}-03-31`, toDate: `${P + 1}-04-01`, reason: 'Across' }).expect(400)).body.error).toMatch(new RegExp(`${P + 1}-03-31`));

    const ledger = (await att(c, 'get', `/leave/ledger?employeeId=${p.id}`).expect(200)).body;
    expect(ledger.period).toMatchObject({ year: P, label });
    const lines = ledger.types.find((x: any) => x.type.id === t.id).entries;
    /* The period's first credit, on the 10th of April: credited, or still to come in its first days. */
    const first = `${P}-04-10`;
    expect(lines.filter((e: any) => e.kind === 'CREDIT' || e.kind === 'UPCOMING')[0]).toMatchObject({ date: first, kind: today >= first ? 'CREDIT' : 'UPCOMING' });
    /* The period's last credit: still to come, unless today is past it. */
    const last = `${P + 1}-03-10`;
    expect(lines.some((e: any) => e.kind === (today >= last ? 'CREDIT' : 'UPCOMING') && e.date === last)).toBe(true);

    const reg = (await att(c, 'get', `/leave/register?year=${P}`).expect(200)).body;
    const row = reg.rows.find((r: any) => r.employeeId === p.id && r.leaveTypeId === t.id);
    expect(row).toMatchObject({ taken: 2, pending: 0, opening: 0, lapsed: null });
    expect(row.closing).toBe(row.credited - 2);

    /* Applications of a period, for its register. */
    expect((await att(c, 'get', `/leave/requests?year=${P}`).expect(200)).body.requests.map((r: any) => r.id)).toEqual([sep.id]);
    expect((await att(c, 'get', `/leave/requests?year=${P - 1}`).expect(200)).body.requests).toHaveLength(0);
  }, 60_000);
});
