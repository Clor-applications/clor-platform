import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

/**
 * The company's password rules everywhere a password is set (SX-13), a list
 * of passwords too common to accept (SX-15), and a login miss that costs the
 * same bcrypt check as a hit (SX-14).
 *
 * Before this, Settings → Security rules applied only when people changed
 * their own password; sign-up, reset and admin-set passwords checked length.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { issuePasswordResetToken } = await import('../services/auth.js');
const { validatePassword, DEFAULT_POLICY } = await import('../services/policy.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';
type Ctx = { token: string; orgId: string; branchId: string; email: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `pw.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `PW Co ${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true, accountId: true } });
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email, userId: user.id, accountId: user.accountId };
}

/** Turn on the strict rules: 12 characters, mixed case, a number and a symbol. */
async function strictRules(c: Ctx) {
  const policy = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
  await request(app)
    .put(`/api/orgs/${c.orgId}/security/policy`)
    .set(at(c))
    .send({ ...policy, passwordMinLength: 12, passwordRequireMixedCase: true, passwordRequireNumber: true, passwordRequireSymbol: true })
    .expect(200);
}

describe('common passwords', () => {
  it('are refused whatever their case, as is one character repeated', () => {
    expect(validatePassword('Password123', DEFAULT_POLICY)).toMatch(/too common/);
    expect(validatePassword('QWERTYUIOP', DEFAULT_POLICY)).toMatch(/too common/);
    expect(validatePassword('india@123', DEFAULT_POLICY)).toMatch(/too common/);
    expect(validatePassword('zzzzzzzzzz', DEFAULT_POLICY)).toMatch(/too common/);
    expect(validatePassword('marigold-Tram-42', DEFAULT_POLICY)).toBeNull();
  });

  it('cannot be used to sign up', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: `pw.common.${rnd()}@example.com`, password: 'password123', name: 'Someone' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });
});

describe("the company's password rules", () => {
  it('apply when an admin sets a password for someone', async () => {
    const c = await makeOwner();
    const email = `pw.set.${rnd()}@example.com`;
    const added = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Set Person', password: 'Marigold-Tram-42', orgIds: [c.orgId] });
    expect(added.status).toBeLessThan(300);
    const person = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
    await strictRules(c);

    const path = `/api/orgs/${c.orgId}/users/${person.id}/password`;
    const weak = await request(app).post(path).set(at(c)).send({ password: 'longenough1' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    await request(app).post(path).set(at(c)).send({ password: 'Marigold-Tram-42!' }).expect(200);
  });

  it('apply when an admin adds a person with a new login', async () => {
    const c = await makeOwner();
    await strictRules(c);
    const weak = await request(app)
      .post('/api/users')
      .set(at(c))
      .send({ email: `pw.new.${rnd()}@example.com`, fullName: 'New Person', password: 'longenough1', orgIds: [c.orgId] });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');

    const ok = await request(app)
      .post('/api/users')
      .set(at(c))
      .send({ email: `pw.new.${rnd()}@example.com`, fullName: 'New Person', password: 'Marigold-Tram-42', orgIds: [c.orgId] });
    expect(ok.status).toBeLessThan(300);
  });

  it('apply on password reset, and a refused password leaves the link usable', async () => {
    const c = await makeOwner();
    await strictRules(c);
    const user = await platformPrisma.user.findUniqueOrThrow({ where: { id: c.userId }, select: { id: true, accountId: true, email: true } });
    const token = await issuePasswordResetToken({ id: user.id, accountId: user.accountId });

    const weak = await request(app).post('/api/auth/reset-password').send({ token, password: 'longenough1' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');

    await request(app).post('/api/auth/reset-password').send({ token, password: 'Marigold-Tram-42' }).expect(200);
  });
});

describe('login timing', () => {
  it('spends a bcrypt check on an email with no account, as on a wrong password', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    const res = await request(app).post('/api/auth/login').send({ email: `nobody.${rnd()}@example.com`, password: 'Whatever-12345' });
    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
