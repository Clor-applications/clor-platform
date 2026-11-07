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
const { stepNow, codeAt } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
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

  it('tells the Workspace which apps the person can open, apart from what the company subscribes to', async () => {
    const o = await owner('apps');
    const none = await person(o, 'no-role');
    const pay = await person(o, 'pay', 'Payroll User');
    expect((await request(app).get('/api/account/me').set(at(none)).expect(200)).body.apps).toEqual([]);
    expect((await request(app).get('/api/account/me').set(at(pay)).expect(200)).body.apps).toContain('payroll');
    expect((await request(app).get('/api/account/me').set(at(o)).expect(200)).body).toMatchObject({ role: 'OWNER', companyAdmin: true });
  });

  it('lists the account’s audit, newest first, filtered, and only to its administrators', async () => {
    const o = await owner('audit');
    const p = await person(o, 'aud-person');
    await request(app).post(`/api/account/members/${p.userId}/suspend`).set(at(o)).expect(200);
    await request(app).post(`/api/account/members/${o.userId}/suspend`).set(at(p)).expect(403);
    const all = (await request(app).get('/api/account/audit').set(at(o)).expect(200)).body.events;
    expect(all[0].action).toBe('MEMBER_SUSPENDED');
    expect(all[0]).toMatchObject({ result: 'OK', actor: { id: o.userId }, targetName: 'aud-person' });
    const denied = (await request(app).get('/api/account/audit?result=DENIED').set(at(o)).expect(200)).body.events;
    expect(denied.every((e: any) => e.result === 'DENIED')).toBe(true);
    const other = await owner('audit-other');
    expect((await request(app).get('/api/account/audit').set(at(other)).expect(200)).body.events.map((e: any) => e.targetId)).not.toContain(p.userId);
  });

  it('signs a member out of every session while keeping their access, and flags who has no authenticator', async () => {
    const o = await owner('signout');
    const p = await person(o, 'laptop-lost', 'Accountant');
    await request(app).get('/api/auth/me').set(at(p)).expect(200);
    expect((await request(app).post(`/api/account/members/${p.userId}/sign-out`).set(at(o)).expect(200)).body.revoked).toBeGreaterThan(0);
    expect((await request(app).get('/api/auth/me').set(at(p))).status).toBe(401);
    /* Access unchanged: signing in again works. */
    await request(app).post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(200);
    const d = (await request(app).get('/api/account/members/directory').set(at(o)).expect(200)).body;
    expect(d.members.find((m: any) => m.userId === p.userId).authenticator).toBe(false);
    expect((await request(app).post(`/api/account/members/${o.userId}/sign-out`).set(at(o)).expect(409)).body.code).toBe('SELF');
  });

  it('asks an administrator with an authenticator for a fresh code to make someone an administrator', async () => {
    const o = await owner('elevate');
    const p = await person(o, 'to-elevate');
    const roles = (await request(app).get(`/api/orgs/${o.orgId}/roles`).set(at(o)).expect(200)).body.roles;
    const admin = roles.find((r: any) => r.roleType === 'ADMIN');
    const grant = (extra: Record<string, string> = {}) => request(app).post(`/api/orgs/${o.orgId}/users/${p.userId}/roles`).set({ ...at(o), ...extra }).send({ roleId: admin.id, branchId: null });
    const sec = (path: string, b?: unknown) => request(app).post(`/api/orgs/${o.orgId}/security${path}`).set(at(o)).send(b as any);
    const { secret } = (await sec('/two-factor/setup', { password: PASSWORD }).expect(200)).body;
    await clearOfStepEdge();
    const s0 = stepNow();
    await sec('/two-factor/enable', { code: codeAt(secret, s0) }).expect(200);
    expect((await grant().expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    const token = (await sec('/step-up', { code: codeAt(secret, s0 + 1) }).expect(200)).body.token;
    await grant({ 'x-step-up': token }).expect(201);
  });
});
