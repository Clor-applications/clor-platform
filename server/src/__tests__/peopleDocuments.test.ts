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

const app = buildApp().listen(0, '127.0.0.1');
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

/*
 * Audit 7 Nov 2026 #1 (P0): a Team Manager listed and opened "HR only" files of their reports, payslips included,
 * through the team's Documents VIEW. A team-scoped role now opens only what the person themself can see, and no
 * payslip but the manager's own; HR (a company-wide Documents VIEW) keeps every HR-only file.
 */
const { runInTenant } = await import('../utils/tenantScope.js');
/* The Team Manager preset's grants (permissionCatalog.ts TEAM_MANAGER), on a role kept to its own team. */
const TEAM_MANAGER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE', 'PEOPLE::Lifecycle::VIEW', 'PEOPLE::Lifecycle::EDIT', 'PEOPLE::Policies::VIEW', 'PEOPLE::Performance::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];

async function teamManager(boss: Ctx): Promise<Ctx & { userId: string }> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Team ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions: TEAM_MANAGER }).expect(200);
  const email = `mgr.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Rahul Manager', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}

describe('a team manager and the HR-only files of their team (audit #1)', () => {
  let boss: Ctx;
  let mgr: Ctx & { userId: string };
  let mgrEmp: any;
  let report: any;
  const f: Record<string, string> = {};
  const upload = async (employee: string, title: string, kind: string, classification: string) =>
    (await people(boss).post(`/employees/${employee}/documents`, { title, kind, classification, ...file(title) }).expect(201)).body.document.id as string;

  beforeAll(async () => {
    boss = await owner();
    mgr = await teamManager(boss);
    mgrEmp = (await people(boss).post('/employees', { firstName: 'Rahul', lastName: 'Manager', code: 'TM-1' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: mgrEmp.id }, data: { userId: mgr.userId } }));
    report = (await people(boss).post('/employees', { firstName: 'Priya', lastName: 'Report', code: 'TM-2', reportingManagerId: mgrEmp.id }).expect(201)).body.employee;
    f.shared = await upload(report.id, 'Joining kit', 'OTHER', 'EMPLOYEE_VISIBLE');
    f.hrPayslip = await upload(report.id, 'Payslip October', 'PAYSLIP', 'HR_ONLY');
    f.hrContract = await upload(report.id, 'Signed contract', 'CONTRACT', 'HR_ONLY');
    f.reportPayslip = await upload(report.id, 'Payslip September', 'PAYSLIP', 'EMPLOYEE_VISIBLE');
    f.mgrPayslip = await upload(mgrEmp.id, 'My payslip', 'PAYSLIP', 'EMPLOYEE_VISIBLE');
  }, 120_000);

  it('the manager lists only what the person can see, and no payslip but their own', async () => {
    const register = (await people(mgr).get('/documents').expect(200)).body.documents.map((d: any) => d.id).sort();
    expect(register).toEqual([f.shared, f.mgrPayslip].sort());
    const onRecord = (await people(mgr).get(`/employees/${report.id}/documents`).expect(200)).body.documents.map((d: any) => d.id);
    expect(onRecord).toEqual([f.shared]);
  });

  it('the manager cannot download, preview or follow an HR-only file or a report\'s payslip: each reads as absent', async () => {
    for (const id of [f.hrPayslip, f.hrContract, f.reportPayslip]) {
      await people(mgr).get(`/documents/${id}`).expect(404);
      await people(mgr).get(`/documents/${id}/versions`).expect(404);
      await people(mgr).get(`/documents/${id}/acknowledgements`).expect(404);
    }
    const open = await people(mgr).get(`/documents/${f.shared}`).expect(200);
    expect(open.body.document.dataUrl).toContain('base64,');
    await people(mgr).get(`/documents/${f.mgrPayslip}`).expect(200);
  });

  it('the manager\'s view of the person\'s activity names no HR-only file or payslip', async () => {
    const activity = JSON.stringify((await people(mgr).get(`/employees/${report.id}/activity`).expect(200)).body);
    expect(activity).toContain('Joining kit');
    for (const title of ['Payslip October', 'Signed contract', 'Payslip September']) expect(activity).not.toContain(title);
  });

  it('HR, with a company-wide Documents VIEW, lists and opens every HR-only file and payslip', async () => {
    const hrUser = await colleague(boss, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW']);
    for (const who of [boss, hrUser]) {
      const listed = (await people(who).get(`/employees/${report.id}/documents`).expect(200)).body.documents.map((d: any) => d.id).sort();
      expect(listed).toEqual([f.shared, f.hrPayslip, f.hrContract, f.reportPayslip].sort());
      for (const id of [f.hrPayslip, f.hrContract, f.reportPayslip]) await people(who).get(`/documents/${id}`).expect(200);
    }
  });

  it('the employee sees their own visible files and payslip in the employee app, never the HR-only ones', async () => {
    const att = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${boss.orgId}/attendance${p}`).set(at(boss)).send(b as any);
    const companyCode = (await att('get', '/portal-access').expect(200)).body.company.code;
    const code = (await att('post', '/portal-access/codes', { employeeIds: [report.id] }).expect(200)).body.codes[0].activationCode;
    await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'TM-2', activationCode: code, password: 'app pass 12' }).expect(200);
    const token = (await request(app).post('/api/portal/login').send({ company: companyCode, employeeCode: 'TM-2', password: 'app pass 12' }).expect(200)).body.token;
    const mine = (await request(app).get('/api/portal/documents').set('Authorization', `Bearer ${token}`).expect(200)).body.documents.map((d: any) => d.id).sort();
    expect(mine).toEqual([f.shared, f.reportPayslip].sort());
    await request(app).get(`/api/portal/documents/${f.reportPayslip}`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get(`/api/portal/documents/${f.hrPayslip}`).set('Authorization', `Bearer ${token}`).expect(404);
  });
});
