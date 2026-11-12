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

  it('Documents VIEW opens what the person can see; with HR-only documents, HR-only files too; never restricted or confidential ones', async () => {
    /* Documents VIEW alone (the Viewer template, owner 8 Nov 2026): only what the person themself can see. */
    const reader = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW']);
    expect((await people(reader).get(`/employees/${employeeId}/documents`).expect(200)).body.documents.map((d: any) => d.classification)).toEqual(['EMPLOYEE_VISIBLE']);
    await people(reader).get(`/documents/${docs.HR_ONLY}`).expect(404);
    const viewer = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::HR-only Documents::VIEW']);
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
    const editor = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::HR-only Documents::VIEW', 'PEOPLE::Documents::EDIT']);
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
const { writeChangeLog } = await import('../services/people/changeLog.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
/* The Team Manager preset's grants (permissionCatalog.ts TEAM_MANAGER), on a role kept to its own team. */
const TEAM_MANAGER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Org Structure::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE', 'PEOPLE::Lifecycle::VIEW', 'PEOPLE::Lifecycle::EDIT', 'PEOPLE::Policies::VIEW', 'PEOPLE::Performance::VIEW', 'ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Leave Requests::APPROVE', 'ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE'];

async function teamManager(boss: Ctx, extra: string[] = []): Promise<Ctx & { userId: string }> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Team ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions: [...TEAM_MANAGER, ...extra] }).expect(200);
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
    const hrUser = await colleague(boss, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::HR-only Documents::VIEW']);
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

/*
 * Review of PR #143: every other surface that names, writes or brings back a file asks the same rule. A team-scoped
 * role that may add, change and delete files still writes only what it may open; Activity, the recycle bin, the
 * profile's permits and the attendance "Documents expiring" report (on screen and by mail) name no file it cannot open.
 */
describe('a team-scoped writer and every other surface that names a file (review of #143)', () => {
  let boss: Ctx & { userId: string; accountId: string };
  let mgr: Ctx & { userId: string };
  let writer: Ctx & { userId: string };
  let report: any;
  const f: Record<string, string> = {};
  const upload = async (who: Ctx, employee: string, body: Record<string, unknown>) =>
    (await people(who).post(`/employees/${employee}/documents`, { kind: 'OTHER', classification: 'EMPLOYEE_VISIBLE', ...body, ...file(String(body.title)) }).expect(201)).body.document.id as string;
  const claims = (c: Ctx) => JSON.parse(Buffer.from(c.token.split('.')[1], 'base64url').toString());

  beforeAll(async () => {
    const o = await owner();
    boss = { ...o, userId: claims(o).userId, accountId: claims(o).accountId };
    mgr = await teamManager(boss);
    writer = await teamManager(boss, ['PEOPLE::Documents::CREATE', 'PEOPLE::Documents::EDIT', 'PEOPLE::Documents::DELETE']);
    /* The viewing manager leads the writer, who leads the person: both readers have the person in their team. */
    const top = (await people(boss).post('/employees', { firstName: 'Rahul', lastName: 'Viewer', code: 'TW-0' }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: top.id }, data: { userId: mgr.userId } }));
    const lead = (await people(boss).post('/employees', { firstName: 'Kiran', lastName: 'Lead', code: 'TW-1', reportingManagerId: top.id }).expect(201)).body.employee;
    await runInTenant(boss.orgId, () => peoplePrisma.employee.update({ where: { id: lead.id }, data: { userId: writer.userId } }));
    report = (await people(boss).post('/employees', { firstName: 'Anu', lastName: 'Report', code: 'TW-2', reportingManagerId: lead.id }).expect(201)).body.employee;
    f.hrContract = await upload(boss, report.id, { title: 'Signed contract TW', kind: 'CONTRACT', classification: 'HR_ONLY' });
    f.reportPayslip = await upload(boss, report.id, { title: 'Payslip TW', kind: 'PAYSLIP' });
    f.toDelete = await upload(boss, report.id, { title: 'Warning letter TW', kind: 'LETTER', classification: 'HR_ONLY' });
    f.permit = await upload(boss, report.id, { title: 'Visa TW', kind: 'WORK_PERMIT', classification: 'HR_ONLY', expiresOn: '2020-01-01' });
    f.shared = await upload(boss, report.id, { title: 'Joining kit TW', expiresOn: '2020-02-01' });
  }, 180_000);

  it('the writer cannot replace, delete, remind about or ask to read an HR-only file or a report\'s payslip', async () => {
    for (const id of [f.hrContract, f.reportPayslip]) {
      await people(writer).post(`/documents/${id}/replace`, { title: 'x', ...file('x') }).expect(404);
      await people(writer).post(`/documents/${id}/remind`, {}).expect(404);
      await people(writer).post(`/documents/${id}/ask-to-read`, {}).expect(404);
      await people(writer).del(`/documents/${id}`).expect(404);
    }
    expect(await peoplePrisma.employeeDocument.count({ where: { orgId: boss.orgId, id: { in: [f.hrContract, f.reportPayslip] }, supersededById: null } })).toBe(2);
  });

  it('the writer cannot add an HR-only file or a payslip; a file the person sees, they can', async () => {
    const hrOnly = await people(writer).post(`/employees/${report.id}/documents`, { title: 'Note', kind: 'OTHER', classification: 'HR_ONLY', ...file('n') }).expect(403);
    expect(hrOnly.body.error).toMatch(/Only HR adds files the person cannot see/);
    const restricted = await people(writer).post(`/employees/${report.id}/documents`, { title: 'Note', kind: 'OTHER', classification: 'RESTRICTED', ...file('n') }).expect(403);
    expect(restricted.body.error).toMatch(/Only HR/);
    const payslip = await people(writer).post(`/employees/${report.id}/documents`, { title: 'Slip', kind: 'PAYSLIP', classification: 'EMPLOYEE_VISIBLE', ...file('p') }).expect(403);
    expect(payslip.body.error).toMatch(/Only HR adds payslips/);
    await people(writer).post(`/employees/${report.id}/documents`, { title: 'Team photo ID', kind: 'ID_PROOF', classification: 'EMPLOYEE_VISIBLE', ...file('id') }).expect(201);
  });

  it('a deleted HR-only file is not named in a team reader\'s Activity, nor is an older line that never stored who could see it', async () => {
    await people(boss).del(`/documents/${f.toDelete}`).expect(200);
    const legacy = await runInTenant(boss.orgId, () => writeChangeLog(peoplePrisma as any, { accountId: boss.accountId, orgId: boss.orgId, userId: boss.userId, source: 'FORM', correlationId: `legacy-${rnd()}` } as any, { kind: 'EmployeeDocument', id: `gone-${rnd()}`, employeeId: report.id }, [{ field: 'document', before: 'Old disciplinary note TW', after: null, redacted: false }]));
    expect(legacy).toBe(1);
    for (const who of [mgr, writer]) {
      const activity = JSON.stringify((await people(who).get(`/employees/${report.id}/activity`).expect(200)).body);
      expect(activity).not.toContain('Warning letter TW');
      expect(activity).not.toContain('Old disciplinary note TW');
      expect(activity).not.toContain('document.classification');
    }
    const hrView = JSON.stringify((await people(boss).get(`/employees/${report.id}/activity`).expect(200)).body);
    expect(hrView).toContain('Warning letter TW');
    expect(hrView).toContain('Old disciplinary note TW');
    expect(hrView).not.toContain('document.classification');
  });

  it('the recycle bin lists a removed HR-only file only to who could open it; restore and purge read as absent to anyone else', async () => {
    const bin = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/recycle-bin`).set(at(c)).expect(200).then((r) => r.body.items as any[]);
    const item = (await bin(boss)).find((i) => i.kind === 'employeeDocument' && i.label.includes('Warning letter TW'));
    expect(item).toBeTruthy();
    expect((await bin(writer)).some((i) => i.id === item.id)).toBe(false);
    await request(app).post(`/api/orgs/${writer.orgId}/recycle-bin/${item.id}/restore`).set(at(writer)).expect(404);
    await request(app).delete(`/api/orgs/${writer.orgId}/recycle-bin/${item.id}`).set(at(writer)).expect(404);

    /* A file the writer could open, it sees in the bin and can bring back. */
    const own = await upload(writer, report.id, { title: 'Bus pass TW' });
    await people(writer).del(`/documents/${own}`).expect(200);
    const mine = (await bin(writer)).find((i) => i.kind === 'employeeDocument' && i.label.includes('Bus pass TW'));
    expect(mine).toBeTruthy();
    await request(app).post(`/api/orgs/${writer.orgId}/recycle-bin/${mine.id}/restore`).set(at(writer)).expect(200);

    /* HR brings the HR-only file back. */
    await request(app).post(`/api/orgs/${boss.orgId}/recycle-bin/${item.id}/restore`).set(at(boss)).expect(200);
    expect(await peoplePrisma.employeeDocument.count({ where: { orgId: boss.orgId, id: f.toDelete } })).toBe(1);
  });

  it('a removed confidential file comes back only with the confidential grant', async () => {
    const conf = await upload(boss, report.id, { title: 'Medical TW', classification: 'CONFIDENTIAL' });
    await people(boss).del(`/documents/${conf}`).expect(200);
    const item = (await request(app).get(`/api/orgs/${boss.orgId}/recycle-bin`).set(at(boss)).expect(200)).body.items.find((i: any) => i.label.includes('Medical TW'));
    expect(item).toBeTruthy();
    const hrUser = await colleague(boss, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Documents::EDIT', 'PEOPLE::Documents::DELETE']);
    expect((await request(app).get(`/api/orgs/${hrUser.orgId}/recycle-bin`).set(at(hrUser)).expect(200)).body.items.some((i: any) => i.id === item.id)).toBe(false);
    await request(app).post(`/api/orgs/${hrUser.orgId}/recycle-bin/${item.id}/restore`).set(at(hrUser)).expect(404);
    /* Opens it, may delete files, but not confidential ones: refused. */
    const reader = await colleague(boss, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::Documents::DELETE', 'PEOPLE::Confidential Documents::VIEW']);
    await request(app).post(`/api/orgs/${reader.orgId}/recycle-bin/${item.id}/restore`).set(at(reader)).expect(403);
  });

  it('the profile says a permit has lapsed without naming an HR-only one to the manager', async () => {
    const mgrPermits = (await people(mgr).get(`/employees/${report.id}`).expect(200)).body.permits;
    expect(mgrPermits).toEqual([expect.objectContaining({ id: null, title: 'A restricted document', hidden: true, expired: true })]);
    expect(JSON.stringify(mgrPermits)).not.toContain('Visa TW');
    const hrPermits = (await people(boss).get(`/employees/${report.id}`).expect(200)).body.permits;
    expect(hrPermits).toEqual([expect.objectContaining({ id: f.permit, title: 'Visa TW', hidden: false })]);
  });

  it('the attendance "Documents expiring" report lists only files the reader may open, on screen and by mail', async () => {
    const reader = await colleague(boss, ATTENDANCE_MANAGER_PEOPLE);
    const docsReport = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/attendance/reports/documents`).set(at(c)).expect(200)).body.rows.map((r: any) => r.document);
    const readerRows = await docsReport(reader);
    for (const t of ['Visa TW', 'Joining kit TW', 'Signed contract TW']) expect(readerRows).not.toContain(t);
    expect(await docsReport(boss)).toEqual(expect.arrayContaining(['Visa TW', 'Joining kit TW']));

    /* A scheduled mail reads as the person who set it up, and as nobody when that is unknown. */
    const { build } = await import('../routes/attendanceReports.js');
    const mailed = async (asUserId?: string | null) => (await build('documents', boss.accountId, boss.orgId, {}, { asUserId })).rows.map((r: any) => r.document);
    expect(await mailed(boss.userId)).toEqual(expect.arrayContaining(['Visa TW', 'Joining kit TW']));
    const asManager = await mailed(mgr.userId);
    expect(asManager).toContain('Joining kit TW');
    expect(asManager).not.toContain('Visa TW');
    expect(await mailed(null)).toEqual([]);

    const { runSchedule } = await import('../services/attendance/reportSchedules.js');
    const seen: unknown[] = [];
    await runSchedule({ id: `s-${rnd()}`, accountId: boss.accountId, orgId: boss.orgId, reportId: 'documents', paramsJson: '{}', cadence: 'DAILY', dayOfWeek: null, dayOfMonth: null, hour: 7, recipients: '', enabled: true, lastSentAt: null, createdByUserId: mgr.userId }, async (...args: unknown[]) => {
      seen.push(args[4]);
      return { title: 'Documents', period: '', columns: [], rows: [] };
    }).catch(() => undefined);
    expect(seen).toEqual([{ asUserId: mgr.userId }]);
  });

  /* Re-review of #143: a schedule anyone with Records VIEW may edit or send must not carry its creator's files to them. */
  const att = (c: Ctx) => ({
    post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance/reports${p}`).set(at(c)).send(b as any),
    put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/attendance/reports${p}`).set(at(c)).send(b as any),
  });
  const mailOf = async (scheduleId: string) => (await platformPrisma.emailOutbox.findMany({ where: { relatedType: 'ReportSchedule', relatedId: scheduleId }, select: { bodyHtml: true, bodyText: true, attachmentsJson: true } })).map((m) => `${m.bodyHtml}${m.bodyText}${m.attachmentsJson}`).join('\n');

  it('whoever redirects a schedule becomes who it reads as: an editor without document grants mails no file names', async () => {
    const reader = await colleague(boss, ATTENDANCE_MANAGER_PEOPLE);
    const s = (await att(boss).post('/schedules', { reportId: 'documents', cadence: 'DAILY', hour: 7, recipients: 'hr@example.com' }).expect(201)).body.schedule;
    await att(reader).put(`/schedules/${s.id}`, { recipients: 'outside@example.com' }).expect(200);
    const row = await peoplePrisma.reportSchedule.findFirst({ where: { id: s.id }, select: { createdByUserId: true } });
    expect(row?.createdByUserId).toBe(claims(reader).userId);
    await att(reader).post(`/schedules/${s.id}/send`).expect(200);
    const mail = await mailOf(s.id);
    expect(mail.length).toBeGreaterThan(0);
    for (const t of ['Visa TW', 'Joining kit TW', 'Signed contract TW']) expect(mail).not.toContain(t);
    /* A change to only the hour does not move whose access it reads with. */
    await att(boss).put(`/schedules/${s.id}`, { hour: 8 }).expect(200);
    expect((await peoplePrisma.reportSchedule.findFirst({ where: { id: s.id }, select: { createdByUserId: true } }))?.createdByUserId).toBe(claims(reader).userId);
  });

  it('sent now by someone weaker than its creator, it lists only what both may open', async () => {
    await upload(boss, report.id, { title: 'Address proof TW', kind: 'ADDRESS_PROOF', classification: 'RESTRICTED', expiresOn: '2020-03-01' });
    const weaker = await colleague(boss, ['ATTENDANCE::Attendance Records::VIEW', 'PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW', 'PEOPLE::HR-only Documents::VIEW']);
    const s = (await att(boss).post('/schedules', { reportId: 'documents', cadence: 'DAILY', hour: 7, recipients: 'hr@example.com' }).expect(201)).body.schedule;
    await att(weaker).post(`/schedules/${s.id}/send`).expect(200);
    const mail = await mailOf(s.id);
    expect(mail).toContain('Joining kit TW');
    expect(mail).toContain('Visa TW');
    expect(mail).not.toContain('Address proof TW');
    /* The creator pressing it gets the restricted file too. */
    const s2 = (await att(boss).post('/schedules', { reportId: 'documents', cadence: 'DAILY', hour: 7, recipients: 'hr@example.com' }).expect(201)).body.schedule;
    await att(boss).post(`/schedules/${s2.id}/send`).expect(200);
    expect(await mailOf(s2.id)).toContain('Address proof TW');
  });
});
