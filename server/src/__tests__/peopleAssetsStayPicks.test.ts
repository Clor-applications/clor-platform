import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Server picks batch 2 (rounds 51 and 52): company things in the employee app (Good, Fair or
 * Damaged only; "I still have this"; "Report a problem"; asking for something as an Ask HR case)
 * and taking back an accepted resignation, decided by the manager.
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
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

async function owner(): Promise<Ctx> {
  const email = `assets.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Assets Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { peopleBenefits: true, peopleEngage: true } }).expect(200);
  c.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${c.token}`).expect(200)).body.user.id;
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id };
}
const ppl = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
async function appOf(c: Ctx, employee: { id: string; code: string }) {
  const code = (await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200)).body.company.code;
  const issued = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employee.id] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: code, employeeCode: employee.code, activationCode: issued, password: 'mine pass 1' }).expect(200)).body.token;
  return {
    get: (p: string) => request(app).get(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: unknown = {}) => request(app).post(`/api/portal/people${p}`).set('Authorization', `Bearer ${token}`).send(b as any),
  };
}

const MANAGER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];
let hr: Ctx;
let manager: Ctx;
let ravi: any;
let meena: any;
let raviApp: Awaited<ReturnType<typeof appOf>>;
let meenaApp: Awaited<ReturnType<typeof appOf>>;

