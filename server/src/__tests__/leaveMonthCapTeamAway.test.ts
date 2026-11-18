import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Leave type rules from the round 42 picks: a monthly limit (work from home
 * style) and a warning when part of the team is already away. Both are off
 * on every type until a company sets them.
 *
 * The calendar: 2 Nov 2026 is a Monday; the default week has Sunday off.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { planLeave } = await import('../routes/leave.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `lmc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `LMC Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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
const type = async (c: Ctx, body: Record<string, unknown>) => (await att(c, 'post', '/leave/types', { annualDays: 60, ...body }).expect(201)).body.type;
const ask = (c: Ctx, body: Record<string, unknown>) => att(c, 'post', '/leave/requests', { reason: 'Home', ...body });
const codes = (xs: Array<{ code: string }> | undefined) => (xs || []).map((x) => x.code);

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('a monthly limit', () => {
  it('is off by default and saved, cleared and checked on the type', async () => {
    const plain = await type(c, { name: `Plain ${rnd()}`, code: `P${rnd().slice(0, 3)}` });
    expect(plain.maxDaysPerMonth).toBeNull();
    expect(plain.teamAwayWarnAt).toBeNull();
    expect((await att(c, 'post', '/leave/types', { name: `Bad ${rnd()}`, maxDaysPerMonth: 40 }).expect(400)).body.error).toBeTruthy();
    const set = (await att(c, 'put', `/leave/types/${plain.id}`, { ...plain, maxDaysPerMonth: 4, teamAwayWarnAt: 2 }).expect(200)).body.type;
    expect([set.maxDaysPerMonth, set.teamAwayWarnAt]).toEqual([4, 2]);
    const cleared = (await att(c, 'put', `/leave/types/${plain.id}`, { ...set, maxDaysPerMonth: null, teamAwayWarnAt: null }).expect(200)).body.type;
    expect([cleared.maxDaysPerMonth, cleared.teamAwayWarnAt]).toEqual([null, null]);
  }, 60_000);

  it('stops the person past it, tells HR instead, and shows the days left month by month', async () => {
    const wfh = await type(c, { name: `Work from home ${rnd()}`, code: `W${rnd().slice(0, 3)}`, maxDaysPerMonth: 4 });
    const p = await person(c, { name: 'Home worker' });
    const asker = { id: p.id, branchId: null, status: 'ACTIVE' };
    /* Three days used in November, one waiting and one approved. */
    await ask(c, { employeeId: p.id, leaveTypeId: wfh.id, fromDate: '2026-11-02', toDate: '2026-11-03' }).expect(201);
    await ask(c, { employeeId: p.id, leaveTypeId: wfh.id, fromDate: '2026-11-05', toDate: '2026-11-05' }).expect(201);
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: wfh.id, fromDate: '2026-11-10', toDate: '2026-11-10', reason: 'Home' }).expect(200)).body;
    expect(preview.monthly).toEqual([{ month: '2026-11', limit: 4, before: 1, asked: 1, after: 0 }]);
    /* Two more days: one over. The person is stopped; HR entering it is warned. */
    const two = { leaveTypeId: wfh.id, fromDate: '2026-11-10', toDate: '2026-11-11', reason: 'Home' };
    const own = await planLeave(c.accountId, c.orgId, asker, two, false);
    expect('problems' in own && codes(own.problems)).toContain('MONTH_LIMIT');
    expect('problems' in own && own.problems.find((x) => x.code === 'MONTH_LIMIT')?.message).toMatch(/at most 4 days a month\. November has 1 day left; this asks 2 days/);
    const hr = await planLeave(c.accountId, c.orgId, asker, two, true);
    expect('problems' in hr && codes(hr.problems)).not.toContain('MONTH_LIMIT');
    expect('warnings' in hr && codes(hr.warnings)).toContain('MONTH_LIMIT');
    /* A half day fits in the one day left. */
    const half = await planLeave(c.accountId, c.orgId, asker, { ...two, toDate: '2026-11-10', halfDay: 'FIRST' }, false);
    expect('problems' in half && codes(half.problems)).not.toContain('MONTH_LIMIT');
    /* Across a month end each month is counted on its own: 30 Nov in November, 1 Dec in December. */
    const cross = await planLeave(c.accountId, c.orgId, asker, { ...two, fromDate: '2026-11-30', toDate: '2026-12-01' }, false);
    expect('monthly' in cross && cross.monthly.map((m: any) => [m.month, m.asked, m.after])).toEqual([['2026-11', 1, 0], ['2026-12', 1, 3]]);
    expect('problems' in cross && codes(cross.problems)).not.toContain('MONTH_LIMIT');
    /* A withdrawn request frees its days. */
    const mine = await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.findMany({ where: { orgId: c.orgId, employeeId: p.id }, orderBy: { fromDate: 'asc' } }));
    await runInTenant(c.orgId, () => peoplePrisma.leaveRequest.update({ where: { id: mine[0].id }, data: { status: 'CANCELLED' } }));
    const freed = await planLeave(c.accountId, c.orgId, asker, two, false);
    expect('problems' in freed && codes(freed.problems)).not.toContain('MONTH_LIMIT');
  }, 60_000);

  it('leaves a type without one untouched', async () => {
    const free = await type(c, { name: `Free ${rnd()}`, code: `F${rnd().slice(0, 3)}` });
    const p = await person(c, { name: 'No cap' });
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: p.id, leaveTypeId: free.id, fromDate: '2026-11-02', toDate: '2026-11-07', reason: 'Home' }).expect(200)).body;
    expect(preview.monthly).toEqual([]);
    expect(codes(preview.problems)).not.toContain('MONTH_LIMIT');
  }, 60_000);
});

