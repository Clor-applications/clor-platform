import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Team scope (docs/people/03 contract §4; PC-ACC-01) and the dotted-line
 * manager (ORG-02). A manager role limited to its own records sees itself
 * and the people whose line, solid or dotted, reaches it; nobody else, on
 * the directory, the record, its history, its documents or the chart.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `scope.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Scope Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
/** A colleague holding these permissions, on a role limited to their own records when asked. */
async function colleague(boss: Ctx, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ mime: 'text/plain', data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });

let hr: Ctx;
let manager: Ctx;
let me: any;
let report: any;
let dotted: any;
let grandReport: any;
let stranger: any;
beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Documents::VIEW'], true);
  me = (await people(hr).post('/employees', { name: 'Ravi Manager', code: 'M-1' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: me.id }, data: { userId: manager.userId } }));
  report = (await people(hr).post('/employees', { name: 'Direct Report', code: 'M-2', reportingManagerId: me.id }).expect(201)).body.employee;
  dotted = (await people(hr).post('/employees', { name: 'Dotted Report', code: 'M-3', dottedManagerId: me.id }).expect(201)).body.employee;
  grandReport = (await people(hr).post('/employees', { name: 'Grand Report', code: 'M-4', reportingManagerId: report.id }).expect(201)).body.employee;
  stranger = (await people(hr).post('/employees', { name: 'Someone Else', code: 'M-5' }).expect(201)).body.employee;
  for (const e of [report, stranger]) await people(hr).post(`/employees/${e.id}/documents`, { title: `${e.name} file`, kind: 'OTHER', classification: 'HR_ONLY', ...file('x') }).expect(201);
}, 90_000);

describe('a manager limited to their own team', () => {
  it('sees themselves and their line, solid and dotted, and nobody else on the directory', async () => {
    const names = (await people(manager).get('/employees?limit=500').expect(200)).body.employees.map((e: any) => e.name).sort();
    expect(names).toEqual(['Direct Report', 'Dotted Report', 'Grand Report', 'Ravi Manager']);
    const all = (await people(hr).get('/employees?limit=500').expect(200)).body.employees.map((e: any) => e.name);
    expect(all).toContain('Someone Else');
  });

  it('a stranger reads as absent: record, history, documents, chart', async () => {
    await people(manager).get(`/employees/${report.id}`).expect(200);
    await people(manager).get(`/employees/${stranger.id}`).expect(404);
    await people(manager).get(`/employees/${stranger.id}/history`).expect(404);
    await people(manager).get(`/employees/${stranger.id}/documents`).expect(404);
    const register = (await people(manager).get('/documents').expect(200)).body.documents.map((d: any) => d.title);
    expect(register).toEqual(['Direct Report file']);
    const chart = (await people(manager).get('/org-chart').expect(200)).body;
    const ids = JSON.stringify(chart);
    expect(ids).toContain(report.id);
    expect(ids).not.toContain(stranger.id);
  });

  it('the dotted line is recorded like any other change, and approvals stay with the reporting manager', async () => {
    const history = (await people(hr).get(`/employees/${dotted.id}/history`).expect(200)).body.events;
    const one = (await people(hr).get(`/employees/${dotted.id}`).expect(200)).body.employee;
    expect(one).toMatchObject({ dottedManagerId: me.id, dottedManagerName: 'Ravi Manager', reportingManagerId: null });
    await people(hr).put(`/employees/${dotted.id}`, { dottedManagerId: null }).expect(200);
    const after = (await people(hr).get(`/employees/${dotted.id}/history`).expect(200)).body.events.find((x: any) => x.field === 'dottedManagerId');
    expect(after).toMatchObject({ from: 'Ravi Manager', to: null, title: 'Secondary manager changed' });
    expect(after.payrollImpact).toBeNull();
    void history;
  });

  it('cannot edit, delete or withdraw a change for someone outside their team, even with those grants', async () => {
    const editor = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Employees::DELETE'], true);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: report.id }, data: { userId: editor.userId } }));
    await people(editor).put(`/employees/${stranger.id}`, { phone: '9000000001' }).expect(404);
    await request(app).delete(`/api/orgs/${hr.orgId}/people/employees/${stranger.id}`).set(at(editor)).expect(404);
    await request(app).delete(`/api/orgs/${hr.orgId}/people/employees/${stranger.id}/scheduled/any`).set(at(editor)).expect(404);
    const untouched = await runInTenant(hr.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: stranger.id } }));
    expect(untouched.phone).not.toBe('9000000001');
    /* Their own line is still theirs to edit. */
    await people(editor).put(`/employees/${grandReport.id}`, { phone: '9000000002' }).expect(200);
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: report.id }, data: { userId: null } }));
  });

  it('a manager with no employee record of their own sees nobody', async () => {
    const lone = await colleague(hr, ['PEOPLE::Employees::VIEW'], true);
    expect((await people(lone).get('/employees?limit=500').expect(200)).body).toMatchObject({ employees: [], total: 0 });
  });

  it('the rest of People keeps to the team too (Workforce audit S1–S4)', async () => {
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Employees::EXPORT', 'PEOPLE::Employees::CREATE', 'PEOPLE::Employees::DELETE', 'PEOPLE::Employee Notes::VIEW', 'PEOPLE::Employee Notes::CREATE', 'PEOPLE::Statutory Details::VIEW', 'PEOPLE::Statutory Details::EDIT', 'PEOPLE::Lifecycle::EDIT'], true);
    const mine = (await people(hr).post('/employees', { name: 'Lead Self', code: `L-${rnd()}`, probationEndDate: '2099-01-01' }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: mine.id }, data: { userId: lead.userId } }));
    /* Ticked ids from outside the team are not exported. */
    const csv = (await people(lead).get(`/employees/export?ids=${stranger.id}`).expect(200)).text;
    expect(csv).not.toContain('Someone Else');
    /* Statutory, identity, notes, checklist: a stranger reads as absent. */
    await people(lead).get(`/employees/${stranger.id}/statutory`).expect(404);
    await people(lead).put(`/employees/${stranger.id}/identity`, { aadhaarLast4: '1234' }).expect(404);
    await people(lead).get(`/employees/${stranger.id}/notes`).expect(404);
    await people(lead).post(`/employees/${stranger.id}/notes`, { body: 'Should not land' }).expect(404);
    await people(lead).get(`/employees/${stranger.id}/checklist`).expect(404);
    await people(lead).post(`/employees/${stranger.id}/probation/review`, { observations: 'x' }).expect(404);
    /* Nobody reviews their own probation. */
    await people(lead).post(`/employees/${mine.id}/probation/review`, { observations: 'All good' }).expect(403);
    /* Open tasks and the overview show the team only. */
    const tasks = (await people(lead).get('/checklist-tasks').expect(200)).body.tasks.map((t: any) => t.employee.id);
    expect(tasks).not.toContain(stranger.id);
    const overview = (await people(lead).get('/overview').expect(200)).body;
    expect(overview.headcount).toBe(1);
    /* Company-wide HR work is refused outright. */
    await people(lead).post('/employees/import', { rows: [{ name: 'Imported' }] }).expect(403);
    await people(lead).get('/data-requests').expect(403);
    await people(lead).get('/headcount').expect(403);
    await people(lead).post(`/employees/${stranger.id}/anonymise`, { confirmName: 'Someone Else' }).expect(403);
  });

  it('a read-only role gets the work profile; date of birth, address and family stay with HR (Workforce audit E4)', async () => {
    await people(hr).put(`/employees/${report.id}`, { dateOfBirth: '1990-05-04', addressLine: '12 Lake Road', emergencyContactName: 'Sita' }).expect(200);
    const seen = (await people(manager).get(`/employees/${report.id}`).expect(200)).body.employee;
    expect(seen).toMatchObject({ personalHidden: true, name: 'Direct Report' });
    expect(seen.dateOfBirth).toBeUndefined();
    expect(seen.addressLine).toBeUndefined();
    const listed = (await people(manager).get('/employees?limit=500').expect(200)).body.employees.find((e: any) => e.id === report.id);
    expect(listed.emergencyContactName).toBeUndefined();
    /* Their own record is theirs to see in full. */
    await people(hr).put(`/employees/${me.id}`, { dateOfBirth: '1985-01-01' }).expect(200);
    expect((await people(manager).get(`/employees/${me.id}`).expect(200)).body.employee.dateOfBirth).toBe('1985-01-01');
    /* HR sees it all; the change shows as changed, without values, to the read-only role. */
    expect((await people(hr).get(`/employees/${report.id}`).expect(200)).body.employee.dateOfBirth).toBe('1990-05-04');
    const activity = (await people(manager).get(`/employees/${report.id}/activity`).expect(200)).body;
    expect(JSON.stringify(activity)).not.toContain('12 Lake Road');
  });

  it("a team lead's own record is changed through the employee app; a manager outside their team does not open (Workforce audit E10, E20)", async () => {
    const lead = await colleague(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT'], true);
    const boss = (await people(hr).post('/employees', { name: 'Their Boss', code: `TB-${rnd()}` }).expect(201)).body.employee;
    const self = (await people(hr).post('/employees', { name: 'Lead Own', code: `LO-${rnd()}`, reportingManagerId: boss.id }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: self.id }, data: { userId: lead.userId } }));
    const mine = (await people(lead).get(`/employees/${self.id}`).expect(200)).body.employee;
    expect(mine).toMatchObject({ ownRecordLocked: true, managerOpens: false, reportingManagerName: 'Their Boss' });
    const refused = await people(lead).put(`/employees/${self.id}`, { phone: '9876501234' }).expect(403);
    expect(refused.body.code).toBe('OWN_RECORD');
    /* HR edits it as ever. */
    await people(hr).put(`/employees/${self.id}`, { phone: '9876501234' }).expect(200);
  });

  it('the change preview does not name a manager outside the viewer\'s team (Workforce audit S17)', async () => {
    const impact = (await people(manager).get(`/employees/${report.id}/change-impact?reportingManagerId=${stranger.id}`).expect(200)).body.impact;
    /* The stranger has no login, so before this the preview said "Someone Else cannot sign in yet". */
    expect(JSON.stringify(impact)).not.toContain('Someone Else');
  });
});
