import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Review of PR #142 (Workspace security). What the first pass left open:
 *  B1  the Attendance connector's directory sync made a SCIM token without #2's bounds;
 *  S1  a company step-up opened operator actions, around #9's lockout;
 *  S2  outside engagements (an accountant, an auditor) and the domain rule;
 *  S3  rules that shut out a company's administrators; owners exempt;
 *  S4  account administrators, not only owners, out of directory sync's reach;
 *  S5  another account's allowed domains showing through "add a person";
 *  N2  who chose a sign-on provider's role; N3 the session-days cap;
 *  N4  adding a company or a branch keeps the domain rule; N5 refresh re-checks entry.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string; verifyToken?: string };
const at = (c: Ctx, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...extra });
const mail = (label: string, domain = 'example.com') => `wsr.${label}.${Date.now()}.${rnd()}@${domain}`;

async function owner(label: string, domain = 'example.com'): Promise<Ctx> {
  const email = mail(label, domain);
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `WSR ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email, verifyToken: signup.body.devVerifyToken };
}
async function anotherCompany(o: Ctx): Promise<Ctx> {
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${o.token}`).send({ companyName: `WSR extra ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { ...o, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}
async function role(o: Ctx, permissions: string[]) {
  const r = await request(app).post(`/api/orgs/${o.orgId}/roles`).set(at(o)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions }).expect(201);
  return String(r.body.role?.id || r.body.id);
}
const adminRoleOf = async (o: Ctx) => ((await request(app).get(`/api/orgs/${o.orgId}/roles`).set(at(o)).expect(200)).body.roles as any[]).find((r) => r.roleType === 'ADMIN').id as string;
/** Someone the owner adds, with a role of these permissions (or the company's Administrator role). */
async function added(o: Ctx, permissions: string[] | 'ADMIN', email = mail('m')): Promise<Ctx> {
  const u = await request(app).post('/api/users').set(at(o)).send({ email, fullName: `Member ${rnd()}`, password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } }).expect(201);
  const id = String(u.body.user?.id || u.body.id);
  const roleId = permissions === 'ADMIN' ? await adminRoleOf(o) : permissions.length ? await role(o, permissions) : null;
  if (roleId) await request(app).post(`/api/orgs/${o.orgId}/users/${id}/roles`).set(at(o)).send({ roleId }).expect(201);
  return { ...o, token: '', userId: id, email };
}
const login = (email: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });
const signedIn = async (c: Ctx) => ({ ...c, token: (await login(c.email).expect(200)).body.token as string });
const opens = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/security/two-factor`).set(at(c));

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
const refreshWith = (res: request.Response) => request(app).post('/api/auth/refresh').set('Cookie', cookieOf(res).split(';')[0]);
const maxAgeOf = (res: request.Response) => Number(/Max-Age=(\d+)/.exec(cookieOf(res))?.[1] || 0);

async function authenticator(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: PASSWORD }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return secret as string;
}

const CONNECTOR_MAKER = ['ATTENDANCE::Attendance Integrations::VIEW', 'ATTENDANCE::Attendance Integrations::CREATE', 'ATTENDANCE::Attendance Integrations::EDIT', 'SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT'];
const PAYROLL_FULL = ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::APPROVE', 'PAYROLL::Employee Payroll Profile::VIEW'];
const LDAP = { url: 'ldaps://dc1.corp.local', bindDn: 'CN=svc-clor,OU=Service,DC=corp,DC=local', bindPassword: 'bindpw', baseDn: 'DC=corp,DC=local' };
const agents = (c: Ctx) => ({
  make: (defaultRoleId: string | null) => request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/agents`).set(at(c)).send({ name: `DC ${rnd()}`, ldap: { ...LDAP, defaultRoleId } }),
  change: (id: string, defaultRoleId: string | null, extra: Record<string, string> = {}) =>
    request(app).put(`/api/orgs/${c.orgId}/attendance/integrations/agents/${id}`).set(at(c, extra)).send({ name: 'DC sync', ldap: { ...LDAP, defaultRoleId } }),
  rotate: (id: string) => request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/agents/${id}/rotate`).set(at(c)).send({}),
});
const scimOfAgent = (agentId: string) =>
  outsideTenant('test: the connector’s directory-sync token', async () => {
    const { peoplePrisma } = await import('../utils/peoplePrisma.js');
    const a = await peoplePrisma.siteAgent.findUniqueOrThrow({ where: { id: agentId } });
    return platformPrisma.scimToken.findUniqueOrThrow({ where: { id: a.scimTokenId! } });
  });

