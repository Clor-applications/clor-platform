import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Attendance requests (TIME-LEAVE-DECISIONS.md, advanced build): four kinds
 * on one list and one approval. Work from home and on duty mark the working
 * days present with the kind on the record; permission excuses hours on the
 * day; a missed punch is the correction as it was. Each kind has a monthly
 * quota and a back-date window; a People-only company runs them too; the
 * employee app asks, changes and withdraws through the portal token.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean>): Promise<Ctx> {
  const email = `ar.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `AR Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `arc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) =>
  (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const days = async (c: Ctx, employeeId: string, from: string, to: string) => (await att(c, 'get', `/records?from=${from}&to=${to}&employeeId=${employeeId}`).expect(200)).body.records;
const REQUESTS_HR = ['ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE', 'PEOPLE::Employees::VIEW'];
/* A past working day in this test's own calendar: a Tuesday, a week ago or so. */
const pastTuesday = (() => {
  const d = new Date(Date.now() - 7 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
/* Future working days: the first full week of a month at least a month away, Sunday off by default. */
const nextMonth = (() => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 2);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const monday = d.toISOString().slice(0, 10);
  const plus = (n: number) => {
    const x = new Date(`${monday}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  return { month: monday.slice(0, 7), mon: monday, tue: plus(1), wed: plus(2), thu: plus(3), fri: plus(4), sat: plus(5), sun: plus(6), mon2: plus(7), tue2: plus(8), wed2: plus(9), far: plus(16) };
})();

