import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * What the People end-to-end suite found (e2e/, 30 Oct 2026), fixed on the
 * server:
 *
 *   5  a team manager's Home and Who's away met 403s: the holiday list is read
 *      with leave; published announcements and scheduled events are read by
 *      anyone who works in People (drafts and writes stay with the module);
 *      the overview says when the reader sees a team (clashes, M4)
 *   7  a one-person company: the owner's own leave waits in her own inbox,
 *      marked, under maker-checker AUTO (and only then); her first open of
 *      My leave links her file once, whichever request gets there first
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `e2ef.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `E2E Fix ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId, email };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  return c;
}
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `e2efc.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const att = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
const ppl = (c: Ctx, m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const person = async (c: Ctx, body: Record<string, unknown>) => (await ppl(c, 'post', '/employees', { dateOfJoining: '2026-01-01', ...body }).expect(201)).body.employee;
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));
/* The Team Manager role's grants (permissionCatalog.ts), as a manager signs in with them. */
const TEAM_MANAGER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE', 'PEOPLE::Lifecycle::VIEW', 'PEOPLE::Policies::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];
const nextYear = String(new Date().getFullYear() + 1);

describe("a team manager's Home and Who's away read what they need, and no more (5)", () => {
  let owner: Ctx;
  let lead: Ctx;
  let stranger: Ctx;
  let other: Ctx;
  let audience: string[] = [];
  beforeAll(async () => {
    owner = await company();
    other = await company();
    lead = await colleague(owner, TEAM_MANAGER, true);
    /* Someone in the company with no People or leave right at all. */
    stranger = await colleague(owner, ['ATTENDANCE::My Attendance::VIEW']);
    const leadEmp = await person(owner, { name: 'Rahul Lead', code: 'TM1' });
    await link(owner, leadEmp.id, lead.userId);
    const report = await person(owner, { name: 'Imran Report', code: 'TM2', reportingManagerId: leadEmp.id });
    audience = [leadEmp.id, report.id];
    await att(owner, 'post', '/holidays', { date: `${nextYear}-01-26`, name: 'Republic Day' }).expect(201);
    await att(other, 'post', '/holidays', { date: `${nextYear}-08-15`, name: 'Other Co holiday' }).expect(201);
    for (const [title, status] of [['Canteen opens', 'PUBLISHED'], ['Pay rise draft', 'DRAFT']]) {
      await ppl(owner, 'post', '/workspace/announcements', { title, status, details: { body: title } }).expect(201);
    }
    for (const [title, status] of [['Diwali lunch', 'SCHEDULED'], ['Offsite idea', 'DRAFT']]) {
      await ppl(owner, 'post', '/workspace/events', { title, status, details: { startDate: `${nextYear}-11-05`, endDate: '', location: 'Office' } }).expect(201);
    }
    await ppl(other, 'post', '/workspace/announcements', { title: 'Other Co news', status: 'PUBLISHED', details: { body: 'x' } }).expect(201);
  }, 120_000);

  it('reads the holiday list with leave, but cannot change it; other companies stay out', async () => {
    const list = (await att(lead, 'get', `/holidays?year=${nextYear}`).expect(200)).body.holidays;
    expect(list.map((h: any) => h.name)).toEqual(['Republic Day']);
    await att(lead, 'post', '/holidays', { date: `${nextYear}-03-01`, name: 'Not mine to add' }).expect(403);
    await att(stranger, 'get', `/holidays?year=${nextYear}`).expect(403);
    /* Another company's address with this sign-in: refused, nothing read. */
    const cross = await request(app).get(`/api/orgs/${other.orgId}/attendance/holidays?year=${nextYear}`).set(at(lead));
    expect(cross.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(cross.body)).not.toContain('Other Co holiday');
  });

  it('reads published announcements and scheduled events, never drafts, and cannot write them', async () => {
    const news = (await ppl(lead, 'get', '/workspace/announcements').expect(200)).body.records;
    expect(news.map((r: any) => r.title)).toEqual(['Canteen opens']);
    const events = (await ppl(lead, 'get', '/workspace/events').expect(200)).body.records;
    expect(events.map((r: any) => r.title)).toEqual(['Diwali lunch']);
    await ppl(lead, 'post', '/workspace/announcements', { title: 'Mine', status: 'DRAFT', details: { body: 'x' } }).expect(403);
    await ppl(lead, 'post', '/workspace/events', { title: 'Mine', status: 'DRAFT', details: { startDate: `${nextYear}-11-05`, endDate: '' } }).expect(403);
    /* Other workspace modules are not opened by this: still the module's own right. */
    await ppl(lead, 'get', '/workspace/assets').expect(403);
    /* Without any People right, nothing. */
    await ppl(stranger, 'get', '/workspace/announcements').expect(403);
    /* HR (the owner) still reads everything, drafts too. */
    const all = (await ppl(owner, 'get', '/workspace/events').expect(200)).body.records;
    expect(all.map((r: any) => r.title).sort()).toEqual(['Diwali lunch', 'Offsite idea']);
  });

  it('reads a published announcement as the employee app does: no audience, so no other employee ids (#80 re-review)', async () => {
    await ppl(owner, 'post', '/workspace/announcements', { title: 'Team lunch', status: 'PUBLISHED', details: { body: 'Friday', symbol: 'party', audienceKind: 'PEOPLE', audienceIds: audience, audience: 'Rahul Lead and Imran Report' } }).expect(201);
    const news = (await ppl(lead, 'get', '/workspace/announcements').expect(200)).body.records;
    const lunch = news.find((r: any) => r.title === 'Team lunch');
    expect(lunch.details).toEqual({ body: 'Friday', symbol: 'party' });
    expect(JSON.stringify(news)).not.toContain(audience[1]);
    const events = (await ppl(lead, 'get', '/workspace/events').expect(200)).body.records;
    expect(Object.keys(events[0].details).sort()).toEqual(['description', 'endDate', 'location', 'startDate']);
    /* HR still reads the whole record, audience included. */
    const all = (await ppl(owner, 'get', '/workspace/announcements').expect(200)).body.records;
    expect(all.find((r: any) => r.title === 'Team lunch').details.audienceIds).toEqual(audience);
  });

  it('cannot read the company set-up list (Home asks only those who can)', async () => {
    await ppl(lead, 'get', '/setup').expect(403);
    await ppl(owner, 'get', '/setup').expect(200);
  });

  it("the overview says when the reader sees a team, so two of them away is a clash (M4)", async () => {
    expect((await att(lead, 'get', '/leave/overview').expect(200)).body.team).toBe(true);
    expect((await att(owner, 'get', '/leave/overview').expect(200)).body.team).toBe(false);
  });
});

describe('a one-person company decides its own leave from Approvals (7)', () => {
  let solo: Ctx;
  let casual: any;
  let mine: any;
  beforeAll(async () => {
    solo = await company();
    casual = (await att(solo, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    /* She adds herself with her sign-in email: the file links on her first visit to My leave. */
    await person(solo, { name: 'Lalitha Rao', code: 'S1', workEmail: solo.email });
  }, 120_000);

  it('her first My leave links the file once, whichever of the parallel requests gets there first', async () => {
    const [leave, restricted, again] = await Promise.all([
      att(solo, 'get', '/me/leave'),
      att(solo, 'get', '/me/holidays/restricted'),
      att(solo, 'get', '/me/leave'),
    ]);
    expect([leave.status, restricted.status, again.status]).toEqual([200, 200, 200]);
    expect(leave.body.employee.name).toBe('Lalitha Rao');
    expect(await runInTenant(solo.orgId, () => peoplePrisma.employee.count({ where: { orgId: solo.orgId, userId: solo.userId } }))).toBe(1);
  });

  it('her own leave waits in her own inbox, marked as hers to decide alone, not for bulk', async () => {
    mine = (await att(solo, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: `${nextYear}-02-02`, toDate: `${nextYear}-02-02`, reason: 'Supplier visit' }).expect(201)).body.request;
    const box = (await ppl(solo, 'get', '/inbox').expect(200)).body;
    const item = box.items.find((i: any) => i.id === mine.id);
    expect(item).toMatchObject({ kind: 'LEAVE', employeeName: 'Lalitha Rao', own: 'ONLY_APPROVER', bulk: false });
    expect(box.counts.LEAVE).toBe(1);
  });

  it('approving it from the inbox works and is written down as a self-approval', async () => {
    const out = (await att(solo, 'post', '/leave/requests/bulk-review', { ids: [mine.id], approve: true }).expect(200)).body;
    expect(out.done).toBe(1);
    expect(await platformPrisma.auditLog.count({ where: { orgId: solo.orgId, action: 'SELF_APPROVED' } })).toBeGreaterThan(0);
    const box = (await ppl(solo, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === mine.id)).toBeUndefined();
  });

  it('once someone else can approve leave, her own leaves her inbox and waits for them', async () => {
    const next = (await att(solo, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: `${nextYear}-03-03`, toDate: `${nextYear}-03-03`, reason: 'Bank' }).expect(201)).body.request;
    const hr = await colleague(solo, ['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'PEOPLE::Employees::VIEW']);
    const box = (await ppl(solo, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === next.id)).toBeUndefined();
    const theirs = (await ppl(hr, 'get', '/inbox').expect(200)).body;
    expect(theirs.items.find((i: any) => i.id === next.id)).toMatchObject({ own: null, bulk: true });
  });

  it('STRICT: never in her own inbox, even alone', async () => {
    const strict = await company();
    const type = (await att(strict, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    const me = await person(strict, { name: 'Strict Owner', code: 'S2' });
    await link(strict, me.id, strict.userId);
    const policy = (await request(app).get(`/api/orgs/${strict.orgId}/security/policy`).set(at(strict)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${strict.orgId}/security/policy`).set(at(strict)).send({ ...policy, makerChecker: 'STRICT' }).expect(200);
    const r = (await att(strict, 'post', '/me/leave', { leaveTypeId: type.id, fromDate: `${nextYear}-04-06`, toDate: `${nextYear}-04-06`, reason: 'Errand' }).expect(201)).body.request;
    const box = (await ppl(strict, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === r.id)).toBeUndefined();
  });
});

