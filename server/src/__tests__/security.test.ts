import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `sec.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Sec owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Sec Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('security policy', () => {
  it('returns defaults before anything is configured', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/security/policy`).set(auth(owner)).expect(200);
    expect(res.body.policy.maxFailedLogins).toBeGreaterThan(0);
    expect(res.body.passwordRules[0]).toMatch(/at least/);
  });

  it('stores a policy and applies it to lockout', async () => {
    const org = await makeOwner();
    await request(app)
      .put(`/api/orgs/${org.orgId}/security/policy`)
      .set(auth(org))
      .send({
        maxFailedLogins: 3,
        lockoutMinutes: 20,
        sessionDays: 7,
        accessTokenMinutes: 10,
        passwordMinLength: 10,
        passwordRequireMixedCase: true,
        passwordRequireNumber: true,
        passwordRequireSymbol: false,
        requireVerifiedEmail: false,
        allowedEmailDomains: null,
      })
      .expect(200);

    // Three wrong attempts is now enough, rather than the default eight.
    let locked = null as any;
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ emailOrUsername: org.email, password: 'wrong' });
      if (r.status === 429) {
        locked = r;
        break;
      }
    }
    expect(locked).toBeTruthy();
    expect(String(locked.body.error)).toMatch(/20 minute/);
  });

  it('enforces password rules on change', async () => {
    const org = await makeOwner();
    await request(app)
      .put(`/api/orgs/${org.orgId}/security/policy`)
      .set(auth(org))
      .send({
        maxFailedLogins: 8,
        lockoutMinutes: 15,
        sessionDays: 30,
        accessTokenMinutes: 15,
        passwordMinLength: 12,
        passwordRequireMixedCase: true,
        passwordRequireNumber: true,
        passwordRequireSymbol: true,
        requireVerifiedEmail: false,
        allowedEmailDomains: null,
      })
      .expect(200);

    const weak = await request(app)
      .post(`/api/orgs/${org.orgId}/security/change-password`)
      .set(auth(org))
      .send({ currentPassword: 'Passw0rd!23', newPassword: 'alllowercase' })
      .expect(400);
    expect(String(weak.body.error)).toMatch(/12 characters|upper and lower|number|symbol/i);

    await request(app)
      .post(`/api/orgs/${org.orgId}/security/change-password`)
      .set(auth(org))
      .send({ currentPassword: 'Passw0rd!23', newPassword: 'Str0ng&Passphrase' })
      .expect(200);

    // The new password works and every session was ended.
    await request(app)
      .post('/api/auth/login')
      .send({ emailOrUsername: org.email, password: 'Str0ng&Passphrase' })
      .expect(200);
  });

  it('keeps the device that changed the password signed in, and signs out the others', async () => {
    const email = `sec.keep.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Keep me' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `Keep Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    /* Two devices: each sign-in is its own session with its own refresh cookie. */
    const signIn = () =>
      request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    const here = await signIn();
    const elsewhere = await signIn();
    const cookieOf = (r: any) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    const ctx = { token: here.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };

    await request(app)
      .post(`/api/orgs/${ctx.orgId}/security/change-password`)
      .set(auth(ctx))
      .send({ currentPassword: 'Passw0rd!23', newPassword: 'N3w!Passphrase' })
      .expect(200);

    await request(app).post('/api/auth/refresh').set('Cookie', cookieOf(here)).expect(200);
    await request(app).post('/api/auth/refresh').set('Cookie', cookieOf(elsewhere)).expect(401);
  });

  it('refuses a wrong current password', async () => {
    const org = await makeOwner();
    await request(app)
      .post(`/api/orgs/${org.orgId}/security/change-password`)
      .set(auth(org))
      .send({ currentPassword: 'not-it', newPassword: 'Another!2345' })
      .expect(400);
  });
});