describe('kinds, quotas and what approval does to the days', () => {
  let c: Ctx;
  let asha: any;
  let ravi: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
    asha = await person(c, { name: 'Asha', code: 'A1' });
    ravi = await person(c, { name: 'Ravi', code: 'A2' });
  }, 60_000);

  it('work from home is off until the company switches it on', async () => {
    const off = await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: nextMonth.mon, reason: 'Plumber coming' }).expect(400);
    expect(off.body.code).toBe('KIND_OFF');
    const rules = (await att(c, 'get', '/request-rules').expect(200)).body.rules;
    expect(rules.WFH).toMatchObject({ on: false, quotaPerMonth: 4, backDays: 7, approval: null });
    expect(rules.MISSED_PUNCH.on).toBe(true);
    const saved = (await att(c, 'put', '/request-rules', { WFH: { on: true }, ON_DUTY: { on: true }, PERMISSION: { on: true } }).expect(200)).body.rules;
    expect(saved.WFH.on).toBe(true);
    expect(saved.PERMISSION).toMatchObject({ on: true, hoursPerMonth: 4, maxMinutes: 120 });
  });

  it('the monthly quota counts used and waiting days and refuses the fifth, in plain words', async () => {
    const ask = async (date: string) => (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date, reason: 'Working from home' }).expect(201)).body.request;
    const r1 = await ask(nextMonth.mon);
    const r2 = await ask(nextMonth.tue);
    await ask(nextMonth.wed);
    await ask(nextMonth.thu);
    expect(r1.kind).toBe('WFH');
    expect(r1.history).toHaveLength(1);
    await att(c, 'post', `/requests/${r1.id}/approve`).expect(200);
    await att(c, 'post', `/requests/${r2.id}/approve`).expect(200);
    const u = (await att(c, 'get', `/requests/usage?employeeId=${asha.id}&month=${nextMonth.month}&kind=WFH`).expect(200)).body.usage.WFH;
    expect(u).toMatchObject({ used: 2, pending: 2, quota: 4, left: 0, unit: 'days' });
    const fifth = await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: nextMonth.fri, reason: 'One more' }).expect(409);
    expect(fifth.body.code).toBe('QUOTA');
    expect(fifth.body.error).toMatch(/You have used your 4 work-from-home days for/);
    /* The same day twice is an overlap, not a quota question. */
    expect((await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'WFH', date: nextMonth.mon, reason: 'Home day' }).expect(201)).body.request.id).toBeTruthy();
    expect((await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'WFH', date: nextMonth.mon, reason: 'again' }).expect(409)).body.code).toBe('OVERLAP');
    /* The list pages with counts per status, and filters by kind. */
    const list = (await att(c, 'get', `/requests?limit=10&kind=WFH&employeeId=${asha.id}`).expect(200)).body;
    expect(list.total).toBe(4);
    expect(list.counts).toMatchObject({ PENDING: 2, APPROVED: 2, all: 4 });
    expect(list.requests[0].employeeName).toBe('Asha');
  });

  it('an approved span marks the working days present as WFH, skips Sunday; cancelling before the date clears them', async () => {
    const r = (await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'WFH', date: nextMonth.fri, toDate: nextMonth.mon2, reason: 'Travel back' }).expect(201)).body.request;
    expect(r.toDate).toBe(nextMonth.mon2);
    await att(c, 'post', `/requests/${r.id}/approve`).expect(200);
    const marked = (await days(c, ravi.id, nextMonth.fri, nextMonth.mon2)).sort((a: any, b: any) => a.date.localeCompare(b.date));
    expect(marked.map((d: any) => [d.date, d.status, d.dayKind])).toEqual([
      [nextMonth.fri, 'PRESENT', 'WFH'],
      [nextMonth.sat, 'PRESENT', 'WFH'],
      [nextMonth.mon2, 'PRESENT', 'WFH'],
    ]);
    expect(marked[0].attendanceRequestId).toBe(r.id);
    const story = (await att(c, 'get', `/requests/${r.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toEqual(['Asked', 'Approved']);
    expect(story.days).toHaveLength(3);
    expect(story.usage).toMatchObject({ kind: 'WFH', used: 3 });
    const cancelled = (await att(c, 'post', `/requests/${r.id}/cancel`).expect(200)).body.request;
    expect(cancelled.status).toBe('CANCELLED');
    const after = await days(c, ravi.id, nextMonth.fri, nextMonth.mon2);
    expect(after.every((d: any) => d.dayKind === null && d.attendanceRequestId === null && d.status !== 'PRESENT')).toBe(true);
    /* A half day with no punches is present by the request (a company without punches); with punches it is worked out from them. */
    const half = (await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'WFH', date: nextMonth.tue2, halfDay: 'SECOND', reason: 'Afternoon at home' }).expect(201)).body.request;
    await att(c, 'post', `/requests/${half.id}/approve`).expect(200);
    const [h] = await days(c, ravi.id, nextMonth.tue2, nextMonth.tue2);
    expect(h).toMatchObject({ dayKind: 'WFH', attendanceRequestId: half.id, status: 'PRESENT' });
  });

  it('on duty needs a place; a waiting request can be changed and keeps its history', async () => {
    expect((await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'ON_DUTY', date: nextMonth.wed2, reason: 'Client visit' }).expect(400)).body.error).toMatch(/place/);
    const r = (await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'ON_DUTY', date: nextMonth.wed2, place: 'Peenya', reason: 'Client visit' }).expect(201)).body.request;
    expect(r.place).toBe('Peenya');
    const edited = (await att(c, 'put', `/requests/${r.id}`, { date: nextMonth.wed2, place: 'Whitefield', reason: 'Client visit, moved' }).expect(200)).body.request;
    expect(edited.place).toBe('Whitefield');
    expect(edited.history.map((h: any) => h.what)).toEqual(['ASKED', 'EDITED']);
    expect(edited.history[1].from).toMatchObject({ place: 'Peenya' });
    /* The edit stays inside the window: 14 days at most. */
    expect((await att(c, 'put', `/requests/${r.id}`, { date: nextMonth.mon, toDate: nextMonth.far, place: 'Whitefield', reason: 'Too long' }).expect(400)).body.error).toMatch(/14 days/);
  });

  it('permission caps the hours and stops the lateness inside its window counting', async () => {
    await att(c, 'put', '/records', { employeeId: asha.id, date: pastTuesday, checkIn: '10:00', checkOut: '19:00' }).expect(200);
    expect((await days(c, asha.id, pastTuesday, pastTuesday))[0].lateMinutes).toBe(60);
    expect((await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'PERMISSION', date: pastTuesday, checkIn: '09:00', checkOut: '12:00', reason: 'Bank' }).expect(400)).body.error).toMatch(/15 minutes and 2 hours/);
    const r = (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'PERMISSION', date: pastTuesday, checkIn: '09:00', checkOut: '10:00', reason: 'Bank' }).expect(201)).body.request;
    expect(r.minutes).toBe(60);
    /* A refusal of these kinds says why. */
    expect((await att(c, 'post', `/requests/${r.id}/reject`).expect(400)).body.error).toMatch(/Say why/);
    await att(c, 'post', `/requests/${r.id}/approve`).expect(200);
    const [d] = await days(c, asha.id, pastTuesday, pastTuesday);
    expect(d).toMatchObject({ lateMinutes: 0, dayKind: 'PERMISSION', attendanceRequestId: r.id, status: 'PRESENT' });
    /* The excuse survives the day being written again. */
    await att(c, 'put', '/records', { employeeId: asha.id, date: pastTuesday, checkIn: '10:00', checkOut: '19:30' }).expect(200);
    expect((await days(c, asha.id, pastTuesday, pastTuesday))[0]).toMatchObject({ lateMinutes: 0, dayKind: 'PERMISSION' });
    expect((await att(c, 'get', `/requests/usage?employeeId=${asha.id}&month=${pastTuesday.slice(0, 7)}`).expect(200)).body.usage.PERMISSION).toMatchObject({ used: 1, quota: 4, left: 3, unit: 'hours' });
  });

  it('a missed punch is the correction it always was: the default kind, the day written on approval', async () => {
    const r = (await att(c, 'post', '/requests', { employeeId: ravi.id, date: pastTuesday, checkIn: '09:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201)).body.request;
    expect(r.kind).toBe('MISSED_PUNCH');
    await att(c, 'post', `/requests/${r.id}/approve`).expect(200);
    expect((await days(c, ravi.id, pastTuesday, pastTuesday))[0]).toMatchObject({ status: 'PRESENT', source: 'REQUEST', dayKind: null });
    await att(c, 'post', `/requests/${r.id}/approve`).expect(409);
  });
});

describe('manager, then HR', () => {
  it('the manager (with a sign-in) takes the first step in People, HR the second; the same person cannot take both', async () => {
    const hr = await company({ people: true, attendance: true });
    const lead = await colleague(hr, REQUESTS_HR, true);
    const leadEmp = await person(hr, { name: 'Lead', code: 'L1' });
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    const report = await person(hr, { name: 'Report', code: 'L2', reportingManagerId: leadEmp.id });
    await att(hr, 'put', '/request-rules', { WFH: { on: true, approval: 'MANAGER_THEN_HR' } }).expect(200);
    const r = (await att(hr, 'post', '/requests', { employeeId: report.id, kind: 'WFH', date: nextMonth.mon, reason: 'Home' }).expect(201)).body.request;
    const early = await att(hr, 'post', `/requests/${r.id}/approve`).expect(409);
    expect(early.body.code).toBe('MANAGER_FIRST');
    expect(early.body.error).toMatch(/Lead has not approved/);
    const step = await att(lead, 'post', `/requests/${r.id}/approve`, { note: 'Fine by me' }).expect(200);
    expect(step.body.stage).toBe('HR');
    expect(step.body.request).toMatchObject({ status: 'PENDING', managerNote: 'Fine by me' });
    expect((await att(lead, 'post', `/requests/${r.id}/approve`).expect(403)).body.code).toBe('HR_STEP');
    const done = await att(hr, 'post', `/requests/${r.id}/approve`).expect(200);
    expect(done.body.request.status).toBe('APPROVED');
    expect(done.body.request.history.map((h: any) => h.what)).toEqual(['ASKED', 'MANAGER_APPROVED', 'APPROVED']);
    /* A team role sees its team's requests and nobody else's. */
    const stranger = await person(hr, { name: 'Stranger', code: 'L3' });
    await att(hr, 'post', '/requests', { employeeId: stranger.id, kind: 'WFH', date: nextMonth.mon, reason: 'Home' }).expect(201);
    expect((await att(lead, 'get', '/requests?limit=10').expect(200)).body.total).toBe(1);
  }, 60_000);
});

describe('a People-only company, and the employee app', () => {
  let c: Ctx;
  let asha: any;
  let boss: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    boss = await person(c, { name: 'Boss', code: 'B1' });
    asha = await person(c, { name: 'Asha', code: 'P1', reportingManagerId: boss.id });
  }, 60_000);

  it('runs work-from-home requests without Attendance', async () => {
    await att(c, 'put', '/request-rules', { WFH: { on: true } }).expect(200);
    const r = (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: nextMonth.mon, reason: 'Home' }).expect(201)).body.request;
    await att(c, 'post', `/requests/${r.id}/approve`).expect(200);
    expect((await days(c, asha.id, nextMonth.mon, nextMonth.mon))[0]).toMatchObject({ status: 'PRESENT', dayKind: 'WFH' });
  });

  it('the employee asks, changes and withdraws in the app; the manager decides from the app too', async () => {
    await att(c, 'put', '/request-rules', { WFH: { on: true } }).expect(200);
    const access = (await att(c, 'get', '/portal-access').expect(200)).body.company.code;
    const activate = async (employeeId: string, code: string) => {
      const issued = (await att(c, 'post', '/portal-access/codes', { employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
      const token = (await request(app).post('/api/portal/activate').send({ company: access, employeeCode: code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
      return {
        get: (p: string) => request(app).get(`/api/portal${p}`).set('Authorization', `Bearer ${token}`),
        post: (p: string, b: unknown = {}) => request(app).post(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
        put: (p: string, b: unknown = {}) => request(app).put(`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
      };
    };
    const me = await activate(asha.id, 'P1');
    const rules = (await me.get('/request-rules').expect(200)).body;
    expect(rules.kinds.map((k: any) => k.kind)).toEqual(['MISSED_PUNCH', 'WFH']);
    expect(rules.usage.WFH).toMatchObject({ quota: 4 });
    /* Too far back for the person; HR could still enter it. */
    expect((await me.post('/requests', { kind: 'WFH', date: '2026-01-05', reason: 'Long ago' }).expect(400)).body.code).toBe('TOO_OLD');
    const r = (await me.post('/requests', { kind: 'WFH', date: nextMonth.wed, reason: 'Home' }).expect(201)).body.request;
    expect(r.requestedByUserId).toBe(`portal:${asha.id}`);
    const mine = (await me.get(`/requests?month=${nextMonth.month}`).expect(200)).body;
    expect(mine.requests.find((x: any) => x.id === r.id)).toMatchObject({ kind: 'request', requestKind: 'WFH', canChange: true, canCancel: true });
    expect(mine.usage.WFH).toMatchObject({ used: 1, pending: 1, left: 2 });
    await me.put(`/requests/${r.id}`, { date: nextMonth.thu, reason: 'Home, Thursday' }).expect(200);
    /* The manager sees it in the app's queue and approves it there. */
    const mm = await activate(boss.id, 'B1');
    const queue = (await mm.get('/approvals').expect(200)).body;
    expect(queue.requests.map((x: any) => x.id)).toContain(r.id);
    expect(queue.requests[0]).toMatchObject({ type: 'request', kind: 'WFH', employeeName: 'Asha', date: nextMonth.thu });
    await mm.post(`/approvals/request/${r.id}`, { decision: 'approve' }).expect(200);
    expect((await days(c, asha.id, nextMonth.thu, nextMonth.thu))[0]).toMatchObject({ status: 'PRESENT', dayKind: 'WFH' });
    /* Approved, still ahead: the person may withdraw it, and the day goes back. */
    expect((await me.post(`/requests/${r.id}/cancel`).expect(200)).body.request.status).toBe('CANCELLED');
    expect((await days(c, asha.id, nextMonth.thu, nextMonth.thu))[0].dayKind).toBeNull();
    /* The old correction route still works, as a missed punch. */
    const corr = (await me.post('/corrections', { date: pastTuesday, checkIn: '09:00', reason: 'Reader was slow' }).expect(201)).body.request;
    expect(corr.kind).toBe('MISSED_PUNCH');
  }, 60_000);
});

