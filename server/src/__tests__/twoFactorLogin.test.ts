import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Two-factor sign-in and the company rule that owners and admins use it (SX-09).
 *
 * Until this change the authenticator only guarded money-moving payroll
 * actions; a password alone signed anyone in. Now a person with an
 * authenticator gets a challenge, not a session, until they give a code, and a
 * company can require owners and admins to have one.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const sec = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/security${path}`).set(at(c)).send(body as any);
const PASSWORD = 'Passw0rd!23';

async function makeOwner(): Promise<Ctx> {
  const email = `tfa.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `TFA Co ${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
}

/** Switch on an authenticator for this person; returns its secret and recovery codes. */
async function enable2fa(c: Ctx) {
  const setup = await sec(c, '/two-factor/setup').expect(200);
  const secret = setup.body.secret as string;
  await clearOfStepEdge();
  const on = await sec(c, '/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return { secret, recovery: on.body.recoveryCodes as string[] };
}

const login = (email: string) => request(app).post('/api/auth/login').send({ email, password: PASSWORD });

describe('two-factor sign-in', () => {
  it('asks for a code after the password, and signs in only with a right one, once', async () => {
    const c = await makeOwner();
    const { secret, recovery } = await enable2fa(c);

    const first = await login(c.email).expect(200);
    expect(first.body.twoFactorRequired).toBe(true);
    expect(first.body.token).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();

    const wrong = await request(app).post('/api/auth/login/two-factor').send({ challenge: first.body.challenge, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('BAD_CODE');

    const code = codeAt(secret, stepNow());
    const ok = await request(app).post('/api/auth/login/two-factor').send({ challenge: first.body.challenge, code }).expect(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.headers['set-cookie']).toBeTruthy();

    /* The same code does not work twice, even with a fresh challenge. */
    const again = await login(c.email).expect(200);
    const replay = await request(app).post('/api/auth/login/two-factor').send({ challenge: again.body.challenge, code });
    expect(replay.status).toBe(400);

    /* A recovery code works, once. */
    const viaRecovery = await request(app).post('/api/auth/login/two-factor').send({ challenge: again.body.challenge, code: recovery[0] }).expect(200);
    expect(viaRecovery.body.token).toBeTruthy();
    const third = await login(c.email).expect(200);
    await request(app).post('/api/auth/login/two-factor').send({ challenge: third.body.challenge, code: recovery[0] }).expect(400);
  });

  it('refuses a forged or missing challenge', async () => {
    const res = await request(app).post('/api/auth/login/two-factor').send({ challenge: 'not-a-token', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('signs in with the password alone when no authenticator is set up', async () => {
    const c = await makeOwner();
    const res = await login(c.email).expect(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.twoFactorRequired).toBeUndefined();
    expect(res.body.twoFactorSetupRequired).toBe(false);
  });
});

describe('owners and admins must use two-factor sign-in', () => {
  it('cannot be switched on by someone without an authenticator', async () => {
    const c = await makeOwner();
    const policy = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    const res = await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...policy, requireAdminTwoFactor: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  });

  it('leaves an admin without an authenticator only their own set-up', async () => {
    const c = await makeOwner();
    const { recovery } = await enable2fa(c);
    const policy = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...policy, requireAdminTwoFactor: true }).expect(200);

    /* The owner turns their authenticator off (password and a recovery code, A-10): now an admin without one, under the rule. */
    await sec(c, '/two-factor/disable', { password: PASSWORD, code: recovery[0] }).expect(200);

    const blocked = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(at(c));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    await request(app).get(`/api/orgs/${c.orgId}/security/two-factor`).set(at(c)).expect(200);

    const signIn = await login(c.email).expect(200);
    expect(signIn.body.twoFactorSetupRequired).toBe(true);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signIn.body.token}`).expect(200);
    expect(me.body.twoFactorSetupRequired).toBe(true);

    /* Setting one up again opens the company. */
    await enable2fa(c);
    await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(at(c)).expect(200);
  });
});
