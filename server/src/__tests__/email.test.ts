import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';

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

type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `mail.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Mail owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Mail Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    userId: signup.body.user.id,
    email,
  };
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('email verification', () => {
  it('sends a verification message on signup and records it in the outbox', async () => {
    const email = `verify.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Verify me' })
      .expect(200);

    expect(signup.body.emailVerificationSent).toBe(true);
    expect(signup.body.devVerifyToken).toBeTruthy();

    const sent = await platformPrisma.emailOutbox.findFirst({
      where: { toEmail: email, templateKey: 'auth.verify_email' },
    });
    expect(sent?.status).toBe('SENT');
    // The link, not a placeholder, must reach the recipient.
    expect(sent?.bodyText).toContain('/?verify=');
    expect(sent?.subject).toBe('Confirm your email address');
  });

  it('marks the address verified, once', async () => {
    const email = `once.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Once' })
      .expect(200);

    await request(app).post('/api/auth/verify-email').send({ token: signup.body.devVerifyToken }).expect(200);

    const user = await platformPrisma.user.findUnique({
      where: { id: signup.body.user.id },
      select: { emailVerifiedAt: true },
    });
    expect(user?.emailVerifiedAt).toBeTruthy();

    const second = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: signup.body.devVerifyToken })
      .expect(400);
    expect(String(second.body.error)).toMatch(/already been used/i);
  });

  it('rejects a bogus token', async () => {
    await request(app).post('/api/auth/verify-email').send({ token: 'not-a-real-token' }).expect(400);
  });

  it('resends and retires the previous link', async () => {
    const email = `resend.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Resend' })
      .expect(200);

    const resend = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .expect(200);

    // The old link is dead, the new one works.
    await request(app).post('/api/auth/verify-email').send({ token: signup.body.devVerifyToken }).expect(400);
    await request(app).post('/api/auth/verify-email').send({ token: resend.body.devVerifyToken }).expect(200);
  });
});