describe('review of #80: Approvals offers only what can be approved now', () => {
  let boss: Ctx;
  let lead: Ctx;
  let casual: any;
  let leadFile: any;
  let mine: any;
  const chain = (c: Ctx, leaveApproval: string) => runInTenant(c.orgId, async () => {
    const { accountId } = await peoplePrisma.leaveType.findFirstOrThrow({ where: { orgId: c.orgId }, select: { accountId: true } });
    await peoplePrisma.attendanceSettings.upsert({ where: { orgId: c.orgId }, create: { accountId, orgId: c.orgId, leaveApproval, updatedByUserId: c.userId }, update: { leaveApproval } });
  });
  beforeAll(async () => {
    boss = await company();
    casual = (await att(boss, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await chain(boss, 'MANAGER_THEN_HR');
    /* The owner reports to a manager, who signs in with a team manager's rights. */
    lead = await colleague(boss, [...TEAM_MANAGER, 'ATTENDANCE::Attendance Requests::VIEW']);
    leadFile = await person(boss, { name: 'Rahul Lead', code: 'L1' });
    await link(boss, leadFile.id, lead.userId);
    const me = await person(boss, { name: 'Owner Self', code: 'O1', reportingManagerId: leadFile.id });
    await link(boss, me.id, boss.userId);
    const policy = (await request(app).get(`/api/orgs/${boss.orgId}/security/policy`).set(at(boss)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${boss.orgId}/security/policy`).set(at(boss)).send({ ...policy, makerChecker: 'ALLOW' }).expect(200);
    mine = (await att(boss, 'post', '/me/leave', { leaveTypeId: casual.id, fromDate: `${nextYear}-05-04`, toDate: `${nextYear}-05-04`, reason: 'Errand' }).expect(201)).body.request;
  }, 120_000);

  it('ALLOW: my own leave stays out of my inbox and my count while my manager has not approved it', async () => {
    const box = (await ppl(boss, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === mine.id)).toBeUndefined();
    expect(box.counts.LEAVE || 0).toBe(0);
  });

  it("the manager's drawer does not call them late for their own step, and HR's still waits for them", async () => {
    const asManager = (await att(lead, 'get', `/leave/requests/${mine.id}`).expect(200)).body;
    expect(asManager.waitingForManager).toBeNull();
    const asOther = (await att(boss, 'get', `/leave/requests/${mine.id}`).expect(200)).body;
    expect(asOther.waitingForManager).toMatch(/has not approved this yet/);
    const box = (await ppl(lead, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === mine.id)).toMatchObject({ bulk: true, own: null });
  });

  it('the same for an attendance request: its drawer asks nobody to wait for themselves', async () => {
    await att(boss, 'put', '/request-rules', { WFH: { on: true, approval: 'MANAGER_THEN_HR' } }).expect(200);
    const staff = await person(boss, { name: 'Report', code: 'R1', reportingManagerId: leadFile.id });
    const r = (await att(boss, 'post', '/requests', { employeeId: staff.id, kind: 'WFH', date: `${nextYear}-05-10`, reason: 'Home' }).expect(201)).body.request;
    expect((await att(lead, 'get', `/requests/${r.id}`).expect(200)).body.waitingForManager).toBeNull();
    expect((await att(boss, 'get', `/requests/${r.id}`).expect(200)).body.waitingForManager).toMatch(/has not approved this yet/);
  });

  it('once the manager has approved, it comes to me, marked, and I may decide it', async () => {
    await att(lead, 'post', '/leave/requests/bulk-review', { ids: [mine.id], approve: true }).expect(200);
    const box = (await ppl(boss, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === mine.id)).toMatchObject({ own: 'ALLOWED', bulk: false });
    const out = (await att(boss, 'post', '/leave/requests/bulk-review', { ids: [mine.id], approve: true }).expect(200)).body;
    expect(out.done).toBe(1);
  });

  it('AUTO, nobody else can approve: still out of my inbox while a manager is on the file', async () => {
    const solo = await company();
    const type = (await att(solo, 'post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await chain(solo, 'MANAGER_THEN_HR');
    /* The manager has a file but no sign-in. */
    const m = await person(solo, { name: 'No Sign-in', code: 'M1' });
    const me = await person(solo, { name: 'Solo Owner', code: 'S1', reportingManagerId: m.id });
    await link(solo, me.id, solo.userId);
    const r = (await att(solo, 'post', '/me/leave', { leaveTypeId: type.id, fromDate: `${nextYear}-06-01`, toDate: `${nextYear}-06-01`, reason: 'Errand' }).expect(201)).body.request;
    const box = (await ppl(solo, 'get', '/inbox').expect(200)).body;
    expect(box.items.find((i: any) => i.id === r.id)).toBeUndefined();
  });
});

describe('review of #80: what a People user without the module right reads of it', () => {
  it('only what Home and the employee app show, and no past events', async () => {
    const owner = await company();
    await request(app).put(`/api/orgs/${owner.orgId}/features`).set(at(owner)).send({ features: { peopleEngage: true } }).expect(200);
    const lead = await colleague(owner, TEAM_MANAGER);
    const event = (title: string, startDate: string, status = 'SCHEDULED') => ppl(owner, 'post', '/workspace/events', { title, status, details: { startDate, endDate: '', location: 'Canteen' } }).expect(201);
    await event('Long gone', '2020-01-06');
    await event('Coming up', `${nextYear}-11-05`);
    await ppl(owner, 'post', '/workspace/announcements', { title: 'News', status: 'PUBLISHED', details: { body: 'Hello' } }).expect(201);
    const events = (await ppl(lead, 'get', '/workspace/events').expect(200)).body.records;
    expect(events.map((r: any) => r.title)).toEqual(['Coming up']);
    expect(events[0].details.location).toBe('Canteen');
    const news = (await ppl(lead, 'get', '/workspace/announcements').expect(200)).body.records;
    expect(news.map((r: any) => r.title)).toEqual(['News']);
    for (const row of [events[0], news[0]]) expect(Object.keys(row).sort()).toEqual(['details', 'id', 'kind', 'status', 'title', 'updatedAt']);
    /* HR keeps the whole row and the past. */
    const all = (await ppl(owner, 'get', '/workspace/events').expect(200)).body.records;
    expect(all.map((r: any) => r.title).sort()).toEqual(['Coming up', 'Long gone']);
    expect(all[0].createdBy).toBeTruthy();
  });
});

describe("#80 manager QA: a half day's notice says which half", () => {
  it('names the first or second half, and keeps whole days as a count', async () => {
    const { leaveNoticeBody } = await import('../routes/leave.js');
    expect(leaveNoticeBody({ halfDay: 'FIRST' }, 0.5)).toBe('Half a day, first half');
    expect(leaveNoticeBody({ halfDay: 'SECOND' }, 0.5)).toBe('Half a day, second half');
    expect(leaveNoticeBody({ halfDay: null }, 1)).toBe('1 day');
    expect(leaveNoticeBody({ halfDay: null }, 2.5)).toBe('2.5 days');
  });
});

describe('#80 QA F4: the attendance drawer names who decides, as the reader can', () => {
  it('says HR alone to HR, and "HR, or you as their manager" to the manager who can approve it', async () => {
    const owner = await company();
    const lead = await colleague(owner, [...TEAM_MANAGER, 'ATTENDANCE::Attendance Requests::VIEW', 'ATTENDANCE::Attendance Requests::APPROVE'], true);
    const leadEmp = await person(owner, { name: 'Rahul Lead', code: 'F41' });
    await link(owner, leadEmp.id, lead.userId);
    const imran = await person(owner, { name: 'Imran Khan', code: 'F42', reportingManagerId: leadEmp.id });
    const d = new Date(Date.now() - 3 * 86_400_000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    const date = d.toISOString().slice(0, 10);
    const r = (await att(owner, 'post', '/requests', { employeeId: imran.id, kind: 'MISSED_PUNCH', date, checkIn: '09:00', checkOut: '18:00', reason: 'Forgot to punch' }).expect(201)).body.request;
    const asLead = (await att(lead, 'get', `/requests/${r.id}`).expect(200)).body;
    expect(asLead.chain).toBe('HR');
    expect(asLead.decidedBy).toBe('HR, or you as their manager');
    const asHr = (await att(owner, 'get', `/requests/${r.id}`).expect(200)).body;
    expect(asHr.decidedBy).toBe('HR');
    /* And what the words promise holds: the manager's Approve decides it. */
    await att(lead, 'post', `/requests/${r.id}/approve`, {}).expect(200);
  }, 120_000);
});
