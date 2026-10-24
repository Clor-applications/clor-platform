import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace W-4: the account's people. A directory with each person's
 * companies, roles and the apps those open; one person's effective access
 * with who gave it; suspending in the account and removing from a company as
 * separate acts, each with its own reach.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string };
const at = (c: { token: string; orgId: string; branchId: string }) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function owner(label: string): Promise<Ctx> {
  const email = `mem.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `MEM ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email };
}

/** A person added to the owner's company, holding the given preset role there. */
async function person(o: Ctx, label: string, preset?: string): Promise<Ctx> {
  const email = `mem.${label}.${Date.now()}.${rnd()}@example.com`;
  const r = await request(app).post('/api/users').set(at(o)).send({ email, fullName: label, password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(201);
  if (preset) {
    /* A stock role, seeded in every company under its preset's label. */
    const roles = (await request(app).get(`/api/orgs/${o.orgId}/roles`).set(at(o)).expect(200)).body.roles;
    const role = roles.find((x: any) => x.name === preset);
    if (!role) throw new Error(`No seeded role named ${preset}`);
    await request(app).post(`/api/orgs/${o.orgId}/users/${r.body.user.id}/roles`).set(at(o)).send({ roleId: role.id, branchId: null }).expect(201);
  }
  const token = (await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.token;
  return { token, orgId: o.orgId, branchId: o.branchId, accountId: o.accountId, userId: r.body.user.id, email };
}

describe('the account’s people', () => {
  it('lists everyone with their companies, roles and the apps those open', async () => {
    const o = await owner('dir');
    const p = await person(o, 'payroll-clerk', 'Payroll User');
    const d = (await request(app).get('/api/account/members/directory').set(at(o)).expect(200)).body;
    const row = d.members.find((m: any) => m.userId === p.userId);
    expect(row).toMatchObject({ accountRole: 'MEMBER', status: 'ACTIVE' });
    expect(row.companies).toHaveLength(1);
    expect(row.companies[0].apps).toContain('payroll');
    expect(row.companies[0].roles).toEqual(['Payroll User']);
    const me = d.members.find((m: any) => m.userId === o.userId);
    expect(me.companies[0].isAdmin).toBe(true);
  });

  it('shows one person’s effective access: who gave each role, and what is sensitive', async () => {
    const o = await owner('detail');
    const p = await person(o, 'hr', 'Payroll Manager');
    const a = (await request(app).get(`/api/account/members/${p.userId}/access`).set(at(o)).expect(200)).body;
    expect(a.companies[0].roles[0]).toMatchObject({ via: 'direct', grantedBy: 'detail owner' });
    expect(a.companies[0].apps).toContain('payroll');
    expect(a.companies[0].sensitive.some((k: string) => k.startsWith('PAYROLL::'))).toBe(true);
  });

  it('suspends a person in every company of the account at once, and reinstates them', async () => {
    const o = await owner('susp');
    const p = await person(o, 'clerk', 'Accountant');
    await request(app).get(`/api/orgs/${p.orgId}/ledger/accounts`).set(at(p)).expect(200);
    await request(app).post(`/api/account/members/${p.userId}/suspend`).set(at(o)).expect(200);
    expect((await request(app).get(`/api/orgs/${p.orgId}/ledger/accounts`).set(at(p)).expect(403)).body.code).toBe('ACCOUNT_MEMBER_SUSPENDED');
    await request(app).post(`/api/account/members/${p.userId}/reinstate`).set(at(o)).expect(200);
    await request(app).get(`/api/orgs/${p.orgId}/ledger/accounts`).set(at(p)).expect(200);
  });

  it('keeps owners for owners and nobody acting on themself', async () => {
    const o = await owner('guard');
    const a = await person(o, 'admin');
    await request(app).put(`/api/account/members/${a.userId}/role`).set(at(o)).send({ role: 'ADMIN' }).expect(200);
    expect((await request(app).post(`/api/account/members/${o.userId}/suspend`).set(at(a)).expect(403)).body.code).toBe('ACCOUNT_OWNER_ONLY');
    expect((await request(app).post(`/api/account/members/${a.userId}/suspend`).set(at(a)).expect(409)).body.code).toBe('SELF');
    const m = await person(o, 'member');
    expect((await request(app).post(`/api/account/members/${o.userId}/suspend`).set(at(m)).expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');
  });

  it('removes a person from one company only: their login and account membership stay', async () => {
    const o = await owner('remove');
    const p = await person(o, 'leaver', 'Accountant');
    await request(app).delete(`/api/account/members/${p.userId}/companies/${o.orgId}`).set(at(o)).expect(200);
    const login = await request(app).post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(200);
    const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200)).body;
    expect(me.orgs.map((x: any) => x.orgId)).not.toContain(o.orgId);
    const still = await outsideTenant('test', () => platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId: o.accountId, userId: p.userId } } }));
    expect(still?.status).toBe('ACTIVE');
    const roles = await outsideTenant('test', () => platformPrisma.userRoleAssignment.count({ where: { orgId: o.orgId, userId: p.userId } }));
    expect(roles).toBe(0);
    expect((await request(app).delete(`/api/account/members/${p.userId}/companies/${o.orgId}`).set(at(o)).expect(404)).body.code).toBe('NOT_IN_COMPANY');
  });

  it('shows another account nothing and lets it change nothing', async () => {
    const x = await owner('x');
    const y = await owner('y');
    const yp = await person(y, 'y-person');
    expect((await request(app).get(`/api/account/members/${yp.userId}/access`).set(at(x)).expect(404)).body.code).toBe('NOT_A_MEMBER');
    expect((await request(app).post(`/api/account/members/${yp.userId}/suspend`).set(at(x)).expect(404)).body.code).toBe('NOT_A_MEMBER');
    expect((await request(app).delete(`/api/account/members/${yp.userId}/companies/${y.orgId}`).set(at(x)).expect(404)).body.code).toBe('NOT_A_MEMBER');
    const d = (await request(app).get('/api/account/members/directory').set(at(x)).expect(200)).body;
    expect(d.members.map((m: any) => m.userId)).not.toContain(yp.userId);
  });
});