describe('sign-in methods', () => {
  it('always reports local sign-in as active', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/security/providers`).set(auth(owner)).expect(200);
    expect(res.body.local.kind).toBe('LOCAL');
    expect(res.body.local.enabled).toBe(true);
  });

  it('stores an OIDC provider with its secret encrypted and never returned', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/security/providers`)
      .set(auth(owner))
      .send({
        kind: 'OIDC',
        name: `Microsoft ${rnd()}`,
        discoveryUrl: 'https://login.microsoftonline.com/x/v2.0/.well-known/openid-configuration',
        clientId: 'abc-123',
        clientSecret: 'the-actual-secret',
        emailDomains: 'yourcompany.com',
      })
      .expect(201);

    expect(res.body.provider.hasClientSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('the-actual-secret');
    // OIDC can sign people in now; this one is still switched off.
    expect(res.body.provider.status).toBe('DISABLED');

    const stored = await platformPrisma.authProvider.findUnique({ where: { id: res.body.provider.id } });
    expect(stored?.clientSecretEnc).toBeTruthy();
    expect(stored?.clientSecretEnc).not.toContain('the-actual-secret');
  });

  it('rejects an incomplete configuration', async () => {
    const missingSecret = await request(app)
      .post(`/api/orgs/${owner.orgId}/security/providers`)
      .set(auth(owner))
      .send({ kind: 'OIDC', name: `Broken ${rnd()}`, issuer: 'https://issuer', clientId: 'x' })
      .expect(400);
    expect(String(missingSecret.body.error)).toMatch(/client secret/i);

    const missingCert = await request(app)
      .post(`/api/orgs/${owner.orgId}/security/providers`)
      .set(auth(owner))
      .send({ kind: 'SAML', name: `BrokenSaml ${rnd()}`, entryPoint: 'https://idp', entityId: 'urn:x' })
      .expect(400);
    expect(String(missingCert.body.error)).toMatch(/certificate/i);
  });

  it('keeps the stored secret when editing other fields', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/security/providers`)
      .set(auth(owner))
      .send({
        kind: 'OIDC',
        name: `Keep ${rnd()}`,
        issuer: 'https://issuer',
        clientId: 'x',
        clientSecret: 'keep-me',
      })
      .expect(201);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/security/providers/${created.body.provider.id}`)
      .set(auth(owner))
      .send({ kind: 'OIDC', name: `Renamed ${rnd()}`, issuer: 'https://issuer', clientId: 'x' })
      .expect(200);

    const stored = await platformPrisma.authProvider.findUnique({ where: { id: created.body.provider.id } });
    expect(stored?.clientSecretEnc).toBeTruthy();
  });

  it('needs user administration rights to configure', async () => {
    const roleRes = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `NoAdmin ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${roleRes.body.role.id}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW'] })
      .expect(200);

    const email = `plain.${Date.now()}.${rnd()}@example.com`;
    const created = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({
        email,
        fullName: 'Plain',
        password: 'Passw0rd!23',
        orgIds: [owner.orgId],
        branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
      })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${created.body.user.id}/roles`)
      .set(auth(owner))
      .send({ roleId: roleRes.body.role.id, branchId: null })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrUsername: email, password: 'Passw0rd!23' })
      .expect(200);
    const member = { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId, email };

    await request(app).get(`/api/orgs/${owner.orgId}/security/providers`).set(auth(member)).expect(403);
    // But a user can always manage their own account.
    await request(app).get(`/api/orgs/${owner.orgId}/security/my-sessions`).set(auth(member)).expect(200);
  });
});

describe('activity log', () => {
  it('records policy changes and sign-in events', async () => {
    const org = await makeOwner();
    await request(app).post('/api/auth/login').send({ emailOrUsername: org.email, password: 'wrong' }).expect(401);

    const res = await request(app).get(`/api/orgs/${org.orgId}/security/events`).set(auth(org)).expect(200);
    const types = res.body.events.map((e: any) => e.eventType);
    expect(types).toContain('LOGIN_FAILED');
    expect(res.body.events[0]).toHaveProperty('ip');
  });
});

describe('warehouse header does not break unrelated requests', () => {
  it('ignores a warehouse the caller cannot use, instead of refusing the request', async () => {
    const org = await makeOwner();

    // A ledger read carrying a warehouse header the user has no access to.
    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/ledger/trial-balance`)
      .set({ ...auth(org), 'x-warehouse-id': 'some-warehouse-they-cannot-use' })
      .expect(200);

    expect(res.body.totals).toBeTruthy();
  });

  it('still refuses a stock movement into a warehouse the caller cannot use', async () => {
    const org = await makeOwner();

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/adjustments`)
      .set({ ...auth(org), 'x-warehouse-id': 'some-warehouse-they-cannot-use' })
      .send({ itemId: 'x', qtyDelta: 1, reason: 'test' });

    // Either the permission or the warehouse check refuses it; what matters is
    // that it is not allowed through.
    expect([400, 403]).toContain(res.status);
  });
});

/**
 * A pretend identity provider on localhost: discovery, keys, an authorise
 * endpoint that bounces straight back with a code, a token endpoint that
 * mints an ID token for whichever e-mail the test asked for. Enough to walk
 * the whole OpenID Connect flow without the internet.
 */
