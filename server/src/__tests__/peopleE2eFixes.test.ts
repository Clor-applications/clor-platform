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

const app = buildApp().listen(0);
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
  beforeAll(async () => {
    owner = await company();
    other = await company();
    lead = await colleague(owner, TEAM_MANAGER, true);
    /* Someone in the company with no People or leave right at all. */
    stranger = await colleague(owner, ['ATTENDANCE::My Attendance::VIEW']);
    const leadEmp = await person(owner, { name: 'Rahul Lead', code: 'TM1' });
    await link(owner, leadEmp.id, lead.userId);
    await person(owner, { name: 'Imran Report', code: 'TM2', reportingManagerId: leadEmp.id });
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
