import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Sign-in codes by text message, beside the authenticator app (owner, 17 Nov
 * 2026): offered only once CLOR's sender is set up in the operator console;
 * turned on with the password and a code sent to the number; good for the
 * second step of a sign-in and for the "owners and admins" rule; held back so
 * nobody can run up a bill or pester a number. Nothing is really sent under
 * the test runner: texts land in `smsTestOutbox`.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { smsTestOutbox } = await import('../services/sms.js');
const { SmsLimitError, issueSmsCode, useSmsCode } = await import('../services/smsCodes.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';
const KEY = 'Abcd1234Efgh5678Ijkl9012';
type Ctx = { token: string; orgId: string; branchId: string; email: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });
const sec = (c: Ctx, path: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${path}`).set(at(c)).send(body as any);
const state = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/security/two-factor`).set(at(c)).expect(200)).body;
const login = (email: string) => request(app).post('/api/auth/login').send({ email, password: PASSWORD });
const finish = (challenge: string, code: string) => request(app).post('/api/auth/login/two-factor').send({ challenge, code });
/** A fresh Indian mobile number each time, so one test's texts never count against another's. */
const mobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
/** The newest code texted to a number. */
const texted = (phone: string) => {
  const hit = [...smsTestOutbox].reverse().find((m) => m.to === `+91${phone}`);
  if (!hit) throw new Error(`no text went to ${phone}`);
  return hit.code;
};
/** A six-digit code that is not the given one. */
const not = (code: string) => (code === '000000' ? '000001' : '000000');

async function makeOwner(): Promise<Ctx> {
  const email = `sms.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `SMS Co ${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email, userId: claims.userId };
}

/** Switch on an authenticator; returns its secret and recovery codes. */
async function enableApp(c: Ctx) {
  const setup = await sec(c, '/two-factor/setup', { password: PASSWORD }).expect(200);
  const secret = setup.body.secret as string;
  await clearOfStepEdge();
  const on = await sec(c, '/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return { secret, recovery: on.body.recoveryCodes as string[] };
}

/** Switch on codes by text message; returns the number and any recovery codes shown. */
async function enableSms(c: Ctx) {
  const phone = mobile();
  await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone }).expect(200);
  const on = await sec(c, '/two-factor/sms/enable', { code: texted(phone) }).expect(200);
  return { phone, recovery: on.body.recoveryCodes as string[] | null };
}

