import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Comp-off that expires (platform audit 11 Nov 2026, "Partial"):
 * - a leave type may say how many days comp-off credited to it lasts; none
 *   set, it never expires, and what was earned before never gets an expiry;
 * - each grant under it carries its last day, shown with the balance;
 * - the leave job reminds the person a week before, and lapses what is left
 *   after the last day, once.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { deliverOutbox } = await import('../services/people/outbox.js');
const { COMP_OFF_SUGGESTED_VALID_DAYS, compOffExpiresOn, expiringOf, grantsLeft } = await import('../services/attendance/compOff.js');
const { compOffExpiringFor, runCompOffExpiry } = await import('../services/attendance/leaveJobs.js');
const { addDays, todayIst } = await import('../utils/istDate.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

describe('comp-off expiry, on its own', () => {
  it('has no last day unless the leave type sets a validity', () => {
    expect(compOffExpiresOn(null, '2026-08-02', '2026-08-03')).toBeNull();
    expect(compOffExpiresOn(undefined, '2026-08-02', '2026-08-03')).toBeNull();
    expect(compOffExpiresOn(0, '2026-08-02', '2026-08-03')).toBeNull();
    expect(COMP_OFF_SUGGESTED_VALID_DAYS).toBe(90);
  });

  it('counts the validity from the day worked, and keeps a week for a day credited late', () => {
    expect(compOffExpiresOn(90, '2026-08-02', '2026-08-03')).toBe('2026-10-31');
    /* Worked in August, credited in December: already past 90 days, so a week from the credit. */
    expect(compOffExpiresOn(90, '2026-08-02', '2026-12-01')).toBe('2026-12-08');
  });

  it('takes leave from the grant that expires soonest, among those it can use', () => {
    const grants = [
      { id: 'old', workedOn: '2026-01-04', expiresOn: null, days: 1 },
      { id: 'b', workedOn: '2026-08-09', expiresOn: '2026-11-07', days: 1 },
      { id: 'a', workedOn: '2026-08-02', expiresOn: '2026-10-31', days: 1 },
    ];
    const left = (uses: Array<{ date: string; days: number }>) => Object.fromEntries(grantsLeft(grants, uses).map((g) => [g.id, g.left]));
    expect(left([])).toEqual({ a: 1, b: 1, old: 1 });
    expect(left([{ date: '2026-09-01', days: 1.5 }])).toEqual({ a: 0, b: 0.5, old: 1 });
    /* Taken before either was earned: only the old one can cover it. */
    expect(left([{ date: '2026-07-01', days: 1 }])).toEqual({ a: 1, b: 1, old: 0 });
    /* Taken after the first expired: it is not saved by that leave. */
    expect(left([{ date: '2026-11-03', days: 1 }])).toEqual({ a: 1, b: 0, old: 1 });
  });

  it('shows what expires soonest first, never more than the balance, and nothing already gone', () => {
    const left = grantsLeft(
      [
        { id: 'a', workedOn: '2026-08-02', expiresOn: '2026-10-31', days: 1 },
        { id: 'b', workedOn: '2026-08-09', expiresOn: '2026-11-07', days: 1 },
        { id: 'gone', workedOn: '2026-05-03', expiresOn: '2026-08-01', days: 1, lapsedAt: new Date(), lapsedDays: 1 },
        { id: 'old', workedOn: '2026-01-04', expiresOn: null, days: 1 },
      ],
      [],
    );
    expect(expiringOf(left, 3, '2026-10-01')).toEqual([{ days: 1, expiresOn: '2026-10-31', workedOn: '2026-08-02' }, { days: 1, expiresOn: '2026-11-07', workedOn: '2026-08-09' }]);
    expect(expiringOf(left, 1.5, '2026-10-01')).toEqual([{ days: 1, expiresOn: '2026-10-31', workedOn: '2026-08-02' }, { days: 0.5, expiresOn: '2026-11-07', workedOn: '2026-08-09' }]);
    expect(expiringOf(left, 0, '2026-10-01')).toEqual([]);
    expect(expiringOf(undefined, 3, '2026-10-01')).toEqual([]);
  });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `co.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CO Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);

const TODAY = todayIst();
const ago = (n: number) => addDays(TODAY, -n);

describe('comp-off expiry in a company', () => {
  let hr: Ctx;
  let ownerId: string;
  let asha: any; // linked to the owner's sign-in, so she has a "my leave" and gets notifications
  let ravi: any; // no sign-in
  let type: any;
  const grant = async (employeeId: string, workedOn: string, days = 1) => (await att(hr, 'post', '/leave/comp-off', { employeeId, workedOn, days, reason: 'Stock count' }).expect(201)).body.adjustment;
  const row = (id: string) => runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.findUniqueOrThrow({ where: { id } }));
  const setExpiry = (id: string, expiresOn: string) => runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.update({ where: { id }, data: { expiresOn } }));
  const myType = async () => (await att(hr, 'get', '/me/leave').expect(200)).body.types.find((t: any) => t.id === type.id);
  const lapses = (employeeId: string) => runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.findMany({ where: { orgId: hr.orgId, employeeId, kind: 'LAPSE' } }));
  let g0: any;
  let g1: any;
  let g2: any;
  let g3: any;

  beforeAll(async () => {
    hr = await company();
    ownerId = (await platformPrisma.userOrgMembership.findFirst({ where: { orgId: hr.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))!.userId;
    const person = async (body: Record<string, unknown>) => (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ dateOfJoining: '2025-01-01', ...body }).expect(201)).body.employee;
    asha = await person({ name: 'Asha', code: 'A1' });
    ravi = await person({ name: 'Ravi', code: 'R1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { userId: ownerId } }));
    /* Carries over a year end, so a run of this test in January reads the same balance. */
    type = (await att(hr, 'post', '/leave/types', { name: 'Comp-off', code: 'CO', annualDays: 0, carryForwardMax: 30 }).expect(201)).body.type;
    const rules = (await att(hr, 'get', '/overtime/rules').expect(200)).body.rules;
    await att(hr, 'put', '/overtime/rules', { ...rules, compOffEnabled: true, compOffLeaveTypeId: type.id }).expect(200);
  });

  it('with no validity on the type, comp-off has no last day, as before', async () => {
    expect(type.compOffValidDays).toBeNull();
    g0 = await grant(asha.id, ago(25));
    expect((await row(g0.id)).expiresOn).toBeNull();
    const t = await myType();
    expect(t.available).toBe(1);
    expect(t.expiring).toEqual([]);
  });

  it('a validity can be set on a type already in use, and is said on the overtime rules', async () => {
    await att(hr, 'put', `/leave/types/${type.id}`, { name: 'Comp-off', code: 'CO', annualDays: 0, carryForwardMax: 30, compOffValidDays: 0 }).expect(400);
    type = (await att(hr, 'put', `/leave/types/${type.id}`, { name: 'Comp-off', code: 'CO', annualDays: 0, carryForwardMax: 30, compOffValidDays: 90 }).expect(200)).body.type;
    expect(type.compOffValidDays).toBe(90);
    const types = (await att(hr, 'get', '/overtime/rules').expect(200)).body.leaveTypes;
    expect(types.find((t: any) => t.id === type.id).compOffValidDays).toBe(90);
    /* What was earned before the validity keeps no last day. */
    expect((await row(g0.id)).expiresOn).toBeNull();
  });

  it('each grant made under it carries its last day, shown with the balance soonest first', async () => {
    g1 = await grant(asha.id, ago(20));
    g2 = await grant(asha.id, ago(12));
    g3 = await grant(asha.id, ago(5), 0.5);
    expect((await row(g1.id)).expiresOn).toBe(addDays(ago(20), 90));
    expect((await row(g3.id)).expiresOn).toBe(addDays(ago(5), 90));
    const t = await myType();
    expect(t.available).toBe(3.5);
    expect(t.expiring).toEqual([
      { days: 1, expiresOn: addDays(ago(20), 90), workedOn: ago(20) },
      { days: 1, expiresOn: addDays(ago(12), 90), workedOn: ago(12) },
      { days: 0.5, expiresOn: addDays(ago(5), 90), workedOn: ago(5) },
    ]);
  });

  it('comp-off approved from an employee’s request carries its last day too', async () => {
    const worked = ago(3);
    const asked = await runInTenant(hr.orgId, () => peoplePrisma.overtimeRequest.create({ data: { accountId: ravi.accountId, orgId: hr.orgId, employeeId: ravi.id, date: worked, kind: 'COMP_OFF', minutes: 480, days: 1, reason: 'Sunday dispatch' } }));
    await att(hr, 'post', `/overtime/requests/${asked.id}/approve`, {}).expect(200);
    const made = await runInTenant(hr.orgId, () => peoplePrisma.leaveAdjustment.findFirstOrThrow({ where: { orgId: hr.orgId, employeeId: ravi.id, workedOn: worked } }));
    expect(made.expiresOn).toBe(addDays(worked, 90));
  });

  it('leave taken uses the grant that expires soonest', async () => {
    await runInTenant(hr.orgId, () => peoplePrisma.leaveRequest.create({ data: { accountId: asha.accountId, orgId: hr.orgId, employeeId: asha.id, leaveTypeId: type.id, fromDate: ago(2), toDate: ago(2), days: 1, reason: 'Rest', status: 'APPROVED', requestedByUserId: ownerId } }));
    const t = await myType();
    expect(t.available).toBe(2.5);
    expect(t.expiring.map((e: any) => [e.days, e.workedOn])).toEqual([[1, ago(12)], [0.5, ago(5)]]);
  });

  it('nothing is lapsed or said while every last day is more than a week away', async () => {
    expect(await runCompOffExpiry()).toEqual({ lapsed: 0, reminded: 0 });
  });

  it('a week before the last day the person is told once, in the bell and in the employee app; a day already used is not mentioned', async () => {
    /* The first grant (used by the leave above) and the second (unused) both come within a week. */
    await setExpiry(g1.id, addDays(TODAY, 3));
    await setExpiry(g2.id, addDays(TODAY, 5));
    expect(await runCompOffExpiry()).toEqual({ lapsed: 0, reminded: 1 });
    expect((await row(g2.id)).expiryRemindedAt).not.toBeNull();
    expect((await row(g1.id)).expiryRemindedAt).toBeNull();
    await deliverOutbox(new Date(), 5000);
    const notes = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, userId: ownerId, dedupeKey: { startsWith: 'comp-off-expiry:' } } });
    expect(notes).toHaveLength(1);
    expect(notes[0].dedupeKey).toBe(`comp-off-expiry:${g2.id}`);
    expect(notes[0].kind).toBe('attendance.leave_lapse');
    expect(notes[0].title).toMatch(/^1 day of Comp-off expires on /);
    expect(notes[0].body).toMatch(/^Earned for work on .+\. Take it by then, or it lapses\.$/);
    /* A second run the same day, or the next, says nothing more. */
    expect(await runCompOffExpiry()).toEqual({ lapsed: 0, reminded: 0 });
    expect(await runCompOffExpiry(addDays(TODAY, 1))).toEqual({ lapsed: 0, reminded: 0 });
    const feed = await runInTenant(hr.orgId, () => compOffExpiringFor(asha.accountId, hr.orgId, asha.id));
    expect(feed).toEqual([{ id: g2.id, leaveType: 'Comp-off', days: 1, workedOn: ago(12), expiresOn: addDays(TODAY, 5) }]);
  });

  it('a grant already used takes nothing back when its last day passes', async () => {
    await setExpiry(g1.id, ago(1));
    expect((await runCompOffExpiry()).lapsed).toBe(1);
    const used = await row(g1.id);
    expect(used.lapsedAt).not.toBeNull();
    expect(used.lapsedDays).toBe(0);
    expect(await lapses(asha.id)).toHaveLength(0);
    expect((await myType()).available).toBe(2.5);
  });

  it('on its last day it can still be used; the day after, what is left lapses, once', async () => {
    await setExpiry(g2.id, TODAY);
    expect((await runCompOffExpiry()).lapsed).toBe(0);
    expect((await myType()).expiring[0]).toMatchObject({ days: 1, expiresOn: TODAY, workedOn: ago(12) });

    await setExpiry(g2.id, ago(1));
    expect((await runCompOffExpiry()).lapsed).toBe(1);
    const after = await row(g2.id);
    expect(after.lapsedAt).not.toBeNull();
    expect(after.lapsedDays).toBe(1);
    const made = await lapses(asha.id);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ days: -1, kind: 'LAPSE', leaveTypeId: type.id, createdByUserId: 'system', workedOn: null });
    expect(made[0].reason).toMatch(/^Comp-off for .+ was not used by .+: 1 day lapsed$/);
    const t = await myType();
    expect(t.available).toBe(1.5);
    expect(t.expiring.map((e: any) => [e.days, e.workedOn])).toEqual([[0.5, ago(5)]]);

    expect((await runCompOffExpiry()).lapsed).toBe(0);
    expect(await lapses(asha.id)).toHaveLength(1);
  });

  it('what was earned before the validity is never touched', async () => {
    const old = await row(g0.id);
    expect(old.expiresOn).toBeNull();
    expect(old.lapsedAt).toBeNull();
    /* The same day can still not be granted twice, lapsed or not. */
    await att(hr, 'post', '/leave/comp-off', { employeeId: asha.id, workedOn: ago(12), days: 1, reason: 'Again' }).expect(409);
  });
});
