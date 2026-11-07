import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Statutory details (docs/people/02-PRD.md CORE-04, PRV-07, FND-09): the
 * Statutory Details grant, masked values, format checks, a reveal that needs
 * an authenticator code and is logged, and no link across companies.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `stat.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Stat Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return ctx;
}
async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId };
}
const people = (c: Ctx, extra: Record<string, string> = {}) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set({ ...at(c), ...extra }).send(body as any),
});
/** Enrol an authenticator and return a fresh step-up token. */
async function stepUp(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return (await sec('/step-up', { code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
}

let hr: Ctx;
let employeeId: string;
beforeAll(async () => {
  hr = await owner();
  employeeId = (await people(hr).post('/employees', { name: 'Meera Shah', code: 'ST-1' }).expect(201)).body.employee.id;
  await request(app).put(`/api/orgs/${hr.orgId}/payroll/employees/${employeeId}`).set(at(hr)).send({ pan: 'ABCPM1234K', uan: '100200300400', bankAccountNumber: '50100123456789', bankIfsc: 'HDFC0001234', bankName: 'HDFC' });
}, 90_000);

describe('statutory details', () => {
  it('need the Statutory Details grant; without it the section says so', async () => {
    const viewer = await colleague(hr, ['PEOPLE::Employees::VIEW']);
    expect((await people(viewer).get(`/employees/${employeeId}/statutory`).expect(200)).body).toEqual({ visible: false });
    await people(viewer).put(`/employees/${employeeId}/identity`, { aadhaarLast4: '1234' }).expect(403);
    await people(viewer).post(`/employees/${employeeId}/statutory/reveal`, { field: 'pan' }).expect(403);
  });

  it('are masked by default and keep only the last four of Aadhaar; a wrong shape is refused', async () => {
    await people(hr).put(`/employees/${employeeId}/identity`, { aadhaarLast4: '123456789012' }).expect(400);
    await people(hr).put(`/employees/${employeeId}/identity`, { passportNumber: 'nope' }).expect(400);
    const saved = (await people(hr).put(`/employees/${employeeId}/identity`, { aadhaarLast4: '9012', passportNumber: 'A1234567', passportExpiry: '2031-05-01', statutoryCategory: 'WORKER', categoryFrom: '2026-01-01' }).expect(200)).body.identity;
    expect(saved).toMatchObject({ aadhaarLast4: '********9012', passportNumber: '****4567', statutoryCategory: 'WORKER' });
    const shown = (await people(hr).get(`/employees/${employeeId}/statutory`).expect(200)).body;
    expect(shown).toMatchObject({ visible: true, canEdit: true, identity: { aadhaarLast4: '********9012', passportNumber: '****4567' } });
    /* Payroll's values come through its read interface, masked. */
    if (shown.inPayroll !== false) expect(shown.pan).toMatch(/\*+234K$/);
    const stored = await runInTenant(hr.orgId, () => peoplePrisma.employeeIdentity.findUniqueOrThrow({ where: { employeeId } }));
    expect(stored.aadhaarLast4).toBe('9012');
    const log = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId, entity: 'EmployeeIdentity' } }));
    expect(log.find((l) => l.field === 'passportNumber')).toMatchObject({ redacted: true, before: null, after: null });
    expect(log.find((l) => l.field === 'statutoryCategory')).toMatchObject({ redacted: false, after: 'WORKER' });
  });

  it('a reveal needs a fresh authenticator code, returns one value, and is logged', async () => {
    const refused = await people(hr).post(`/employees/${employeeId}/statutory/reveal`, { field: 'passportNumber' }).expect(403);
    expect(['TWO_FACTOR_SETUP_REQUIRED', 'STEP_UP_REQUIRED']).toContain(refused.body.code);
    const token = await stepUp(hr);
    const shown = (await people(hr, { 'x-step-up': token }).post(`/employees/${employeeId}/statutory/reveal`, { field: 'passportNumber' }).expect(200)).body;
    expect(shown).toEqual({ field: 'passportNumber', value: 'A1234567' });
    await people(hr, { 'x-step-up': token }).post(`/employees/${employeeId}/statutory/reveal`, { field: 'photo' }).expect(400);
    const log = await runInTenant(hr.orgId, () => peoplePrisma.accessLog.findMany({ where: { employeeId, what: 'STATUTORY' } }));
    expect(log).toEqual([expect.objectContaining({ field: 'passportNumber', entityId: employeeId })]);
    expect(log[0].userId).toBeTruthy();
    /* The access log cannot be edited. */
    await expect(runInTenant(hr.orgId, () => peoplePrisma.accessLog.delete({ where: { id: log[0].id } }))).rejects.toThrow(/append_only/);
  });

  it('never links people across companies because an identifier matches', async () => {
    const other = await owner();
    const twin = (await people(other).post('/employees', { name: 'Someone Else', code: 'ST-9' }).expect(201)).body.employee;
    await people(other).put(`/employees/${twin.id}/identity`, { passportNumber: 'A1234567', aadhaarLast4: '9012' }).expect(200);
    const mine = (await people(hr).get(`/employees/${employeeId}/statutory`).expect(200)).body;
    expect(JSON.stringify(mine)).not.toContain(twin.id);
    expect(await runInTenant(other.orgId, () => peoplePrisma.employeeIdentity.count({ where: { employeeId } }))).toBe(0);
    expect(await runInTenant(hr.orgId, () => peoplePrisma.employeeIdentity.count({ where: { passportNumber: 'A1234567' } }))).toBe(1);
  });
});
