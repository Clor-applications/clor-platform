import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The roster planner (platform audit 11 Nov 2026): a grid painted as a draft
 * and published in one go. A bulk change is one request, checked on the
 * server; a closed month refuses it; a draft moves nobody's day until it is
 * published; publishing tells each person whose days changed, once; and the
 * coverage row counts heads a shift a day against the shift's minimum.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { loadSchedule, resolveShift } = await import('../services/attendance/schedule.js');
const { isWeeklyOff } = await import('../services/attendance/compute.js');
const { rosterNotice } = await import('../services/attendance/roster.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
async function makeOwner(): Promise<Ctx> {
  const email = `roster.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Roster Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const person = async (c: Ctx, code: string, extra: Record<string, unknown> = {}) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01', ...extra }).expect(201)).body.employee;
const shift = async (c: Ctx, name: string, code: string, extra: Record<string, unknown> = {}) =>
  (await att(c).post('/shifts', { name, code, startTime: '09:00', endTime: '18:00', breakMinutes: 0, ...extra }).expect(201)).body.shift;
const close = async (c: Ctx, month: string) => att(c).post(`/months/${month}/close`, { acknowledge: true, ...(await att(c).get(`/months/${month}/readiness`)).body.noRecordConfirm }).expect(200);
const reopen = async (c: Ctx, month: string) => att(c).post(`/months/${month}/reopen`, { reason: 'Correct the roster' }).expect(200);
const grid = async (c: Ctx, q: string) => (await att(c).get(`/roster?${q}`).expect(200)).body;
const cellOf = (g: any, employeeId: string, d: string) => g.rows.find((r: any) => r.employeeId === employeeId).cells.find((x: any) => x.date === d);
const drafts = (c: Ctx) => peoplePrisma.rosterDay.count({ where: { orgId: c.orgId, state: 'DRAFT' } });
const published = (c: Ctx) => peoplePrisma.rosterDay.count({ where: { orgId: c.orgId, state: 'PUBLISHED' } });
const resolved = async (c: Ctx, employeeId: string, d: string) => {
  const r = resolveShift(await runInTenant(c.orgId, () => loadSchedule(c.orgId, [employeeId])), employeeId, d);
  return { shiftId: r.shiftId, source: r.source, off: isWeeklyOff(r.rule, d) };
};

describe('the notice, pure', () => {
  it('says the one day in its title, or counts the days and lists them in order', () => {
    expect(rosterNotice([{ date: '2026-12-09', line: 'Wed 9 Dec: Night 22:00–06:00' }])).toEqual({ title: 'Your roster changed: Wed 9 Dec: Night 22:00–06:00', body: null });
    const many = rosterNotice([
      { date: '2026-12-10', line: 'Thu 10 Dec: weekly off' },
      { date: '2026-12-09', line: 'Wed 9 Dec: Night 22:00–06:00' },
    ]);
    expect(many).toEqual({ title: 'Your roster changed on 2 days, from Wed 9 Dec', body: 'Wed 9 Dec: Night 22:00–06:00 · Thu 10 Dec: weekly off' });
    const long = rosterNotice(Array.from({ length: 15 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, line: `d${i + 1}` })));
    expect(long.body).toMatch(/· and 3 more$/);
  });
});

describe('painting the draft in one request', () => {
  let c: Ctx;
  let a: any;
  let b: any;
  let day: any;
  let night: any;
  beforeAll(async () => {
    c = await makeOwner();
    a = await person(c, 'R1');
    b = await person(c, 'R2');
    day = await shift(c, 'Day', 'D');
    night = await shift(c, 'Late', 'L', { startTime: '12:00', endTime: '20:00' });
  }, 120_000);

  it('sets a block of people and days at once, and shows it as a draft', async () => {
    const r = (await att(c).post('/roster/draft', { employeeIds: [a.id, b.id], dates: ['2026-12-08', '2026-12-09', '2026-12-10'], kind: 'SHIFT', shiftId: day.id }).expect(200)).body;
    expect(r).toMatchObject({ changed: 6, unchanged: 0, skippedCount: 0, draft: { days: 6, people: 2, from: '2026-12-08', to: '2026-12-10' } });
    const g = await grid(c, 'from=2026-12-07&to=2026-12-13');
    expect(g.days).toHaveLength(7);
    expect(cellOf(g, a.id, '2026-12-08')).toMatchObject({ kind: 'WORK', shiftId: day.id, code: 'D', draft: 'SHIFT', source: 'ROSTER' });
    expect(cellOf(g, a.id, '2026-12-07')).toMatchObject({ kind: 'WORK', shiftId: null, source: 'DEFAULT' });
    expect(cellOf(g, a.id, '2026-12-07').draft).toBeUndefined();
    /* A weekly off on a working day, and a shift on the Sunday. */
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-11'], kind: 'OFF' }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-13'], kind: 'SHIFT', shiftId: night.id }).expect(200);
    const g2 = await grid(c, 'from=2026-12-07&to=2026-12-13');
    expect(cellOf(g2, a.id, '2026-12-11')).toMatchObject({ kind: 'OFF', draft: 'OFF' });
    expect(cellOf(g2, a.id, '2026-12-13')).toMatchObject({ kind: 'WORK', code: 'L', draft: 'SHIFT' });
  });

  it('writes no draft where the day already is what was asked', async () => {
    const before = await drafts(c);
    /* Sunday is already off; a draft that says what another draft said is replaced, not doubled. */
    expect((await att(c).post('/roster/draft', { employeeIds: [b.id], dates: ['2026-12-06'], kind: 'OFF' }).expect(200)).body).toMatchObject({ changed: 0, unchanged: 1 });
    expect((await att(c).post('/roster/draft', { employeeIds: [b.id], dates: ['2026-12-08'], kind: 'SHIFT', shiftId: day.id }).expect(200)).body).toMatchObject({ changed: 1 });
    expect(await drafts(c)).toBe(before);
    /* Back to the schedule on a day with nothing published: the draft just goes. */
    expect((await att(c).post('/roster/draft', { employeeIds: [b.id], dates: ['2026-12-10'], kind: 'CLEAR' }).expect(200)).body).toMatchObject({ changed: 0, unchanged: 1 });
    expect(await drafts(c)).toBe(before - 1);
  });

  it('refuses a shift or a person that is not the company’s, and a switched-off shift', async () => {
    const other = await makeOwner();
    const theirs = await shift(other, 'Theirs', 'T');
    const stranger = await person(other, 'X1');
    const before = await drafts(c);
    expect((await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-15'], kind: 'SHIFT', shiftId: theirs.id }).expect(400)).body.error).toBe('That shift is not in this organisation.');
    expect((await att(c).post('/roster/draft', { employeeIds: [a.id, stranger.id], dates: ['2026-12-15'], kind: 'OFF' }).expect(400)).body.error).toBe('Someone chosen is not in this organisation.');
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-15'], kind: 'SHIFT' }).expect(400);
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['15 Dec'], kind: 'OFF' }).expect(400);
    await att(c).post('/roster/draft', { employeeIds: [], dates: ['2026-12-15'], kind: 'OFF' }).expect(400);
    const off = await shift(c, 'Retired', 'X', { isActive: false });
    expect((await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-15'], kind: 'SHIFT', shiftId: off.id }).expect(400)).body.error).toContain('switched off');
    expect(await drafts(c)).toBe(before);
  });

  it('skips a day the person is not employed on or a temporary schedule covers, and says so', async () => {
    const joiner = await person(c, 'R3', { dateOfJoining: '2026-12-16' });
    const r = (await att(c).post('/roster/draft', { employeeIds: [joiner.id], dates: ['2026-12-15', '2026-12-16'], kind: 'SHIFT', shiftId: day.id }).expect(200)).body;
    expect(r).toMatchObject({ changed: 1, skippedCount: 1, skipped: [{ employeeId: joiner.id, date: '2026-12-15', reason: 'NOT_EMPLOYED' }] });
    /* Nothing at all to write is a refusal with the reason, not "0 changed". */
    expect((await att(c).post('/roster/draft', { employeeIds: [joiner.id], dates: ['2026-12-14'], kind: 'OFF' }).expect(400)).body).toMatchObject({ code: 'NOT_EMPLOYED', error: 'Not employed on that day.' });
    await att(c).post('/temporary-schedules', { employeeIds: [a.id], shiftId: night.id, fromDate: '2026-12-17', toDate: '2026-12-17', reason: 'Cover' }).expect(201);
    const t = (await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-17', '2026-12-18'], kind: 'SHIFT', shiftId: day.id }).expect(200)).body;
    expect(t).toMatchObject({ changed: 1, skipped: [{ employeeId: a.id, date: '2026-12-17', reason: 'TEMPORARY' }] });
    expect(cellOf(await grid(c, 'from=2026-12-14&to=2026-12-20'), a.id, '2026-12-17')).toMatchObject({ code: 'L', source: 'TEMPORARY' });
  });

  it('copies a week, as planned, onto the weeks after it', async () => {
    /* The week of 7 Dec for A: Tue–Thu Day, Fri off, Sun Late (draft); Mon and Sat the standard day, which has no shift to copy. */
    const r = (await att(c).post('/roster/draft/copy-week', { employeeIds: [a.id], weekStart: '2026-12-07', weeks: 2 }).expect(200)).body;
    expect(r.changed).toBeGreaterThan(0);
    const next = await grid(c, 'from=2026-12-21&to=2026-12-27');
    expect(cellOf(next, a.id, '2026-12-22')).toMatchObject({ kind: 'WORK', code: 'D', draft: 'SHIFT' });
    expect(cellOf(next, a.id, '2026-12-25')).toMatchObject({ draft: 'OFF' });
    expect(cellOf(next, a.id, '2026-12-27')).toMatchObject({ kind: 'WORK', code: 'L', draft: 'SHIFT' });
    expect(cellOf(next, a.id, '2026-12-21').draft).toBeUndefined();
    expect(r.skipped.some((s: any) => s.reason === 'NO_SHIFT')).toBe(true);
    /* The week between took it too, except the day a temporary schedule holds. */
    const mid = await grid(c, 'from=2026-12-14&to=2026-12-20');
    expect(cellOf(mid, a.id, '2026-12-15')).toMatchObject({ code: 'D', draft: 'SHIFT' });
    expect(cellOf(mid, a.id, '2026-12-17')).toMatchObject({ source: 'TEMPORARY' });
    await att(c).post('/roster/draft/copy-week', { employeeIds: [a.id], weekStart: '2026-12-07', weeks: 13 }).expect(400);
  });

  it('pages the people, searches by name or code, and filters by shift', async () => {
    const all = await grid(c, 'month=2026-12&pageSize=2');
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(all.rows).toHaveLength(2);
    expect((await grid(c, 'month=2026-12&pageSize=2&page=2')).rows).toHaveLength(1);
    expect((await grid(c, 'month=2026-12&q=r2')).rows.map((r: any) => r.employeeId)).toEqual([b.id]);
    /* Only A is on Late anywhere in the month. */
    expect((await grid(c, `month=2026-12&shiftId=${night.id}`)).rows.map((r: any) => r.employeeId)).toEqual([a.id]);
    await att(c).get('/roster?from=2026-12-01&to=2027-02-28').expect(400);
  });

  it('discards the draft', async () => {
    expect(await drafts(c)).toBeGreaterThan(0);
    const r = (await att(c).del('/roster/draft').expect(200)).body;
    expect(r.discarded).toBeGreaterThan(0);
    expect(r.draft).toMatchObject({ days: 0, people: 0 });
    expect(await drafts(c)).toBe(0);
    expect((await att(c).post('/roster/publish').expect(400)).body.code).toBe('NOTHING_TO_PUBLISH');
  });
});

describe('a closed month', () => {
  it('refuses a draft that touches it, whole, and a publish once the month has closed', async () => {
    const c = await makeOwner();
    const p = await person(c, 'L1');
    const day = await shift(c, 'Day', 'D');
    await close(c, '2026-09');
    const refused = await att(c).post('/roster/draft', { employeeIds: [p.id], dates: ['2026-09-30', '2026-10-01'], kind: 'SHIFT', shiftId: day.id });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_MONTH_CLOSED', month: '2026-09' });
    expect(await drafts(c)).toBe(0);
    expect((await att(c).post('/roster/draft/copy-week', { employeeIds: [p.id], weekStart: '2026-09-14', weeks: 1 })).status).toBe(409);
    expect((await grid(c, 'from=2026-09-28&to=2026-10-04')).closedMonths).toEqual(['2026-09']);

    /* October is open: the draft is taken. It closes before the publish, which is then refused and changes nothing. */
    await att(c).post('/roster/draft', { employeeIds: [p.id], dates: ['2026-10-01'], kind: 'SHIFT', shiftId: day.id }).expect(200);
    await close(c, '2026-10');
    const late = await att(c).post('/roster/publish');
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    expect([await drafts(c), await published(c)]).toEqual([1, 0]);
    await reopen(c, '2026-10');
    expect((await att(c).post('/roster/publish').expect(200)).body).toMatchObject({ published: 1 });
    expect([await drafts(c), await published(c)]).toEqual([0, 1]);

    /* A shift on the published roster of a closed month keeps its times, and cannot be deleted. */
    await close(c, '2026-10');
    const change = await att(c).put(`/shifts/${day.id}`, { name: day.name, code: 'D', startTime: '10:00', endTime: '18:00', breakMinutes: 0, fullDayMinutes: 420 });
    expect(change.status).toBe(409);
    expect(change.body.code).toBe('ATTENDANCE_MONTH_CLOSED');
    await att(c).del(`/shifts/${day.id}`).expect(409);
  }, 120_000);
});

describe('draft, then published', () => {
  it('a draft moves nobody’s day; publishing does, and tells each person once with their days', async () => {
    const c = await makeOwner();
    const a = await person(c, 'P1');
    const b = await person(c, 'P2');
    const quiet = await person(c, 'P3');
    const night = await shift(c, 'Evening', 'E', { startTime: '13:00', endTime: '21:00' });
    const users = { a: `roster-user-${rnd()}${rnd()}`, b: `roster-user-${rnd()}${rnd()}` };
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: a.id }, data: { userId: users.a } }));
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: b.id }, data: { userId: users.b } }));
    const summary = async (employeeId: string) => (await att(c).get('/summary?month=2026-10').expect(200)).body.rows.find((r: any) => r.employeeId === employeeId);
    const offsBefore = (await summary(a.id)).weeklyOffs;

    /* A: Wed 7 Oct off, Thu 8 Oct on Evening. B: Thu 8 Oct on Evening. Quiet (no sign-in): Fri 9 Oct off. */
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-10-07'], kind: 'OFF' }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [a.id, b.id], dates: ['2026-10-08'], kind: 'SHIFT', shiftId: night.id }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [quiet.id], dates: ['2026-10-09'], kind: 'OFF' }).expect(200);

    /* Unpublished: the resolver, the schedule calendar and the month's figures are as they were. */
    expect(await resolved(c, a.id, '2026-10-07')).toEqual({ shiftId: null, source: 'DEFAULT', off: false });
    expect(await resolved(c, a.id, '2026-10-08')).toEqual({ shiftId: null, source: 'DEFAULT', off: false });
    const calendar = (await att(c).get('/schedule?month=2026-10').expect(200)).body.rows.find((r: any) => r.employeeId === a.id).cells;
    expect(calendar.find((x: any) => x.date === '2026-10-07')).toMatchObject({ kind: 'WORK', source: 'DEFAULT' });
    expect((await summary(a.id)).weeklyOffs).toBe(offsBefore);
    expect(await platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'attendance.roster_published' } })).toBe(0);

    const r = (await att(c).post('/roster/publish').expect(200)).body;
    expect(r).toMatchObject({ published: 4, people: 3, days: 4, notified: 2, from: '2026-10-07', to: '2026-10-09', draft: { days: 0 } });

    /* Published: the same three places now follow the roster. */
    expect(await resolved(c, a.id, '2026-10-07')).toEqual({ shiftId: null, source: 'ROSTER', off: true });
    expect(await resolved(c, a.id, '2026-10-08')).toEqual({ shiftId: night.id, source: 'ROSTER', off: false });
    const after = (await att(c).get('/schedule?month=2026-10').expect(200)).body.rows.find((x: any) => x.employeeId === a.id).cells;
    expect(after.find((x: any) => x.date === '2026-10-07')).toMatchObject({ kind: 'OFF', source: 'ROSTER' });
    expect(after.find((x: any) => x.date === '2026-10-08')).toMatchObject({ kind: 'WORK', code: 'E', source: 'ROSTER' });
    expect((await summary(a.id)).weeklyOffs).toBe(offsBefore + 1);

    /* One notice a person, with their days; nobody else's. */
    const notes = await platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: 'attendance.roster_published' } });
    expect(notes).toHaveLength(2);
    const mine = notes.filter((n) => n.userId === users.a);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Your roster changed on 2 days, from Wed 7 Oct', body: 'Wed 7 Oct: weekly off · Thu 8 Oct: Evening 13:00–21:00' });
    expect(notes.find((n) => n.userId === users.b)).toMatchObject({ title: 'Your roster changed: Thu 8 Oct: Evening 13:00–21:00', body: null });

    /* Nothing left to publish, and nobody is told twice. */
    await att(c).post('/roster/publish').expect(400);
    expect(await platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'attendance.roster_published' } })).toBe(2);

    /* A rostered shift on the shift's own weekly off is a working day. */
    await att(c).post('/roster/draft', { employeeIds: [b.id], dates: ['2026-10-11'], kind: 'SHIFT', shiftId: night.id }).expect(200);
    await att(c).post('/roster/publish').expect(200);
    expect(await resolved(c, b.id, '2026-10-11')).toEqual({ shiftId: night.id, source: 'ROSTER', off: false });

    /* Back to the schedule: the published day goes when that is published, and only A is told. */
    expect((await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-10-07'], kind: 'CLEAR' }).expect(200)).body).toMatchObject({ changed: 1 });
    expect(await resolved(c, a.id, '2026-10-07')).toMatchObject({ source: 'ROSTER', off: true });
    expect((await att(c).post('/roster/publish').expect(200)).body).toMatchObject({ published: 1, people: 1, notified: 1 });
    expect(await resolved(c, a.id, '2026-10-07')).toEqual({ shiftId: null, source: 'DEFAULT', off: false });
    expect(await platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'attendance.roster_published', userId: users.a } })).toBe(2);
  }, 120_000);
});

describe('coverage', () => {
  it('counts heads a shift a day, among the people listed and in the company, and marks a shift short of its minimum', async () => {
    const c = await makeOwner();
    const dept = (await request(app).post(`/api/orgs/${c.orgId}/people/structure/departments`).set(at(c)).send({ name: 'Stores' }).expect(201)).body.item;
    const a = await person(c, 'C1', { departmentId: dept.id });
    const b = await person(c, 'C2', { departmentId: dept.id });
    const d = await person(c, 'C3');
    /* The minimum is the shift's own, set on the shift screen: a whole number, or blank. */
    await att(c).post('/shifts', { name: 'Bad', startTime: '09:00', endTime: '18:00', breakMinutes: 0, minStaff: 0 }).expect(400);
    const early = await shift(c, 'Early', 'E', { minStaff: 3 });
    const late = await shift(c, 'Late', 'L', { startTime: '12:00', endTime: '20:00' });
    expect(early.minStaff).toBe(3);
    expect((await att(c).put(`/shifts/${late.id}`, { name: 'Late', code: 'L', startTime: '12:00', endTime: '20:00', breakMinutes: 0, minStaff: 1 }).expect(200)).body.shift.minStaff).toBe(1);
    expect((await att(c).put(`/shifts/${late.id}`, { name: 'Late', code: 'L', startTime: '12:00', endTime: '20:00', breakMinutes: 0, minStaff: '' }).expect(200)).body.shift.minStaff).toBeNull();
    await att(c).put(`/shifts/${late.id}`, { name: 'Late', code: 'L', startTime: '12:00', endTime: '20:00', breakMinutes: 0, minStaff: 1 }).expect(200);

    /* Tue 8 Dec: all three on Early. Wed 9 Dec: A and B on Early, D on Late. Thu 10 Dec: A on Early, B off, D on the standard day. */
    await att(c).post('/roster/draft', { employeeIds: [a.id, b.id, d.id], dates: ['2026-12-08'], kind: 'SHIFT', shiftId: early.id }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [a.id, b.id], dates: ['2026-12-09'], kind: 'SHIFT', shiftId: early.id }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [d.id], dates: ['2026-12-09'], kind: 'SHIFT', shiftId: late.id }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [a.id], dates: ['2026-12-10'], kind: 'SHIFT', shiftId: early.id }).expect(200);
    await att(c).post('/roster/draft', { employeeIds: [b.id], dates: ['2026-12-10'], kind: 'OFF' }).expect(200);

    const g = await grid(c, 'from=2026-12-07&to=2026-12-13');
    expect(g.shifts.map((s: any) => [s.name, s.minStaff])).toEqual([['Early', 3], ['Late', 1]]);
    const on = (x: any, date: string) => x.coverage.find((v: any) => v.date === date);
    expect(on(g, '2026-12-08')).toMatchObject({ counts: { [early.id]: 3 }, short: { [late.id]: 1 } });
    expect(on(g, '2026-12-09')).toMatchObject({ counts: { [early.id]: 2, [late.id]: 1 }, short: { [early.id]: 1 } });
    expect(on(g, '2026-12-10')).toMatchObject({ counts: { [early.id]: 1, '': 1 }, short: { [early.id]: 2, [late.id]: 1 } });
    /* Sunday: nobody works, so both shifts are short by their whole minimum. */
    expect(on(g, '2026-12-13')).toMatchObject({ counts: {}, short: { [early.id]: 3, [late.id]: 1 } });

    /* One department listed: its own head-count, and the shortfall still the company's. */
    const stores = await grid(c, `from=2026-12-07&to=2026-12-13&departmentId=${dept.id}`);
    expect(stores.total).toBe(2);
    expect(on(stores, '2026-12-08')).toMatchObject({ counts: { [early.id]: 2 }, company: { [early.id]: 3 } });
    expect(on(stores, '2026-12-08').short[early.id]).toBeUndefined();
    expect(on(stores, '2026-12-09')).toMatchObject({ counts: { [early.id]: 2 }, company: { [early.id]: 2, [late.id]: 1 }, short: { [early.id]: 1 } });

    /* The same numbers once published. */
    await att(c).post('/roster/publish').expect(200);
    expect(on(await grid(c, 'from=2026-12-07&to=2026-12-13'), '2026-12-09')).toMatchObject({ counts: { [early.id]: 2, [late.id]: 1 }, short: { [early.id]: 1 } });
  }, 120_000);
});