describe('CLOR’s text-message sender, in the operator console', () => {
  it('offers nobody SMS codes until it is set up', async () => {
    const c = await makeOwner();
    expect((await state(c)).sms).toMatchObject({ enabled: false, available: false, phone: null });
    const res = await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone: mobile() });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SMS_NOT_AVAILABLE');
  }, 60_000);

  it('is saved by an owner of the console with a fresh code, on the record, and never gives the key back', async () => {
    const op = await makeOwner();
    const customer = await makeOwner();
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    const { secret } = await enableApp(op);
    const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
    const ops = { ...bearer(op), 'x-step-up': stepUp };

    /* Customers have no way in. */
    await request(app).get('/api/ops/settings/sms').set(bearer(customer)).expect(403);
    /* A change needs the fresh code. */
    await request(app).put('/api/ops/settings/sms').set(bearer(op)).send({ enabled: false }).expect(403);

    /* On needs a key and a template, said in plain words. */
    const bare = await request(app).put('/api/ops/settings/sms').set(ops).send({ enabled: true });
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('INVALID_SMS');
    expect(bare.body.problems.length).toBe(2);
    expect((await request(app).put('/api/ops/settings/sms').set(ops).send({ enabled: false, senderId: 'clor' })).status).toBe(400);

    const saved = await request(app).put('/api/ops/settings/sms').set(ops).send({ enabled: true, authKey: KEY, templateId: 'tmpl1234abcd', senderId: 'clorin' }).expect(200);
    expect(saved.body.sms).toMatchObject({ enabled: true, ready: true, templateId: 'tmpl1234abcd', senderId: 'CLORIN', authKeySaved: true, authKeyHint: KEY.slice(-4) });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);

    const seen = await request(app).get('/api/ops/settings/sms').set(bearer(op)).expect(200);
    expect(JSON.stringify(seen.body)).not.toContain(KEY);
    expect(seen.body.sms.authKeyEnc).toBeUndefined();

    /* Saved again without a key: the stored one stays. */
    const again = await request(app).put('/api/ops/settings/sms').set(ops).send({ enabled: true, templateId: 'tmpl1234abcd', senderId: 'CLORIN' }).expect(200);
    expect(again.body.sms.authKeySaved).toBe(true);

    const logged = await platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: op.userId, action: 'SMS_SETTINGS_CHANGED' } });
    expect(logged.length).toBe(2);
    expect(JSON.stringify(logged)).not.toContain(KEY);

    /* The test text: a real number only, and its result is kept for the page. */
    expect((await request(app).post('/api/ops/settings/sms/test').set(ops).send({ phone: '12345' }).expect(400)).body.code).toBe('BAD_PHONE');
    const phone = mobile();
    const test = await request(app).post('/api/ops/settings/sms/test').set(ops).send({ phone }).expect(200);
    expect(test.body.ok).toBe(true);
    expect(test.body.message).not.toContain(phone);
    expect(texted(phone)).toMatch(/^\d{6}$/);
    const after = (await request(app).get('/api/ops/settings/sms').set(bearer(op)).expect(200)).body.sms;
    expect(after.lastTestOk).toBe(true);
    expect(after.lastTestAt).toBeTruthy();

    /* Now customers are offered it. */
    expect((await state(customer)).sms.available).toBe(true);
  }, 90_000);
});

