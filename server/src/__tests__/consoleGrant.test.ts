import { generateKeyPairSync } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * The sign-in pass for the Engineering Console (services/consoleGrant.ts,
 * GET /api/ops/console-grant): made for CLOR staff only, for one sign-in
 * attempt, for one minute, and checked here with the Console's own checker
 * (console/api/src/grant.ts) so the two sides are known to agree.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { verifyGrant } = await import('../../../console/api/src/grant.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
  delete process.env.CONSOLE_GRANT_PRIVATE_KEY;
  delete process.env.CONSOLE_API_ORIGIN;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const STATE = 'a'.repeat(32);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(): Promise<Ctx> {
  const email = `grant.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Staff Member' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Grant Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, email };
}
async function authenticator(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set({ ...bearer(c), 'x-org-id': c.orgId, 'x-branch-id': c.branchId }).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
}
function keys() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.CONSOLE_GRANT_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
}
const ask = (c: Ctx | null, state = STATE) => {
  const r = request(app).get('/api/ops/console-grant').query({ state });
  return c ? r.set(bearer(c)) : r;
};

describe('the Console sign-in pass', () => {
  // protects=a pass goes only to CLOR staff signed in with an authenticator; fails_when=a customer, an unsigned caller or an operator without an authenticator gets one; no_claim=none beyond protects
  it('is made for CLOR staff only', async () => {
    keys();
    const op = await company();
    const customer = await company();
    await ask(null).expect(401);
    expect((await ask(customer).expect(403)).body.code).toBe('OPERATOR_ONLY');
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    const refused = await ask(op).expect(403);
    expect(refused.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect(refused.body.redirectTo).toBeUndefined();
  }, 60_000);

  // protects=the pass the API makes is one the Console accepts: right person, right attempt, one minute, and it is on the operator log; fails_when=the Console's checker refuses it, it names someone else, it outlives a minute, or no log line is written; no_claim=the Console's member list and authenticator are the Console's own tests
  it('makes a pass the Console accepts, for this attempt, for a minute', async () => {
    const publicKey = keys();
    process.env.CONSOLE_API_ORIGIN = 'https://console-api.example.test/';
    const op = await company();
    await authenticator(op);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;

    const res = await ask(op).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const to = new URL(res.body.redirectTo);
    expect(`${to.origin}${to.pathname}`).toBe('https://console-api.example.test/api/auth/clor/callback');
    expect(to.searchParams.get('state')).toBe(STATE);
    const pass = to.searchParams.get('grant')!;

    expect(verifyGrant(pass, publicKey, STATE, Date.now())).toMatchObject({ clorUserId: op.userId, email: op.email, name: 'Staff Member' });
    expect(verifyGrant(pass, publicKey, 'b'.repeat(32), Date.now())).toBeNull();
    expect(verifyGrant(pass, publicKey, STATE, Date.now() + 61_000)).toBeNull();
    expect(verifyGrant(pass, generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString(), STATE, Date.now())).toBeNull();

    /* It is not a CLOR session: the customer API itself refuses it as a token. */
    await request(app).get('/api/ops/me').set('Authorization', `Bearer ${pass}`).expect(401);

    const logged = await platformPrisma.operatorAuditEvent.findFirst({ where: { operatorUserId: op.userId, action: 'CONSOLE_PASS_ISSUED' } });
    expect(logged?.targetUserId).toBe(op.userId);
  }, 60_000);

  // protects=no pass without a well-formed attempt id, and none at all until the key is set; fails_when=a pass is made for a free-form state, or with no key; no_claim=none beyond protects
  it('needs a proper attempt id and a key', async () => {
    const op = await company();
    await authenticator(op);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    expect((await ask(op).expect(503)).body.code).toBe('CONSOLE_OFF');
    keys();
    for (const state of ['', 'short', 'https://evil.example/', 'A'.repeat(32), 'a'.repeat(33)]) expect((await ask(op, state).expect(400)).body.redirectTo).toBeUndefined();
    expect(await platformPrisma.operatorAuditEvent.count({ where: { operatorUserId: op.userId, action: 'CONSOLE_PASS_ISSUED' } })).toBe(0);
  }, 60_000);
});
