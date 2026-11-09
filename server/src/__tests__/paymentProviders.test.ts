import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';

/**
 * Payments, set up in the operator console: providers and their keys
 * (encrypted, never returned), Test and Live, one active provider, webhooks
 * per provider (signed, idempotent, refusals kept), the Payments log with
 * Retry, and payments recorded by hand.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { setSubscription, getSubscription } = await import('../services/subscriptions.js');
const { clearProviderCache } = await import('../billing/providers.js');

const app = buildApp().listen(0, '127.0.0.1');
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: payments', fn);
const reset = async () => {
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  await db(() => platformPrisma.paymentEvent.deleteMany({ where: { gateway: { in: ['cashfree', 'razorpay', 'manual'] } } }));
  clearProviderCache();
};
beforeAll(reset);
afterAll(async () => {
  await reset();
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(): Promise<Ctx> {
  const email = `payments.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Pay Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId };
}
const accountOf = async (c: Ctx) => (await db(() => platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId }, select: { accountId: true } }))).accountId!;
async function operator() {
  const op = await company();
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { op, h: { ...bearer(op), 'x-step-up': stepUp } };
}

const RZP_SECRET = 'rzpKeySecret9876';
const RZP_HOOK = 'whsec_rzp_9f8e7d6c';
const provider = (body: { providers: { code: string }[] }, code: string) => body.providers.find((p) => p.code === code) as any;
const auditOf = (opId: string, action: string) => db(() => platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: opId, action }, orderBy: { at: 'asc' } }));
const hook = (code: string, body: string, headers: Record<string, string>) => request(app).post(`/api/billing/webhook/${code}`).set('content-type', 'application/json').set(headers).send(body);

describe('setting up a provider', () => {
  it('is for operators, and saving needs a fresh authenticator code', async () => {
    const c = await company();
    expect((await request(app).get('/api/ops/payments').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    const { op } = await operator();
    expect((await request(app).put('/api/ops/payments/providers/razorpay').set(bearer(op)).send({ enabled: true }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
  });

  it('keeps secrets encrypted, shows only their last four characters, and never logs them', async () => {
    const { op, h } = await operator();
    const r = await request(app)
      .put('/api/ops/payments/providers/razorpay')
      .set(h)
      .send({ enabled: true, test: { id: 'rzp_test_AbCdEf123456', secrets: { keySecret: RZP_SECRET, webhookSecret: RZP_HOOK } } })
      .expect(200);
    const rp = provider(r.body, 'razorpay');
    expect(rp.test).toEqual({ keyId: 'rzp_test_AbCdEf123456', saved: { keySecret: '9876', webhookSecret: '7d6c' } });
    expect(rp.webhookUrl).toMatch(/\/api\/billing\/webhook\/razorpay$/);
    expect(JSON.stringify(r.body)).not.toContain(RZP_SECRET);
    expect(JSON.stringify((await request(app).get('/api/ops/payments').set(h).expect(200)).body)).not.toContain(RZP_SECRET);
    const row = await db(() => platformPrisma.paymentProvider.findUniqueOrThrow({ where: { code: 'razorpay' } }));
    expect(row.secretsEnc).toBeTruthy();
    expect(row.secretsEnc).not.toContain(RZP_SECRET);
    expect(JSON.stringify(row.config)).not.toContain(RZP_SECRET);
    const [a] = await auditOf(op.userId, 'PAYMENT_PROVIDER_CHANGED');
    expect(a.detail).toEqual({ provider: 'razorpay', changed: ['test keyId', 'test keySecret', 'test webhookSecret', 'turned on'] });
    expect(JSON.stringify(a.detail)).not.toContain(RZP_SECRET);

    /* A secret left blank keeps the one saved. */
    await request(app).put('/api/ops/payments/providers/razorpay').set(h).send({ test: { secrets: { keySecret: '' } } }).expect(200);
    const again = await db(() => platformPrisma.paymentProvider.findUniqueOrThrow({ where: { code: 'razorpay' } }));
    expect(again.secretsEnc).toBe(row.secretsEnc);
  });

  it('says what is wrong with keys in plain words', async () => {
    const { h } = await operator();
    const r = await request(app).put('/api/ops/payments/providers/razorpay').set(h).send({ live: { id: 'rzp_test_wrongmode1' } }).expect(400);
    expect(r.body.problems).toEqual(['The live Key ID starts with rzp_live_ and has no spaces.']);
  });

  it('Live needs the word LIVE as a second confirmation, and is audited', async () => {
    const { op, h } = await operator();
    expect((await request(app).post('/api/ops/payments/providers/razorpay/mode').set(h).send({ mode: 'LIVE' }).expect(400)).body.code).toBe('CONFIRM_LIVE');
    const r = await request(app).post('/api/ops/payments/providers/razorpay/mode').set(h).send({ mode: 'LIVE', confirm: 'LIVE' }).expect(200);
    expect(provider(r.body, 'razorpay').mode).toBe('LIVE');
    /* No live keys yet: Test connection says so without calling Razorpay. */
    const t = await request(app).post('/api/ops/payments/providers/razorpay/test').set(h).expect(200);
    expect(t.body).toMatchObject({ ok: false, message: 'Save Razorpay’s live Key ID and Key secret first.', mode: 'LIVE' });
    expect((await auditOf(op.userId, 'PAYMENT_PROVIDER_MODE_CHANGED')).map((a) => a.detail)).toEqual([{ provider: 'razorpay', from: 'TEST', to: 'LIVE' }]);
    await request(app).post('/api/ops/payments/providers/razorpay/mode').set(h).send({ mode: 'TEST' }).expect(200);
  });
});