describe('turning codes by text message on and off', () => {
  it('takes the password, an Indian mobile number, and the code sent to it', async () => {
    const c = await makeOwner();
    const phone = mobile();
    expect((await sec(c, '/two-factor/sms/start', { password: 'wrong', phone })).body.code).toBe('BAD_PASSWORD');
    expect((await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone: '12345 67890' })).body.code).toBe('BAD_PHONE');

    const sent = await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` }).expect(200);
    expect(sent.body.phone).toBe(`+91 ••••• ••${phone.slice(-3)}`);
    expect(sent.body.resendIn).toBe(30);
    const code = texted(phone);

    /* Another straight away is held back, with how long to wait. */
    const soon = await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone });
    expect(soon.status).toBe(429);
    expect(soon.body.code).toBe('SMS_HELD');
    expect(soon.body.retryAfter).toBeGreaterThan(0);

    expect((await sec(c, '/two-factor/sms/enable', { code: not(code) })).body.code).toBe('BAD_CODE');
    const on = await sec(c, '/two-factor/sms/enable', { code }).expect(200);
    expect(on.body.enabled).toBe(true);
    expect(on.body.recoveryCodes.length).toBeGreaterThan(0);

    const s = await state(c);
    expect(s.enabled).toBe(false);
    expect(s.sms).toMatchObject({ enabled: true, phone: `+91 ••••• ••${phone.slice(-3)}` });
    expect(s.recoveryCodesLeft).toBe(on.body.recoveryCodes.length);
    /* The code is spent, and a second set-up is refused. */
    expect((await sec(c, '/two-factor/sms/enable', { code })).status).toBe(409);
    expect((await sec(c, '/two-factor/sms/start', { password: PASSWORD, phone: mobile() })).body.code).toBe('ALREADY_ENABLED');
  }, 60_000);

  it('turns off with the password and a code just texted, and the recovery codes go with it', async () => {
    const c = await makeOwner();
    const { phone } = await enableSms(c);
    const sent = await sec(c, '/two-factor/sms/send').expect(200);
    expect(sent.body.phone).toContain(phone.slice(-3));
    const code = texted(phone);
    expect((await sec(c, '/two-factor/sms/disable', { password: 'wrong', code })).body.code).toBe('BAD_PASSWORD');
    expect((await sec(c, '/two-factor/sms/disable', { password: PASSWORD, code: not(code) })).body.code).toBe('BAD_CODE');
    await sec(c, '/two-factor/sms/disable', { password: PASSWORD, code }).expect(200);

    const s = await state(c);
    expect(s.sms).toMatchObject({ enabled: false, phone: null });
    expect(s.recoveryCodesLeft).toBe(0);
    /* A password alone signs in again. */
    expect((await login(c.email).expect(200)).body.token).toBeTruthy();
  }, 60_000);

  it('shares the recovery codes with the app: turning one off keeps them while the other is on', async () => {
    const c = await makeOwner();
    const app2 = await enableApp(c);
    const sms = await enableSms(c);
    /* The codes from the app's set-up stand; no second set is made. */
    expect(sms.recovery).toBeNull();

    /* The app goes off with a recovery code; the rest stay, because SMS codes are still on. */
    await sec(c, '/two-factor/disable', { password: PASSWORD, code: app2.recovery[0] }).expect(200);
    const s = await state(c);
    expect(s.enabled).toBe(false);
    expect(s.sms.enabled).toBe(true);
    expect(s.recoveryCodesLeft).toBe(app2.recovery.length - 1);

    /* SMS codes go off with a recovery code too (a lost phone), and now nothing is left. */
    await sec(c, '/two-factor/sms/disable', { password: PASSWORD, code: app2.recovery[1] }).expect(200);
    expect((await state(c)).recoveryCodesLeft).toBe(0);
  }, 60_000);
});

describe('signing in with a code by text message', () => {
  it('asks for the second step, texts a code only for a live challenge, and lets the code in once', async () => {
    const c = await makeOwner();
    const { phone, recovery } = await enableSms(c);

    const first = await login(c.email).expect(200);
    expect(first.body.twoFactorRequired).toBe(true);
    expect(first.body.token).toBeUndefined();
    expect(first.body.methods).toEqual(['SMS']);
    expect(first.body.phone).toBe(`+91 ••••• ••${phone.slice(-3)}`);

    /* No text without the challenge a right password gives. */
    const forged = await request(app).post('/api/auth/login/two-factor/sms').send({ challenge: 'not-a-token' });
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('CHALLENGE_EXPIRED');

    const before = smsTestOutbox.length;
    const sent = await request(app).post('/api/auth/login/two-factor/sms').send({ challenge: first.body.challenge }).expect(200);
    expect(sent.body.phone).not.toContain(phone.slice(0, 7));
    expect(smsTestOutbox.length).toBe(before + 1);
    const code = texted(phone);

    const ok = await finish(first.body.challenge, code).expect(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.headers['set-cookie']).toBeTruthy();

    /* The same code does not work twice, even with a fresh challenge; a recovery code does, once. */
    const again = await login(c.email).expect(200);
    expect((await finish(again.body.challenge, code)).status).toBe(400);
    expect((await finish(again.body.challenge, recovery![0]).expect(200)).body.token).toBeTruthy();
  }, 60_000);

  it('offers both ways to someone with the app and text messages, and takes either code', async () => {
    const c = await makeOwner();
    const { secret } = await enableApp(c);
    const { phone } = await enableSms(c);

    const first = await login(c.email).expect(200);
    expect(first.body.methods).toEqual(['APP', 'SMS']);
    await request(app).post('/api/auth/login/two-factor/sms').send({ challenge: first.body.challenge }).expect(200);
    expect((await finish(first.body.challenge, texted(phone)).expect(200)).body.token).toBeTruthy();

    await clearOfStepEdge();
    const second = await login(c.email).expect(200);
    expect((await finish(second.body.challenge, codeAt(secret, stepNow())).expect(200)).body.token).toBeTruthy();
  }, 60_000);

  it('refuses a text to someone who only has the app', async () => {
    const c = await makeOwner();
    await enableApp(c);
    const first = await login(c.email).expect(200);
    expect(first.body.methods).toEqual(['APP']);
    expect(first.body.phone).toBeNull();
    const res = await request(app).post('/api/auth/login/two-factor/sms').send({ challenge: first.body.challenge });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SMS_NOT_ON');
  }, 60_000);
});

describe('the limits on texted codes', () => {
  it('spends a code after five wrong tries, and keeps one purpose’s code from another', async () => {
    const c = await makeOwner();
    const phone = `+91${mobile()}`;
    await issueSmsCode(c.userId, phone, 'LOGIN');
    const code = smsTestOutbox[smsTestOutbox.length - 1].code;
    /* A sign-in code does not turn anything on or off. */
    expect(await useSmsCode(c.userId, 'SETUP', code)).toBeNull();
    expect(await useSmsCode(c.userId, 'DISABLE', code)).toBeNull();
    for (let i = 0; i < 5; i += 1) expect(await useSmsCode(c.userId, 'LOGIN', not(code))).toBeNull();
    expect(await useSmsCode(c.userId, 'LOGIN', code)).toBeNull();
  }, 60_000);

  it('lets a right code in once, and not after five minutes', async () => {
    const c = await makeOwner();
    const phone = `+91${mobile()}`;
    await issueSmsCode(c.userId, phone, 'LOGIN');
    const code = smsTestOutbox[smsTestOutbox.length - 1].code;
    expect(await useSmsCode(c.userId, 'LOGIN', code)).toBe(phone);
    expect(await useSmsCode(c.userId, 'LOGIN', code)).toBeNull();

    await platformPrisma.smsCode.updateMany({ where: { userId: c.userId }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
    await issueSmsCode(c.userId, phone, 'LOGIN');
    const late = smsTestOutbox[smsTestOutbox.length - 1].code;
    await platformPrisma.smsCode.updateMany({ where: { userId: c.userId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await useSmsCode(c.userId, 'LOGIN', late)).toBeNull();
  }, 60_000);

  it('makes only the newest text count, and stops at five texts an hour for one person', async () => {
    const c = await makeOwner();
    const phone = `+91${mobile()}`;
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await issueSmsCode(c.userId, phone, 'LOGIN');
      codes.push(smsTestOutbox[smsTestOutbox.length - 1].code);
      /* Step past the 30-second wait between texts. */
      await platformPrisma.smsCode.updateMany({ where: { userId: c.userId }, data: { createdAt: new Date(Date.now() - 60_000) } });
    }
    const sixth = await issueSmsCode(c.userId, phone, 'LOGIN').catch((e) => e);
    expect(sixth).toBeInstanceOf(SmsLimitError);
    expect(sixth.retryAfterS).toBe(3600);
    if (codes[0] !== codes[4]) expect(await useSmsCode(c.userId, 'LOGIN', codes[0])).toBeNull();
    expect(await useSmsCode(c.userId, 'LOGIN', codes[4])).toBe(phone);
  }, 60_000);
});

describe('owners and admins must use two-step sign-in', () => {
  it('counts codes by text message', async () => {
    const c = await makeOwner();
    const policy = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    const put = (body: unknown) => request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send(body as any);
    expect((await put({ ...policy, requireAdminTwoFactor: true })).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');

    const { phone } = await enableSms(c);
    await put({ ...policy, requireAdminTwoFactor: true }).expect(200);
    await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(at(c)).expect(200);
    expect((await request(app).get('/api/auth/me').set(at(c)).expect(200)).body.twoFactorSetupRequired).toBe(false);

    /* Off again: the company waits until a second step is back, and setting SMS codes up is still allowed. */
    await sec(c, '/two-factor/sms/send').expect(200);
    await sec(c, '/two-factor/sms/disable', { password: PASSWORD, code: texted(phone) }).expect(200);
    const blocked = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(at(c));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    /* Step past the 30-second wait since the first set-up text. */
    await platformPrisma.smsCode.updateMany({ where: { userId: c.userId }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await enableSms(c);
    await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(at(c)).expect(200);
  }, 60_000);
});
