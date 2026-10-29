import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { parseRecord } from '../services/people/workspace.js';
import { runInTenant } from '../utils/tenantScope.js';
const app = buildApp().listen(0);
type Ctx = { token: string; orgId: string; branchId: string };
const headers = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const path = (c: Ctx, kind: string, id = '') => `/api/orgs/${c.orgId}/people/workspace/${kind}${id ? `/${id}` : ''}`;
async function owner() {
  const signup = await request(app).post('/api/auth/signup').send({ name: 'People QA', email: `workspace.${Date.now()}.${Math.random()}@example.com`, password: 'Passw0rd!23' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Workspace QA ${Date.now()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(headers(c)).send({ features: { people: true } }).expect(200);
  return c;
}
let a: Ctx; let b: Ctx; let employeeId: string; let foreignId: string;
beforeAll(async () => {
  a = await owner(); b = await owner();
  employeeId = (await request(app).post(`/api/orgs/${a.orgId}/people/employees`).set(headers(a)).send({ name: 'Asha Test', code: 'QA1' }).expect(201)).body.employee.id;
  foreignId = (await request(app).post(`/api/orgs/${b.orgId}/people/employees`).set(headers(b)).send({ name: 'Other company' }).expect(201)).body.employee.id;
});
afterAll(async () => { await new Promise((done) => app.close(done)); await peoplePrisma.$disconnect(); await platformPrisma.$disconnect(); });
/* Hiring, goals and training moved to their own tables (Talent: peopleTalent.test.ts); the registers left are these. */
const samples = [
  ['announcements', 'DRAFT', 'PUBLISHED', 'ARCHIVED', { body: 'Company policy update', audience: 'All employees' }],
  ['events', 'DRAFT', 'SCHEDULED', 'CANCELLED', { startDate: '2026-11-05', endDate: '2026-11-06', location: 'Office', organiser: 'HR', description: '' }],
  ['helpdesk', 'OPEN', 'IN_PROGRESS', 'CLOSED', { category: 'GENERAL', priority: 'HIGH', description: 'Need an employment letter', resolution: 'Letter issued' }],
  ['assets', 'AVAILABLE', 'ASSIGNED', 'RETIRED', { assetTag: 'LAP-01', serialNumber: 'TEST123', category: 'Laptop', issuedOn: '2026-10-22', condition: 'Good' }],
  ['benefits', 'DRAFT', 'ACTIVE', 'CANCELLED', { provider: 'Insurer', eligibility: 'All permanent staff', coverage: 'Medical insurance', startDate: '2026-10-01', endDate: '2027-09-30' }],
] as const;
describe('saved People registers', () => {
  for (const [kind, initial, next, terminal, details] of samples) {
    it(`${kind}: creates, reads, updates, detects conflicts, isolates tenants, audits, and deletes`, async () => {
      const body = { title: `${kind} QA`, status: initial, employeeId, dueDate: '2026-12-01', details };
      let record = (await request(app).post(path(a, kind)).set(headers(a)).send(body).expect(201)).body.record;
      const list = await request(app).get(path(a, kind)).set(headers(a)).expect(200);
      expect(list.body.records.find((r: any) => r.id === record.id)?.title).toBe(body.title);
      await request(app).put(path(b, kind, record.id)).set(headers(b)).send({ ...body, version: 1 }).expect(404);
      await request(app).delete(path(b, kind, record.id)).set(headers(b)).expect(404);
      expect((await request(app).get(path(b, kind)).set(headers(b)).expect(200)).body.records).toHaveLength(0);
      expect(await runInTenant(b.orgId, () => peoplePrisma.peopleRecord.findFirst({ where: { id: record.id } }))).toBeNull();
      record = (await request(app).put(path(a, kind, record.id)).set(headers(a)).send({ ...body, status: next, version: 1 }).expect(200)).body.record;
      expect(record.version).toBe(2);
      await request(app).put(path(a, kind, record.id)).set(headers(a)).send({ ...body, title: 'Stale edit', version: 1 }).expect(409);
      await request(app).delete(path(a, kind, record.id)).set(headers(a)).expect(409);
      await request(app).put(path(a, kind, record.id)).set(headers(a)).send({ ...body, status: terminal, version: 2 }).expect(200);
      const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: a.orgId, entityId: record.id, action: 'UPDATE' } });
      expect(audit).not.toBeNull();
      await request(app).delete(path(a, kind, record.id)).set(headers(a)).expect(200);
      expect(await peoplePrisma.peopleRecord.findFirst({ where: { id: record.id } })).toBeNull();
    });
  }
  it('lists document metadata without file bytes and without crossing companies', async () => {
    const upload = await request(app).post(`/api/orgs/${a.orgId}/people/employees/${employeeId}/documents`).set(headers(a)).send({ title: 'QA contract', kind: 'CONTRACT', mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from('Employment contract QA').toString('base64')}` }).expect(201);
    const list = await request(app).get(`/api/orgs/${a.orgId}/people/documents`).set(headers(a)).expect(200);
    expect(list.body.documents.find((d: any) => d.id === upload.body.document.id)).toMatchObject({ title: 'QA contract', employeeName: 'Asha Test' });
    expect(JSON.stringify(list.body)).not.toContain('dataUrl');
    expect((await request(app).get(`/api/orgs/${b.orgId}/people/documents`).set(headers(b)).expect(200)).body.documents).toHaveLength(0);
  });
  it('publishes announcements and scheduled events to the employee portal, keeping drafts and other companies private', async () => {
    await request(app).put(`/api/orgs/${a.orgId}/features`).set(headers(a)).send({ features: { attendance: true } }).expect(200);
    const access = await request(app).get(`/api/orgs/${a.orgId}/attendance/portal-access`).set(headers(a)).expect(200);
    const codes = await request(app).post(`/api/orgs/${a.orgId}/attendance/portal-access/codes`).set(headers(a)).send({ employeeIds: [employeeId] }).expect(200);
    const activation = await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: 'QA1', activationCode: codes.body.codes[0].activationCode, password: 'Portal pass 123' }).expect(200);
    const published = (await request(app).post(path(a, 'announcements')).set(headers(a)).send({ title: 'Published news', status: 'PUBLISHED', details: { body: 'Visible company update' } }).expect(201)).body.record;
    await request(app).post(path(a, 'announcements')).set(headers(a)).send({ title: 'Private draft', status: 'DRAFT', details: { body: 'Do not publish yet' } }).expect(201);
    await request(app).post(path(b, 'announcements')).set(headers(b)).send({ title: 'Other company news', status: 'PUBLISHED', details: { body: 'Different company' } }).expect(201);
    await request(app).post(path(a, 'events')).set(headers(a)).send({ title: 'Future workshop', status: 'SCHEDULED', details: { startDate: '2099-01-01', endDate: '', location: 'Office' } }).expect(201);
    const feed = await request(app).get('/api/portal/company-updates').set('Authorization', `Bearer ${activation.body.token}`).expect(200);
    expect(feed.body.announcements.map((n: any) => n.id)).toEqual([published.id]);
    expect(feed.body.events[0].title).toBe('Future workshop');
    expect(JSON.stringify(feed.body)).not.toMatch(/createdBy|accountId|orgId|Private draft|Other company/);
    await request(app).get('/api/portal/company-updates').set('Authorization', `Bearer ${a.token}`).expect(401);
  });
  it('rejects unknown modules, fields, invalid dates, and foreign employees', async () => {
    await request(app).get(path(a, 'unknown')).set(headers(a)).expect(404);
    await request(app).get(path(a, 'announcements')).expect(401);
    await request(app).post(path(a, 'announcements')).set(headers(a)).send({ title: 'Unsafe', status: 'DRAFT', employeeId: foreignId, details: { body: 'Hello' } }).expect(400);
    await request(app).post(path(a, 'events')).set(headers(a)).send({ title: 'Bad date', status: 'DRAFT', details: { startDate: '2026-02-30', endDate: '' } }).expect(400);
    await request(app).post(path(a, 'announcements')).set(headers(a)).send({ title: 'Bad field', status: 'DRAFT', details: { body: 'Hello', arbitrary: 'No' } }).expect(400);
  });
  it('keeps HR cases private from directory viewers and makes announcement viewers read-only', async () => {
    const role = await request(app).post(`/api/orgs/${a.orgId}/roles`).set(headers(a)).send({ name: 'Directory and news viewer', roleType: 'CUSTOM', permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Announcements::VIEW'] }).expect(201);
    const email = `workspace.viewer.${Date.now()}@example.com`;
    const user = await request(app).post('/api/users').set(headers(a)).send({ email, fullName: 'Read Only', password: 'Viewer!2026pass', orgIds: [a.orgId], branchIdsByOrg: { [a.orgId]: [a.branchId] } }).expect(201);
    await request(app).post(`/api/orgs/${a.orgId}/users/${user.body.user?.id || user.body.id}/roles`).set(headers(a)).send({ roleId: role.body.role?.id || role.body.id }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Viewer!2026pass' }).expect(200);
    const viewer = { ...a, token: login.body.token };
    await request(app).get(path(viewer, 'helpdesk')).set(headers(viewer)).expect(403);
    await request(app).get(path(viewer, 'announcements')).set(headers(viewer)).expect(200);
    await request(app).post(path(viewer, 'announcements')).set(headers(viewer)).send({ title: 'Forbidden', status: 'DRAFT', details: { body: 'No' } }).expect(403);
  });
  it('no longer keeps hiring, goals or training here: those addresses are unknown', async () => {
    for (const kind of ['recruitment', 'candidates', 'performance', 'learning']) await request(app).get(path(a, kind)).set(headers(a)).expect(404);
  });
});
describe('domain rules', () => {
  it('requires an employee for an assigned asset and a resolution for closed cases', () => {
    expect(() => parseRecord('assets', { title: 'Laptop', status: 'ASSIGNED', details: { assetTag: 'A1', issuedOn: '' } })).toThrow(/employee/);
    expect(() => parseRecord('helpdesk', { title: 'Case', status: 'CLOSED', employeeId: 'e', details: { category: 'GENERAL', priority: 'NORMAL', description: 'Issue', resolution: '' } })).toThrow(/resolution/);
  });
  it('rejects event and benefit date ranges in reverse order', () => {
    expect(() => parseRecord('events', { title: 'Event', status: 'DRAFT', details: { startDate: '2026-12-01', endDate: '2026-11-01' } })).toThrow(/End date/);
    expect(() => parseRecord('benefits', { title: 'Plan', status: 'DRAFT', details: { startDate: '2026-12-01', endDate: '2026-11-01' } })).toThrow(/End date/);
  });
});
