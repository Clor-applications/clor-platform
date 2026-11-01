import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace W-1: a person's role in the account (OWNER / ADMIN / BILLING_ADMIN
 * / MEMBER). The account's own authority — adding a company, seeing the
 * account, changing account roles — follows it; business data does not.
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
const at = (c: { token: string; orgId: string; branchId: string }, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...extra });

async function owner(label: string): Promise<Ctx> {
  const email = `am.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `AM ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email };
}

/** A person the owner adds to their company, signed in. */
async function addPerson(o: Ctx, label: string): Promise<Ctx> {
  const email = `am.${label}.${Date.now()}.${rnd()}@example.com`;
  const r = await request(app)
    .post('/api/users')
    .set(at(o))
    .send({ email, fullName: label, password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } })
    .expect(201);
  const token = (await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.token;
  return { token, orgId: o.orgId, branchId: o.branchId, accountId: o.accountId, userId: r.body.user.id, email };
}

const roleOf = async (c: Ctx) => (await request(app).get('/api/account/me').set(at(c)).expect(200)).body.role;
const setRole = (by: Ctx, target: Ctx, role: string, extra: Record<string, string> = {}) =>
  request(app).put(`/api/account/members/${target.userId}/role`).set(at(by, extra)).send({ role });
const newCompany = (c: Ctx) =>
  request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${c.token}`).send({ companyName: `AM extra ${Date.now()}-${rnd()}`, state: 'Karnataka' });
const events = (accountId: string) =>
  outsideTenant('test: account audit', () => platformPrisma.accountAuditEvent.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } }));

/** Switch on the authenticator and return a fresh step-up token. */
async function stepUp(c: Ctx) {
  const sec = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup').expect(200)).body;
  await clearOfStepEdge();
  const s0 = stepNow();
  await sec('/two-factor/enable', { code: codeAt(secret, s0) }).expect(200);
  return (await sec('/step-up', { code: codeAt(secret, s0 + 1) }).expect(200)).body.token as string;
}

describe('account roles', () => {
  it('makes whoever signs up the owner, and a person added later a member', async () => {
    const o = await owner('own');
    expect(await roleOf(o)).toBe('OWNER');
    const me = (await request(app).get('/api/auth/me').set(at(o)).expect(200)).body;
    expect(me.accountRole).toBe('OWNER');
    const m = await addPerson(o, 'member');
    expect(await roleOf(m)).toBe('MEMBER');
  });

  it('lets only owners and administrators add a company or see the account', async () => {
    const o = await owner('gate');
    const m = await addPerson(o, 'clerk');
    expect((await newCompany(m).expect(403)).body.code).toBe('NOT_ACCOUNT_ADMIN');
    expect((await request(app).get('/api/account/overview').set(at(m)).expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');
    expect((await request(app).get('/api/account/members').set(at(m)).expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');

    await setRole(o, m, 'ADMIN').expect(200);
    expect(await roleOf(m)).toBe('ADMIN');
    await request(app).get('/api/account/overview').set(at(m)).expect(200);
    await newCompany(m).expect(200);

    const b = await addPerson(o, 'billing');
    await setRole(o, b, 'BILLING_ADMIN').expect(200);
    await request(app).get('/api/account/overview').set(at(b)).expect(200);
    expect((await newCompany(b).expect(403)).body.code).toBe('NOT_ACCOUNT_ADMIN');
  });

  it('keeps a member from changing roles, and an admin away from owners', async () => {
    const o = await owner('rules');
    const m = await addPerson(o, 'm');
    const a = await addPerson(o, 'a');
    expect((await setRole(m, a, 'ADMIN').expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');
    await setRole(o, a, 'ADMIN').expect(200);
    expect((await setRole(a, m, 'OWNER').expect(403)).body.code).toBe('ACCOUNT_OWNER_ONLY');
    expect((await setRole(a, o, 'MEMBER').expect(403)).body.code).toBe('ACCOUNT_OWNER_ONLY');
    await setRole(a, m, 'BILLING_ADMIN').expect(200);

    const trail = await events(o.accountId);
    expect(trail.filter((e) => e.result === 'DENIED').map((e) => JSON.parse(e.metadata || '{}').code)).toEqual(
      expect.arrayContaining(['ACCOUNT_ROLE_REQUIRED', 'ACCOUNT_OWNER_ONLY'])
    );
    expect(trail.filter((e) => e.result === 'OK')).toHaveLength(2);
  });

  it('asks for an authenticator code to change ownership, and never leaves the account without an owner', async () => {
    const o = await owner('steps');
    const m = await addPerson(o, 'heir');
    expect((await setRole(o, m, 'OWNER').expect(403)).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const token = await stepUp(o);
    expect((await setRole(o, o, 'ADMIN', { 'x-step-up': token }).expect(409)).body.code).toBe('LAST_ACCOUNT_OWNER');
    await setRole(o, m, 'OWNER', { 'x-step-up': token }).expect(200);
    /* With a second owner, the first may step down. */
    await setRole(o, o, 'ADMIN', { 'x-step-up': token }).expect(200);
    expect(await roleOf(o)).toBe('ADMIN');
    expect(await roleOf(m)).toBe('OWNER');
  });

  it('opens no business data: an account admin with no role in the company is refused its books', async () => {
    const o = await owner('data');
    const a = await addPerson(o, 'admin-only');
    await setRole(o, a, 'ADMIN').expect(200);
    await request(app).get(`/api/orgs/${a.orgId}/ledger/accounts`).set(at(a)).expect(403);
  });

  it('keeps one account’s owner out of another account’s roles', async () => {
    const x = await owner('x');
    const y = await owner('y');
    const ym = await addPerson(y, 'y-member');
    /* X's owner, in X's own company, names a person of Y: not a member of X. */
    expect((await setRole(x, ym, 'ADMIN').expect(404)).body.code).toBe('NOT_A_MEMBER');
    /* X's owner naming Y's company in the header is refused before any role is looked at. */
    const forged = await request(app).put(`/api/account/members/${ym.userId}/role`).set(at({ ...x, orgId: y.orgId, branchId: y.branchId })).send({ role: 'ADMIN' });
    expect([401, 403, 404]).toContain(forged.status);
    expect(await roleOf(ym)).toBe('MEMBER');
    expect((await request(app).get('/api/account/members').set(at(x)).expect(200)).body.members.map((p: any) => p.userId)).not.toContain(ym.userId);
  });

  it('rejects a role that does not exist', async () => {
    const o = await owner('bad');
    const m = await addPerson(o, 'm');
    expect((await setRole(o, m, 'SUPERUSER').expect(400)).body.code).toBe('BAD_ROLE');
  });

  it('lists the accounts a person reaches in /auth/me, with their role in each', async () => {
    const o = await owner('me');
    const me = (await request(app).get('/api/auth/me').set(at(o)).expect(200)).body;
    expect(me.accounts).toEqual([expect.objectContaining({ id: o.accountId, home: true, role: 'OWNER' })]);
  });

  it('lets an owner rename the account, audited, and not a member', async () => {
    const o = await owner('rename');
    const m = await addPerson(o, 'm');
    expect((await request(app).patch('/api/account').set(at(m)).send({ name: 'Mine now' }).expect(403)).body.code).toBe('ACCOUNT_ROLE_REQUIRED');
    await request(app).patch('/api/account').set(at(o)).send({ name: 'Anand Group' }).expect(200);
    const me = (await request(app).get('/api/auth/me').set(at(o)).expect(200)).body;
    expect(me.accounts[0].name).toBe('Anand Group');
    expect((await events(o.accountId)).some((e) => e.action === 'ACCOUNT_RENAMED')).toBe(true);
    await request(app).patch('/api/account').set(at(o)).send({ name: 'x' }).expect(400);
  });
});
