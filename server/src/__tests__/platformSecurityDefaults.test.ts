import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Security findings of the platform audit, 11 Nov 2026.
 *
 * - A single sign-on session reached every company the person belongs to; it
 *   now opens only the company whose identity provider vouched for them.
 * - An Idempotency-Key belonged to the Authorization header, so a retry after
 *   a token refresh saved a second record; it now belongs to the person.
 * - The public pay page printed whatever text its address carried.
 * - Payroll step-up was off unless a company switched it on.
 * - Stored credentials were sealed with the session-signing key when no key
 *   of their own was set.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { createSession, rotateSession, signAccessToken } = await import('../services/auth.js');
const { DEFAULT_POLICY, payrollStepUpOn, strictestOf } = await import('../services/policy.js');
const { encryptSecret, decryptSecret } = await import('../services/mailer.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Pick<Ctx, 'token' | 'orgId' | 'branchId'>) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `sec.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Sec Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true, accountId: true } });
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: user.id, accountId: user.accountId };
}

describe('a single sign-on session', () => {
  it('opens the company that vouched for the person and no other, through every refresh', async () => {
    const c = await makeOwner();
    const policyOf = (token: string) => request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at({ ...c, token }));

    /* Vouched for by this company: in. */
    const own = await createSession({ accountId: c.accountId, userId: c.userId, ssoOrgId: c.orgId });
    await policyOf(signAccessToken({ userId: c.userId, accountId: c.accountId, sid: own.session.id, so: c.orgId })).expect(200);

    /* Vouched for by another company: this one stays shut, though the person is its owner. */
    const other = await createSession({ accountId: c.accountId, userId: c.userId, ssoOrgId: 'another-company' });
    const refused = await policyOf(signAccessToken({ userId: c.userId, accountId: c.accountId, sid: other.session.id, so: 'another-company' }));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('SSO_OTHER_COMPANY');

    /* A refresh keeps the binding: the next session and its access token carry the same company. */
    const next = await rotateSession(other.refreshToken, {});
    expect(next.session.ssoOrgId).toBe('another-company');
    expect((await policyOf(next.accessToken)).body.code).toBe('SSO_OTHER_COMPANY');

    /* A password sign-in is not bound. */
    await policyOf(c.token).expect(200);
    const plain = await createSession({ accountId: c.accountId, userId: c.userId });
    expect(plain.session.ssoOrgId).toBeNull();
  });
});

