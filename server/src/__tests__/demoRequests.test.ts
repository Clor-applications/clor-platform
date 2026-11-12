import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * "Request a demo" (roadmap items 3 and 4): the public form on clor.in, and
 * the operator console's Demo requests with Create account.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { indianPhone } = await import('../routes/demoRequests.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
  process.env.DISABLE_RATE_LIMIT = 'true';
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(): Promise<Ctx> {
  const email = `demo.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Demo Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId, email };
}
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

const good = (over: Record<string, unknown> = {}) => ({
  name: 'Asha Rao',
  company: `Rao Textiles ${rnd()}`,
  email: `asha.${Date.now()}.${rnd()}@raotextiles.in`,
  phone: '98450 12345',
  city: 'Mysuru',
  companySize: '11-20',
  users: 3,
  apps: ['people', 'books'],
  message: 'We pay 18 people by hand.',
  ...over,
});
const submit = (body: unknown, origin?: string) => {
  const r = request(app).post('/api/public/demo-requests');
  if (origin) r.set('Origin', origin);
  return r.send(body as any);
};

describe('the public form', () => {
  it('keeps a request, logs it, and writes to sales through the outbox', async () => {
    const body = good();
    await submit(body).expect(201);
    const row = await platformPrisma.demoRequest.findFirstOrThrow({ where: { email: body.email } });
    expect(row).toMatchObject({ name: 'Asha Rao', phone: '+919845012345', companySize: '11-20', users: 3, status: 'NEW', apps: ['people', 'accounting'] });
    const logged = await platformPrisma.authEvent.findFirst({ where: { email: body.email, eventType: 'DEMO_REQUESTED' } });
    expect(logged?.detail).toContain(row.id);
    const mail = await platformPrisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'sales.demo_requested', relatedId: row.id } });
    expect(mail.toEmail).toBe('sales@clor.in');
    expect(mail.subject).toContain(body.company);
    expect(mail.bodyText).toContain('Apps: Books, People');
  });

  it('answers each wrong field by name, and keeps nothing', async () => {
    const r = await submit({ name: 'A', company: '', email: 'not-an-email', phone: '12345', city: '', companySize: 'lots', users: 0, apps: ['projects'] }).expect(400);
    expect(Object.keys(r.body.fields).sort()).toEqual(['apps', 'city', 'company', 'companySize', 'email', 'name', 'phone', 'users']);
    expect(r.body.fields.phone).toMatch(/Indian phone/);
    expect(r.body.fields.apps).toMatch(/at least one app/);
    expect(await platformPrisma.demoRequest.count({ where: { email: 'not-an-email' } })).toBe(0);
  });

  it('reads Indian numbers written the usual ways', () => {
    expect(indianPhone('+91 98450-12345')).toBe('+919845012345');
    expect(indianPhone('09845012345')).toBe('+919845012345');
    expect(indianPhone('919845012345')).toBe('+919845012345');
    expect(indianPhone('080 2345 6789')).toBe('+918023456789');
    expect(indianPhone('98450')).toBeNull();
    expect(indianPhone('+1 415 555 0100')).toBeNull();
  });

  it('thanks a bot that filled the hidden field, and keeps nothing', async () => {
    const body = good({ website: 'http://spam.example' });
    await submit(body).expect(201);
    expect(await platformPrisma.demoRequest.count({ where: { email: body.email } })).toBe(0);
    expect(await platformPrisma.emailOutbox.count({ where: { templateKey: 'sales.demo_requested', bodyText: { contains: body.email } } })).toBe(0);
  });

  it('limits one email address, then one address on the network', async () => {
    process.env.DISABLE_RATE_LIMIT = 'false';
    const email = `limit.${Date.now()}.${rnd()}@example.com`;
    for (let i = 0; i < 3; i++) await submit(good({ email })).expect(201);
    expect((await submit(good({ email })).expect(429)).body.error).toMatch(/Too many demo requests/);
    /* Other addresses go on until the address on the network has sent ten in the hour. */
    let last = 201;
    for (let i = 0; i < 10 && last === 201; i++) last = (await submit(good())).status;
    expect(last).toBe(429);
  });

  it('lets clor.in post across origins, without credentials, and nobody else', async () => {
    const pre = await request(app).options('/api/public/demo-requests').set('Origin', 'https://clor.in').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://clor.in');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    const r = await submit(good(), 'https://clor.in').expect(201);
    expect(r.headers['access-control-allow-origin']).toBe('https://clor.in');
    const other = await submit(good(), 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Demo requests in the operator console', () => {
  it('is for operators only: a customer owner cannot read requests', async () => {
    const c = await company();
    await submit(good()).expect(201);
    await request(app).get('/api/ops/demo-requests').expect(401);
    expect((await request(app).get('/api/ops/demo-requests').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    /* Not through the company headers either. */
    expect((await request(app).get('/api/ops/demo-requests').set(at(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    const any = await platformPrisma.demoRequest.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect((await request(app).get(`/api/ops/demo-requests/${any.id}`).set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    expect((await request(app).post(`/api/ops/demo-requests/${any.id}/create-account`).set(bearer(c)).send({ state: 'Karnataka' }).expect(403)).body.code).toBe('OPERATOR_ONLY');
  }, 60_000);

  it('lists newest first by status, and moves a request along with a note, only with a fresh code', async () => {
    const { op, h } = await operator();
    const a = good();
    const b = good();
    await submit(a).expect(201);
    await submit(b).expect(201);
    const list = (await request(app).get('/api/ops/demo-requests').query({ status: 'NEW' }).set(bearer(op)).expect(200)).body;
    const emails = list.requests.map((r: any) => r.email);
    expect(emails.indexOf(b.email)).toBeLessThan(emails.indexOf(a.email));
    expect(list.counts.NEW).toBeGreaterThanOrEqual(2);
    const id = list.requests.find((r: any) => r.email === a.email).id;

    expect((await request(app).patch(`/api/ops/demo-requests/${id}`).set(bearer(op)).send({ status: 'CONTACTED' }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    await request(app).patch(`/api/ops/demo-requests/${id}`).set(h).send({ status: 'ACCOUNT_CREATED' }).expect(400);
    const moved = (await request(app).patch(`/api/ops/demo-requests/${id}`).set(h).send({ status: 'CONTACTED', note: 'Called, demo Thursday 11am' }).expect(200)).body.request;
    expect(moved).toMatchObject({ status: 'CONTACTED', note: 'Called, demo Thursday 11am' });
    const contacted = (await request(app).get('/api/ops/demo-requests').query({ status: 'CONTACTED' }).set(bearer(op)).expect(200)).body.requests.map((r: any) => r.id);
    expect(contacted).toContain(id);
    const one = (await request(app).get(`/api/ops/demo-requests/${id}`).set(bearer(op)).expect(200)).body;
    expect(one.history[0]).toMatchObject({ action: 'DEMO_REQUEST_STATUS', detail: { from: 'NEW', to: 'CONTACTED', note: 'Called, demo Thursday 11am' } });
  }, 90_000);

  it('creates the account once: owner, company, apps on a trial, set-password email; a second click returns it', async () => {
    const { op, h } = await operator();
    const body = good({ apps: ['payroll', 'attendance'] });
    await submit(body).expect(201);
    const { id } = await platformPrisma.demoRequest.findFirstOrThrow({ where: { email: body.email } });

    await request(app).post(`/api/ops/demo-requests/${id}/create-account`).set(h).send({}).expect(400);
    const first = await request(app).post(`/api/ops/demo-requests/${id}/create-account`).set(h).send({ state: 'Karnataka' }).expect(201);
    expect(first.body.created).toBe(true);
    const accountId = first.body.account.id;
    expect(first.body.owner.email).toBe(body.email);

    const again = await request(app).post(`/api/ops/demo-requests/${id}/create-account`).set(h).send({ state: 'Kerala' }).expect(200);
    expect(again.body).toMatchObject({ created: false, account: { id: accountId } });
    expect(await platformPrisma.account.count({ where: { name: body.company } })).toBe(1);
    expect(await platformPrisma.user.count({ where: { email: body.email } })).toBe(1);

    const sub = await platformPrisma.subscription.findUniqueOrThrow({ where: { accountId }, include: { items: true } });
    expect(sub.status).toBe('trialing');
    expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(sub.items.map((i) => i.appCode).sort()).toEqual(['attendance', 'payroll']);
    const org = await platformPrisma.org.findFirstOrThrow({ where: { accountId } });
    expect(org.name).toBe(body.company);
    expect(JSON.parse(org.profileJson!)).toMatchObject({ requestedApp: 'payroll', state: 'Karnataka', city: 'Mysuru' });
    const owner = await platformPrisma.accountMembership.findFirstOrThrow({ where: { accountId } });
    expect(owner.role).toBe('OWNER');
    const switches = await platformPrisma.featureSetting.findMany({ where: { orgId: org.id, key: { in: ['payroll', 'attendance', 'people'] } } });
    expect(switches.filter((s) => s.enabled).map((s) => s.key).sort()).toEqual(['attendance', 'payroll']);

    const row = await platformPrisma.demoRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'ACCOUNT_CREATED', accountId });
    expect((await request(app).patch(`/api/ops/demo-requests/${id}`).set(h).send({ status: 'NEW' }).expect(409)).body.code).toBe('ACCOUNT_CREATED');

    /* One set-password email, and the link in it sets a password the owner can sign in with. */
    const mails = await platformPrisma.emailOutbox.findMany({ where: { templateKey: 'account.welcome', toEmail: body.email } });
    expect(mails).toHaveLength(1);
    /* The link opens the app they asked for once the password is set (roadmap item 5). */
    expect(mails[0].bodyText).toMatch(/\?reset=[^\s&]+&app=payroll/);
    const reset = await platformPrisma.passwordResetToken.findFirstOrThrow({ where: { userId: row.ownerUserId!, usedAt: null } });
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    await request(app).post('/api/auth/login').send({ email: body.email, password: 'anything-at-all' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    /* On the operator record, and on the new customer's own security log. */
    const logged = await platformPrisma.operatorAuditEvent.findFirstOrThrow({ where: { operatorUserId: op.userId, action: 'DEMO_ACCOUNT_CREATED' }, orderBy: { at: 'desc' } });
    expect(logged.targetAccountId).toBe(accountId);
    expect(await platformPrisma.authEvent.count({ where: { accountId, eventType: 'OPERATOR_DEMO_ACCOUNT_CREATED' } })).toBe(1);
  }, 120_000);

  it('refuses an email that already signs in, and leaves the request open to try again', async () => {
    const { h } = await operator();
    const c = await company();
    await submit(good({ email: c.email })).expect(201);
    const { id } = await platformPrisma.demoRequest.findFirstOrThrow({ where: { email: c.email } });
    expect((await request(app).post(`/api/ops/demo-requests/${id}/create-account`).set(h).send({ state: 'Karnataka' }).expect(409)).body.code).toBe('EMAIL_TAKEN');
    expect(await platformPrisma.demoRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ accountId: null, provisioningAt: null, status: 'NEW' });
  }, 90_000);

  it('leaves Create account to billing operators', async () => {
    const boss = await operator();
    const sup = await company();
    const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${sup.orgId}/security${p}`).set(at(sup)).send(b as any);
    const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
    await clearOfStepEdge();
    await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
    await request(app).post('/api/ops/operators').set(boss.h).send({ email: sup.email, role: 'SUPPORT' }).expect(201);
    const st = (await request(app).post('/api/ops/step-up').set(bearer(sup)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token;
    const body = good();
    await submit(body).expect(201);
    const { id } = await platformPrisma.demoRequest.findFirstOrThrow({ where: { email: body.email } });
    await request(app).patch(`/api/ops/demo-requests/${id}`).set({ ...bearer(sup), 'x-step-up': st }).send({ status: 'DEMO_DONE' }).expect(200);
    expect((await request(app).post(`/api/ops/demo-requests/${id}/create-account`).set({ ...bearer(sup), 'x-step-up': st }).send({ state: 'Karnataka' }).expect(403)).body.code).toBe('OPERATOR_ROLE');
  }, 90_000);
});
