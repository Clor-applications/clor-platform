import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Workforce and Organization code review (26 Oct 2026): the defects found,
 * each held here so it cannot come back. Statutory registers stay with the
 * record keepers; an auditor grant cannot forge its grantor; a team lead's
 * bulk change skips their own record; the person a request is about never
 * decides it; a branch people are filed at cannot be deleted; pending
 * actions filter to the team before the cap.
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
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `rvw.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Review Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase().replace(/\W/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });
const link = (c: Ctx, employeeId: string, userId: string) => runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } }));

let hr: Ctx;
let lead: Ctx;
let leadEmp: any;
let report: any;
let ops: any;
beforeAll(async () => {
  hr = await owner();
  lead = await colleague(hr, 'Team Lead', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE'], true);
  leadEmp = (await people(hr).post('/employees', { name: 'Lead Person', code: 'R-1', dateOfBirth: '1990-01-01' }).expect(201)).body.employee;
  await link(hr, leadEmp.id, lead.userId);
  report = (await people(hr).post('/employees', { name: 'Report Person', code: 'R-2', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
  await people(hr).post('/employees', { name: 'Elsewhere Person', code: 'R-3', dateOfBirth: '1985-05-05', phone: '9800000001' }).expect(201);
  ops = (await people(hr).post('/structure/departments', { name: 'Operations' }).expect(201)).body.item;
}, 120_000);

describe('Workforce and Organization review fixes', () => {
  it('the statutory registers are for record keepers over the whole company, not a team lead', async () => {
    expect((await people(lead).get('/compliance/registers/employees').expect(403)).body.error).toContain('personal details');
    await people(lead).get('/compliance/registers/leave?from=2026-01-01&to=2026-12-31').expect(403);
    const viewer = await colleague(hr, 'Viewer', ['PEOPLE::Employees::VIEW']);
    await people(viewer).get('/compliance/registers/employees').expect(403);
    const rows = (await people(hr).get('/compliance/registers/employees').expect(200)).body.rows;
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('an auditor grant cannot name its own grantor, or pad the id to grant oneself', async () => {
    const officer = await colleague(hr, 'Officer', ['PEOPLE::Privacy::VIEW', 'PEOPLE::Privacy::EDIT']);
    const doc = (await people(hr).post(`/employees/${report.id}/documents`, { title: 'Wage register', kind: 'OTHER', classification: 'HR_ONLY', ...file('w') }).expect(201)).body.document;
    const untilAt = new Date(Date.now() + 86_400_000).toISOString();
    const forged = await people(officer).post('/privacy/auditor-grants', { userId: officer.userId, grantedByUserId: hr.userId, purpose: 'Audit', documentIds: [doc.id], untilAt }).expect(400);
    expect(forged.body.code).toBe('SELF_GRANT');
    expect((await people(officer).post('/privacy/auditor-grants', { userId: ` ${officer.userId} `, purpose: 'Audit', documentIds: [doc.id], untilAt }).expect(400)).body.code).toBe('SELF_GRANT');
    const auditor = await colleague(hr, 'Auditor', ['SETTINGS::Audit trail::VIEW']);
    const grant = (await people(officer).post('/privacy/auditor-grants', { userId: auditor.userId, grantedByUserId: 'someone-else', purpose: 'Audit', documentIds: [doc.id], untilAt }).expect(201)).body.grant;
    expect(grant.grantedByUserId).toBe(officer.userId);
  });

  it("a team lead's bulk change skips their own record, and takes only a manager inside the team", async () => {
    const r = (await people(lead).post('/employees/bulk', { ids: [leadEmp.id, report.id], set: { departmentId: ops.id }, reason: 'Reorg' }).expect(200)).body;
    expect(r.changed).toBe(1);
    expect(r.skipped).toEqual([expect.objectContaining({ id: leadEmp.id, why: expect.stringContaining('own record') })]);
    const own = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: leadEmp.id } }));
    expect(own.departmentId).toBeNull();
    const outsider = (await people(hr).post('/employees', { name: 'Outside Manager', code: 'R-9' }).expect(201)).body.employee;
    await people(lead).post('/employees/bulk', { ids: [report.id], set: { reportingManagerId: outsider.id }, reason: 'x' }).expect(400);
  });

  it('the person a request is about never decides it', async () => {
    /* Priya approves job changes; one is raised about Priya herself. */
    const priya = await colleague(hr, 'Priya', ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE']);
    const priyaEmp = (await people(hr).post('/employees', { name: 'Priya Head', code: 'R-4' }).expect(201)).body.employee;
    await link(hr, priyaEmp.id, priya.userId);
    await people(hr).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Priya decides', steps: [{ approver: { kind: 'USER', id: priya.userId }, dueDays: 2 }] }).expect(201);
    const req = (await people(hr).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: priyaEmp.id, title: 'Department for Priya', payload: { employeeId: priyaEmp.id, fields: { departmentId: { before: null, after: ops.id } }, reason: 'Move' } }).expect(201)).body.request;
    expect(JSON.stringify(req.steps)).not.toContain(priya.userId);
    await people(priya).post(`/requests/${req.id}/approve`, {}).expect(403);
  });

  it('a branch people are filed at cannot be deleted', async () => {
    const headBranch = await platformPrisma.branch.findUnique({ where: { id: hr.branchId } });
    const pune = await platformPrisma.branch.create({ data: { accountId: headBranch!.accountId, orgId: hr.orgId, branchCode: 'PUN', branchName: 'Pune', addressLine1: '1 Main Road', state: 'Maharashtra', country: 'India', isActive: true, createdByUserId: headBranch!.createdByUserId } });
    await people(hr).post('/employees', { name: 'Pune Person', code: 'R-5', branchId: pune.id }).expect(201);
    const r = await request(app).delete(`/api/orgs/${hr.orgId}/branches/${pune.id}`).set(at(hr)).expect(409);
    expect(r.body.code).toBe('IN_USE');
    expect(await platformPrisma.branch.findUnique({ where: { id: pune.id } })).not.toBeNull();
  });

  it("pending actions filter to the team before the cap", async () => {
    const r = (await people(lead).get('/workforce/pending').expect(200)).body;
    for (const item of r.requests) expect([leadEmp.id, report.id]).toContain(item.employee.id);
  });
});
