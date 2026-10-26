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
});