describe('team away warning', () => {
  it('warns, never stops, once enough of the same manager’s team are away on those days', async () => {
    const warn = await type(c, { name: `Casual ${rnd()}`, code: `C${rnd().slice(0, 3)}`, teamAwayWarnAt: 2 });
    const quiet = await type(c, { name: `Quiet ${rnd()}`, code: `Q${rnd().slice(0, 3)}` });
    const boss = await person(c, { name: 'Lead' });
    const team = [];
    for (const name of ['One', 'Two', 'Three', 'Four']) team.push(await person(c, { name }));
    await runInTenant(c.orgId, () => peoplePrisma.employee.updateMany({ where: { id: { in: team.map((x) => x.id) } }, data: { reportingManagerId: boss.id, departmentId: null } }));
    const [a, b, d, me] = team;
    await ask(c, { employeeId: a.id, leaveTypeId: quiet.id, fromDate: '2026-11-16', toDate: '2026-11-17' }).expect(201);
    const ask1 = { leaveTypeId: warn.id, fromDate: '2026-11-17', toDate: '2026-11-18', reason: 'Errand' };
    const asker = { id: me.id, branchId: null, status: 'ACTIVE' };
    const one = await planLeave(c.accountId, c.orgId, asker, ask1, false);
    expect('warnings' in one && codes(one.warnings)).not.toContain('TEAM_AWAY');
    await ask(c, { employeeId: b.id, leaveTypeId: quiet.id, fromDate: '2026-11-18', toDate: '2026-11-18' }).expect(201);
    /* Someone away on other days does not count. */
    await ask(c, { employeeId: d.id, leaveTypeId: quiet.id, fromDate: '2026-11-25', toDate: '2026-11-25' }).expect(201);
    const two = await planLeave(c.accountId, c.orgId, asker, ask1, false);
    expect('warnings' in two && two.warnings.find((x) => x.code === 'TEAM_AWAY')?.message).toBe('2 of the team are already away on some of these days.');
    expect('problems' in two && two.problems).toEqual([]);
    /* The rule is the type's: off on a type without it. */
    const off = await planLeave(c.accountId, c.orgId, asker, { ...ask1, leaveTypeId: quiet.id }, false);
    expect('warnings' in off && codes(off.warnings)).not.toContain('TEAM_AWAY');
    /* The form shows it too, and the request still goes in. */
    const preview = (await att(c, 'post', '/leave/requests/preview', { employeeId: me.id, ...ask1 }).expect(200)).body;
    expect(codes(preview.warnings)).toContain('TEAM_AWAY');
    await ask(c, { employeeId: me.id, ...ask1 }).expect(201);
  }, 60_000);
});