describe('one active provider', () => {
  it('refuses a provider that is not ready, then moves between providers, never two at once', async () => {
    const { op, h } = await operator();
    const notReady = await request(app).post('/api/ops/payments/providers/cashfree/activate').set(h).expect(409);
    expect(notReady.body.problems).toEqual(['Turn Cashfree on first.', 'Save the test App ID.', 'Save the test secret key.']);

    const bad = await request(app).put('/api/ops/payments/providers/manual').set(h).send({ enabled: true, manual: { upiId: 'not a upi', bank: { accountNumber: '12', ifsc: 'hdfc1' } } }).expect(400);
    expect(bad.body.problems).toEqual([
      'A UPI ID looks like clor@okaxis: a name, then @, then the bank’s handle.',
      'An IFSC code is 11 characters, like HDFC0001234: four letters, a zero, then six letters or digits.',
      'A bank account number is 9 to 18 digits.',
    ]);
    await request(app)
      .put('/api/ops/payments/providers/manual')
      .set(h)
      .send({ enabled: true, manual: { upiId: 'clor@okaxis', payeeName: 'CLOR Applications', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' } } })
      .expect(200);
    const t = await request(app).post('/api/ops/payments/providers/manual/test').set(h).expect(200);
    expect(t.body.message).toBe('Manual payments are ready. Customers are shown UPI ID clor@okaxis and the bank account ending 5678.');

    /* Keys saved but never tested: not yet. A pass in the current mode (recorded here; the tests make no network calls) lets it in. */
    expect((await request(app).post('/api/ops/payments/providers/razorpay/activate').set(h).expect(409)).body.problems).toEqual(['Press Test connection and get a pass with the test keys.']);
    await db(() => platformPrisma.paymentProvider.update({ where: { code: 'razorpay' }, data: { lastTestOk: true, lastTestMode: 'TEST', lastTestAt: new Date(), lastTestMessage: 'Razorpay accepted the test keys.' } }));
    await request(app).post('/api/ops/payments/providers/razorpay/activate').set(h).expect(200);
    const r = await request(app).post('/api/ops/payments/providers/manual/activate').set(h).expect(200);
    expect(r.body.previous).toBe('razorpay');
    expect(r.body.providers.filter((p: any) => p.active).map((p: any) => p.code)).toEqual(['manual']);
    await expect(db(() => platformPrisma.paymentProvider.update({ where: { code: 'razorpay' }, data: { active: true } }))).rejects.toThrow();
    expect((await auditOf(op.userId, 'PAYMENT_PROVIDER_ACTIVATED')).map((a) => a.detail)).toEqual([
      { provider: 'razorpay', previous: null },
      { provider: 'manual', previous: 'razorpay' },
    ]);

    /* Customers paying by hand are shown the UPI ID, a QR drawn from it, and the bank account. */
    const cust = await company();
    const cat = await request(app).get('/api/billing/catalog').set(at(cust)).expect(200);
    expect(cat.body.gateway).toBe('manual');
    expect(cat.body.payTo).toMatchObject({ upiId: 'clor@okaxis', upiLink: 'upi://pay?pa=clor%40okaxis&pn=CLOR%20Applications&cu=INR', bank: { ifsc: 'HDFC0001234', accountNumber: '50200012345678' } });
    expect(cat.body.payTo.qr).toMatch(/^data:image\/png;base64,/);
  });
});

describe('webhooks', () => {
  const event = (accountId: string, id: string) =>
    JSON.stringify({
      entity: 'event',
      event: 'subscription.charged',
      payload: { subscription: { entity: { id: `sub_${id}`, status: 'active', current_end: 1767225600, notes: { accountId } } }, payment: { entity: { id: `pay_${id}`, amount: 106200, notes: {} } } },
    });
  const sign = (body: string, secret = RZP_HOOK) => createHmac('sha256', secret).update(body).digest('hex');

  it('applies a signed event once, keeps a replay out, and keeps refusals with the reason', async () => {
    const { h } = await operator();
    await request(app)
      .put('/api/ops/payments/providers/razorpay')
      .set(h)
      .send({ enabled: true, test: { id: 'rzp_test_AbCdEf123456', secrets: { keySecret: RZP_SECRET, webhookSecret: RZP_HOOK } } })
      .expect(200);
    const cust = await company();
    const accountId = await accountOf(cust);
    await db(() => setSubscription(accountId, { apps: [{ appCode: 'accounting' }], trialDays: 30 }));

    const body = event(accountId, 'A1');
    const ok = await hook('razorpay', body, { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_A1' }).expect(200);
    expect(ok.body).toEqual({ received: true, duplicate: false });
    const sub = await db(() => getSubscription(accountId));
    expect(sub).toMatchObject({ status: 'active', gatewayName: 'razorpay', gatewaySubscriptionId: 'sub_A1' });
    expect(sub!.currentPeriodEnd!.toISOString()).toBe(new Date(1767225600 * 1000).toISOString());

    expect((await hook('razorpay', body, { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_A1' }).expect(200)).body.duplicate).toBe(true);
    expect(await db(() => platformPrisma.paymentEvent.count({ where: { gateway: 'razorpay', eventId: 'evt_A1' } }))).toBe(1);

    const forged = await hook('razorpay', body, { 'x-razorpay-signature': sign(body, 'not-the-secret'), 'x-razorpay-event-id': 'evt_A2' }).expect(400);
    expect(forged.body.error).toContain('The signature did not match the saved webhook secret');
    expect((await hook('cashfree', '{}', {}).expect(400)).body.error).toBe('Cashfree is turned off in Payments, so this event was not used.');
    await hook('nobody', '{}', {}).expect(404);

    const log = (await request(app).get('/api/ops/payments/events').set(h).expect(200)).body.events;
    const applied = log.find((e: any) => e.reference === 'pay_A1');
    expect(applied).toMatchObject({ gateway: 'razorpay', what: 'Subscription charged', status: 'APPLIED', amount: 106200, accountName: expect.any(String), canRetry: false });
    expect(applied.detail).toMatch(/^The subscription is now active, paid until 1 Jan 2026\.$/);
    expect(log.filter((e: any) => e.status === 'REJECTED').map((e: any) => e.gateway)).toEqual(expect.arrayContaining(['razorpay', 'cashfree']));
  });

  it('an event for an account with no subscription waits, and Retry applies it once there is one', async () => {
    const { op, h } = await operator();
    const cust = await company();
    const accountId = await accountOf(cust);
    await db(() => platformPrisma.subscription.deleteMany({ where: { accountId } }));
    const body = event(accountId, 'B1');
    await hook('razorpay', body, { 'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_B1' }).expect(200);
    const waiting = (await request(app).get('/api/ops/payments/events?status=RECORDED').set(h).expect(200)).body.events.find((e: any) => e.reference === 'pay_B1');
    expect(waiting).toMatchObject({ canRetry: true, detail: 'This account has no subscription yet, so nothing changed. Retry once it has one.' });

    await db(() => setSubscription(accountId, { apps: [{ appCode: 'accounting' }], trialDays: 30 }));
    await request(app).post(`/api/ops/payments/events/${waiting.id}/retry`).set(bearer(op)).expect(403);
    const r = await request(app).post(`/api/ops/payments/events/${waiting.id}/retry`).set(h).expect(200);
    expect(r.body).toMatchObject({ status: 'APPLIED', before: 'RECORDED' });
    expect((await db(() => getSubscription(accountId)))!.status).toBe('active');
    await request(app).post(`/api/ops/payments/events/${waiting.id}/retry`).set(h).expect(409);
    expect((await auditOf(op.userId, 'PAYMENT_EVENT_RETRIED')).map((a) => a.detail)).toEqual([{ eventId: waiting.id, gateway: 'razorpay', from: 'RECORDED', to: 'APPLIED' }]);
  });
});

describe('a payment recorded by hand', () => {
  it('makes the subscription active for the months paid, and the same UTR cannot be recorded twice', async () => {
    const { op, h } = await operator();
    const cust = await company();
    const accountId = await accountOf(cust);
    await db(() => setSubscription(accountId, { apps: [{ appCode: 'payroll' }], trialDays: 30 }));
    const { name } = await db(() => platformPrisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { name: true } }));
    const found = await request(app).get(`/api/ops/payments/accounts?q=${encodeURIComponent(name.slice(0, 6))}`).set(h).expect(200);
    expect(found.body.accounts.some((a: any) => a.id === accountId)).toBe(true);

    const pay = { accountId, amount: 50000, reference: 'utr412345678901', paidOn: '2026-11-09', months: 1 };
    expect((await request(app).post('/api/ops/payments/manual').set(h).send({ ...pay, reference: 'x' }).expect(400)).body.error).toBe('Enter the UTR or bank reference: 6 to 40 letters and digits.');
    const before = Date.now();
    const r = await request(app).post('/api/ops/payments/manual').set(h).send(pay).expect(200);
    expect(r.body.status).toBe('APPLIED');
    const sub = await db(() => getSubscription(accountId));
    expect(sub!.status).toBe('active');
    const days = (sub!.currentPeriodEnd!.getTime() - before) / 86400000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect((await request(app).post('/api/ops/payments/manual').set(h).send(pay).expect(409)).body.error).toBe('A payment with reference UTR412345678901 is already recorded.');
    const [a] = await auditOf(op.userId, 'PAYMENT_RECORDED_BY_HAND');
    expect(a.targetAccountId).toBe(accountId);
    expect(a.detail).toMatchObject({ amount: 50000, reference: 'UTR412345678901', months: 1 });
    const log = (await request(app).get('/api/ops/payments/events?gateway=manual').set(h).expect(200)).body.events;
    expect(log[0]).toMatchObject({ what: 'Payment recorded by hand', amount: 50000, reference: 'UTR412345678901', status: 'APPLIED' });
  });
});
