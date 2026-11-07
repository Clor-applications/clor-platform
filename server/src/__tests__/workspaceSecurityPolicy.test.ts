import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace audit 7 Nov 2026: the sign-in rules that were saved and ignored
 * (#4), the operator step-up with no limit (#9), API keys wider than their
 * maker (#10), exports with no audit row (#11), an authenticator added
 * without the password (#12), and an invitation that took "password1".
 */

/* Links leave only in emails; the test reads them on the way out. */
const sent: Array<{ key: string; to: string; url: string }> = [];
vi.mock('../services/mailer.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    sendTemplate: async (opts: any) => {
      sent.push({ key: opts.templateKey, to: opts.to, url: String(opts.data?.inviteUrl || opts.data?.verifyUrl || '') });
      return real.sendTemplate(opts);
    },
  };
});

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { envAccessMinutes } = await import('../services/policy.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string; verifyToken?: string };
const at = (c: Ctx, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...extra });
const mail = (label: string, domain = 'example.com') => `wsp.${label}.${Date.now()}.${rnd()}@${domain}`;

async function owner(label: string): Promise<Ctx> {
  const email = mail(label);
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `WSP ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email, verifyToken: signup.body.devVerifyToken };
}
const confirm = (c: Ctx) => request(app).post('/api/auth/verify-email').send({ token: c.verifyToken }).expect(200);
async function role(o: Ctx, permissions: string[]) {
  const r = await request(app).post(`/api/orgs/${o.orgId}/roles`).set(at(o)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions }).expect(201);
  return String(r.body.role?.id || r.body.id);
}
/** Someone the owner adds (their address not confirmed: an administrator typed it). */
async function added(o: Ctx, permissions: string[], email = mail('m')): Promise<Ctx> {
  const u = await request(app).post('/api/users').set(at(o)).send({ email, fullName: 'Member', password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(201);
  const id = String(u.body.user?.id || u.body.id);
  if (permissions.length) await request(app).post(`/api/orgs/${o.orgId}/users/${id}/roles`).set(at(o)).send({ roleId: await role(o, permissions) }).expect(201);
  return { ...o, token: '', userId: id, email };
}
const login = (email: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });
const signedIn = async (c: Ctx) => ({ ...c, token: (await login(c.email).expect(200)).body.token as string });

const POLICY = {
  maxFailedLogins: 8,
  lockoutMinutes: 15,
  sessionDays: 30,
  accessTokenMinutes: 15,
  passwordMinLength: 8,
  passwordRequireMixedCase: false,
  passwordRequireNumber: false,
  passwordRequireSymbol: false,
  requireVerifiedEmail: false,
  allowedEmailDomains: null as string | null,
};
const setPolicy = (o: Ctx, patch: Partial<typeof POLICY>) => request(app).put(`/api/orgs/${o.orgId}/security/policy`).set(at(o)).send({ ...POLICY, ...patch });

const cookieOf = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[] | undefined) || []).find((c) => c.startsWith('neev_rt=')) || '';
const maxAgeOf = (res: request.Response) => Number(/Max-Age=(\d+)/.exec(cookieOf(res))?.[1] || 0);
const ttlOf = (token: string) => {
  const c = jwt.decode(token) as any;
  return c.exp - c.iat;
};

describe('#4 how long a sign-in lasts', () => {
  it('follows "Stay signed in for" and the access-token lifetime, and a refresh never lengthens it', async () => {
    const o = await owner('days');
    await setPolicy(o, { sessionDays: 1, accessTokenMinutes: 5 }).expect(200);
    const r = await login(o.email).expect(200);
    expect(maxAgeOf(r)).toBeGreaterThan(86_400 - 60);
    expect(maxAgeOf(r)).toBeLessThanOrEqual(86_400);
    expect(ttlOf(r.body.token)).toBe(300);
    expect(r.body.expiresIn).toBe('5m');
    const session = await outsideTenant('test', () => platformPrisma.session.findFirst({ where: { userId: o.userId, revokedAt: null }, orderBy: { createdAt: 'desc' } }));
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);

    /* A refresh keeps the end the sign-in was given, and the new access token the company's lifetime. */
    const raw = decodeURIComponent(cookieOf(r).split(';')[0].split('=').slice(1).join('='));
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', `neev_rt=${encodeURIComponent(raw)}`).expect(200);
    expect(ttlOf(refreshed.body.token)).toBe(300);
    const next = await outsideTenant('test', () => platformPrisma.session.findFirst({ where: { userId: o.userId, revokedAt: null }, orderBy: { createdAt: 'desc' } }));
    expect(next!.expiresAt.getTime()).toBeLessThanOrEqual(session!.expiresAt.getTime());
    expect(maxAgeOf(refreshed)).toBeLessThanOrEqual(86_400);
  }, 60_000);

  it('shortening the rule reaches a session already open, at its next refresh', async () => {
    const o = await owner('shorten');
    const r = await login(o.email).expect(200);
    expect(maxAgeOf(r)).toBeGreaterThan(29 * 86_400);
    await setPolicy(o, { sessionDays: 2 }).expect(200);
    const raw = decodeURIComponent(cookieOf(r).split(';')[0].split('=').slice(1).join('='));
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', `neev_rt=${encodeURIComponent(raw)}`).expect(200);
    expect(maxAgeOf(refreshed)).toBeLessThanOrEqual(2 * 86_400);
  }, 60_000);

  it('leaves another company’s people on the defaults', async () => {
    const strict = await owner('strict');
    await setPolicy(strict, { sessionDays: 1, accessTokenMinutes: 5 }).expect(200);
    const other = await owner('relaxed');
    const r = await login(other.email).expect(200);
    expect(maxAgeOf(r)).toBeGreaterThan(29 * 86_400);
    expect(ttlOf(r.body.token)).toBe(envAccessMinutes() * 60);
  }, 60_000);
});

describe('#4 a confirmed email address', () => {
  it('cannot be required by someone who has not confirmed their own', async () => {
    const o = await owner('own-unconfirmed');
    expect((await setPolicy(o, { requireVerifiedEmail: true }).expect(400)).body.code).toBe('OWN_EMAIL_NOT_CONFIRMED');
  }, 60_000);

  it('refuses an unconfirmed address with a plain message and a way to get a new link, then lets them in', async () => {
    const o = await owner('confirm');
    await confirm(o);
    const m = await added(o, []);
    const saved = await setPolicy(o, { requireVerifiedEmail: true }).expect(200);
    expect(saved.body.keptOut.unconfirmed).toBe(1);

    const refused = await login(m.email).expect(403);
    expect(refused.body.code).toBe('EMAIL_NOT_CONFIRMED');
    expect(refused.body.error).toMatch(/confirm their email/);
    expect(refused.body.resendChallenge).toBeTruthy();
    expect(cookieOf(refused)).toBe('');
    /* A wrong password is still just a wrong password: nothing says the address exists. */
    expect((await login(m.email, 'not-it-at-all').expect(401)).body.resendChallenge).toBeUndefined();

    await request(app).post('/api/auth/resend-verification/sign-in').send({ challenge: 'nonsense' }).expect(400);
    const resent = await request(app).post('/api/auth/resend-verification/sign-in').send({ challenge: refused.body.resendChallenge }).expect(200);
    expect(sent.some((s) => s.key === 'auth.verify_email' && s.to === m.email)).toBe(true);
    await request(app).post('/api/auth/verify-email').send({ token: resent.body.devVerifyToken }).expect(200);
    await login(m.email).expect(200);
  }, 60_000);

  it('closes the company to a person signed in before the rule, without closing their sign-in elsewhere', async () => {
    const o = await owner('confirm-live');
    await confirm(o);
    const m = await signedIn(await added(o, ['SETTINGS::Users::VIEW']));
    await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(m)).expect(200);
    await setPolicy(o, { requireVerifiedEmail: true }).expect(200);
    expect((await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(m)).expect(403)).body.code).toBe('EMAIL_NOT_CONFIRMED');
    /* The owner, confirmed, carries on. */
    await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(o)).expect(200);
  }, 60_000);
});

describe('#4 allowed email domains', () => {
  it('cannot shut out the person saving it', async () => {
    const o = await owner('own-domain');
    expect((await setPolicy(o, { allowedEmailDomains: 'onlythis.in' }).expect(400)).body.code).toBe('OWN_DOMAIN_EXCLUDED');
    await setPolicy(o, { allowedEmailDomains: 'example.com, onlythis.in' }).expect(200);
  }, 60_000);

  it('refuses invitations, added users and directory sync at other domains, and allowed ones go through', async () => {
    const o = await owner('domains');
    await setPolicy(o, { allowedEmailDomains: 'example.com' }).expect(200);
    const outside = mail('out', 'gmail.example');

    const inv = await request(app).post('/api/account/invitations').set(at(o)).send({ email: outside, accountRole: 'MEMBER', grants: [{ orgId: o.orgId }] }).expect(400);
    expect(inv.body.error).toMatch(/example\.com/);
    await request(app).post('/api/account/invitations').set(at(o)).send({ email: mail('in'), accountRole: 'MEMBER', grants: [{ orgId: o.orgId }] }).expect(201);

    expect((await request(app).post('/api/users').set(at(o)).send({ email: outside, fullName: 'Out', password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(400)).body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');

    const scimToken = (await request(app).post(`/api/orgs/${o.orgId}/security/scim`).set(at(o)).expect(201)).body.token;
    const scim = (userName: string) => request(app).post('/scim/v2/Users').set('Authorization', `Bearer ${scimToken}`).set('Content-Type', 'application/scim+json').send(JSON.stringify({ userName, name: { givenName: 'X' } }));
    await scim(outside).expect(400);
    await scim(mail('scim-in')).expect(201);
  }, 90_000);

  it('closes the company to a member at another domain, and refuses their sign-in when it was their only company', async () => {
    const o = await owner('domain-member');
    const m = await signedIn(await added(o, ['SETTINGS::Users::VIEW'], mail('elsewhere', 'other.example')));
    const saved = await setPolicy(o, { allowedEmailDomains: 'example.com' }).expect(200);
    expect(saved.body.keptOut.outsideDomains).toBe(1);
    /* The saved rules come back in the shape the screen loaded, so it does not go on saying "Unsaved changes". */
    expect(saved.body.policy).toEqual((await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(o)).expect(200)).body.policy);
    expect((await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(m)).expect(403)).body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    const refused = await login(m.email).expect(403);
    expect(refused.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(refused.body.resendChallenge).toBeUndefined();
  }, 60_000);
});

describe('invitation acceptance uses the sign-up password rule', () => {
  it('refuses a common password and the company’s own rules, and accepts a good one', async () => {
    const o = await owner('inv-pass');
    await setPolicy(o, { passwordMinLength: 12 }).expect(200);
    const email = mail('joiner');
    await request(app).post('/api/account/invitations').set(at(o)).send({ email, accountRole: 'MEMBER', grants: [{ orgId: o.orgId }] }).expect(201);
    const hit = [...sent].reverse().find((s) => s.key === 'account.invited' && s.to === email)!;
    const token = new URL(hit.url).searchParams.get('token') || '';
    const accept = (password: string) => request(app).post('/api/invitations/accept').send({ token, fullName: 'New Person', password });

    expect((await accept('password1').expect(400)).body.code).toBe('WEAK_PASSWORD');
    expect((await accept('Short!2026').expect(400)).body.error).toMatch(/at least 12/);
    await accept('A-much-longer-Passw0rd').expect(200);
    await login(email, 'A-much-longer-Passw0rd').expect(200);
  }, 60_000);
});

describe('#12 setting up an authenticator takes the password', () => {
  it('refuses without it or with a wrong one', async () => {
    const o = await owner('2fa');
    const setup = (b: unknown) => request(app).post(`/api/orgs/${o.orgId}/security/two-factor/setup`).set(at(o)).send(b as any);
    expect((await setup({}).expect(400)).body.code).toBe('BAD_PASSWORD');
    expect((await setup({ password: 'wrong' }).expect(400)).body.code).toBe('BAD_PASSWORD');
    expect((await platformPrisma.user.findUnique({ where: { id: o.userId } }))?.totpSecretEnc).toBeNull();
    expect((await setup({ password: PASSWORD }).expect(200)).body.secret).toBeTruthy();
  }, 60_000);
});

describe('#9 operator step-up', () => {
  it('stops taking codes after five wrong ones, even a right one, and records it', async () => {
    const op = await owner('op');
    const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
    const { secret } = (await sec('/two-factor/setup', { password: PASSWORD }).expect(200)).body;
    await clearOfStepEdge();
    await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    const stepUp = (code: string) => request(app).post('/api/ops/step-up').set({ Authorization: `Bearer ${op.token}` }).send({ code });
    for (let i = 0; i < 5; i += 1) expect((await stepUp('000000').expect(400)).body.code).toBe('BAD_CODE');
    expect((await stepUp(codeAt(secret, stepNow())).expect(429)).body.code).toBe('STEP_UP_LOCKED');
    expect(await platformPrisma.operatorAuditEvent.count({ where: { operatorUserId: op.userId, action: 'STEP_UP_LOCKED' } })).toBe(1);
    expect(await platformPrisma.authEvent.count({ where: { userId: op.userId, eventType: 'OPERATOR_STEP_UP_LOCKED' } })).toBe(1);

    /* Another operator is not affected. */
    const op2 = await owner('op2');
    const sec2 = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op2.orgId}/security${p}`).set(at(op2)).send(b as any);
    const s2 = (await sec2('/two-factor/setup', { password: PASSWORD }).expect(200)).body.secret;
    await clearOfStepEdge();
    await sec2('/two-factor/enable', { code: codeAt(s2, stepNow() - 1) }).expect(200);
    process.env.CLOR_OPERATOR_USER_IDS = `${op.userId},${op2.userId}`;
    await request(app).post('/api/ops/step-up').set({ Authorization: `Bearer ${op2.token}` }).send({ code: codeAt(s2, stepNow()) }).expect(200);
  }, 120_000);
});

