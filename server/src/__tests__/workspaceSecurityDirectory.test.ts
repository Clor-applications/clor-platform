import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace audit 7 Nov 2026, items #1–#3: directory sync (SCIM) and single
 * sign-on hand access to people nobody in CLOR looks at, so they get the same
 * bounds as the Users screen and then some.
 *
 *  #1  a token never removes or switches off an owner or an administrator;
 *  #2  a token's role is this company's, never an administrator's, and only
 *      what its maker holds — checked when it is made and again on use;
 *  #3  the same for a sign-on provider's role, and a fresh authenticator code
 *      to change sign-on or directory sync where the person has one.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string };
const at = (c: Ctx, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...extra });

async function owner(label: string): Promise<Ctx> {
  const email = `wsd.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `WSD ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email };
}
async function role(o: Ctx, permissions: string[]) {
  const r = await request(app).post(`/api/orgs/${o.orgId}/roles`).set(at(o)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions }).expect(201);
  return String(r.body.role?.id || r.body.id);
}
/** A person the owner adds with a role made of these permissions, signed in. */
async function member(o: Ctx, permissions: string[]): Promise<Ctx> {
  const roleId = await role(o, permissions);
  const email = `wsd.m.${Date.now()}.${rnd()}@example.com`;
  const u = await request(app).post('/api/users').set(at(o)).send({ email, fullName: 'Member', password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(201);
  const id = String(u.body.user?.id || u.body.id);
  await request(app).post(`/api/orgs/${o.orgId}/users/${id}/roles`).set(at(o)).send({ roleId }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { ...o, token: login.body.token, userId: id, email };
}
const adminRoleOf = async (o: Ctx) => ((await request(app).get(`/api/orgs/${o.orgId}/roles`).set(at(o)).expect(200)).body.roles as any[]).find((r) => r.roleType === 'ADMIN').id as string;
const idp = (token: string) => ({
  post: (p: string, b: unknown) => request(app).post(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(JSON.stringify(b)),
  patch: (p: string, b: unknown) => request(app).patch(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/scim+json').send(JSON.stringify(b)),
  del: (p: string) => request(app).delete(`/scim/v2${p}`).set('Authorization', `Bearer ${token}`),
});
const adminsOf = (o: Ctx) =>
  outsideTenant('test: who administers the company', async () => {
    const roles = await platformPrisma.role.findMany({ where: { orgId: o.orgId, roleType: 'ADMIN' }, select: { id: true } });
    return platformPrisma.userRoleAssignment.count({ where: { orgId: o.orgId, roleId: { in: roles.map((r) => r.id) } } });
  });

const USER_MANAGER = ['SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT', 'SETTINGS::Users::CREATE', 'SETTINGS::Roles::VIEW'];
const PAYROLL_FULL = ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::APPROVE', 'PAYROLL::Employee Payroll Profile::VIEW'];

describe('#1 directory sync never removes an owner or an administrator', () => {
  it('refuses to delete or switch off the owner, refuses an administrator, and removes an ordinary member', async () => {
    const o = await owner('del');
    const manager = await member(o, USER_MANAGER);
    /* A non-administrator who manages users makes the token: exactly the case the audit proved. */
    const token = (await request(app).post(`/api/orgs/${o.orgId}/security/scim`).set(at(manager)).expect(201)).body.token;
    const p = idp(token);

    const refused = await p.del(`/Users/${o.userId}`).expect(403);
    expect(refused.body.scimType).toBe('mutability');
    expect(await adminsOf(o)).toBe(1);
    expect(await outsideTenant('test', () => platformPrisma.userOrgMembership.count({ where: { orgId: o.orgId, userId: o.userId } }))).toBe(1);
    await p.patch(`/Users/${o.userId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] }).expect(403);
    expect((await platformPrisma.user.findUnique({ where: { id: o.userId } }))?.isActive).toBe(true);

    /* A second administrator, made by the owner: still out of a token's reach. */
    const second = await member(o, ['SETTINGS::Users::VIEW']);
    await request(app).post(`/api/orgs/${o.orgId}/users/${second.userId}/roles`).set(at(o)).send({ roleId: await adminRoleOf(o), branchId: null }).expect(201);
    await p.del(`/Users/${second.userId}`).expect(403);

    /* An ordinary member goes, with nothing of theirs left behind in this company. */
    const plain = await member(o, ['SETTINGS::Users::VIEW']);
    await p.del(`/Users/${plain.userId}`).expect(204);
    const left = await outsideTenant('test', async () => ({
      m: await platformPrisma.userOrgMembership.count({ where: { orgId: o.orgId, userId: plain.userId } }),
      b: await platformPrisma.userBranchMembership.count({ where: { orgId: o.orgId, userId: plain.userId } }),
      r: await platformPrisma.userRoleAssignment.count({ where: { orgId: o.orgId, userId: plain.userId } }),
    }));
    expect(left).toEqual({ m: 0, b: 0, r: 0 });
  }, 90_000);

  it('cannot reach another company’s owner', async () => {
    const a = await owner('del-a');
    const b = await owner('del-b');
    const tokenB = (await request(app).post(`/api/orgs/${b.orgId}/security/scim`).set(at(b)).expect(201)).body.token;
    await idp(tokenB).del(`/Users/${a.userId}`).expect(404);
  }, 60_000);
});

describe('#2 a directory-sync token’s role', () => {
  it('is never an administrator’s, never another company’s, and only what its maker holds', async () => {
    const o = await owner('role');
    const other = await owner('role-other');
    const manager = await member(o, USER_MANAGER);
    const payrollRole = await role(o, PAYROLL_FULL);
    const modest = await role(o, ['SETTINGS::Users::VIEW']);
    const scim = (c: Ctx, defaultRoleId: string) => request(app).post(`/api/orgs/${c.orgId}/security/scim`).set(at(c)).send({ defaultRoleId });

    expect((await scim(manager, payrollRole).expect(403)).body.code).toBe('cannot_grant_unheld');
    expect((await scim(manager, await adminRoleOf(o)).expect(400)).body.code).toBe('ADMIN_ROLE_AUTOMATIC');
    expect((await scim(manager, await role(other, ['SETTINGS::Users::VIEW'])).expect(400)).body.code).toBe('FOREIGN_ROLE');
    await scim(manager, modest).expect(201);
    /* The owner holds everything, so may hand out the payroll role. */
    await scim(o, payrollRole).expect(201);
  }, 90_000);

  it('is checked again when somebody is provisioned: a role turned administrator is not given', async () => {
    const o = await owner('role-later');
    const r = await role(o, ['SETTINGS::Users::VIEW']);
    const token = (await request(app).post(`/api/orgs/${o.orgId}/security/scim`).set(at(o)).send({ defaultRoleId: r }).expect(201)).body.token;
    const first = await idp(token).post('/Users', { userName: `wsd.p1.${rnd()}@example.com`, name: { givenName: 'One' } }).expect(201);
    expect(await outsideTenant('test', () => platformPrisma.userRoleAssignment.count({ where: { orgId: o.orgId, userId: first.body.id, roleId: r } }))).toBe(1);

    await outsideTenant('test: the role becomes an administrator role', () => platformPrisma.role.update({ where: { id: r }, data: { roleType: 'ADMIN' } }));
    const second = await idp(token).post('/Users', { userName: `wsd.p2.${rnd()}@example.com`, name: { givenName: 'Two' } }).expect(201);
    expect(await outsideTenant('test', () => platformPrisma.userRoleAssignment.count({ where: { orgId: o.orgId, userId: second.body.id } }))).toBe(0);
  }, 90_000);

  it('cannot be rotated by somebody who could not have made it', async () => {
    const o = await owner('rotate');
    const payrollRole = await role(o, PAYROLL_FULL);
    await request(app).post(`/api/orgs/${o.orgId}/security/scim`).set(at(o)).send({ defaultRoleId: payrollRole }).expect(201);
    const manager = await member(o, [...USER_MANAGER, 'SETTINGS::Credentials::VIEW', 'SETTINGS::Credentials::EDIT']);
    const list = (await request(app).get(`/api/orgs/${o.orgId}/credentials`).set(at(manager)).expect(200)).body.credentials as any[];
    const cred = list.find((x) => x.kind === 'SCIM');
    expect((await request(app).post(`/api/orgs/${o.orgId}/credentials/${cred.id}/rotate`).set(at(manager)).send({}).expect(403)).body.code).toBe('cannot_grant_unheld');
    await request(app).post(`/api/orgs/${o.orgId}/credentials/${cred.id}/rotate`).set(at(o)).send({}).expect(200);
  }, 90_000);
});

describe('#3 a sign-on provider’s role, and a fresh code to change sign-on', () => {
  const provider = (defaultRoleId?: string) => ({ kind: 'OIDC', name: `IdP ${rnd()}`, issuer: 'https://idp.example.com', clientId: 'client', clientSecret: 'secret', autoProvision: true, ...(defaultRoleId ? { defaultRoleId } : {}) });

  it('bounds the role like a directory-sync token’s, on create and on change', async () => {
    const o = await owner('sso');
    const other = await owner('sso-other');
    const manager = await member(o, USER_MANAGER);
    const add = (c: Ctx, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/security/providers`).set(at(c)).send(body as any);

    expect((await add(manager, provider(await adminRoleOf(o))).expect(400)).body.code).toBe('ADMIN_ROLE_AUTOMATIC');
    expect((await add(manager, provider(await role(other, ['SETTINGS::Users::VIEW']))).expect(400)).body.code).toBe('FOREIGN_ROLE');
    expect((await add(manager, provider(await role(o, PAYROLL_FULL))).expect(403)).body.code).toBe('cannot_grant_unheld');
    const made = await add(manager, provider(await role(o, ['SETTINGS::Users::VIEW']))).expect(201);

    /* Changing it later: the same bounds. */
    const patch = (c: Ctx, body: unknown) => request(app).patch(`/api/orgs/${o.orgId}/security/providers/${made.body.provider.id}`).set(at(c)).send(body as any);
    expect((await patch(manager, { name: made.body.provider.name, issuer: 'https://idp.example.com', clientId: 'client', defaultRoleId: await adminRoleOf(o) }).expect(400)).body.code).toBe('ADMIN_ROLE_AUTOMATIC');
    expect((await patch(manager, { name: made.body.provider.name, issuer: 'https://idp.example.com', clientId: 'client', defaultRoleId: await role(o, PAYROLL_FULL) }).expect(403)).body.code).toBe('cannot_grant_unheld');
    await patch(manager, { name: made.body.provider.name, issuer: 'https://idp.example.com', clientId: 'client' }).expect(200);
    expect(await platformPrisma.authEvent.count({ where: { accountId: o.accountId, eventType: 'PROVIDER_UPDATED' } })).toBe(1);
  }, 120_000);

  it('asks for a fresh authenticator code to change sign-on or directory sync, when the person has an authenticator', async () => {
    const o = await owner('sso-stepup');
    const sec = (path: string, b: unknown = {}, extra: Record<string, string> = {}) => request(app).post(`/api/orgs/${o.orgId}/security${path}`).set(at(o, extra)).send(b as any);
    /* Without an authenticator: not stopped (as for an administrator grant, W-5.2). */
    await sec('/providers', provider()).expect(201);

    const { secret } = (await sec('/two-factor/setup', { password: PASSWORD }).expect(200)).body;
    await clearOfStepEdge();
    await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);

    expect((await sec('/providers', provider()).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    expect((await sec('/scim').expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    const stepUp = (await sec('/step-up', { code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
    await sec('/providers', provider(), { 'x-step-up': stepUp }).expect(201);
    await sec('/scim', {}, { 'x-step-up': stepUp }).expect(201);
  }, 120_000);
});
