import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Who can see an employee document (docs/people/02-PRD.md DOC-01; platform
 * review R-01). Before 24 Oct 2026 any role with Employees VIEW opened every
 * file, and the Attendance Manager preset carried that grant. A document now
 * names who can see it, and the employee app keeps its own flag in step.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(): Promise<Ctx> {
  const email = `docs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR head' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Docs Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}

/** A second person in the company holding exactly these permissions. */
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId };
}

const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});

const file = (text: string) => ({ mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });

/* The Attendance Manager preset's People share: Employees VIEW and nothing else in People. */
const ATTENDANCE_MANAGER_PEOPLE = ['PEOPLE::Employees::VIEW', 'ATTENDANCE::Attendance Records::VIEW'];

let hr: Ctx;
let employeeId: string;
const docs: Record<string, string> = {};

beforeAll(async () => {
  hr = await owner();
  const made = await people(hr).post('/employees', { firstName: 'Meera', lastName: 'Shah', code: 'D-1' }).expect(201);
  employeeId = made.body.employee.id;
  for (const classification of ['EMPLOYEE_VISIBLE', 'HR_ONLY', 'RESTRICTED', 'CONFIDENTIAL']) {
    const r = await people(hr).post(`/employees/${employeeId}/documents`, { title: `${classification} file`, kind: 'OTHER', classification, ...file(`${classification} body`) }).expect(201);
    docs[classification] = r.body.document.id;
    expect(r.body.document.classification).toBe(classification);
  }
}, 90_000);

describe('who can see a document', () => {
  it('a role with only Employees VIEW (the Attendance Manager share) opens no document at all', async () => {
    const am = await colleague(hr, ATTENDANCE_MANAGER_PEOPLE);
    await people(am).get('/employees').expect(200);
    await people(am).get(`/employees/${employeeId}/documents`).expect(403);
    await people(am).get('/documents').expect(403);
    for (const id of Object.values(docs)) await people(am).get(`/documents/${id}`).expect(403);
  });

  it('Documents VIEW opens what the person can see and HR-only files, and does not reveal restricted or confidential ones', async () => {
    const viewer = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW']);
    const listed = (await people(viewer).get(`/employees/${employeeId}/documents`).expect(200)).body.documents.map((d: any) => d.classification).sort();
    expect(listed).toEqual(['EMPLOYEE_VISIBLE', 'HR_ONLY']);
    const register = (await people(viewer).get('/documents').expect(200)).body.documents.map((d: any) => d.title);
    expect(register).not.toContain('RESTRICTED file');
    expect(register).not.toContain('CONFIDENTIAL file');
    await people(viewer).get(`/documents/${docs.HR_ONLY}`).expect(200);
    /* Not 403: a refusal would confirm the file exists. */
    await people(viewer).get(`/documents/${docs.RESTRICTED}`).expect(404);
    await people(viewer).get(`/documents/${docs.CONFIDENTIAL}`).expect(404);
  });

  it('Documents EDIT opens restricted files too; only Confidential Documents VIEW opens confidential ones', async () => {
    const editor = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Documents::EDIT']);
    expect((await people(editor).get(`/employees/${employeeId}/documents`).expect(200)).body.documents.map((d: any) => d.classification).sort()).toEqual(['EMPLOYEE_VISIBLE', 'HR_ONLY', 'RESTRICTED']);
    await people(editor).get(`/documents/${docs.CONFIDENTIAL}`).expect(404);

    const trusted = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Confidential Documents::VIEW']);
    const open = await people(trusted).get(`/documents/${docs.CONFIDENTIAL}`).expect(200);
    expect(open.body.document.dataUrl).toContain('base64,');
  });

  it('uploading or deleting a confidential file needs the confidential grant, whatever the Documents grant says', async () => {
    const editor = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Documents::CREATE', 'PEOPLE::Documents::EDIT', 'PEOPLE::Documents::DELETE']);
    await people(editor).post(`/employees/${employeeId}/documents`, { title: 'Medical note', kind: 'OTHER', classification: 'CONFIDENTIAL', ...file('medical') }).expect(403);
    const own = await people(editor).post(`/employees/${employeeId}/documents`, { title: 'Address proof', kind: 'ADDRESS_PROOF', classification: 'RESTRICTED', ...file('address') }).expect(201);
    await people(editor).del(`/documents/${docs.CONFIDENTIAL}`).expect(404);
    await people(editor).del(`/documents/${own.body.document.id}`).expect(200);
  });

  it('refuses a classification it does not know, and still takes the old flag from older clients', async () => {
    await people(hr).post(`/employees/${employeeId}/documents`, { title: 'x', kind: 'OTHER', classification: 'SECRET', ...file('x') }).expect(400);
    const legacy = await people(hr).post(`/employees/${employeeId}/documents`, { title: 'Old client', kind: 'OTHER', visibleToEmployee: false, ...file('legacy') }).expect(201);
    expect(legacy.body.document.classification).toBe('HR_ONLY');
  });

  it('keeps the employee app flag in step: only "the person and HR" files are visible to the person', async () => {
    const rows = await peoplePrisma.employeeDocument.findMany({ where: { orgId: hr.orgId, employeeId }, select: { classification: true, visibleToEmployee: true } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r.visibleToEmployee).toBe(r.classification === 'EMPLOYEE_VISIBLE');
  });
});
