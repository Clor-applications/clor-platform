import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Attendance's and Workspace's own automations (platform audit, 11 Nov 2026: the registry listed both modules
 * and neither had a recipe). Each recipe: listed on its module's screen and off until switched on; sends
 * nothing while off; once on, tells the right people once; a second run the same day, and the next day's
 * run for the things that happen once, sends nothing more.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const A = await import('../services/people/engagement/automations.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(features: Record<string, boolean> = { people: true, attendance: true }): Promise<Ctx> {
  const email = `modauto.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Mod Auto ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id } as Ctx;
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features }).expect(200);
  c.accountId = (await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } }))!.accountId;
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return c;
}
async function withRole(boss: Ctx, label: string, name: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id };
}
const api = (c: Ctx, m: 'get' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
const put = (c: Ctx, module: string, automations: Record<string, unknown>) => api(c, 'put', `/automations?module=${module}`, { automations });
const person = async (c: Ctx, name: string) => (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name, code: `M-${rnd()}`, dateOfJoining: '2024-01-01' }).expect(201)).body.employee;

/* A clock the recipes are handed: the 10th of this month, 10 in the morning in India, and the mornings after. */
const MONTH = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
const morning = (day: number) => new Date(`${MONTH}-${String(day).padStart(2, '0')}T10:00:00+05:30`);
const DAY = 86_400_000;
const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
const lastMonth = () => { const [y, m] = MONTH.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };

/** The daily job's visit to one company, as the job makes it. */
const run = (c: Ctx, now: Date) => runInTenant(c.orgId, () => A.runCompany(c.accountId, c.orgId, now, { respectHours: true }));
const bells = (c: Ctx, kind: string, userId?: string) => runInTenant(c.orgId, () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind, ...(userId ? { userId } : {}) }, select: { userId: true, title: true, body: true, linkJson: true } }));
const ran = (c: Ctx, key: string, now: Date) => runInTenant(c.orgId, () => peoplePrisma.automationRun.findFirst({ where: { orgId: c.orgId, key, ranOn: `${MONTH}-${String(new Date(now.getTime() + 330 * 60_000).getUTCDate()).padStart(2, '0')}` } }));

describe('the screens', () => {
  let c: Ctx;
  let viewer: Ctx;
  beforeAll(async () => {
    c = await company();
    viewer = await withRole(c, 'Viewer', 'Vani Viewer');
  }, 60_000);

  it('Attendance and Workspace each list their own three recipes, all off, with a number of days', async () => {
    const att = (await api(c, 'get', '/automations?module=attendance').expect(200)).body;
    expect(att.canEdit).toBe(true);
    expect(att.automations.map((a: any) => a.key)).toEqual(['attendance.monthNotLocked', 'attendance.readersSilent', 'attendance.requestsWaiting']);
    const ws = (await api(c, 'get', '/automations?module=workspace').expect(200)).body;
    expect(ws.canEdit).toBe(true);
    expect(ws.automations.map((a: any) => a.key)).toEqual(['workspace.invitationWaiting', 'workspace.adminNoAuthenticator', 'workspace.closureSoon']);
    for (const a of [...att.automations, ...ws.automations]) {
      expect(a).toMatchObject({ on: false, defaultOn: false, managedIn: null, channels: ['bell'], channelOptions: null, nextRun: null });
      expect(a.sentence.split('{n}')).toHaveLength(2);
      expect(a.n).toBeGreaterThanOrEqual(a.range.min);
    }
    expect(att.automations[0]).toMatchObject({ n: 5, to: [{ value: 'HR', label: null }], recipients: { options: ['HR', 'OWNER', 'PERSON'] } });
    expect(att.automations[2]).toMatchObject({ n: 2, to: null, recipients: null });
    expect(ws.automations[1]).toMatchObject({ n: 7, to: [{ value: 'OWNER', label: null }], recipients: { options: ['OWNER', 'PERSON'] } });
    /* People's list is as it was: none of these, and the two attendance reminders it always had. */
    const people = (await api(c, 'get', '/automations?module=people').expect(200)).body.automations.map((a: any) => a.key);
    expect(people).toHaveLength(17);
    expect(people).toEqual(expect.arrayContaining(['missingPunch', 'absence']));
  });

  it('Workspace: changed with the company profile’s right, saved under its own module only, and audited', async () => {
    const seen = (await api(viewer, 'get', '/automations?module=workspace').expect(200)).body;
    expect(seen).toMatchObject({ canEdit: false, users: [] });
    await put(viewer, 'workspace', { 'workspace.closureSoon': { on: true } }).expect(403);
    await put(viewer, 'attendance', { 'attendance.readersSilent': { on: true } }).expect(403);
    expect((await put(c, 'people', { 'workspace.closureSoon': { on: true } }).expect(400)).body.error).toMatch(/no such/);
    expect((await put(c, 'workspace', { 'workspace.closureSoon': { n: 31 } }).expect(400)).body.error).toMatch(/1 to 30/);
    const since = new Date();
    const saved = (await put(c, 'workspace', { 'workspace.closureSoon': { on: true, n: 10 } }).expect(200)).body.automations.find((a: any) => a.key === 'workspace.closureSoon');
    expect(saved).toMatchObject({ on: true, n: 10 });
    const audit = await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'EngagementSettings', createdAt: { gte: since } } });
    expect(audit).toHaveLength(1);
    expect(audit[0].message).toMatch(/workspace\.closureSoon on \(10\) to OWNER/);
    await api(c, 'get', '/automations/workspace.closureSoon/history').expect(200);
    await api(viewer, 'get', '/automations/workspace.closureSoon/history').expect(403);
  }, 60_000);
});

describe('Attendance recipes', () => {
  let c: Ctx;
  let hr: Ctx;
  let viewer: Ctx;
  let emp: { id: string };
  const now = morning(10);
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hema HR');
    viewer = await withRole(c, 'Viewer', 'Vani Viewer');
    emp = await person(c, 'Ravi Worker');
    await peoplePrisma.attendanceRecord.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, date: `${lastMonth()}-15`, status: 'PRESENT', createdByUserId: c.userId } });
    await peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, createdByUserId: c.userId, serialNumber: `SIL-${rnd()}${rnd()}`, name: 'Gate reader', lastSeenAt: before(now, 3) } });
    await peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, createdByUserId: c.userId, serialNumber: `LIV-${rnd()}${rnd()}`, name: 'Office reader', lastSeenAt: before(now, 0.01) } });
    await peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, createdByUserId: c.userId, serialNumber: `NEW-${rnd()}${rnd()}`, name: 'Unboxed reader', lastSeenAt: null } });
    await peoplePrisma.attendanceRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, date: `${MONTH}-05`, reason: 'Forgot to punch out', requestedByUserId: 'portal:ravi', createdAt: before(now, 3) } });
    await peoplePrisma.attendanceRequest.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, date: `${MONTH}-09`, reason: 'Reader was down', requestedByUserId: 'portal:ravi', createdAt: before(now, 0.5) } });
    /* A row to save switches in, with nothing of Attendance's on yet. */
    await put(c, 'people', { birthdays: { on: false } }).expect(200);
  }, 90_000);

  it('switched off, nothing is sent and nothing is recorded', async () => {
    const done = await run(c, now);
    expect(Object.keys(done).filter((k) => k.startsWith('attendance.'))).toEqual([]);
    for (const kind of ['attendance.month_open', 'reader.silent', 'attendance.requests_waiting']) expect(await bells(c, kind)).toEqual([]);
    expect(await runInTenant(c.orgId, () => peoplePrisma.automationRun.count({ where: { orgId: c.orgId, key: { startsWith: 'attendance.' } } }))).toBe(0);
  });

  it('last month not locked: HR hears from the chosen day, once a day, and not once it is locked', async () => {
    await put(c, 'attendance', { 'attendance.monthNotLocked': { on: true, n: 12 } }).expect(200);
    /* The 10th, with the 12th chosen: too early. */
    expect((await run(c, now))['attendance.monthNotLocked']).toBe(0);
    expect(await bells(c, 'attendance.month_open')).toEqual([]);
    await put(c, 'attendance', { 'attendance.monthNotLocked': { n: 5 } }).expect(200);
    const day2 = morning(11);
    expect((await run(c, day2))['attendance.monthNotLocked']).toBe(2);
    const told = await bells(c, 'attendance.month_open');
    /* HR is whoever may edit employees: the HR Manager and the owner, not a viewer. */
    expect(told.map((t) => t.userId).sort()).toEqual([c.userId, hr.userId].sort());
    expect(told[0].title).toMatch(/attendance is not locked yet$/);
    expect(JSON.parse(told[0].linkJson!)).toEqual({ app: 'attendance', screen: 'monthClose' });
    /* A second wake the same day: claimed already. */
    expect(await run(c, new Date(day2.getTime() + 3_600_000))).not.toHaveProperty('attendance.monthNotLocked');
    expect((await ran(c, 'attendance.monthNotLocked', day2))!.count).toBe(2);
    expect(await bells(c, 'attendance.month_open')).toHaveLength(2);
    /* The next morning it is one refreshed notice each, not a second row. */
    expect((await run(c, morning(12)))['attendance.monthNotLocked']).toBe(2);
    expect(await bells(c, 'attendance.month_open')).toHaveLength(2);
    /* Locked: nothing more. */
    await peoplePrisma.attendanceMonthLock.create({ data: { accountId: c.accountId, orgId: c.orgId, month: lastMonth(), lockedByUserId: c.userId } });
    expect((await run(c, morning(13)))['attendance.monthNotLocked']).toBe(0);
    await put(c, 'attendance', { 'attendance.monthNotLocked': { on: false } }).expect(200);
  }, 60_000);

  it('readers gone quiet: only the chosen person hears, about the reader that stopped, once a day', async () => {
    await put(c, 'attendance', { 'attendance.readersSilent': { on: true, n: 2, to: [`PERSON:${hr.userId}`] } }).expect(200);
    const day = morning(14);
    /* By the 14th the Gate reader has been quiet a week; the Office reader is brought up to date. */
    await peoplePrisma.attendanceDevice.updateMany({ where: { orgId: c.orgId, name: 'Office reader' }, data: { lastSeenAt: before(day, 0.01) } });
    expect((await run(c, day))['attendance.readersSilent']).toBe(1);
    const told = await bells(c, 'reader.silent');
    expect(told.map((t) => t.userId)).toEqual([hr.userId]);
    expect(told[0].title).toBe('Gate reader has sent nothing for 2 days or more');
    expect(await run(c, new Date(day.getTime() + 3_600_000))).not.toHaveProperty('attendance.readersSilent');
    expect(await bells(c, 'reader.silent')).toHaveLength(1);
    expect((await ran(c, 'attendance.readersSilent', day))).toMatchObject({ count: 1, recipients: ['Hema HR'] });
    /* It reconnects: the next morning says nothing. */
    await peoplePrisma.attendanceDevice.updateMany({ where: { orgId: c.orgId, name: 'Gate reader' }, data: { lastSeenAt: before(morning(15), 0.01) } });
    expect((await run(c, morning(15)))['attendance.readersSilent']).toBe(0);
    await put(c, 'attendance', { 'attendance.readersSilent': { on: false } }).expect(200);
  }, 60_000);

  it('attendance fixes waiting: each approver hears how many are old enough, once a day', async () => {
    await put(c, 'attendance', { 'attendance.requestsWaiting': { on: true, n: 2 } }).expect(200);
    const day = morning(16);
    /* By the 16th both have waited more than two days. */
    const done = await run(c, day);
    expect(done['attendance.requestsWaiting']).toBeGreaterThanOrEqual(1);
    const mine = await bells(c, 'attendance.requests_waiting', c.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('2 attendance fixes have waited 2 days or more');
    expect(await bells(c, 'attendance.requests_waiting', viewer.userId)).toEqual([]);
    const all = (await bells(c, 'attendance.requests_waiting')).length;
    expect(await run(c, new Date(day.getTime() + 3_600_000))).not.toHaveProperty('attendance.requestsWaiting');
    expect(await bells(c, 'attendance.requests_waiting')).toHaveLength(all);
    /* Decided: nothing waits, nobody is told. */
    await peoplePrisma.attendanceRequest.updateMany({ where: { orgId: c.orgId }, data: { status: 'APPROVED' } });
    expect((await run(c, morning(17)))['attendance.requestsWaiting']).toBe(0);
  }, 60_000);
});

describe('Workspace recipes', () => {
  let c: Ctx;
  let hr: Ctx;
  const now = morning(10);
  let inviteId = '';
  beforeAll(async () => {
    c = await company();
    hr = await withRole(c, 'HR Manager', 'Hema HR');
    const grants = JSON.stringify([{ orgId: c.orgId, branchIds: [], roleIds: [] }]);
    inviteId = (await platformPrisma.accountInvitation.create({ data: { accountId: c.accountId, email: `late.${rnd()}@example.com`, grants, tokenHash: `t-${rnd()}${rnd()}${rnd()}`, expiresAt: new Date(now.getTime() + 10 * DAY), invitedByUserId: hr.userId, lastSentAt: before(now, 4), createdAt: before(now, 4) } })).id;
    /* Not old enough (and lapsed before it is), already accepted, and one into another company: none of these is this company's to remind about. */
    await platformPrisma.accountInvitation.create({ data: { accountId: c.accountId, email: `fresh.${rnd()}@example.com`, grants, tokenHash: `t-${rnd()}${rnd()}${rnd()}`, expiresAt: new Date(now.getTime() + 3 * DAY), invitedByUserId: hr.userId, lastSentAt: before(now, 1) } });
    await platformPrisma.accountInvitation.create({ data: { accountId: c.accountId, email: `done.${rnd()}@example.com`, grants, tokenHash: `t-${rnd()}${rnd()}${rnd()}`, status: 'ACCEPTED', expiresAt: new Date(now.getTime() + 10 * DAY), invitedByUserId: hr.userId, lastSentAt: before(now, 6) } });
    await platformPrisma.accountInvitation.create({ data: { accountId: c.accountId, email: `else.${rnd()}@example.com`, grants: JSON.stringify([{ orgId: 'another-company', branchIds: [], roleIds: [] }]), tokenHash: `t-${rnd()}${rnd()}${rnd()}`, expiresAt: new Date(now.getTime() + 10 * DAY), invitedByUserId: hr.userId, lastSentAt: before(now, 6) } });
    /* The owner has administered this company for ten days, with a password alone. */
    await platformPrisma.userOrgMembership.updateMany({ where: { orgId: c.orgId, userId: c.userId }, data: { createdAt: before(now, 10) } });
    await platformPrisma.orgClosure.create({ data: { accountId: c.accountId, orgId: c.orgId, orgName: 'Mod Auto', status: 'SCHEDULED', requestedByUserId: c.userId, requestedAt: before(now, 10), deleteAfter: new Date(now.getTime() + 20 * DAY) } });
    await put(c, 'people', { birthdays: { on: false } }).expect(200);
  }, 90_000);

  it('switched off, nothing is sent and nothing is recorded', async () => {
    const done = await run(c, now);
    expect(Object.keys(done).filter((k) => k.startsWith('workspace.'))).toEqual([]);
    for (const kind of ['workspace.invitation_waiting', 'workspace.admin_no_authenticator', 'workspace.closure_soon']) expect(await bells(c, kind)).toEqual([]);
    expect(await runInTenant(c.orgId, () => peoplePrisma.automationRun.count({ where: { orgId: c.orgId, key: { startsWith: 'workspace.' } } }))).toBe(0);
  });

  it('an invitation not accepted: whoever sent it hears once, and again only if it is sent again', async () => {
    await put(c, 'workspace', { 'workspace.invitationWaiting': { on: true, n: 3 } }).expect(200);
    expect((await run(c, now))['workspace.invitationWaiting']).toBe(1);
    const told = await bells(c, 'workspace.invitation_waiting');
    expect(told.map((t) => t.userId)).toEqual([hr.userId]);
    expect(told[0].title).toMatch(/^late\..*has not accepted the invitation yet$/);
    expect(JSON.parse(told[0].linkJson!)).toEqual({ app: 'admin', screen: 'invitations' });
    expect(await ran(c, 'workspace.invitationWaiting', now)).toMatchObject({ count: 1, recipients: ['Hema HR'] });
    /* The same day again, and the next morning: nothing more about the same invitation. */
    expect(await run(c, new Date(now.getTime() + 3_600_000))).not.toHaveProperty('workspace.invitationWaiting');
    expect((await run(c, morning(11)))['workspace.invitationWaiting']).toBe(0);
    expect(await bells(c, 'workspace.invitation_waiting')).toHaveLength(1);
    /* Sent again and still not accepted three days on: one more reminder. */
    await platformPrisma.accountInvitation.update({ where: { id: inviteId }, data: { sendCount: 2, lastSentAt: before(morning(15), 3.5) } });
    expect((await run(c, morning(15)))['workspace.invitationWaiting']).toBe(1);
    /* Whoever sent it is no longer a user: the owner hears instead. */
    await platformPrisma.accountInvitation.update({ where: { id: inviteId }, data: { sendCount: 3, lastSentAt: before(morning(19), 3.5), expiresAt: new Date(morning(19).getTime() + 5 * DAY) } });
    await platformPrisma.user.update({ where: { id: hr.userId }, data: { isActive: false } });
    expect((await run(c, morning(19)))['workspace.invitationWaiting']).toBe(1);
    expect((await bells(c, 'workspace.invitation_waiting', c.userId))).toHaveLength(1);
    await platformPrisma.user.update({ where: { id: hr.userId }, data: { isActive: true } });
    await put(c, 'workspace', { 'workspace.invitationWaiting': { on: false } }).expect(200);
  }, 60_000);

  it('an administrator with no authenticator app: the owner and a named person hear, once', async () => {
    await put(c, 'workspace', { 'workspace.adminNoAuthenticator': { on: true, n: 30 } }).expect(200);
    /* Thirty days chosen, ten served: not yet. */
    expect((await run(c, now))['workspace.adminNoAuthenticator']).toBe(0);
    await put(c, 'workspace', { 'workspace.adminNoAuthenticator': { n: 7, to: ['OWNER', `PERSON:${hr.userId}`] } }).expect(200);
    const day = morning(11);
    expect((await run(c, day))['workspace.adminNoAuthenticator']).toBe(2);
    const own = await bells(c, 'workspace.admin_no_authenticator', c.userId);
    expect(own.map((t) => t.title)).toEqual(['You have no authenticator app set up']);
    const other = await bells(c, 'workspace.admin_no_authenticator', hr.userId);
    expect(other.map((t) => t.title)).toEqual(['Asha Owner has no authenticator app set up']);
    /* The HR Manager has none either, but is not an administrator: nobody is told about them. */
    expect(await bells(c, 'workspace.admin_no_authenticator')).toHaveLength(2);
    expect(await run(c, new Date(day.getTime() + 3_600_000))).not.toHaveProperty('workspace.adminNoAuthenticator');
    expect((await run(c, morning(12)))['workspace.adminNoAuthenticator']).toBe(0);
    expect(await bells(c, 'workspace.admin_no_authenticator')).toHaveLength(2);
    /* Set up: a company whose administrators all have one says nothing (a fresh company, to see it unsent). */
    const safe = await company();
    await platformPrisma.userOrgMembership.updateMany({ where: { orgId: safe.orgId, userId: safe.userId }, data: { createdAt: before(now, 10) } });
    await platformPrisma.user.update({ where: { id: safe.userId }, data: { totpEnabledAt: before(now, 1) } });
    await put(safe, 'workspace', { 'workspace.adminNoAuthenticator': { on: true, n: 7 } }).expect(200);
    expect((await run(safe, now))['workspace.adminNoAuthenticator']).toBe(0);
    expect(await bells(safe, 'workspace.admin_no_authenticator')).toEqual([]);
    await put(c, 'workspace', { 'workspace.adminNoAuthenticator': { on: false } }).expect(200);
  }, 90_000);

  it('a closure coming up: the owner hears once, inside the chosen days only', async () => {
    await put(c, 'workspace', { 'workspace.closureSoon': { on: true, n: 7 } }).expect(200);
    /* Twenty days away: too early. */
    expect((await run(c, now))['workspace.closureSoon']).toBe(0);
    expect(await bells(c, 'workspace.closure_soon')).toEqual([]);
    const day = morning(11);
    await platformPrisma.orgClosure.update({ where: { orgId: c.orgId }, data: { deleteAfter: new Date(day.getTime() + 5 * DAY) } });
    expect((await run(c, day))['workspace.closureSoon']).toBe(1);
    const told = await bells(c, 'workspace.closure_soon');
    expect(told.map((t) => t.userId)).toEqual([c.userId]);
    expect(told[0].title).toBe('Mod Auto will be closed in 5 days');
    expect(JSON.parse(told[0].linkJson!)).toEqual({ app: 'admin', screen: 'close' });
    expect(await run(c, new Date(day.getTime() + 3_600_000))).not.toHaveProperty('workspace.closureSoon');
    expect((await run(c, morning(12)))['workspace.closureSoon']).toBe(0);
    expect(await bells(c, 'workspace.closure_soon')).toHaveLength(1);
    /* Cancelled: nothing, even inside the days. */
    await platformPrisma.orgClosure.update({ where: { orgId: c.orgId }, data: { status: 'CANCELLED' } });
    await runInTenant(c.orgId, () => platformPrisma.notification.deleteMany({ where: { orgId: c.orgId, kind: 'workspace.closure_soon' } }));
    expect((await run(c, morning(13)))['workspace.closureSoon']).toBe(0);
    expect(await bells(c, 'workspace.closure_soon')).toEqual([]);
  }, 60_000);
});

describe('the daily job', () => {
  it('enters each company itself; Attendance’s recipes wait for Attendance to be on, Workspace’s do not', async () => {
    const c = await company({ people: true, attendance: false });
    const now = morning(10);
    await peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, createdByUserId: c.userId, serialNumber: `JOB-${rnd()}${rnd()}`, name: 'Dock reader', lastSeenAt: before(now, 5) } });
    await platformPrisma.orgClosure.create({ data: { accountId: c.accountId, orgId: c.orgId, orgName: 'Job Co', status: 'SCHEDULED', requestedByUserId: c.userId, requestedAt: before(now, 25), deleteAfter: new Date(now.getTime() + 3 * DAY) } });
    /* Saved straight to the row: Attendance's screen answers nothing while Attendance is off. */
    await put(c, 'workspace', { 'workspace.closureSoon': { on: true } }).expect(200);
    await runInTenant(c.orgId, async () => {
      const row = await peoplePrisma.engagementSettings.findUnique({ where: { orgId: c.orgId } });
      await peoplePrisma.engagementSettings.update({ where: { orgId: c.orgId }, data: { automations: { ...(row!.automations as any), 'attendance.readersSilent': { on: true } } } });
    });
    await api(c, 'get', '/automations?module=attendance').expect(403);
    await A.runAutomations(now);
    await A.runAutomations(new Date(now.getTime() + 3_600_000));
    expect(await bells(c, 'workspace.closure_soon')).toHaveLength(1);
    expect(await bells(c, 'reader.silent')).toEqual([]);
    expect(await runInTenant(c.orgId, () => peoplePrisma.automationRun.count({ where: { orgId: c.orgId, key: 'attendance.readersSilent' } }))).toBe(0);
    expect(await runInTenant(c.orgId, () => peoplePrisma.automationRun.findFirst({ where: { orgId: c.orgId, key: 'workspace.closureSoon' } }))).toMatchObject({ count: 1, recipients: ['Asha Owner'] });
  }, 120_000);
});