async function fakeIssuer(email: string, name: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  let base = '';
  let lastNonce = '';
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', base);
    const json = (b: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`, response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'] });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/authorize') {
      lastNonce = url.searchParams.get('nonce') || '';
      const back = new URL(url.searchParams.get('redirect_uri') || '');
      back.searchParams.set('code', 'the-code');
      back.searchParams.set('state', url.searchParams.get('state') || '');
      res.statusCode = 302; res.setHeader('location', back.href); return res.end();
    }
    if (url.pathname === '/token') {
      const idToken = await new SignJWT({ email, email_verified: true, name, nonce: lastNonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(base).setAudience('clor-client').setSubject('sub-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return json({ access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('signing in with OpenID Connect', () => {
  it('offers the provider for its domain, walks the code flow, and makes the person a member', async () => {
    const domain = `sso-${rnd()}.example`;
    const issuer = await fakeIssuer(`asha@${domain}`, 'Asha Rao');
    try {
      const created = await request(app)
        .post(`/api/orgs/${owner.orgId}/security/providers`)
        .set(auth(owner))
        .send({ kind: 'OIDC', name: `Okta ${rnd()}`, discoveryUrl: `${issuer.base}/.well-known/openid-configuration`, clientId: 'clor-client', clientSecret: 's3cret', emailDomains: domain, autoProvision: true, enabled: true })
        .expect(201);
      expect(created.body.provider.status).toBe('ACTIVE');
      const pid = created.body.provider.id;

      expect((await request(app).get(`/api/auth/sso/lookup?email=asha@${domain}`).expect(200)).body.providers.map((p: any) => p.id)).toEqual([pid]);
      expect((await request(app).get('/api/auth/sso/lookup?email=asha@elsewhere.example').expect(200)).body.providers).toEqual([]);

      const start = await request(app).get(`/api/auth/sso/${pid}/start?return=/attendance`).expect(302);
      const to = new URL(start.headers.location);
      expect(to.origin).toBe(issuer.base);
      expect(to.searchParams.get('code_challenge_method')).toBe('S256');
      expect(to.searchParams.get('redirect_uri')).toContain('/api/auth/sso/callback');
      const cookie = String(start.headers['set-cookie']).split(';')[0];

      /* The provider bounces back with a code and the state it was given. */
      const bounced = await fetch(to.href, { redirect: 'manual' });
      const back = new URL(bounced.headers.get('location') || '');
      const done = await request(app).get(`/api/auth/sso/callback?${back.searchParams.toString()}`).set('Cookie', cookie).expect(302);
      expect(done.headers.location).toMatch(/\/attendance\?sso=ok$/);
      expect(String(done.headers['set-cookie'])).toMatch(/neev_rt=/);

      const user = await platformPrisma.user.findFirst({ where: { email: `asha@${domain}` } });
      expect(user?.fullName).toBe('Asha Rao');
      expect(await platformPrisma.userOrgMembership.findFirst({ where: { userId: user!.id, orgId: owner.orgId } })).toBeTruthy();

      /* Replaying the callback without a fresh start is refused. */
      const replay = await request(app).get(`/api/auth/sso/callback?${back.searchParams.toString()}`).expect(302);
      expect(replay.headers.location).toMatch(/sso_error=/);

      /* With provisioning off, a stranger is turned away by name. */
      await request(app).patch(`/api/orgs/${owner.orgId}/security/providers/${pid}`).set(auth(owner)).send({ kind: 'OIDC', name: created.body.provider.name, discoveryUrl: `${issuer.base}/.well-known/openid-configuration`, clientId: 'clor-client', emailDomains: domain, autoProvision: false, enabled: true }).expect(200);
      const issuer2 = await fakeIssuer(`new@${domain}`, 'New Person');
      await request(app).patch(`/api/orgs/${owner.orgId}/security/providers/${pid}`).set(auth(owner)).send({ kind: 'OIDC', name: created.body.provider.name, discoveryUrl: `${issuer2.base}/.well-known/openid-configuration`, clientId: 'clor-client', emailDomains: domain, autoProvision: false, enabled: true }).expect(200);
      const start2 = await request(app).get(`/api/auth/sso/${pid}/start`).expect(302);
      const cookie2 = String(start2.headers['set-cookie']).split(';')[0];
      const back2 = new URL((await fetch(start2.headers.location, { redirect: 'manual' })).headers.get('location') || '');
      const refused = await request(app).get(`/api/auth/sso/callback?${back2.searchParams.toString()}`).set('Cookie', cookie2).expect(302);
      expect(decodeURIComponent(refused.headers.location)).toMatch(/has no CLOR login yet/);
      await issuer2.close();
    } finally {
      await issuer.close();
    }
  });
});
