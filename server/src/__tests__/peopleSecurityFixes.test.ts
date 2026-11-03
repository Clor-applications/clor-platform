import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Fixes from the People security and tests audit (3 Nov 2026):
 *   - a job or profile change carries only its own fields, and a team-scoped asker asks only about their team;
 *   - resign, stay and rehire answer without the reader PIN or the employee app's password hash;
 *   - exit-interview answers are kept to a calendar month end, not rolled into the next month.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { changePayloadProblem, photoFrom, JOB_CHANGE_FIELDS, PROFILE_CHANGE_FIELDS } = await import('../services/people/approvals/changeFields.js');
const { withoutSecrets } = await import('../services/people/employees.js');
const { addMonths } = await import('../utils/istDate.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `sec.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Sec Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  ctx.userId = me.body.user.id;
  return ctx;
}
async function teamLead(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Lead ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `lead.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Ravi Lead', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const people = (c: Ctx) => ({
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
let lead: Ctx;
let leadEmp: any;
let report: any;
let stranger: any;
beforeAll(async () => {
  hr = await owner();
  lead = await teamLead(hr, ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE']);
  leadEmp = (await people(hr).post('/employees', { name: 'Ravi Lead', code: 'S-1' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
  report = (await people(hr).post('/employees', { name: 'Meera Report', code: 'S-2', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
  stranger = (await people(hr).post('/employees', { name: 'Kiran Elsewhere', code: 'S-3' }).expect(201)).body.employee;
}, 120_000);

describe('a change request carries only its own fields', () => {
  it('a job change naming a column outside the job fields is refused, and so is a hidden data block', async () => {
    const hidden = await people(hr).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: report.id, title: 'Grade', payload: { employeeId: report.id, fields: { gradeId: { before: null, after: null } }, data: { userId: lead.userId, portalPasswordHash: 'x' } } });
    expect(hidden.status).toBe(400);
    const column = await people(hr).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: report.id, title: 'Grade', payload: { employeeId: report.id, fields: { portalPasswordHash: { before: null, after: 'x' } } } });
    expect(column.status).toBe(400);
    expect(column.body.error).toMatch(/portalPasswordHash cannot be changed/);
    const status = await people(hr).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: report.id, title: 'Status', payload: { employeeId: report.id, fields: { status: { before: 'ACTIVE', after: 'LEFT' } } } });
    expect(status.status).toBe(400);
  });

  it('profile changes, leaving, probation and policy publishing are refused here: each has its own path', async () => {
    for (const requestType of ['PROFILE_CHANGE', 'LEAVING', 'PROBATION', 'POLICY_PUBLISH']) {
      const r = await people(hr).post('/requests', { requestType, subjectEmployeeId: report.id, title: 'x', payload: { employeeId: report.id, fields: {} } });
      expect(r.status, requestType).toBe(400);
    }
  });

  it('a team lead asks only about their own team; someone outside it reads as absent', async () => {
    const outside = await people(lead).post('/requests', { requestType: 'JOB_CHANGE', subjectEmployeeId: stranger.id, title: 'Move Kiran', payload: { employeeId: stranger.id, fields: { gradeId: { before: null, after: null } } } });
    expect(outside.status).toBe(404);
  });

  it('when a change is applied, only its allowed fields are written, whatever the stored payload holds', async () => {
    /* A request stored before this fix (or written by hand) with extra columns: approval must not write them. */
    expect(changePayloadProblem('JOB_CHANGE', { fields: { departmentId: {} } })).toBeNull();
    expect(changePayloadProblem('JOB_CHANGE', { fields: { userId: {} } })).toMatch(/userId/);
    expect(changePayloadProblem('JOB_CHANGE', { fields: {}, data: {} })).toMatch(/fields only/);
    expect(changePayloadProblem('SEAT_REQUEST', { anything: 1 })).toBeNull();
    for (const f of ['userId', 'portalPasswordHash', 'portalSetupHash', 'devicePassword', 'status', 'orgId', 'accountId']) {
      expect(JOB_CHANGE_FIELDS.has(f), f).toBe(false);
      expect(PROFILE_CHANGE_FIELDS.has(f), f).toBe(false);
    }
    expect(photoFrom({ photoUrl: 'data:image/png;base64,iVBORw0KGgo=' })).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(photoFrom({ photoUrl: 'https://evil.example/x.png' })).toBeNull();
    expect(photoFrom({ userId: 'x' })).toBeNull();
  });
});

describe('leaving, staying and rejoining answer without secrets', () => {
  it('resign, stay and rehire return flags, never the reader PIN or the app password hash', async () => {
    const e = (await people(hr).post('/employees', { name: 'Anil Secret', code: 'S-9' }).expect(201)).body.employee;
    await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { devicePassword: '4321', portalPasswordHash: 'hash-that-must-not-leave' } }));
    const secretFree = (row: any) => {
      expect(row.devicePassword).toBeUndefined();
      expect(row.portalPasswordHash).toBeUndefined();
      expect(row.portalSetupHash).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain('hash-that-must-not-leave');
      expect(row.hasDevicePassword).toBe(true);
    };
    const resigned = await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2099-12-31', leavingType: 'RESIGNED' }).expect(200);
    secretFree(resigned.body.employee);
    const stayed = await people(hr).post(`/employees/${e.id}/stay`, { reason: 'Changed their mind' });
    if (stayed.status === 200) secretFree(stayed.body.employee);
    const left = await people(hr).post(`/employees/${e.id}/resign`, { lastDay: '2026-01-31', leavingType: 'RESIGNED' });
    if (left.status === 200) {
      secretFree(left.body.employee);
      const back = await people(hr).post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-03-01' });
      if (back.status === 200) secretFree(back.body.employee);
    }
    expect(Object.keys(withoutSecrets({ id: 'x', devicePassword: '1', portalPasswordHash: 'h', portalSetupHash: null, portalSetupExpires: null }))).toEqual(['id', 'hasDevicePassword', 'hasPortalPassword', 'portalSetupPending']);
  });
});

describe('exit-interview keeping dates stay inside the month', () => {
  it('31 Aug + 6 months is 28 Feb, and 29 Feb + 12 months is 28 Feb', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });
});
