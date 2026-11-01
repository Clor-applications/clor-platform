import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Privacy (docs/people/02-PRD.md PRV-01, 02, 03, 06, 07): a notice per
 * purpose whose every version asks for a fresh read, in the languages the
 * company switches on; an erasure shows what the law keeps; past-retention
 * people wait on a deletion review that nothing passes without a person and
 * a hold stops; an auditor sees only named evidence, until a time, logged,
 * and never a profile; the access report says who viewed what.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `prv.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Privacy Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\s/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
async function portalFor(c: Ctx, companyCode: string, employee: { id: string; code: string }) {
  const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: employee.code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
  return { Authorization: `Bearer ${token}` };
}
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

let boss: Ctx;
let companyCode = '';
beforeAll(async () => {
  boss = await owner();
  companyCode = (await request(app).get(`/api/orgs/${boss.orgId}/attendance/portal-access`).set(at(boss)).expect(200)).body.company.code;
}, 120_000);

describe('privacy notices (PRV-01)', () => {
  it('a notice per purpose; every version asks for a fresh read; the portal reads it in an enabled language', async () => {
    await people(boss).post('/policies', { title: 'Attendance notice', category: 'PRIVACY' }).expect(400);
    const notice = (await people(boss).post('/policies', { title: 'Attendance notice', category: 'PRIVACY', purpose: 'ATTENDANCE' }).expect(201)).body.policy;
    expect(notice.purpose).toBe('ATTENDANCE');
    /* Hindi is not switched on yet. */
    await people(boss).post(`/policies/${notice.id}/versions`, { body: 'We record punches.', effectiveFrom: today(), translations: { hi: 'हम पंच दर्ज करते हैं।' } }).expect(400);
    await people(boss).put('/policies/notice-languages', { languages: ['hi', 'xx'] }).expect(400);
    expect((await people(boss).put('/policies/notice-languages', { languages: ['hi'] }).expect(200)).body.enabled).toEqual(['hi']);
    const v1 = (await people(boss).post(`/policies/${notice.id}/versions`, { body: 'We record punches.', effectiveFrom: today(), needsAcceptance: false, translations: { hi: 'हम पंच दर्ज करते हैं।' } }).expect(201)).body.version;
    expect(v1.needsAcceptance).toBe(true);
    const e = (await people(boss).post('/employees', { name: 'Neha Rao', code: 'PRV-1', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    await people(boss).post(`/policies/${notice.id}/versions/1/submit`, {}).expect(200);
    const portal = await portalFor(boss, companyCode, e);
    expect((await request(app).get('/api/portal/people/acknowledgements').set(portal).expect(200)).body.pending.length).toBe(1);
    const mine = (await request(app).get('/api/portal/people/policies').set(portal).expect(200)).body.policies;
    expect(mine[0]).toMatchObject({ purpose: 'ATTENDANCE', languages: ['hi'] });
    const hindi = (await request(app).get(`/api/portal/people/policies/${v1.id}?lang=hi`).set(portal).expect(200)).body.policy;
    expect(hindi).toMatchObject({ language: 'hi', body: 'हम पंच दर्ज करते हैं।', languages: ['en', 'hi'] });
    /* A second purpose does not conflict with the first. */
    const pay = (await people(boss).post('/policies', { title: 'Pay notice', category: 'PRIVACY', purpose: 'PAYROLL' }).expect(201)).body.policy;
    await people(boss).post(`/policies/${pay.id}/versions`, { body: 'We process pay.', effectiveFrom: today() }).expect(201);
    await people(boss).post(`/policies/${pay.id}/versions/1/submit`, {}).expect(200);
    expect((await people(boss).get('/policies/conflicts').expect(200)).body.conflicts.filter((c: any) => c.category === 'PRIVACY')).toEqual([]);
  });
});

describe('requests (PRV-02)', () => {
  it('a grievance is due in 90 days, an access request in 30; an erasure shows what the law keeps', async () => {
    const e = (await people(boss).post('/employees', { name: 'Arun Pillai', code: 'PRV-2', dateOfJoining: '2024-01-05' }).expect(201)).body.employee;
    const portal = await portalFor(boss, companyCode, e);
    const g = (await request(app).post('/api/portal/data-requests').set(portal).send({ type: 'GRIEVANCE', details: 'My data was shared.' }).expect(201)).body.request;
    const a = (await request(app).post('/api/portal/data-requests').set(portal).send({ type: 'ACCESS', details: 'Show me my data.' }).expect(201)).body.request;
    const days = (r: any) => Math.round((Date.parse(r.dueAt) - Date.parse(r.createdAt)) / 86_400_000);
    expect(days(g)).toBe(90);
    expect(days(a)).toBe(30);
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { status: 'LEFT', dateOfLeaving: '2026-03-31' } }));
    await runInTenant(boss.orgId, () => peoplePrisma.dataRequest.create({ data: { accountId: (g as any).accountId, orgId: boss.orgId, employeeId: e.id, type: 'ERASURE', details: 'Erase me.' } }));
    const list = (await people(boss).get('/data-requests').expect(200)).body.requests;
    const erasure = list.find((r: any) => r.type === 'ERASURE');
    expect(erasure.retentionExceptions.map((k: any) => [k.dataType, k.until])).toEqual([['PAYROLL', '2034-03-31'], ['ATTENDANCE', '2029-03-31'], ['ACCESS_LOG', '2029-03-31']]);
    expect(list.find((r: any) => r.type === 'ACCESS').retentionExceptions).toBeNull();
  });
});

describe('retention and deletion review (PRV-03)', () => {
  it('past-retention people wait for a person; a hold stops erasure; approve anonymises', async () => {
    const officer = await colleague(boss, 'Priya DPO', ['PEOPLE::Privacy::VIEW', 'PEOPLE::Privacy::EDIT']);
    const old = (await people(boss).post('/employees', { name: 'Old Leaver', code: 'PRV-3', dateOfJoining: '2015-01-05', email: 'old.leaver@example.com' }).expect(201)).body.employee;
    const recent = (await people(boss).post('/employees', { name: 'Recent Leaver', code: 'PRV-4', dateOfJoining: '2020-01-05' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, async () => {
      await peoplePrisma.employee.update({ where: { id: old.id }, data: { status: 'LEFT', dateOfLeaving: '2020-06-30' } });
      await peoplePrisma.employee.update({ where: { id: recent.id }, data: { status: 'LEFT', dateOfLeaving: '2026-06-30' } });
    });
    /* The legal minimum holds. */
    expect((await people(officer).put('/privacy/retention/PAYROLL', { keepYears: 5 }).expect(400)).body.code).toBe('BELOW_LEGAL_MINIMUM');
    const review = (await people(officer).get('/privacy/deletion-review').expect(200)).body;
    expect(review.rows.map((r: any) => r.label)).toEqual(['Old Leaver (PRV-3)']);
    expect(review.rows[0].dueSince).toBe('2023-06-30');
    const item = review.rows[0];
    /* Erasing needs the delete grant. */
    expect((await people(officer).post(`/privacy/deletion-review/${item.id}`, { decision: 'APPROVE' }).expect(403)).body.code).toBe('FORBIDDEN');
    await people(officer).put('/privacy/retention/PEOPLE_RECORD', { legalHold: true }).expect(400);
    await people(officer).put('/privacy/retention/PEOPLE_RECORD', { legalHold: true, holdReason: 'Labour court case 12/2026' }).expect(200);
    const eraser = await colleague(boss, 'Dev Admin', ['PEOPLE::Privacy::VIEW', 'PEOPLE::Privacy::EDIT', 'PEOPLE::Privacy::DELETE']);
    expect((await people(eraser).post(`/privacy/deletion-review/${item.id}`, { decision: 'APPROVE' }).expect(409)).body.code).toBe('LEGAL_HOLD');
    expect((await people(eraser).get('/privacy/deletion-review').expect(200)).body.hold).toBe('Labour court case 12/2026');
    await people(officer).put('/privacy/retention/PEOPLE_RECORD', { legalHold: false }).expect(200);
    const done = (await people(eraser).post(`/privacy/deletion-review/${item.id}`, { decision: 'APPROVE' }).expect(200)).body.item;
    expect(done.status).toBe('APPROVED');
    const row = await runInTenant(boss.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: old.id } }));
    expect(row.anonymisedAt).not.toBeNull();
    expect(row.email).not.toBe('old.leaver@example.com');
    /* Decided once; the next scan does not bring it back. */
    await people(eraser).post(`/privacy/deletion-review/${item.id}`, { decision: 'KEEP', note: 'x' }).expect(409);
    expect((await people(officer).get('/privacy/deletion-review').expect(200)).body.rows).toEqual([]);
  });
});

describe('auditor access (PRV-06) and the access report (PRV-07)', () => {
  it('the auditor opens only named evidence until the grant ends, every open logged, and never a profile', async () => {
    const e = (await people(boss).post('/employees', { name: 'Kiran Shetty', code: 'PRV-5', dateOfJoining: '2025-01-05' }).expect(201)).body.employee;
    const named = (await people(boss).post(`/employees/${e.id}/documents`, { title: 'Wage register Sep', kind: 'OTHER', classification: 'HR_ONLY', ...file('wages') }).expect(201)).body.document;
    const other = (await people(boss).post(`/employees/${e.id}/documents`, { title: 'Medical note', kind: 'OTHER', classification: 'CONFIDENTIAL', ...file('medical') }).expect(201)).body.document;
    const auditor = await colleague(boss, 'Audit Partner', ['SETTINGS::Audit trail::VIEW']);
    const now = Date.now();
    await people(boss).post('/privacy/auditor-grants', { userId: auditor.userId, purpose: 'Statutory audit FY26', documentIds: [named.id], untilAt: new Date(now + 100 * 86_400_000).toISOString() }).expect(400);
    await people(boss).post('/privacy/auditor-grants', { userId: auditor.userId, purpose: 'Statutory audit FY26', documentIds: ['nope'], untilAt: new Date(now + 86_400_000).toISOString() }).expect(400);
    const grant = (await people(boss).post('/privacy/auditor-grants', { userId: auditor.userId, purpose: 'Statutory audit FY26', documentIds: [named.id], untilAt: new Date(now + 86_400_000).toISOString() }).expect(201)).body.grant;

    const seen = (await people(auditor).get('/audit-evidence').expect(200)).body;
    expect(seen.documents.map((d: any) => d.title)).toEqual(['Wage register Sep']);
    expect(JSON.stringify(seen)).not.toContain('Kiran');
    expect((await people(auditor).get(`/audit-evidence/${named.id}`).expect(200)).body.document.dataUrl).toContain('base64,');
    await people(auditor).get(`/audit-evidence/${other.id}`).expect(404);
    await people(auditor).get(`/employees/${e.id}`).expect(403);
    await people(auditor).get(`/documents/${named.id}`).expect(403);

    /* The grant ends on time. */
    await runInTenant(boss.orgId, () => peoplePrisma.auditorGrant.update({ where: { id: grant.id }, data: { untilAt: new Date(Date.now() - 1000) } }));
    await people(auditor).get(`/audit-evidence/${named.id}`).expect(404);
    expect((await people(auditor).get('/audit-evidence').expect(200)).body.documents).toEqual([]);

    /* Confidential opens and statutory reveals land on the report, with the auditor's open. */
    await people(boss).get(`/documents/${other.id}`).expect(200);
    await runInTenant(boss.orgId, () => peoplePrisma.accessLog.create({ data: { accountId: grant.accountId, orgId: boss.orgId, what: 'STATUTORY', entityId: e.id, employeeId: e.id, field: 'pan', userId: boss.userId } }));
    const officer = await colleague(boss, 'Report Reader', ['PEOPLE::Privacy::VIEW']);
    const report = (await people(officer).get(`/privacy/access?employeeId=${e.id}`).expect(200)).body;
    expect(report.views.map((v: any) => [v.what, v.detail]).sort()).toEqual([['AUDITOR_DOC', 'Wage register Sep'], ['DOC_CONFIDENTIAL', 'Medical note'], ['STATUTORY', 'pan']]);
    expect(report.views.find((v: any) => v.what === 'AUDITOR_DOC').user).toBe('Audit Partner');
    const statutoryOnly = (await people(officer).get(`/privacy/access?what=STATUTORY`).expect(200)).body.views;
    expect(statutoryOnly.map((v: any) => v.employee)).toEqual(['Kiran Shetty (PRV-5)']);
    const csv = await people(officer).get(`/privacy/access?employeeId=${e.id}&format=csv`).expect(200);
    expect(csv.text.split('\n')[0]).toBe('When,Who,What,Person,Detail');
    await people(auditor).get('/privacy/access').expect(403);
  });
});