describe('second audit (27 Oct 2026): a span over a month end, a half day without punches', () => {
  let c: Ctx;
  let dev: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: false });
    dev = await person(c, { name: 'Dev', code: 'D1' });
    await att(c, 'put', '/request-rules', { WFH: { on: true, quotaPerMonth: 2 } }).expect(200);
  }, 60_000);

  it('each month the span touches is checked against its own quota', async () => {
    /* The first working week two months out; the span runs from the last days of the month before it. */
    const d = new Date(`${nextMonth.mon}T00:00:00Z`);
    const before = (n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    const prev = [7, 6, 5, 4, 3, 2, 1].map(before).filter((x) => x.slice(0, 7) !== nextMonth.month && new Date(`${x}T00:00:00Z`).getUTCDay() !== 0);
    const twoBefore = prev.slice(-2);
    /* Two days already approved in the new month fill its quota. */
    await att(c, 'post', '/requests', { employeeId: dev.id, kind: 'WFH', date: nextMonth.wed, toDate: nextMonth.thu, reason: 'Fixed days' }).expect(201);
    const refused = await att(c, 'post', '/requests', { employeeId: dev.id, kind: 'WFH', date: twoBefore[0], toDate: nextMonth.mon, reason: 'Straddles' }).expect(409);
    expect(refused.body.code).toBe('QUOTA');
    expect(refused.body.error).toMatch(/used your 2|left for/);
    /* Inside the month before, the same days are fine. */
    await att(c, 'post', '/requests', { employeeId: dev.id, kind: 'WFH', date: twoBefore[0], toDate: twoBefore[1], reason: 'Month before' }).expect(201);
  });

  it('a half-day WFH with no punches makes the day present, never absent', async () => {
    const other = await person(c, { name: 'Quiet', code: 'D2' });
    const r = (await att(c, 'post', '/requests', { employeeId: other.id, kind: 'WFH', date: nextMonth.mon2, halfDay: 'FIRST', reason: 'Morning at home' }).expect(201)).body.request;
    await att(c, 'post', `/requests/${r.id}/approve`).expect(200);
    const day = (await days(c, other.id, nextMonth.mon2, nextMonth.mon2))[0];
    expect(day).toMatchObject({ status: 'PRESENT', dayKind: 'WFH' });
  });
});

