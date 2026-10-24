import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Custom fields (docs/people/02-PRD.md CORE-08): typed fields with who may
 * see and who may edit; a field the caller may not see is absent from the
 * answer, key and all; a definition change is a new version.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `cf.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha HR' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CF Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '' };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  return ctx;
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
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('custom fields', () => {
  it('typed fields with permissions: an HR-only field is absent from a manager’s answer, key and all; values are checked by type; a definition change is a new version', async () => {
    const blood = (await people(hr).post('/custom-fields', { key: 'blood_group', label: 'Blood group', type: 'CHOICE', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] }).expect(201)).body.field;
    expect(blood).toMatchObject({ version: 1, viewPermission: 'PEOPLE::Employees::VIEW', editPermission: 'PEOPLE::Employees::EDIT' });
    const uniform = (await people(hr).post('/custom-fields', { key: 'uniform_size', label: 'Uniform size', type: 'TEXT' }).expect(201)).body.field;
    const notice = (await people(hr).post('/custom-fields', { key: 'background_check', label: 'Background check cleared', type: 'BOOLEAN', viewPermission: 'PEOPLE::Statutory Details::VIEW', editPermission: 'PEOPLE::Statutory Details::EDIT' }).expect(201)).body.field;
    await people(hr).post('/custom-fields', { key: 'Blood Group', label: 'x', type: 'TEXT' }).expect(400);
    await people(hr).post('/custom-fields', { key: 'blood_group', label: 'Again', type: 'TEXT' }).expect(409);
    await people(hr).post('/custom-fields', { key: 'pick', label: 'Pick', type: 'CHOICE', options: [] }).expect(400);
    await people(hr).post('/custom-fields', { key: 'bad', label: 'Bad', type: 'TEXT', viewPermission: 'whatever' }).expect(400);

    const e = (await people(hr).post('/employees', { name: 'Kavya Reddy', code: 'CF-1', dateOfJoining: '2026-01-05' }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}/custom-fields`, { values: { blood_group: 'Z+' } }).expect(400);
    await people(hr).put(`/employees/${e.id}/custom-fields`, { values: { nope: 1 } }).expect(400);
    const saved = (await people(hr).put(`/employees/${e.id}/custom-fields`, { values: { blood_group: 'O+', uniform_size: 'M', background_check: 'yes' } }).expect(200)).body;
    expect(saved.changed.sort()).toEqual(['background_check', 'blood_group', 'uniform_size']);
    expect(saved.fields.map((f: any) => [f.key, f.value, f.savedUnderVersion, f.canEdit])).toEqual([['blood_group', 'O+', 1, true], ['uniform_size', 'M', 1, true], ['background_check', true, 1, true]]);
    /* The log carries the change; the HR-only one without its value. */
    const lines = await runInTenant(hr.orgId, () => peoplePrisma.changeLog.findMany({ where: { employeeId: e.id, field: { startsWith: 'custom.' } }, orderBy: { field: 'asc' } }));
    expect(lines.map((l) => [l.field, l.after, l.redacted])).toEqual([['custom.background_check', null, true], ['custom.blood_group', 'O+', false], ['custom.uniform_size', 'M', false]]);

    /* A manager with Employees VIEW and EDIT: no statutory grant, so the key is not in the answer and cannot be written. */
    const manager = await colleague(hr, 'Manager', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT']);
    const seen = (await people(manager).get(`/employees/${e.id}/custom-fields`).expect(200)).body.fields;
    expect(seen.map((f: any) => f.key)).toEqual(['blood_group', 'uniform_size']);
    expect(JSON.stringify(seen)).not.toContain('background_check');
    await people(manager).put(`/employees/${e.id}/custom-fields`, { values: { background_check: false } }).expect(403);
    expect((await people(manager).put(`/employees/${e.id}/custom-fields`, { values: { uniform_size: 'L' } }).expect(200)).body.changed).toEqual(['uniform_size']);
    /* Only Org Structure EDIT shapes the fields themselves. */
    await people(manager).post('/custom-fields', { key: 'x', label: 'X', type: 'TEXT' }).expect(403);

    /* Changing the options is a new version; the key and the type stay. */
    const v2 = (await people(hr).put(`/custom-fields/${blood.id}`, { options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Bombay'] }).expect(200)).body.field;
    expect(v2.version).toBe(2);
    await people(hr).put(`/custom-fields/${blood.id}`, { key: 'other' }).expect(400);
    await people(hr).put(`/custom-fields/${blood.id}`, { type: 'TEXT' }).expect(400);
    expect((await people(hr).put(`/custom-fields/${uniform.id}`, { label: 'Uniform size' }).expect(200)).body.field.version).toBe(1);
    const after = (await people(hr).get(`/employees/${e.id}/custom-fields`).expect(200)).body.fields;
    expect(after.find((f: any) => f.key === 'blood_group')).toMatchObject({ version: 2, savedUnderVersion: 1, value: 'O+' });
    await people(hr).put(`/employees/${e.id}/custom-fields`, { values: { blood_group: 'Bombay' } }).expect(200);
    expect((await people(hr).get(`/employees/${e.id}/custom-fields`).expect(200)).body.fields.find((f: any) => f.key === 'blood_group').savedUnderVersion).toBe(2);
    /* Switched off, it is gone from the record until switched on again. */
    await people(hr).put(`/custom-fields/${notice.id}`, { active: false }).expect(200);
    expect((await people(hr).get(`/employees/${e.id}/custom-fields`).expect(200)).body.fields.map((f: any) => f.key)).toEqual(['blood_group', 'uniform_size']);
    expect((await people(hr).get('/custom-fields?all=1').expect(200)).body.fields).toHaveLength(3);
  });
});