describe('#10 API key scopes', () => {
  it('are bounded by what the maker holds, on make and on rotate, in Workspace and in Attendance', async () => {
    const o = await owner('keys');
    const maker = await signedIn(await added(o, ['SETTINGS::Credentials::VIEW', 'SETTINGS::Credentials::CREATE', 'SETTINGS::Credentials::EDIT', 'ATTENDANCE::Attendance Records::VIEW']));
    const make = (c: Ctx, scopes: string[]) => request(app).post(`/api/orgs/${o.orgId}/credentials/api-keys`).set(at(c)).send({ name: `Key ${rnd()}`, scopes });

    const refused = await make(maker, ['employees:write']).expect(403);
    expect(refused.body.code).toBe('cannot_grant_unheld');
    expect(refused.body.permissions).toEqual(expect.arrayContaining(['PEOPLE::Employees::CREATE', 'PEOPLE::Employees::EDIT']));
    await make(maker, ['attendance:read', 'leave:approve']).expect(403);
    await make(maker, ['attendance:read']).expect(201);

    /* The owner's wide key cannot be rotated by the narrower maker, who would walk off with its token. */
    const wide = await make(o, ['employees:write']).expect(201);
    expect((await request(app).post(`/api/orgs/${o.orgId}/credentials/${wide.body.credentialId}/rotate`).set(at(maker)).send({}).expect(403)).body.code).toBe('cannot_grant_unheld');
    await request(app).post(`/api/orgs/${o.orgId}/credentials/${wide.body.credentialId}/rotate`).set(at(o)).send({}).expect(200);

    /* Attendance → Integrations makes the same keys, under the same rule. */
    const att = await signedIn(await added(o, ['ATTENDANCE::Attendance Integrations::VIEW', 'ATTENDANCE::Attendance Integrations::CREATE', 'ATTENDANCE::Attendance Records::VIEW']));
    const attMake = (scopes: string[]) => request(app).post(`/api/orgs/${o.orgId}/attendance/integrations/keys`).set(at(att)).send({ name: `Att ${rnd()}`, scopes });
    expect((await attMake(['leave:approve']).expect(403)).body.code).toBe('cannot_grant_unheld');
    await attMake(['attendance:read']).expect(201);
  }, 120_000);
});

