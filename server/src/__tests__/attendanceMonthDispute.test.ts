import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * HR answers an employee who says their month is wrong (Attendance, 13 Nov 2026). Attendance Records EDIT, inside a
 * team-scoped role's team; once per dispute, under the company's write lock; a dispute sent again is open again. The
 * employee hears of it (a CLOR notice through the outbox, and the app's month and What's new), and month close warns
 * while any dispute is unanswered.
 *
 * October 2026 can be confirmed until its cutoff (the 3rd of November by default): "today" is held at 2 November.
 */
vi.mock('../utils/istDate.js', async (orig) => {
  const real: any = await orig();
  return { ...real, todayIst: () => '2026-11-02' };
});

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { confirmMonth } = await import('../services/attendance/selfService.js');
const { deliverNotice } = await import('../services/attendance/notices.js');
const { NOTICE_EVENT } = await import('../services/people/outbox.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const MONTH = '2026-10';
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const resolve = (c: Ctx, employeeId: string, body: Record<string, unknown>) => att(c).post(`/months/${MONTH}/confirmations/${employeeId}/resolve`, body);
const readiness = async (c: Ctx) => (await att(c).get(`/months/${MONTH}/readiness`).expect(200)).body;

let hr: Ctx;
let lead: Ctx;
let viewer: Ctx;
const E: Record<string, any> = {};
const portal: Record<string, string> = {};
const inTenant = <X>(fn: () => Promise<X>) => runInTenant(hr.orgId, fn);
const who = async (id: string) => inTenant(() => peoplePrisma.employee.findUniqueOrThrow({ where: { id }, select: { id: true, accountId: true, orgId: true, name: true, code: true, areaId: true, branchId: true } }));
const row = (employeeId: string) => inTenant(() => peoplePrisma.attendanceMonthConfirmation.findUniqueOrThrow({ where: { orgId_employeeId_month: { orgId: hr.orgId, employeeId, month: MONTH } } }));
const dispute = (k: string, note: string) => request(app).post(`/api/portal/month-review/${MONTH}/dispute`).set('Authorization', `Bearer ${portal[k]}`).send({ note });

async function userWithRole(permissions: string[], ownOnly: boolean): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${hr.orgId}/roles`).set(at(hr)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${hr.orgId}/roles/${role.body.role.id}/permissions`).set(at(hr)).send({ permissions }).expect(200);
  const email = `u.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(hr)).send({ email, fullName: `User ${rnd()}`, password: 'Passw0rd!23', orgIds: [hr.orgId], branchIdsByOrg: { [hr.orgId]: [hr.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${hr.orgId}/users/${user.body.user.id}/roles`).set(at(hr)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const token = (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200)).body.token;
  return { token, orgId: hr.orgId, branchId: hr.branchId, userId: user.body.user.id, accountId: hr.accountId };
}