describe('email settings', () => {
  it('stores the SMTP password encrypted and never returns it', async () => {
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/email/settings`)
      .set(auth(owner))
      .send({
        provider: 'SMTP',
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'postmaster',
        password: 'super-secret-password',
        fromName: 'Acme Books',
        fromEmail: 'billing@example.com',
      })
      .expect(200);

    expect(res.body.settings.hasPassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-password');

    const stored = await platformPrisma.emailSetting.findUnique({ where: { orgId: owner.orgId } });
    expect(stored?.passwordEnc).toBeTruthy();
    expect(stored?.passwordEnc).not.toContain('super-secret-password');
    expect(decryptSecret(stored!.passwordEnc!)).toBe('super-secret-password');
  });

  it('keeps the stored password when it is not resubmitted', async () => {
    await request(app)
      .put(`/api/orgs/${owner.orgId}/email/settings`)
      .set(auth(owner))
      .send({ provider: 'SMTP', host: 'smtp.example.com', port: 465, secure: true, username: 'postmaster' })
      .expect(200);

    const stored = await platformPrisma.emailSetting.findUnique({ where: { orgId: owner.orgId } });
    expect(decryptSecret(stored!.passwordEnc!)).toBe('super-secret-password');
    expect(stored?.port).toBe(465);
  });

  it('requires a host and port for SMTP', async () => {
    await request(app)
      .put(`/api/orgs/${owner.orgId}/email/settings`)
      .set(auth(owner))
      .send({ provider: 'SMTP' })
      .expect(400);
  });

  it('round-trips encryption', () => {
    const plain = 'p@ssw0rd with spaces and ünicode';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });
});

describe('notification preferences', () => {
  it('lists events with defaults and saves changes', async () => {
    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/notifications`)
      .set(auth(owner))
      .expect(200);

    const keys = list.body.events.map((e: any) => e.key);
    expect(keys).toContain('approval.requested');
    // Transactional mail is not switchable, so it is not offered as an event.
    expect(keys).not.toContain('auth.verify_email');
    expect(list.body.events.every((e: any) => e.enabled)).toBe(true);

    await request(app)
      .put(`/api/orgs/${owner.orgId}/notifications`)
      .set(auth(owner))
      .send({ events: [{ eventKey: 'approval.requested', enabled: false }] })
      .expect(200);

    const after = await request(app).get(`/api/orgs/${owner.orgId}/notifications`).set(auth(owner)).expect(200);
    expect(after.body.events.find((e: any) => e.key === 'approval.requested').enabled).toBe(false);
  });

  it('rejects an unknown event key', async () => {
    await request(app)
      .put(`/api/orgs/${owner.orgId}/notifications`)
      .set(auth(owner))
      .send({ events: [{ eventKey: 'not.a.thing', enabled: true }] })
      .expect(400);
  });

  it('suppresses a switched-off notification but still records the attempt', async () => {
    const org = await makeOwner();

    await request(app)
      .put(`/api/orgs/${org.orgId}/notifications`)
      .set(auth(org))
      .send({ events: [{ eventKey: 'approval.requested', enabled: false }] })
      .expect(200);

    // Build an approval that would normally notify.
    const roleRes = await request(app)
      .post(`/api/orgs/${org.orgId}/roles`)
      .set(auth(org))
      .send({ name: `Approver ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);
    const approverRole = roleRes.body.role.id;
    await request(app)
      .put(`/api/orgs/${org.orgId}/roles/${approverRole}/permissions`)
      .set(auth(org))
      .send({ permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'] })
      .expect(200);

    const approverEmail = `appr.${Date.now()}.${rnd()}@example.com`;
    const approver = await request(app)
      .post('/api/users')
      .set(auth(org))
      .send({
        email: approverEmail,
        fullName: 'Approver',
        password: 'Passw0rd!23',
        orgIds: [org.orgId],
        branchIdsByOrg: { [org.orgId]: [org.branchId] },
      })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${org.orgId}/users/${approver.body.user.id}/roles`)
      .set(auth(org))
      .send({ roleId: approverRole, branchId: null })
      .expect(201);

    const raiserRes = await request(app)
      .post(`/api/orgs/${org.orgId}/roles`)
      .set(auth(org))
      .send({ name: `Raiser ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);
    await request(app)
      .put(`/api/orgs/${org.orgId}/roles/${raiserRes.body.role.id}/permissions`)
      .set(auth(org))
      .send({ permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'] })
      .expect(200);

    const raiserEmail = `rais.${Date.now()}.${rnd()}@example.com`;
    const raiser = await request(app)
      .post('/api/users')
      .set(auth(org))
      .send({
        email: raiserEmail,
        fullName: 'Raiser',
        password: 'Passw0rd!23',
        orgIds: [org.orgId],
        branchIdsByOrg: { [org.orgId]: [org.branchId] },
      })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${org.orgId}/users/${raiser.body.user.id}/roles`)
      .set(auth(org))
      .send({ roleId: raiserRes.body.role.id, branchId: null })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${org.orgId}/approval-rules`)
      .set(auth(org))
      .send({ docType: 'INVOICE', name: 'Big', minAmount: 1000, approverRoleId: approverRole })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrUsername: raiserEmail, password: 'Passw0rd!23' })
      .expect(200);

    await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set({ Authorization: `Bearer ${login.body.token}`, 'x-org-id': org.orgId, 'x-branch-id': org.branchId })
      .send({ number: `N-${rnd()}`, date: '2026-08-17', customerName: 'X', subtotal: 5000, total: 5000, items: [] })
      .expect(201);

    const suppressed = await platformPrisma.emailOutbox.findFirst({
      where: { orgId: org.orgId, templateKey: 'approval.requested', toEmail: approverEmail },
    });
    expect(suppressed?.status).toBe('SUPPRESSED');
    expect(suppressed?.lastError).toMatch(/switched off/i);
  });
});

describe('notifications on real events', () => {
  it('emails an invited user', async () => {
    // A fresh org, so it uses the platform transport rather than the deliberately
    // broken SMTP configuration another test installs on `owner`.
    const org = await makeOwner();
    const email = `invited.${Date.now()}.${rnd()}@example.com`;
    await request(app)
      .post('/api/users')
      .set(auth(org))
      .send({
        email,
        fullName: 'Invited',
        password: 'Passw0rd!23',
        orgIds: [org.orgId],
        branchIdsByOrg: { [org.orgId]: [org.branchId] },
      })
      .expect(201);

    const msg = await platformPrisma.emailOutbox.findFirst({ where: { toEmail: email, templateKey: 'auth.user_invited' } });
    expect(msg?.status).toBe('SENT');
    expect(msg?.subject).toMatch(/added to/i);
  });

  it('records a delivery failure with its reason instead of losing the message', async () => {
    // `owner` points at smtp.example.com, which does not answer.
    const email = `fails.${Date.now()}.${rnd()}@example.com`;
    await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({
        email,
        fullName: 'Unreachable',
        password: 'Passw0rd!23',
        orgIds: [owner.orgId],
        branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
      })
      .expect(201);

    const msg = await platformPrisma.emailOutbox.findFirst({ where: { toEmail: email, templateKey: 'auth.user_invited' } });
    expect(msg?.status).toBe('FAILED');
    expect(msg?.attempts).toBeGreaterThan(0);
    expect(msg?.lastError).toBeTruthy();
    // The content survives, so it can be retried once the server is fixed.
    expect(msg?.bodyText).toContain('has added you to');

    const retry = await request(app)
      .post(`/api/orgs/${owner.orgId}/email/outbox/retry`)
      .set(auth(owner))
      .expect(200);
    expect(retry.body.retried).toBeGreaterThan(0);

    const after = await platformPrisma.emailOutbox.findUnique({ where: { id: msg!.id } });
    expect(after?.attempts).toBeGreaterThan(msg!.attempts);
  });

  it('emails a password reset link', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email }).expect(200);
    const msg = await platformPrisma.emailOutbox.findFirst({
      where: { toEmail: owner.email, templateKey: 'auth.password_reset' },
      orderBy: { createdAt: 'desc' },
    });
    expect(msg?.status).toBe('SENT');
    expect(msg?.bodyText).toContain('/?reset=');
  });

  it('exposes the delivery log', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/email/outbox`).set(auth(owner)).expect(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });
});