describe('Attendance app on the shared engine (27 Oct 2026): bulk decisions, the people picker, suggestions', () => {
  let c: Ctx;
  let asha: any;
  let ravi: any;
  beforeAll(async () => {
    c = await company({ people: true, attendance: true });
    asha = await person(c, { name: 'Asha', code: 'S1' });
    ravi = await person(c, { name: 'Ravi', code: 'S2' });
    await att(c, 'put', '/request-rules', { WFH: { on: true }, ON_DUTY: { on: true } }).expect(200);
  }, 60_000);

  it('deciding several at once goes through the same decision as one: a WFH day is marked WFH, a missed punch writes the day, a refusal needs a note', async () => {
    const wfh = (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: nextMonth.mon, reason: 'Home' }).expect(201)).body.request;
    const punch = (await att(c, 'post', '/requests', { employeeId: ravi.id, date: pastTuesday, checkIn: '09:00', checkOut: '18:00', reason: 'Reader was down' }).expect(201)).body.request;
    const out = (await att(c, 'post', '/requests/bulk-review', { ids: [wfh.id, punch.id], approve: true }).expect(200)).body;
    expect(out).toMatchObject({ done: 2, failed: 0, handedOn: 0 });
    expect((await days(c, asha.id, nextMonth.mon, nextMonth.mon))[0]).toMatchObject({ status: 'PRESENT', dayKind: 'WFH', attendanceRequestId: wfh.id });
    expect((await days(c, ravi.id, pastTuesday, pastTuesday))[0]).toMatchObject({ status: 'PRESENT', source: 'REQUEST', dayKind: null });
    const story = (await att(c, 'get', `/requests/${wfh.id}`).expect(200)).body;
    expect(story.history.map((h: any) => h.what)).toEqual(['Asked', 'Approved']);
    /* Rejecting without a note: the missed punch keeps its old manners, the WFH is refused and says why. */
    const wfh2 = (await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'WFH', date: nextMonth.tue, reason: 'Home again' }).expect(201)).body.request;
    const pastMonday = new Date(new Date(`${pastTuesday}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const punch2 = (await att(c, 'post', '/requests', { employeeId: ravi.id, date: pastMonday, checkIn: '09:00', reason: 'Forgot' }).expect(201)).body.request;
    const refused = (await att(c, 'post', '/requests/bulk-review', { ids: [wfh2.id, punch2.id, wfh.id], approve: false }).expect(200)).body;
    expect(refused.done).toBe(1);
    expect(refused.failed).toBe(2);
    expect(refused.results.find((x: any) => x.id === wfh2.id).error).toMatch(/Say why/);
    expect(refused.results.find((x: any) => x.id === wfh.id).error).toMatch(/already approved/);
    const withNote = (await att(c, 'post', '/requests/bulk-review', { ids: [wfh2.id], approve: false, note: 'Office day' }).expect(200)).body;
    expect(withNote).toMatchObject({ done: 1, failed: 0 });
    expect((await att(c, 'get', `/requests/${wfh2.id}`).expect(200)).body.request).toMatchObject({ status: 'REJECTED', reviewNote: 'Office day' });
  });

  it('the people picker opens to anyone who may see leave or requests, not only days; a team-scoped role sees its team', async () => {
    const leaveOnly = await colleague(c, ['ATTENDANCE::Leave Requests::VIEW']);
    const names = (await att(leaveOnly, 'get', '/employees').expect(200)).body.employees.map((e: any) => e.name).sort();
    expect(names).toEqual(['Asha', 'Ravi']);
    const requestsOnly = await colleague(c, ['ATTENDANCE::Attendance Requests::VIEW']);
    expect((await att(requestsOnly, 'get', '/employees').expect(200)).body.employees).toHaveLength(2);
    const nobody = await colleague(c, ['ATTENDANCE::Holidays::VIEW']);
    await att(nobody, 'get', '/employees').expect(403);
    const ownOnly = await colleague(c, ['ATTENDANCE::Leave Requests::VIEW'], true);
    expect((await att(ownOnly, 'get', '/employees').expect(200)).body.employees).toEqual([]);
  });

  it('suggests the company’s own places and reasons from the leave engine, so Attendance alone gets them too', async () => {
    await att(c, 'post', '/requests', { employeeId: ravi.id, kind: 'ON_DUTY', date: nextMonth.wed, place: 'Peenya works', reason: 'Client visit' }).expect(201);
    const places = (await att(c, 'get', '/suggestions?field=place').expect(200)).body.values;
    expect(places.map((v: any) => v.value)).toContain('Peenya works');
    /* A reason counts once two people have used it. */
    const reasons = (await att(c, 'get', '/suggestions?field=requestReason').expect(200)).body.values.map((v: any) => v.value);
    expect(reasons).not.toContain('Client visit');
    await att(c, 'post', '/requests', { employeeId: asha.id, kind: 'ON_DUTY', date: nextMonth.wed, place: 'Peenya works', reason: 'Client visit' }).expect(201);
    expect((await att(c, 'get', '/suggestions?field=requestReason').expect(200)).body.values.map((v: any) => v.value)).toContain('Client visit');
    expect((await att(c, 'get', '/suggestions?field=salary').expect(200)).body.values).toEqual([]);
  });

  it('a company with Attendance only lists people and suggestions the same way', async () => {
    const only = await company({ people: false, attendance: true });
    const ok = (await att(only, 'get', '/employees').expect(200)).body;
    expect(ok.employees).toEqual([]);
    expect((await att(only, 'get', '/suggestions?field=leaveReason').expect(200)).body.values).toEqual([]);
  });
});