describe('#11 every export is audited', () => {
  it('writes a row for a data-only and a configuration-only export, with what was taken, and only in that company', async () => {
    const o = await owner('export');
    const other = await owner('export-other');
    const rows = (c: Ctx) => outsideTenant('test', () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'Company', action: { in: ['EXPORT', 'EXPORT_ALL'] } }, orderBy: { createdAt: 'asc' } }));

    await request(app).get(`/api/orgs/${o.orgId}/export?scope=data`).set(at(o)).expect(200);
    await request(app).get(`/api/orgs/${o.orgId}/export?scope=configuration`).set(at(o)).expect(200);
    await request(app).get(`/api/orgs/${o.orgId}/export`).set(at(o)).expect(200);
    const mine = await rows(o);
    expect(mine.map((r) => r.action)).toEqual(['EXPORT', 'EXPORT', 'EXPORT_ALL']);
    const meta = (r: { metadata: unknown }) => JSON.parse(String(r.metadata || '{}'));
    expect(meta(mine[0]).scope).toBe('data');
    expect(meta(mine[1]).scope).toBe('configuration');
    expect(typeof meta(mine[0]).counts).toBe('object');
    expect(mine.every((r) => r.createdByUserId === o.userId)).toBe(true);
    expect(await rows(other)).toHaveLength(0);
  }, 60_000);
});
