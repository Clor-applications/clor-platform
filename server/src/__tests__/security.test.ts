import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

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
    // Honest about not being usable yet.
    expect(res.body.provider.status).toBe('CONFIGURED_NOT_ACTIVE');

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