describe('B1 the Attendance connector’s directory sync is bounded like a SCIM token', () => {
  it('refuses a wider role and another company’s, allows a held one, and answers to whoever set or rotated it', async () => {
    const o = await owner('conn');
    const other = await owner('conn-other');
    const maker = await signedIn(await added(o, CONNECTOR_MAKER));

    expect((await agents(maker).make(await role(o, PAYROLL_FULL)).expect(403)).body.code).toBe('cannot_grant_unheld');
    expect((await agents(maker).make(await role(other, ['SETTINGS::Users::VIEW'])).expect(400)).body.code).toBe('FOREIGN_ROLE');
    expect((await agents(maker).make(await adminRoleOf(o)).expect(400)).body.code).toBe('ADMIN_ROLE_AUTOMATIC');

    const made = await agents(maker).make(await role(o, ['SETTINGS::Users::VIEW'])).expect(201);
    const id = made.body.agent.id as string;
    expect((await scimOfAgent(id)).createdByUserId).toBe(maker.userId);

    /* The owner widens the role: provisioning is now checked against the owner. */
    await agents(o).change(id, await role(o, PAYROLL_FULL)).expect(200);
    expect((await scimOfAgent(id)).createdByUserId).toBe(o.userId);
    /* The narrower maker may neither change it nor rotate the connector, which would hand them the token with that role. */
    expect((await agents(maker).change(id, await role(o, PAYROLL_FULL)).expect(403)).body.code).toBe('cannot_grant_unheld');
    expect((await agents(maker).rotate(id).expect(403)).body.code).toBe('cannot_grant_unheld');
    await agents(o).rotate(id).expect(200);
    expect((await scimOfAgent(id)).createdByUserId).toBe(o.userId);

    /* With an authenticator, a change to directory sync takes a fresh code. */
    await authenticator(o);
    expect((await agents(o).change(id, null).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    expect((await agents(o).rotate(id).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
  }, 120_000);
});

describe('S1 an operator action takes only the operator console’s step-up', () => {
  it('refuses a company step-up token and accepts one from /ops/step-up', async () => {
    const op = await owner('s1');
    const secret = await authenticator(op);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    const company = (await request(app).post(`/api/orgs/${op.orgId}/security/step-up`).set(at(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token;
    const grant = (stepUp: string) => request(app).post('/api/billing/accounts/no-such-account/subscription').set({ Authorization: `Bearer ${op.token}`, 'x-step-up': stepUp }).send({ apps: [{ appCode: 'people' }] });
    expect((await grant(company).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    await clearOfStepEdge();
    const ops = (await request(app).post('/api/ops/step-up').set({ Authorization: `Bearer ${op.token}` }).send({ code: codeAt(secret, stepNow() + 1) }).expect(200)).body.token;
    await grant(ops).expect(404);
    /* And the other way round: the operator's token is no company step-up. */
    expect(jwt.decode(ops) as any).toMatchObject({ aud: 'clor-operator-step-up' });
  }, 90_000);
});

describe('S2 the domain rule does not apply to an outside engagement', () => {
  it('lets in an accountant from another firm at another domain, and still refuses the company’s own member there', async () => {
    const client = await owner('s2-client');
    const firm = await owner('s2-firm', 'firm.example');
    await setPolicy(client, { allowedEmailDomains: 'example.com' }).expect(200);
    await outsideTenant('test: the accountant confirmed their address', () => platformPrisma.user.update({ where: { id: firm.userId }, data: { emailVerifiedAt: new Date() } }));
    await request(app).post('/api/users').set(at(client)).send({ email: firm.email, fullName: 'Firm accountant', password: 'Irrelevant!23', orgIds: [client.orgId], branchIdsByOrg: { [client.orgId]: [client.branchId] } }).expect(201);
    const accountant = { ...client, token: (await login(firm.email).expect(200)).body.token, userId: firm.userId, email: firm.email };
    await opens(accountant).expect(200);

    const own = await request(app).post('/api/users').set(at(client)).send({ email: mail('own', 'firm.example'), fullName: 'Own', password: PASSWORD, orgIds: [client.orgId], branchIdsByOrg: { [client.orgId]: [client.branchId] } }).expect(400);
    expect(own.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  }, 90_000);
});

describe('S3 owners and administrators', () => {
  it('refuses rules that would shut out an administrator, naming them, and lets the saving administrator see their own reason', async () => {
    const o = await owner('s3a');
    await request(app).post('/api/auth/verify-email').send({ token: o.verifyToken }).expect(200);
    const admin = await added(o, 'ADMIN', mail('admin', 'partner.example'));
    const domain = await setPolicy(o, { allowedEmailDomains: 'example.com' }).expect(400);
    expect(domain.body.code).toBe('ADMINS_SHUT_OUT');
    expect(domain.body.error).toContain(admin.email);
    const confirmed = await setPolicy(o, { requireVerifiedEmail: true }).expect(400);
    expect(confirmed.body.code).toBe('ADMINS_SHUT_OUT');
    expect(confirmed.body.people.map((p: any) => p.email)).toEqual([admin.email]);
    /* An ordinary member is not protected: the rules may keep them out, and the screen is told. */
    await added(o, [], mail('plain', 'partner.example'));
    expect((await setPolicy(o, { allowedEmailDomains: 'example.com, partner.example' }).expect(200)).body.keptOut.outsideDomains).toBe(0);

    /* The administrator saving rules that shut themselves out is told it is them. */
    const me = await signedIn(admin);
    expect((await setPolicy(me, { allowedEmailDomains: 'example.com' }).expect(400)).body.code).toBe('OWN_DOMAIN_EXCLUDED');
    expect((await setPolicy(me, { requireVerifiedEmail: true }).expect(400)).body.code).toBe('OWN_EMAIL_NOT_CONFIRMED');
  }, 90_000);

  it('never shuts out an account owner: not on a request, not at sign-in, not at refresh', async () => {
    const o = await owner('s3b');
    /* The owner's own address is unconfirmed and outside the list: neither rule touches them. */
    const saved = await setPolicy(o, { requireVerifiedEmail: true, allowedEmailDomains: 'onlythis.in' }).expect(200);
    expect(saved.body.keptOut).toEqual({ unconfirmed: 0, outsideDomains: 0 });
    await opens(o).expect(200);
    const r = await login(o.email).expect(200);
    await refreshWith(r).expect(200);
  }, 60_000);
});

describe('S4 directory sync never touches an account administrator', () => {
  it('refuses to remove or switch off someone who administers the account, though no company', async () => {
    const o = await owner('s4');
    const accountAdmin = await added(o, []);
    await request(app).put(`/api/account/members/${accountAdmin.userId}/role`).set(at(o)).send({ role: 'ADMIN' }).expect(200);
    const plain = await added(o, []);
    const token = (await request(app).post(`/api/orgs/${o.orgId}/security/scim`).set(at(o)).expect(201)).body.token;
    const del = (id: string) => request(app).delete(`/scim/v2/Users/${id}`).set('Authorization', `Bearer ${token}`);
    expect((await del(accountAdmin.userId).expect(403)).body.scimType).toBe('mutability');
    await del(plain.userId).expect(204);
  }, 60_000);
});

describe('S5 adding a person never shows another account’s domain list', () => {
  it('reads only this account’s companies', async () => {
    const mine = await owner('s5');
    const theirs = await owner('s5-other');
    await setPolicy(theirs, { allowedEmailDomains: 'secretdomain.example' }).expect(200);
    const r = await request(app)
      .post('/api/users')
      .set(at(mine))
      .send({ email: mail('probe', 'nowhere.example'), fullName: 'Probe', password: PASSWORD, orgIds: [theirs.orgId], branchIdsByOrg: {} });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('secretdomain');
  }, 60_000);
});

describe('N2 a sign-on provider’s role answers to whoever chose it', () => {
  it('records the person who set the default role', async () => {
    const o = await owner('n2');
    const roleId = await role(o, ['SETTINGS::Users::VIEW']);
    const made = await request(app)
      .post(`/api/orgs/${o.orgId}/security/providers`)
      .set(at(o))
      .send({ kind: 'OIDC', name: `Okta ${rnd()}`, issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'secret', emailDomains: 'example.com', autoProvision: true, defaultRoleId: roleId, enabled: false });
    expect(made.status).toBe(201);
    const row = await outsideTenant('test', () => platformPrisma.authProvider.findUniqueOrThrow({ where: { id: made.body.provider.id } }));
    expect(row.defaultRoleSetByUserId).toBe(o.userId);
  }, 60_000);
});

describe('N3 a sign-in never outlasts its refresh token', () => {
  it('refuses more than 30 days, and reads a longer saved value as 30', async () => {
    const o = await owner('n3');
    await setPolicy(o, { sessionDays: 60 }).expect(400);
    await setPolicy(o, { sessionDays: 30 }).expect(200);
    await outsideTenant('test: a value saved before the cap', () => platformPrisma.authPolicy.update({ where: { orgId: o.orgId }, data: { sessionDays: 90 } }));
    expect((await request(app).get(`/api/orgs/${o.orgId}/security/policy`).set(at(o)).expect(200)).body.policy.sessionDays).toBe(30);
    expect(maxAgeOf(await login(o.email).expect(200))).toBeLessThanOrEqual(30 * 86_400);
  }, 60_000);
});

describe('N4 adding a company or a branch keeps the domain rule', () => {
  it('refuses adding someone at another domain to a company that does not allow it, either way', async () => {
    const o = await owner('n4');
    const second = await anotherCompany(o);
    await setPolicy(second, { allowedEmailDomains: 'example.com' }).expect(200);
    const m = await added(o, [], mail('far', 'far.example'));
    const companies = await request(app).put(`/api/users/${m.userId}/companies`).set(at(o)).send({ orgIds: [o.orgId, second.orgId] }).expect(400);
    expect(companies.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    const branches = await request(app).post(`/api/orgs/${second.orgId}/users/${m.userId}/branches`).set(at(second)).send({ branchIds: [second.branchId] }).expect(400);
    expect(branches.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    /* An allowed address goes through. */
    const near = await added(o, []);
    await request(app).put(`/api/users/${near.userId}/companies`).set(at(o)).send({ orgIds: [o.orgId, second.orgId] }).expect(200);
  }, 90_000);
});

describe('N5 a refresh asks again whether any company lets the person in', () => {
  it('refuses the refresh of someone every company now keeps out', async () => {
    const o = await owner('n5');
    const m = await added(o, [], mail('later', 'later.example'));
    const r = await login(m.email).expect(200);
    await setPolicy(o, { allowedEmailDomains: 'example.com' }).expect(200);
    const refused = await refreshWith(r).expect(403);
    expect(refused.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  }, 60_000);
});

/*
 * Review round 2:
 *  S-A  account administrators (active) are exempt from both entry rules, like owners; suspended ones are not;
 *  N-a  "shuts out an administrator" refuses only a save that tightens the rules;
 *  N-b  who those administrators are only for someone who may see the company's people;
 *  N-d  a role chosen for directory sync or sign-on is withheld once its chooser no longer holds it;
 *       an outsider is still held to the confirmed-email rule.
 */
const { companyEntryRefusal, signInEntry, whoRulesKeepOut } = await import('../services/signInRules.js');
const { clearAccessCache } = await import('../utils/accessCache.js');
const { SignedXml } = await import('xml-crypto');
const { execFileSync } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const accountRole = (o: Ctx, userId: string, r: 'ADMIN' | 'MEMBER') => request(app).put(`/api/account/members/${userId}/role`).set(at(o)).send({ role: r }).expect(200);
const membershipStatus = (accountId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED') =>
  outsideTenant('test: account membership status', () => platformPrisma.accountMembership.update({ where: { accountId_userId: { accountId, userId } }, data: { status } }));
/** Takes away every role the person holds in the company, as an administrator would. */
const stripRoles = async (c: Ctx, userId: string) => {
  await outsideTenant('test: roles taken away', () => platformPrisma.userRoleAssignment.deleteMany({ where: { orgId: c.orgId, userId } }));
  clearAccessCache();
};
const rolesOf = (orgId: string, email: string) =>
  outsideTenant('test: roles given on arrival', async () => {
    const u = await platformPrisma.user.findFirstOrThrow({ where: { email } });
    return (await platformPrisma.userRoleAssignment.findMany({ where: { orgId, userId: u.id }, select: { roleId: true } })).map((r) => r.roleId);
  });

describe('S-A an account administrator is exempt from the entry rules, like an owner', () => {
  it('opens the company, signs in and refreshes though unconfirmed and outside the domains, and is not counted as kept out', async () => {
    const o = await owner('sa');
    const accountAdmin = await added(o, [], mail('acctadmin', 'elsewhere.example'));
    await accountRole(o, accountAdmin.userId, 'ADMIN');
    const saved = await setPolicy(o, { requireVerifiedEmail: true, allowedEmailDomains: 'onlythis.in' }).expect(200);
    expect(saved.body.keptOut).toEqual({ unconfirmed: 0, outsideDomains: 0 });

    const r = await login(accountAdmin.email).expect(200);
    await opens({ ...accountAdmin, token: r.body.token }).expect(200);
    const refreshed = await refreshWith(r).expect(200);

    /* Back to an ordinary member: the rules now apply. */
    await accountRole(o, accountAdmin.userId, 'MEMBER');
    expect((await refreshWith(refreshed).expect(403)).body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  }, 90_000);

  it('does not exempt a suspended owner or a suspended account administrator', async () => {
    const o = await owner('sa-susp');
    const accountAdmin = await added(o, [], mail('acctadmin', 'elsewhere.example'));
    await accountRole(o, accountAdmin.userId, 'ADMIN');
    const rules = { requireVerifiedEmail: true, allowedEmailDomains: 'onlythis.in' };
    await setPolicy(o, rules).expect(200);
    expect(await companyEntryRefusal(o.userId, o.orgId, o.accountId)).toBeNull();
    expect(await companyEntryRefusal(accountAdmin.userId, o.orgId, o.accountId)).toBeNull();

    await membershipStatus(o.accountId, o.userId, 'SUSPENDED');
    await membershipStatus(o.accountId, accountAdmin.userId, 'SUSPENDED');
    expect((await companyEntryRefusal(o.userId, o.orgId, o.accountId))?.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect((await companyEntryRefusal(accountAdmin.userId, o.orgId, o.accountId))?.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect((await signInEntry(accountAdmin.userId, { email: accountAdmin.email, emailVerifiedAt: null })).refusal?.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    const kept = (await whoRulesKeepOut(o.accountId, o.orgId, rules)).map((k) => k.userId);
    expect(kept).toEqual(expect.arrayContaining([o.userId, accountAdmin.userId]));
  }, 90_000);
});

describe('N-a an administrator already kept out does not block an unrelated save', () => {
  it('saves a lockout change, and refuses only the administrators a tightening would newly shut out', async () => {
    const o = await owner('na');
    await request(app).post('/api/auth/verify-email').send({ token: o.verifyToken }).expect(200);
    const far = await added(o, 'ADMIN', mail('faradmin', 'partner.example'));
    await setPolicy(o, { allowedEmailDomains: 'example.com, partner.example' }).expect(200);
    /* The partner's domain comes off outside this save (an older one, a changed address): that admin is already kept out. */
    await outsideTenant('test: rules saved before', () => platformPrisma.authPolicy.update({ where: { orgId: o.orgId }, data: { allowedEmailDomains: 'example.com' } }));

    const unrelated = await setPolicy(o, { allowedEmailDomains: 'example.com', maxFailedLogins: 9 }).expect(200);
    expect(unrelated.body.keptOut.outsideDomains).toBe(1);

    /* Turning on confirmed email would newly shut out a second, unconfirmed administrator at an allowed domain. */
    const near = await added(o, 'ADMIN', mail('nearadmin'));
    const tightened = await setPolicy(o, { allowedEmailDomains: 'example.com', requireVerifiedEmail: true }).expect(400);
    expect(tightened.body.code).toBe('ADMINS_SHUT_OUT');
    expect(tightened.body.people.map((p: any) => p.email)).toEqual([near.email]);
    expect(tightened.body.error).not.toContain(far.email);
  }, 90_000);
});

describe('N-b who would be shut out is named only to someone who may see the company’s people', () => {
  it('gives a saver without Users view the count alone', async () => {
    const o = await owner('nb');
    await request(app).post('/api/auth/verify-email').send({ token: o.verifyToken }).expect(200);
    const admin = await added(o, 'ADMIN', mail('admin', 'partner.example'));
    const editor = await signedIn(await added(o, ['SETTINGS::Users::EDIT']));
    const r = await setPolicy(editor, { allowedEmailDomains: 'example.com' }).expect(400);
    expect(r.body.code).toBe('ADMINS_SHUT_OUT');
    expect(r.body.count).toBe(1);
    expect(r.body.people).toBeUndefined();
    expect(r.body.error).not.toContain(admin.email);
    /* The owner, who may see them, is told who. */
    expect((await setPolicy(o, { allowedEmailDomains: 'example.com' }).expect(400)).body.people.map((p: any) => p.email)).toEqual([admin.email]);
  }, 90_000);
});

describe('N-d a role chosen for automatic arrivals answers to its chooser at each arrival', () => {
  let dir = '';
  let keyPem = '';
  let certPem = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clor-wsr-saml-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-subj', '/CN=test-idp', '-days', '2'], { stdio: 'ignore' });
    keyPem = fs.readFileSync(path.join(dir, 'k.pem'), 'utf8');
    certPem = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  function signedResponse(o: { acs: string; audience: string; issuer: string; email: string }) {
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${rnd()}" Version="2.0" IssueInstant="${iso(0)}" Destination="${o.acs}">
  <saml:Issuer>${o.issuer}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="_a${rnd()}${rnd()}" Version="2.0" IssueInstant="${iso(0)}">
    <saml:Issuer>${o.issuer}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${o.email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(300_000)}" Recipient="${o.acs}"/></saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${o.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(0)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
  </saml:Assertion>
</samlp:Response>`;
    const sig = new SignedXml({ privateKey: keyPem, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } } as any);
    return Buffer.from(sig.getSignedXml()).toString('base64');
  }

  it('withholds the connector token’s role once the person who set it no longer holds it', async () => {
    const o = await owner('nd-conn');
    const maker = await signedIn(await added(o, CONNECTOR_MAKER));
    const roleId = await role(o, ['SETTINGS::Users::VIEW']);
    const made = await agents(maker).make(roleId).expect(201);
    const config = await request(app).get('/agent/v1/config').set('Authorization', `Bearer ${made.body.token}`).expect(200);
    const scim = config.body.once.scimToken as string;
    const arrive = (email: string) => request(app).post('/scim/v2/Users').set('Authorization', `Bearer ${scim}`).send({ userName: email, name: { givenName: 'Dir', familyName: 'Person' } }).expect(201);

    const first = mail('dir1');
    await arrive(first);
    expect(await rolesOf(o.orgId, first)).toEqual([roleId]);

    await stripRoles(o, maker.userId);
    const second = mail('dir2');
    await arrive(second);
    expect(await rolesOf(o.orgId, second)).toEqual([]);
  }, 90_000);

  it('withholds a sign-on provider’s role once the person who chose it no longer holds it', async () => {
    const domain = `wsr${rnd()}.example.com`;
    const o = await owner('nd-sso', domain);
    const setter = await signedIn(await added(o, ['SETTINGS::Users::VIEW', 'SETTINGS::Users::EDIT'], mail('setter', domain)));
    const roleId = await role(o, ['SETTINGS::Users::VIEW']);
    const issuer = 'https://idp.example.com/adfs/services/trust';
    const made = await request(app)
      .post(`/api/orgs/${o.orgId}/security/providers`)
      .set(at(setter))
      .send({ kind: 'SAML', name: `ADFS ${rnd()}`, entryPoint: 'https://idp.example.com/adfs/ls/', entityId: issuer, certificate: certPem, emailDomains: domain, autoProvision: true, defaultRoleId: roleId, enabled: true })
      .expect(201);
    const p = made.body.provider;
    const arrive = async (email: string) => {
      const r = await request(app).post(`/api/auth/sso/saml/${p.id}/acs`).type('form').send({ SAMLResponse: signedResponse({ acs: p.saml.acsUrl, audience: p.saml.spEntityId, issuer, email }) }).expect(302);
      expect(r.headers.location).toMatch(/sso=ok/);
    };

    const first = `first.${rnd()}@${domain}`;
    await arrive(first);
    expect(await rolesOf(o.orgId, first)).toEqual([roleId]);

    await stripRoles(o, setter.userId);
    const second = `second.${rnd()}@${domain}`;
    await arrive(second);
    expect(await rolesOf(o.orgId, second)).toEqual([]);
  }, 90_000);

  it('still refuses an outsider by the confirmed-email rule', async () => {
    const client = await owner('nd-out');
    await request(app).post('/api/auth/verify-email').send({ token: client.verifyToken }).expect(200);
    const firm = await owner('nd-firm', 'firm.example');
    await outsideTenant('test: the accountant confirmed their address', () => platformPrisma.user.update({ where: { id: firm.userId }, data: { emailVerifiedAt: new Date() } }));
    await request(app).post('/api/users').set(at(client)).send({ email: firm.email, fullName: 'Firm accountant', password: 'Irrelevant!23', orgIds: [client.orgId], branchIdsByOrg: { [client.orgId]: [client.branchId] } }).expect(201);
    const accountant = { ...client, token: (await login(firm.email).expect(200)).body.token, userId: firm.userId, email: firm.email };
    await setPolicy(client, { requireVerifiedEmail: true }).expect(200);
    await opens(accountant).expect(200);

    await outsideTenant('test: the address is no longer confirmed', () => platformPrisma.user.update({ where: { id: firm.userId }, data: { emailVerifiedAt: null } }));
    expect((await opens(accountant).expect(403)).body.code).toBe('EMAIL_NOT_CONFIRMED');
  }, 90_000);
});
