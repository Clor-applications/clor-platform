import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Start a free trial from clor.in (roadmap item 7): the email link, the
 * setup step, the account it makes through the one account-making path, the
 * trial's dates from the published plan, and what a trial that ended may do.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { withImplied, SIGNUP_LINK_HOURS } = await import('../routes/signup.js');
const { offerFrom, DEFAULT_TRIAL_DAYS } = await import('../services/trialPlan.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
  process.env.DISABLE_RATE_LIMIT = 'true';
});

const DAY = 86_400_000;
const rnd = () => Math.random().toString(36).slice(2, 8);
const freshEmail = () => `trial.${Date.now()}.${rnd()}@example.com`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = freshEmail();
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set(bearer(signup.body.token)).send({ companyName: `Own Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId };
}
async function operator() {
  const op = await company();
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op.token)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { op, h: { ...bearer(op.token), 'x-step-up': stepUp } };
}

/** A visitor's email, and the token from the link that was mailed. */
async function started(over: Record<string, unknown> = {}) {
  const email = String(over.email || freshEmail());
  const r = await request(app).post('/api/public/signup/start').send({ email, app: 'books', ...over }).expect(201);
  const row = await platformPrisma.trialSignup.findFirstOrThrow({ where: { email }, orderBy: { createdAt: 'desc' } });
  const mail = await platformPrisma.emailOutbox.findFirstOrThrow({ where: { templateKey: 'signup.confirm', relatedId: row.id }, orderBy: { createdAt: 'desc' } });
  /* The sent mail keeps no token (mailer.ts withoutLinkTokens); in a test run the server hands it back. */
  return { email, row, mail, token: String(r.body.devStartToken), body: r.body };
}

const setup = (token: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/public/signup/confirm')
    .send({ token, ownerName: 'Asha Rao', companyName: `Rao Textiles ${rnd()}`, apps: ['books'], state: 'Karnataka', ...over });

describe('the email step', () => {
  it('keeps a pending sign-up, mails a link to /start with a token that is only kept hashed, and says how long', async () => {
    const { row, mail, token, body } = await started();
    expect(body).toMatchObject({ ok: true, linkHours: SIGNUP_LINK_HOURS, trialDays: DEFAULT_TRIAL_DAYS });
    expect(row).toMatchObject({ status: 'PENDING', app: 'accounting', sendCount: 1 });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + (SIGNUP_LINK_HOURS - 1) * 3_600_000);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(row.tokenHash).not.toContain(token);
    expect(mail.bodyText).toMatch(/\/start\?t=/);
    if (mail.status === 'SENT') expect(mail.bodyText).not.toContain(token);
    expect(mail.subject).toContain('confirm your email');
    expect(mail.bodyText).toContain('Books');
    expect(mail.bodyText).toContain(`${DEFAULT_TRIAL_DAYS} days`);
    const logged = await platformPrisma.authEvent.findFirst({ where: { email: row.email, eventType: 'TRIAL_STARTED' } });
    expect(logged?.detail).toContain(row.id);
  });

  it('refuses a bad address, thanks a bot and keeps nothing, and turns away an email that already signs in', async () => {
    expect((await request(app).post('/api/public/signup/start').send({ email: 'not-an-email' }).expect(400)).body.error).toMatch(/email address like/);
    const bot = freshEmail();
    await request(app).post('/api/public/signup/start').send({ email: bot, website: 'http://spam.example' }).expect(202);
    expect(await platformPrisma.trialSignup.count({ where: { email: bot } })).toBe(0);
    const c = await company();
    const owner = await platformPrisma.user.findUniqueOrThrow({ where: { id: c.userId }, select: { email: true } });
    const r = await request(app).post('/api/public/signup/start').send({ email: owner.email!.toUpperCase() }).expect(409);
    expect(r.body.code).toBe('EMAIL_TAKEN');
    expect(await platformPrisma.trialSignup.count({ where: { email: owner.email!.toLowerCase() } })).toBe(0);
  }, 60_000);

  it('asking again replaces the link: one pending row per email, and the old link stops working', async () => {
    const a = await started();
    const b = await started({ email: a.email, app: 'people' });
    expect(b.row.id).toBe(a.row.id);
    expect(b.row).toMatchObject({ app: 'people', sendCount: 2 });
    await request(app).get('/api/public/signup/pending').query({ t: a.token }).expect(410);
    expect((await request(app).get('/api/public/signup/pending').query({ t: b.token }).expect(200)).body).toMatchObject({ email: a.email, app: 'people', trialDays: DEFAULT_TRIAL_DAYS });
  });

  it('limits one email address, then one address on the network', async () => {
    process.env.DISABLE_RATE_LIMIT = 'false';
    const email = freshEmail();
    for (let i = 0; i < 3; i++) await request(app).post('/api/public/signup/start').send({ email }).expect(201);
    expect((await request(app).post('/api/public/signup/start').send({ email }).expect(429)).body.error).toMatch(/Too many trial sign-ups/);
    let last = 201;
    for (let i = 0; i < 10 && last === 201; i++) last = (await request(app).post('/api/public/signup/start').send({ email: freshEmail() })).status;
    expect(last).toBe(429);
  });
});

describe('the link and the setup step', () => {
  it('answers the same for an unknown, a used and a run-out link', async () => {
    for (const t of ['', 'short', 'x'.repeat(43)]) {
      expect((await request(app).get('/api/public/signup/pending').query({ t }).expect(410)).body.code).toBe('LINK_ENDED');
      /* A token too short to be one is a bad form, not an ended link. */
      expect((await setup(t).expect(t.length >= 20 ? 410 : 400)).body.code).toBe(t.length >= 20 ? 'LINK_ENDED' : 'INVALID');
    }
    const late = await started();
    await platformPrisma.trialSignup.update({ where: { id: late.row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await setup(late.token).expect(410)).body.code).toBe('LINK_ENDED');
    expect((await platformPrisma.trialSignup.findUniqueOrThrow({ where: { id: late.row.id } })).status).toBe('EXPIRED');
    expect(await platformPrisma.user.count({ where: { email: late.email } })).toBe(0);
  });

  it('asks for the state only with Books, and for at least one app', async () => {
    const { token } = await started();
    expect((await setup(token, { apps: [] }).expect(400)).body.code).toBe('NO_APPS');
    expect((await setup(token, { apps: ['books'], state: '' }).expect(400)).body.code).toBe('STATE_REQUIRED');
    expect((await setup(token, { apps: ['books'], state: 'Narnia' }).expect(400)).body.code).toBe('STATE_REQUIRED');
    expect((await setup(token, { ownerName: 'A' }).expect(400)).body.error).toMatch(/your name/);
    /* Still pending: nothing above spent the link. */
    await request(app).get('/api/public/signup/pending').query({ t: token }).expect(200);
  });

  it('makes the account once through the one account-making path: owner, company, apps on a trial, set-password mail, signed in; the link then ends', async () => {
    const { email, token } = await started();
    const r = await setup(token, { apps: ['books', 'payroll'], state: 'Kerala' }).expect(201);
    expect(r.body.apps.sort()).toEqual(['accounting', 'payroll']);
    expect(r.body.app).toBe('accounting');
    expect(r.body.trialDays).toBe(DEFAULT_TRIAL_DAYS);
    expect(r.headers['set-cookie']?.join(';')).toMatch(/HttpOnly/i);

    /* Signed in at once, into the company just made. */
    const me = await request(app).get('/api/auth/me').set(bearer(r.body.token)).expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.orgs).toHaveLength(1);
    expect(me.body.orgs[0].org.id).toBe(r.body.activeOrgId);
    expect(me.body.accountRole).toBe('OWNER');

    const claims = jwt.decode(r.body.token) as { accountId: string; userId: string };
    const sub = await platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: claims.accountId }, include: { items: true } });
    expect(sub.status).toBe('trialing');
    expect(sub.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + (DEFAULT_TRIAL_DAYS - 1) * DAY);
    expect(sub.trialEndsAt!.getTime()).toBeLessThan(Date.now() + (DEFAULT_TRIAL_DAYS + 1) * DAY);
    expect(sub.items.map((i) => i.appCode).sort()).toEqual(['accounting', 'payroll']);
    expect(new Date(r.body.trialEndsAt).getTime()).toBe(sub.trialEndsAt!.getTime());

    const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: r.body.activeOrgId } });
    expect(JSON.parse(org.profileJson!)).toMatchObject({ requestedApp: 'accounting', state: 'Kerala', source: 'self-serve', trialDays: DEFAULT_TRIAL_DAYS });
    const branch = await platformPrisma.branch.findFirstOrThrow({ where: { orgId: org.id } });
    expect(branch.state).toBe('Kerala');
    const switches = await platformPrisma.featureSetting.findMany({ where: { orgId: org.id, key: { in: ['payroll', 'attendance', 'people'] } } });
    expect(switches.filter((s) => s.enabled).map((s) => s.key)).toEqual(['payroll']);

    /* The link proved the email; the same welcome mail an operator's Create account sends carries the set-password link. */
    const user = await platformPrisma.user.findUniqueOrThrow({ where: { id: claims.userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
    const welcome = await platformPrisma.emailOutbox.findMany({ where: { templateKey: 'account.welcome', toEmail: email } });
    expect(welcome).toHaveLength(1);
    expect(welcome[0].bodyText).toMatch(/\?reset=[^\s&]+&app=accounting/);
    expect(welcome[0].bodyText).toContain('Your trial runs until');
    expect(await platformPrisma.emailOutbox.count({ where: { templateKey: 'auth.verify_email', toEmail: email } })).toBe(0);

    const row = await platformPrisma.trialSignup.findFirstOrThrow({ where: { email } });
    expect(row).toMatchObject({ status: 'CONFIRMED', accountId: claims.accountId, ownerUserId: claims.userId, apps: ['accounting', 'payroll'], state: 'Kerala', trialDays: DEFAULT_TRIAL_DAYS });
    expect(row.companyName).toBe(org.name);

    /* The link is spent: a second confirm makes nothing. */
    expect((await setup(token).expect(410)).body.code).toBe('LINK_ENDED');
    expect(await platformPrisma.user.count({ where: { email } })).toBe(1);
  }, 60_000);

  it('People includes Attendance, and a company without Books needs no state', async () => {
    expect(withImplied(['people'])).toEqual(['people', 'attendance']);
    expect(withImplied(['attendance', 'payroll'])).toEqual(['attendance', 'payroll']);
    const { token } = await started({ app: 'people' });
    const r = await setup(token, { apps: ['people'], state: undefined }).expect(201);
    expect(r.body.apps.sort()).toEqual(['attendance', 'people']);
    expect(r.body.app).toBe('people');
    const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: r.body.activeOrgId } });
    const switches = await platformPrisma.featureSetting.findMany({ where: { orgId: org.id, key: { in: ['payroll', 'attendance', 'people'] } } });
    expect(switches.filter((s) => s.enabled).map((s) => s.key).sort()).toEqual(['attendance', 'people']);
  }, 60_000);

  it('turns away an email that came to sign in meanwhile, and leaves the link usable', async () => {
    const { email, token } = await started();
    await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Same person' }).expect(200);
    expect((await setup(token).expect(409)).body.code).toBe('EMAIL_TAKEN');
    const row = await platformPrisma.trialSignup.findFirstOrThrow({ where: { email } });
    expect(row).toMatchObject({ status: 'PENDING', provisioningAt: null, accountId: null });
  }, 60_000);
});

describe('the trial itself', () => {
  it('takes its length and apps from the published plans when there are any, the shortest among the plans that carry the apps', () => {
    const plans = [
      { code: 'books-starter', name: 'Books starter', apps: ['accounting'], trialDays: 30, showOnWebsite: true },
      { code: 'hr', name: 'HR', apps: ['people', 'attendance'], trialDays: 14, showOnWebsite: true },
      { code: 'payroll-only', name: 'Payroll', apps: ['payroll'], trialDays: 21, showOnWebsite: false },
      { code: 'projects', name: 'Projects', apps: ['projects'], trialDays: 60, showOnWebsite: true },
    ];
    /* Only plans on the site whose apps are sold are self-serve: Payroll is off the site, Projects is not sold yet. */
    expect(offerFrom(plans).apps.map((a) => a.code)).toEqual(['accounting', 'people', 'attendance']);
    expect(offerFrom(plans, ['books'])).toMatchObject({ trialDays: 30, planCode: 'books-starter', source: 'published' });
    expect(offerFrom(plans, ['people', 'attendance'])).toMatchObject({ trialDays: 14, planCode: 'hr' });
    expect(offerFrom(plans, ['accounting', 'people'])).toMatchObject({ trialDays: 14, planCode: null });
    expect(offerFrom(plans, ['accounting'], 'books-starter')).toMatchObject({ trialDays: 30, planCode: 'books-starter' });
    /* A ?plan= that does not carry the apps chosen is not taken at its word. */
    expect(offerFrom(plans, ['people'], 'books-starter')).toMatchObject({ trialDays: 14, planCode: 'hr' });
    /* No book published: the default, and it says so. */
    expect(offerFrom(null, ['books'])).toMatchObject({ trialDays: DEFAULT_TRIAL_DAYS, planCode: null, source: 'default' });
    expect(offerFrom(null).apps.map((a) => a.code)).toEqual(['accounting', 'people', 'attendance', 'payroll']);
  });

  it('sees only itself: its one company, and nothing of another account, even by id', async () => {
    const other = await company();
    const { token } = await started();
    const r = await setup(token).expect(201);
    const trial: Ctx = { token: r.body.token, orgId: r.body.activeOrgId, branchId: '', userId: '', accountId: '' };
    const branch = await platformPrisma.branch.findFirstOrThrow({ where: { orgId: trial.orgId } });
    trial.branchId = branch.id;

    const mine = await request(app).get('/api/auth/me').set(bearer(trial.token)).expect(200);
    expect(mine.body.orgs.map((m: any) => m.org.id)).toEqual([trial.orgId]);
    expect(mine.body.accounts.map((a: any) => a.id)).not.toContain(other.accountId);

    /* The other company's rows, asked for with the trial's own session and the other company's ids: refused, not found, never 2xx. */
    for (const path of [`/api/orgs/${other.orgId}/invoices`, `/api/orgs/${other.orgId}/customers`, `/api/orgs/${other.orgId}/branches`]) {
      const asOther = await request(app).get(path).set({ ...bearer(trial.token), 'x-org-id': other.orgId, 'x-branch-id': other.branchId });
      expect(asOther.status, path).toBeGreaterThanOrEqual(400);
      const mixed = await request(app).get(path).set(at(trial));
      expect(mixed.status, `${path} with own headers`).toBeGreaterThanOrEqual(400);
    }
    /* And its own books open. */
    await request(app).get(`/api/orgs/${trial.orgId}/customers`).set(at(trial)).expect(200);
  }, 90_000);

  it('blocks nothing until it ends; then the account reads, and every change is refused with the reason', async () => {
    const { token } = await started();
    const r = await setup(token).expect(201);
    const claims = jwt.decode(r.body.token) as { accountId: string };
    const branch = await platformPrisma.branch.findFirstOrThrow({ where: { orgId: r.body.activeOrgId } });
    const c: Ctx = { token: r.body.token, orgId: r.body.activeOrgId, branchId: branch.id, userId: '', accountId: claims.accountId };
    const party = () => request(app).post(`/api/orgs/${c.orgId}/customers`).set(at(c)).send({ name: `Customer ${rnd()}` });

    /* On trial: everything works. */
    const made = await party();
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    let billing = await request(app).get('/api/billing/subscription').set(at(c)).expect(200);
    expect(billing.body).toMatchObject({ status: 'trialing', inGoodStanding: true, reason: null });

    /* The trial ended yesterday. */
    await platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { trialEndsAt: new Date(Date.now() - DAY) } });
    const { clearAccessCache } = await import('../utils/accessCache.js');
    clearAccessCache();
    await request(app).get(`/api/orgs/${c.orgId}/customers`).set(at(c)).expect(200);
    const refused = await party().expect(402);
    expect(refused.body.code).toBe('SUBSCRIPTION_LAPSED');
    expect(refused.body.error).toMatch(/free trial ended on \d+ \w+ \d{4}\. Everything is still here to read/);
    billing = await request(app).get('/api/billing/subscription').set(at(c)).expect(200);
    expect(billing.body).toMatchObject({ status: 'trialing', inGoodStanding: false, entitledApps: [] });
    expect(billing.body.ownedApps).toContain('accounting');
    expect(billing.body.reason).toMatch(/free trial ended/);
  }, 90_000);
});

describe('Trials in the operator console', () => {
  it('lists sign-ups for operators only, newest first by status, with the offer; resend mails a new link and ends the old', async () => {
    const c = await company();
    const a = await started();
    const b = await started();
    await request(app).get('/api/ops/signups').expect(401);
    expect((await request(app).get('/api/ops/signups').set(bearer(c.token)).expect(403)).body.code).toBe('OPERATOR_ONLY');

    const { op, h } = await operator();
    const list = (await request(app).get('/api/ops/signups').query({ status: 'PENDING' }).set(bearer(op.token)).expect(200)).body;
    const emails = list.signups.map((s: any) => s.email);
    expect(emails.indexOf(b.email)).toBeLessThan(emails.indexOf(a.email));
    expect(list.counts.PENDING).toBeGreaterThanOrEqual(2);
    expect(list.offer).toMatchObject({ trialDays: DEFAULT_TRIAL_DAYS, source: 'default' });
    expect(list.signups.find((s: any) => s.email === a.email)).toMatchObject({ status: 'PENDING', app: 'accounting', sendCount: 1 });

    expect((await request(app).post(`/api/ops/signups/${a.row.id}/resend`).set(bearer(op.token)).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    const sent = (await request(app).post(`/api/ops/signups/${a.row.id}/resend`).set(h).expect(200)).body.signup;
    expect(sent.sendCount).toBe(2);
    await request(app).get('/api/public/signup/pending').query({ t: a.token }).expect(410);
    const mails = await platformPrisma.emailOutbox.findMany({ where: { templateKey: 'signup.confirm', relatedId: a.row.id } });
    expect(mails).toHaveLength(2);
    const audit = await platformPrisma.operatorAuditEvent.findFirst({ where: { action: 'TRIAL_LINK_RESENT' }, orderBy: { at: 'desc' } });
    expect((audit?.detail as any)?.trialSignupId).toBe(a.row.id);

    /* A confirmed one has nothing to send. */
    await setup(b.token).expect(201);
    expect((await request(app).post(`/api/ops/signups/${b.row.id}/resend`).set(h).expect(409)).body.code).toBe('CONFIRMED');
    const confirmed = (await request(app).get('/api/ops/signups').query({ status: 'CONFIRMED' }).set(bearer(op.token)).expect(200)).body.signups;
    expect(confirmed.find((s: any) => s.email === b.email)).toMatchObject({ status: 'CONFIRMED', apps: ['accounting'] });
  }, 120_000);
});