beforeAll(async () => {
  const email = `md.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Md Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${hr.token}`).expect(200);
  hr.userId = me.body.user.id;
  hr.accountId = me.body.orgs.find((o: any) => o.orgId === hr.orgId).accountId;
  lead = await userWithRole(['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EDIT', 'PEOPLE::Employees::VIEW', 'ATTENDANCE::My Attendance::VIEW'], true);
  viewer = await userWithRole(['ATTENDANCE::Attendance Records::VIEW', 'PEOPLE::Employees::VIEW'], false);
  const emp = async (body: Record<string, unknown>) => (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  E.lead = await emp({ name: 'Lead Person', code: 'D-1' });
  E.mine = await emp({ name: 'In Team', code: 'D-2', reportingManagerId: E.lead.id });
  E.other = await emp({ name: 'Out Of Team', code: 'D-3' });
  await inTenant(() => peoplePrisma.employee.update({ where: { id: E.lead.id }, data: { userId: lead.userId } }));
  const company = (await att(hr).get('/portal-access').expect(200)).body.company.code;
  for (const k of ['mine', 'other']) {
    const code = (await att(hr).post('/portal-access/codes', { employeeIds: [E[k].id] }).expect(200)).body.codes[0].activationCode;
    portal[k] = (await request(app).post('/api/portal/activate').send({ company, employeeCode: E[k].code, activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
  }
  await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
}, 120_000);

describe('answering a disputed month', () => {
  it('needs Attendance Records EDIT: a viewer is refused and nothing is written', async () => {
    expect((await dispute('other', 'The 12th was on duty at the client')).status).toBe(200);
    expect((await resolve(viewer, E.other.id, { reply: 'Looked at it' })).status).toBe(403);
    expect((await row(E.other.id)).resolvedAt).toBeNull();
  }, 60_000);

  it('keeps a team-scoped role to its team (404 outside it), and answers inside it', async () => {
    expect((await dispute('mine', 'I was present on the 7th')).status).toBe(200);
    expect((await resolve(lead, E.other.id, { reply: 'Not mine to answer' })).status).toBe(404);
    expect((await row(E.other.id)).resolvedAt).toBeNull();
    /* The team-scoped role sees its own team's disputes only. */
    const seen = (await readiness(lead)).confirmations.disputed.map((d: any) => d.employeeId);
    expect(seen).toEqual([E.mine.id]);
    const r = await resolve(lead, E.mine.id, { reply: 'Corrected the 7th to present.' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await row(E.mine.id);
    expect(after).toMatchObject({ status: 'DISPUTED', resolvedByUserId: lead.userId, resolution: 'Corrected the 7th to present.' });
    expect(after.resolvedAt).toBeTruthy();
  }, 60_000);

  it('lands once: a second answer is refused (409) and the first stands; two at once, one wins', async () => {
    const r = await resolve(hr, E.mine.id, { reply: 'Another answer' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DISPUTE_RESOLVED');
    expect((await row(E.mine.id)).resolution).toBe('Corrected the 7th to present.');

    const both = await Promise.all([resolve(hr, E.other.id, { reply: 'First' }), resolve(hr, E.other.id, { reply: 'Second' })]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    const won = both.find((x) => x.status === 200)!.body.resolved.reply;
    expect((await row(E.other.id)).resolution).toBe(won);
  }, 60_000);

  it('a dispute sent again clears the answer, and an answer to the older note is refused', async () => {
    const read = (await row(E.mine.id)).updatedAt;
    expect((await dispute('mine', 'Still wrong: the 8th as well')).status).toBe(200);
    const again = await row(E.mine.id);
    expect(again).toMatchObject({ status: 'DISPUTED', note: 'Still wrong: the 8th as well', resolvedAt: null, resolvedByUserId: null, resolution: null });
    const stale = await resolve(hr, E.mine.id, { reply: 'Answer to the old note', seenAt: read.toISOString() });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('DISPUTE_CHANGED');
    expect((await row(E.mine.id)).resolvedAt).toBeNull();
    expect((await resolve(hr, E.mine.id, { reply: 'Fixed the 8th too.', seenAt: again.updatedAt.toISOString() })).status).toBe(200);
  }, 60_000);

  it('refuses a month nobody disputed, a confirmed month, and an empty reply', async () => {
    expect((await resolve(hr, E.lead.id, { reply: 'Nothing to answer' })).status).toBe(404);
    await confirmMonth(await who(E.lead.id), MONTH, null);
    const confirmed = await resolve(hr, E.lead.id, { reply: 'Nothing to answer' });
    expect(confirmed.status).toBe(404);
    expect(confirmed.body.code).toBe('NO_DISPUTE');
    expect((await resolve(hr, E.mine.id, { reply: '' })).status).toBe(400);
    expect((await att(hr).post(`/months/2026-13/confirmations/${E.mine.id}/resolve`, { reply: 'Bad month' })).status).toBe(400);
  }, 60_000);
});

describe('the employee hears of the answer', () => {
  it('in the app: on their month and in What’s new', async () => {
    const review = (await request(app).get(`/api/portal/month-review?month=${MONTH}`).set('Authorization', `Bearer ${portal.mine}`).expect(200)).body;
    expect(review.confirmation.reply.text).toBe('Fixed the 8th too.');
    const updates = (await request(app).get('/api/portal/updates').set('Authorization', `Bearer ${portal.mine}`).expect(200)).body.decided;
    expect(updates.find((u: any) => u.status === 'ANSWERED')?.text).toContain('Fixed the 8th too.');
  }, 60_000);

  it('with a CLOR sign-in: a notice through the outbox, with HR’s reply', async () => {
    await confirmMonth(await who(E.lead.id), MONTH, 'My leave on the 20th is missing');
    expect((await resolve(hr, E.lead.id, { reply: 'Added the leave on the 20th.' })).status).toBe(200);
    const events = await inTenant(() => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, name: NOTICE_EVENT, employeeId: E.lead.id } }));
    const ev = events.find((e: any) => e.payload?.topic === 'direct' && e.payload?.notice?.kind === 'attendance.month_dispute_answered');
    expect(ev).toBeTruthy();
    expect((ev!.payload as any).userIds).toEqual([lead.userId]);
    expect((ev!.payload as any).notice.body).toBe('Added the leave on the 20th.');
    /* Delivered (again, if the outbox already did): one notice, with the reply. */
    await deliverNotice({ eventId: ev!.id, name: NOTICE_EVENT as any, version: 1, accountId: ev!.accountId, orgId: ev!.orgId, employeeId: ev!.employeeId, occurredAt: ev!.occurredAt.toISOString(), correlationId: ev!.correlationId, data: ev!.payload as any });
    const notes = await platformPrisma.notification.findMany({ where: { orgId: hr.orgId, userId: lead.userId, kind: 'attendance.month_dispute_answered' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('Added the leave on the 20th.');
  }, 60_000);
});

describe('month close', () => {
  it('warns while a dispute is unanswered, and does not block closing over it', async () => {
    const before = (await readiness(hr)).checks.find((c: any) => c.key === 'disputes');
    expect(before).toMatchObject({ severity: 'check', count: 0, screen: 'confirmations' });
    expect((await dispute('other', 'Again: the 12th was on duty')).status).toBe(200);
    const r = await readiness(hr);
    expect(r.checks.find((c: any) => c.key === 'disputes').count).toBe(1);
    expect(r.confirmations.openDisputes).toBe(1);
    /* A team-scoped role's count is its own team's: the open dispute is outside it. */
    expect((await readiness(lead)).checks.find((c: any) => c.key === 'disputes').count).toBe(0);
    /* Answered disputes carry who answered, by name. */
    expect(r.confirmations.disputed.find((d: any) => d.employeeId === E.mine.id).resolved.by).toBe('Asha Owner');
  }, 60_000);
});
