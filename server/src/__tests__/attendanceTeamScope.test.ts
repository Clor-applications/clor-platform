import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The single overtime and field-punch decide routes, and every attendance records route (mark a day, import, delete,
 * validate, approve a day's overtime), keep a team-scoped role to its team (review of PR #105): with Attendance
 * Records or Attendance Devices rights for their own team only, nobody changes the days, overtime or field punches of
 * someone outside it. A company-wide role is unaffected. The bulk decide routes already checked this.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { todayIst, addDays } = await import('../utils/istDate.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});

let hr: Ctx;
let lead: Ctx;
const E: Record<string, any> = {};
const app_: Record<string, string> = {};
const inTenant = <X>(fn: () => Promise<X>) => runInTenant(hr.orgId, fn);

beforeAll(async () => {
  const email = `ts.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Ts Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  hr = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '' };
  await request(app).put(`/api/orgs/${hr.orgId}/features`).set(at(hr)).send({ features: { people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${hr.token}`).expect(200);
  hr.userId = me.body.user.id;
  hr.accountId = me.body.orgs.find((o: any) => o.orgId === hr.orgId).accountId;
  /* A team lead's custom role: overtime (records, edit) and field punches (devices, edit), own team only. */
  const role = await request(app).post(`/api/orgs/${hr.orgId}/roles`).set(at(hr)).send({ name: `Lead ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: true }).expect(201);
  await request(app).put(`/api/orgs/${hr.orgId}/roles/${role.body.role.id}/permissions`).set(at(hr)).send({ permissions: ['ATTENDANCE::Attendance Records::VIEW', 'ATTENDANCE::Attendance Records::EDIT', 'ATTENDANCE::Attendance Records::APPROVE', 'ATTENDANCE::Attendance Records::DELETE', 'ATTENDANCE::Attendance Devices::VIEW', 'ATTENDANCE::Attendance Devices::EDIT', 'PEOPLE::Employees::VIEW', 'ATTENDANCE::My Attendance::VIEW'] }).expect(200);
  const leadEmail = `lead.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(hr)).send({ email: leadEmail, fullName: 'Lead', password: 'Passw0rd!23', orgIds: [hr.orgId], branchIdsByOrg: { [hr.orgId]: [hr.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${hr.orgId}/users/${user.body.user.id}/roles`).set(at(hr)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  lead = { token: (await request(app).post('/api/auth/login').send({ email: leadEmail, password: 'Passw0rd!23' }).expect(200)).body.token, orgId: hr.orgId, branchId: hr.branchId, userId: user.body.user.id, accountId: hr.accountId };
  const emp = async (body: Record<string, unknown>) => (await request(app).post(`/api/orgs/${hr.orgId}/people/employees`).set(at(hr)).send({ dateOfJoining: '2024-01-01', ...body }).expect(201)).body.employee;
  E.lead = await emp({ name: 'Lead Person', code: 'T-1' });
  E.mine = await emp({ name: 'In Team', code: 'T-2', reportingManagerId: E.lead.id });
  E.other = await emp({ name: 'Out Of Team', code: 'T-3' });
  await inTenant(async () => {
    await peoplePrisma.employee.update({ where: { id: E.lead.id }, data: { userId: lead.userId } });
    await peoplePrisma.employee.updateMany({ where: { orgId: hr.orgId, id: { in: [E.mine.id, E.other.id] } }, data: { mobilePunch: true, phonePunchMode: 'FIELD' } });
  });
  const company = (await att(hr).get('/portal-access').expect(200)).body.company.code;
  for (const k of ['mine', 'other']) {
    const code = (await att(hr).post('/portal-access/codes', { employeeIds: [E[k].id] }).expect(200)).body.codes[0].activationCode;
    app_[k] = (await request(app).post('/api/portal/activate').send({ company, employeeCode: E[k].code, activationCode: code, password: 'app pass 123' }).expect(200)).body.token;
  }
  await inTenant(() => peoplePrisma.portalSession.updateMany({ where: { orgId: hr.orgId }, data: { createdAt: new Date(), lastSeenAt: new Date() } }));
}, 120_000);

let back = addDays(todayIst(), -2);
async function overtimeOf(k: string) {
  back = addDays(back, -1);
  const day = back;
  await inTenant(() => peoplePrisma.attendanceRecord.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: E[k].id, date: day, status: 'PRESENT', source: 'MANUAL', workedMinutes: 600, overtimeMinutes: 90, createdByUserId: hr.userId } }));
  const r = await request(app).post('/api/portal/overtime').set('Authorization', `Bearer ${app_[k]}`).send({ date: day, kind: 'OVERTIME', reason: 'Stock count' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.request.id as string;
}
async function punchOf(k: string) {
  await inTenant(() => peoplePrisma.$executeRaw`UPDATE "DevicePunch" SET "at" = "at" - interval '5 minutes' WHERE "orgId" = ${hr.orgId} AND "employeeId" = ${E[k].id}`);
  expect((await request(app).post('/api/portal/punch').set('Authorization', `Bearer ${app_[k]}`).send({ latitude: 12.97, longitude: 77.59, accuracy: 20 })).status).toBe(201);
  return (await inTenant(() => peoplePrisma.devicePunch.findFirstOrThrow({ where: { orgId: hr.orgId, employeeId: E[k].id }, orderBy: { createdAt: 'desc' } }))).id;
}

describe('single overtime and field punch decisions stay inside a team-scoped role’s team', () => {
  it('overtime: refused (404) outside the team, nothing written; inside it, decided; HR decides anyone', async () => {
    const out = await overtimeOf('other');
    for (const d of ['approve', 'reject']) expect((await att(lead).post(`/overtime/requests/${out}/${d}`, { note: 'x' })).status).toBe(404);
    expect((await inTenant(() => peoplePrisma.overtimeRequest.findUniqueOrThrow({ where: { id: out } }))).status).toBe('PENDING');
    const mine = await overtimeOf('mine');
    expect((await att(lead).post(`/overtime/requests/${mine}/approve`, {})).status).toBe(200);
    expect((await att(hr).post(`/overtime/requests/${out}/approve`, {})).status).toBe(200);
  }, 60_000);

  it('field punch: refused (404) outside the team, still waiting; inside it, decided; HR decides anyone', async () => {
    const out = await punchOf('other');
    for (const approve of [true, false]) expect((await att(lead).post(`/phone-punches/${out}/review`, { approve })).status).toBe(404);
    expect((await inTenant(() => peoplePrisma.devicePunch.findUniqueOrThrow({ where: { id: out } }))).reviewStatus).toBe('PENDING');
    const mine = await punchOf('mine');
    expect((await att(lead).post(`/phone-punches/${mine}/review`, { approve: true })).status).toBe(200);
    expect((await att(hr).post(`/phone-punches/${out}/review`, { approve: true })).status).toBe(200);
  }, 60_000);
});

describe('attendance records routes stay inside a team-scoped role’s team', () => {
  let day = addDays(todayIst(), -60);
  const nextPast = () => (day = addDays(day, -1));
  const recordOf = (k: string, extra: Record<string, unknown> = {}) => {
    const date = nextPast();
    return inTenant(() => peoplePrisma.attendanceRecord.create({ data: { accountId: hr.accountId, orgId: hr.orgId, employeeId: E[k].id, date, status: 'PRESENT', source: 'MANUAL', workedMinutes: 600, createdByUserId: hr.userId, ...extra } }));
  };
  const rec = (id: string) => inTenant(() => peoplePrisma.attendanceRecord.findUnique({ where: { id } }));

  it('marking a day: refused (404) outside the team, nothing written; inside it, written; HR marks anyone', async () => {
    const date = nextPast();
    expect((await request(app).put(`/api/orgs/${hr.orgId}/attendance/records`).set(at(lead)).send({ employeeId: E.other.id, date, status: 'ABSENT' })).status).toBe(404);
    expect(await inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, employeeId: E.other.id, date } }))).toBe(0);
    expect((await request(app).put(`/api/orgs/${hr.orgId}/attendance/records`).set(at(lead)).send({ employeeId: E.mine.id, date, status: 'ABSENT' })).status).toBe(200);
    expect((await request(app).put(`/api/orgs/${hr.orgId}/attendance/records`).set(at(hr)).send({ employeeId: E.other.id, date, status: 'ABSENT' })).status).toBe(200);
  }, 60_000);

  it('import: a row for someone outside the team is refused as unknown and not written; the team’s rows go in, in a check run too', async () => {
    const date = nextPast();
    const rows = [{ employeeCode: 'T-3', date, status: 'ABSENT' }, { employeeCode: 'T-2', date, status: 'ABSENT' }];
    const check = await att(lead).post('/records/import', { rows, dryRun: true }).expect(200);
    expect([check.body.imported, check.body.failed]).toEqual([1, 1]);
    const r = await att(lead).post('/records/import', { rows }).expect(200);
    expect([r.body.imported, r.body.failed, r.body.results[0].row]).toEqual([1, 1, 1]);
    expect(r.body.results[0].error).toBe('No employee with code T-3.');
    expect(await inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, employeeId: E.other.id, date } }))).toBe(0);
    expect(await inTenant(() => peoplePrisma.attendanceRecord.count({ where: { orgId: hr.orgId, employeeId: E.mine.id, date } }))).toBe(1);
    expect((await att(hr).post('/records/import', { rows: [rows[0]] }).expect(200)).body.imported).toBe(1);
  }, 60_000);

  it('deleting a day: refused (404) outside the team, the day stays; inside it, deleted; HR deletes anyone', async () => {
    const out = await recordOf('other');
    expect((await request(app).delete(`/api/orgs/${hr.orgId}/attendance/records/${out.id}`).set(at(lead))).status).toBe(404);
    expect(await rec(out.id)).toBeTruthy();
    const mine = await recordOf('mine');
    expect((await request(app).delete(`/api/orgs/${hr.orgId}/attendance/records/${mine.id}`).set(at(lead))).status).toBe(200);
    expect((await request(app).delete(`/api/orgs/${hr.orgId}/attendance/records/${out.id}`).set(at(hr))).status).toBe(200);
  }, 60_000);

  it('validating days: any day outside the team refuses the lot (404), nothing validated; the team’s days validate; HR validates anyone', async () => {
    const out = await recordOf('other');
    const mine = await recordOf('mine');
    expect((await att(lead).post('/records/validate', { ids: [mine.id, out.id] })).status).toBe(404);
    expect([(await rec(out.id))!.validated, (await rec(mine.id))!.validated]).toEqual([false, false]);
    expect((await att(lead).post('/records/validate', { ids: [mine.id] }).expect(200)).body.validated).toBe(1);
    expect((await att(hr).post('/records/validate', { ids: [out.id] }).expect(200)).body.validated).toBe(1);
  }, 60_000);

  it('a day’s overtime: refused (404) outside the team, not approved; inside it, approved; HR approves anyone', async () => {
    const out = await recordOf('other', { overtimeMinutes: 60 });
    expect((await att(lead).post(`/records/${out.id}/overtime`, { approved: true })).status).toBe(404);
    expect((await rec(out.id))!.overtimeApproved).toBe(false);
    const mine = await recordOf('mine', { overtimeMinutes: 60 });
    expect((await att(lead).post(`/records/${mine.id}/overtime`, { approved: true })).status).toBe(200);
    expect((await att(hr).post(`/records/${out.id}/overtime`, { approved: true })).status).toBe(200);
  }, 60_000);
});