describe('an Idempotency-Key', () => {
  it('still guards a retry sent with a refreshed access token', async () => {
    const c = await makeOwner();
    const url = `/api/orgs/${c.orgId}/recurring/run`;
    const key = `retry-${rnd()}`;
    const first = await request(app).post(url).set(at(c)).set('Idempotency-Key', key).send({});
    expect(first.status).toBeLessThan(400);

    /* The same person with a new token, as after the fifteen-minute refresh. */
    const session = await createSession({ accountId: c.accountId, userId: c.userId });
    const fresh = signAccessToken({ userId: c.userId, accountId: c.accountId, sid: session.session.id });
    expect(fresh).not.toBe(c.token);
    const again = await request(app).post(url).set(at({ ...c, token: fresh })).set('Idempotency-Key', key).send({});
    expect(again.headers['idempotency-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);

    /* Somebody else using the same key is a different request, not a replay of the first person's answer. */
    const stranger = await makeOwner();
    const theirs = await request(app).post(`/api/orgs/${stranger.orgId}/recurring/run`).set(at(stranger)).set('Idempotency-Key', key).send({});
    expect(theirs.headers['idempotency-replayed']).toBeUndefined();

    /* A token that does not verify is not given a scope; requireAuth refuses it. */
    const forged = await request(app).post(url).set({ ...at(c), Authorization: 'Bearer not-a-token' }).set('Idempotency-Key', key).send({});
    expect(forged.status).toBe(401);
  });
});

describe('the public pay page', () => {
  it('says only its own sentences, whatever the address carries', async () => {
    const c = await makeOwner();
    const inv = (
      await request(app)
        .post(`/api/orgs/${c.orgId}/invoices`)
        .set(at(c))
        .send({ date: '2026-10-10', customerName: 'Asha Traders', subtotal: 500, gstTotal: 0, total: 500, items: [{ description: 'Service', quantity: 1, rate: 500, gstRate: 0 }] })
        .expect(201)
    ).body.invoice;
    if (inv.status === 'Draft') await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
    const made = await request(app).post(`/api/orgs/${c.orgId}/pay-requests`).set(at(c)).send({ docId: inv.id, payeeVpa: 'asha.traders@okhdfc', payeeName: 'Asha Traders' }).expect(201);
    const token = String(made.body.url).split('/pay/')[1];

    const crafted = await request(app).get(`/pay/${token}`).query({ err: 'Payment failed. Call 98450 00000 and read out your card number.' }).expect(200);
    expect(crafted.text).not.toContain('98450');
    expect(crafted.text).not.toContain('card number');

    /* A refused UTR comes back with a code, and the page turns the code into the sentence. */
    const claim = await request(app).post(`/pay/${token}/claim`).type('form').send({ utr: 'short' });
    expect(claim.status).toBe(303);
    expect(claim.headers.location).toBe(`/pay/${token}?err=utr`);
    const told = await request(app).get(claim.headers.location).expect(200);
    expect(told.text).toContain('That does not look like a UTR');
  });
});

describe('payroll step-up', () => {
  const before = process.env.PAYROLL_STEP_UP_DEFAULT;
  afterEach(() => {
    if (before === undefined) delete process.env.PAYROLL_STEP_UP_DEFAULT;
    else process.env.PAYROLL_STEP_UP_DEFAULT = before;
  });

  it('is on for a company that has never chosen, and off only where the company says so', async () => {
    const c = await makeOwner();
    const mine = () => request(app).get(`/api/orgs/${c.orgId}/security/two-factor`).set(at(c)).expect(200);

    /* The suite itself runs with the default off, because its companies have no authenticators. */
    delete process.env.PAYROLL_STEP_UP_DEFAULT;
    expect(DEFAULT_POLICY.requirePayrollStepUp).toBe(false);

    /* As deployed. */
    process.env.PAYROLL_STEP_UP_DEFAULT = 'on';
    expect(DEFAULT_POLICY.requirePayrollStepUp).toBe(true);
    expect(await payrollStepUpOn(c.orgId)).toBe(true);
    expect((await mine()).body.payrollStepUp).toBe(true);

    /* The company's own choice wins either way. */
    await platformPrisma.authPolicy.create({ data: { accountId: c.accountId, orgId: c.orgId, requirePayrollStepUp: false, updatedByUserId: c.userId } });
    expect(await payrollStepUpOn(c.orgId)).toBe(false);
    expect((await mine()).body.payrollStepUp).toBe(false);

    /* Across a person's companies: off only when every one of them said off. */
    const row = await platformPrisma.authPolicy.findUniqueOrThrow({ where: { orgId: c.orgId } });
    expect(strictestOf([row]).requirePayrollStepUp).toBe(false);
    expect(strictestOf([row, { ...row, requirePayrollStepUp: true }]).requirePayrollStepUp).toBe(true);

    /* A new row takes the new default. */
    const d = await makeOwner();
    const fresh = await platformPrisma.authPolicy.create({ data: { accountId: d.accountId, orgId: d.orgId, updatedByUserId: d.userId } });
    expect(fresh.requirePayrollStepUp).toBe(true);
  });
});

describe('the key that seals stored credentials', () => {
  const KEYS = ['NODE_ENV', 'VITEST', 'MAIL_SECRET_KEY', 'JWT_SECRET'] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is never the session-signing key in production, and old secrets still open', () => {
    process.env.JWT_SECRET = 'signing-key-0123456789abcdef';
    delete process.env.MAIL_SECRET_KEY;
    /* Sealed before this change, when the signing key stood in. */
    const old = encryptSecret('smtp-password');

    process.env.NODE_ENV = 'production';
    delete process.env.VITEST;
    expect(() => encryptSecret('new-password')).toThrow(/MAIL_SECRET_KEY must be set/);
    expect(decryptSecret(old)).toBe('smtp-password');

    process.env.MAIL_SECRET_KEY = 'own-key-fedcba9876543210';
    const sealed = encryptSecret('new-password');
    expect(decryptSecret(sealed)).toBe('new-password');
    /* Not openable with the signing key alone. */
    delete process.env.MAIL_SECRET_KEY;
    expect(decryptSecret(sealed)).not.toBe('new-password');
  });
});