beforeAll(async () => {
  hr = await owner();
  manager = await colleague(hr, 'Kiran', MANAGER);
  const boss = (await ppl(hr).post('/employees', { name: 'Kiran Rao', code: 'M-1', dateOfJoining: '2024-01-01' }).expect(201)).body.employee;
  await runInTenant(hr.orgId, () => peoplePrisma.employee.update({ where: { id: boss.id }, data: { userId: manager.userId } }));
  ravi = (await ppl(hr).post('/employees', { name: 'Ravi Das', code: 'E-1', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
  meena = (await ppl(hr).post('/employees', { name: 'Meena Iyer', code: 'E-2', dateOfJoining: '2024-01-01', reportingManagerId: boss.id }).expect(201)).body.employee;
  raviApp = await appOf(hr, ravi);
  meenaApp = await appOf(hr, meena);
}, 180_000);

describe('company things in the employee app (round 51)', () => {
  it('keeps Good, Fair or Damaged and a value; the holder confirms, reports a problem and asks for something; HR saves keep what the holder wrote', async () => {
    const base = { title: 'Laptop', status: 'ASSIGNED', employeeId: ravi.id, details: { assetTag: 'LT-9', serialNumber: '', category: 'Laptop', issuedOn: '', condition: '' } };
    await ppl(hr).post('/workspace/assets', { ...base, details: { ...base.details, state: 'BROKEN' } }).expect(400);
    await ppl(hr).post('/workspace/assets', { ...base, details: { ...base.details, value: 'lots' } }).expect(400);
    const laptop = (await ppl(hr).post('/workspace/assets', { ...base, details: { ...base.details, state: 'GOOD', value: '45000' } }).expect(201)).body.record;

    const mine = (await raviApp.get('/me/assets').expect(200)).body;
    expect(mine.available).toBe(true);
    expect(mine.assets).toEqual([expect.objectContaining({ id: laptop.id, title: 'Laptop', tag: 'LT-9', state: 'Good', confirmedOn: null, problem: null })]);
    /* The value the company put on it is not the holder's to read. */
    expect(JSON.stringify(mine)).not.toContain('45000');
    /* Someone else's laptop is not theirs to confirm. */
    await meenaApp.post(`/me/assets/${laptop.id}/confirm`).expect(404);

    expect((await raviApp.post(`/me/assets/${laptop.id}/confirm`).expect(200)).body.asset.confirmedOn).toBe(today());
    await raviApp.post(`/me/assets/${laptop.id}/problem`, { what: 'no' }).expect(400);
    const reported = (await raviApp.post(`/me/assets/${laptop.id}/problem`, { what: 'The hinge is cracked and the screen flickers.' }).expect(200)).body;
    expect(reported.asset.problem).toMatch(/hinge/);
    expect(reported.caseId).toBeTruthy();
    const asked = (await raviApp.post('/me/assets/ask', { what: 'Second screen' }).expect(201)).body;
    const desk = (await raviApp.get('/desk').expect(200)).body.requests;
    expect(desk.map((r: any) => r.subject)).toEqual(expect.arrayContaining(['Problem with Laptop (LT-9)', 'Asking for: Second screen']));
    expect(desk.find((r: any) => r.id === asked.caseId).category).toBe('IT');

    /* HR edits the asset from the register form (only its own fields): what Ravi wrote stays. */
    let record = (await ppl(hr).get(`/workspace/assets`).expect(200)).body.records.find((r: any) => r.id === laptop.id);
    expect(record.details).toMatchObject({ confirmedOn: today(), problem: expect.stringMatching(/hinge/) });
    await ppl(hr).put(`/workspace/assets/${laptop.id}`, { ...base, version: record.version, details: { ...base.details, state: 'DAMAGED', value: '45000' } }).expect(200);
    record = (await ppl(hr).get(`/workspace/assets`).expect(200)).body.records.find((r: any) => r.id === laptop.id);
    expect(record.details).toMatchObject({ state: 'DAMAGED', confirmedOn: today(), problem: expect.stringMatching(/hinge/) });
    /* Sent for repair: a new state starts clean, and it is no longer in Ravi's list. */
    await ppl(hr).put(`/workspace/assets/${laptop.id}`, { ...base, status: 'REPAIR', employeeId: null, version: record.version, details: { ...base.details, state: 'DAMAGED', value: '45000' } }).expect(200);
    record = (await ppl(hr).get(`/workspace/assets`).expect(200)).body.records.find((r: any) => r.id === laptop.id);
    expect(record.details.confirmedOn).toBeUndefined();
    expect(record.details.problem).toBeUndefined();
    expect((await raviApp.get('/me/assets').expect(200)).body.assets).toEqual([]);
    await raviApp.post(`/me/assets/${laptop.id}/confirm`).expect(404);
  });
});

describe('taking back a resignation (round 52)', () => {
  it('is only for someone on notice after resigning; the manager decides; accepted, they work here again', async () => {
    await raviApp.post('/me/stay', {}).expect(409);
    await ppl(hr).post(`/employees/${ravi.id}/resign`, { lastDay: plus(20), leavingType: 'RESIGNED' }).expect(200);
    expect((await raviApp.get('/me/leaving').expect(200)).body).toMatchObject({ status: 'ON_NOTICE', staying: null });
    const asked = (await raviApp.post('/me/stay', { reason: 'Family plans changed' }).expect(202)).body;
    expect(asked.request.status).toBe('WAITING');
    await raviApp.post('/me/stay', {}).expect(409);
    expect((await raviApp.get('/me/leaving').expect(200)).body.staying).toMatchObject({ id: asked.request.id, status: 'WAITING' });
    /* The manager decides; HR is not a step. */
    const done = (await request(app).post(`/api/orgs/${hr.orgId}/people/requests/${asked.request.id}/approve`).set(at(manager)).send({ comment: 'Glad to keep you' }).expect(200)).body;
    expect(done.request.status).toBe('APPROVED');
    const now = (await ppl(hr).get(`/employees/${ravi.id}`).expect(200)).body.employee;
    expect(now).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null, leavingType: null });

    /* A leaving that is not a resignation is HR's to undo. */
    await ppl(hr).post(`/employees/${meena.id}/resign`, { lastDay: plus(10), leavingType: 'TERMINATED' }).expect(200);
    expect((await meenaApp.post('/me/stay', {}).expect(409)).body.error).toMatch(/Only a resignation/);
  });
});
