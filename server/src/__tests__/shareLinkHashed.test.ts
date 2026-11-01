import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-32 (Batch 5, U4): invoice share links were stored as they are, never
 * expired, were made by anyone who could view invoices, and were not
 * audited; cancelling an invoice left its payment link payable.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { hashToken } = await import('../services/credentials.js');
const { linkExpiry } = await import('../services/shareLinks.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 864e5;

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `slh.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'SLH owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SLH Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
}
/** A colleague who can see invoices but not edit them. */
async function viewer(c: Ctx): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(auth(c)).send({ name: `Viewer ${rnd()}`, roleType: 'CUSTOM', permissions: ['SALES::Invoices::VIEW'] }).expect(201);
  const email = `v.${rnd()}@example.com`;
  const u = await request(app).post('/api/users').set(auth(c)).send({ email, fullName: 'View Only', password: 'Viewer!2026pass', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const id = u.body.user?.id || u.body.id;
  await request(app).post(`/api/orgs/${c.orgId}/users/${id}/roles`).set(auth(c)).send({ roleId: role.body.role?.id || role.body.id }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Viewer!2026pass' }).expect(200);
  return { ...c, token: login.body.token, userId: id };
}
const raise = async (c: Ctx, extra: Record<string, unknown> = {}) =>
  (
    await request(app)
      .post(`/api/orgs/${c.orgId}/invoices`)
      .set(auth(c))
      .send({ number: `INV-${rnd()}`, date: '2026-09-09', customerName: 'Acme', subtotal: 1000, gstTotal: 0, total: 1000, status: 'Unpaid', items: [{ description: 'x', quantity: 1, rate: 1000, gstRate: 0 }], ...extra })
      .expect(201)
  ).body.invoice;
const share = (c: Ctx, id: string) => request(app).post(`/api/orgs/${c.orgId}/invoices/${id}/share`).set(auth(c));
const open = (token: string) => request(app).get(`/api/public/invoice/${token}`);
const status = (c: Ctx, id: string, s: string) => request(app).patch(`/api/orgs/${c.orgId}/invoices/${id}/status`).set(auth(c)).send({ status: s });
const linkRow = (orgId: string, docId: string) => outsideTenant('test', () => prisma.documentShareLink.findFirst({ where: { orgId, docId } }));
const credOf = (token: string) => outsideTenant('test', () => platformPrisma.credential.findUnique({ where: { kind_tokenHash: { kind: 'SHARE_LINK', tokenHash: hashToken(token) } } }));

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('how a link is kept', () => {
  it('found by its hash, with an encrypted copy; the same address on every reminder', async () => {
    const inv = await raise(owner);
    const a = (await share(owner, inv.id).expect(201)).body.token;
    const b = (await share(owner, inv.id).expect(200)).body.token;
    const c = (await share(owner, inv.id).expect(200)).body.token;
    expect(new Set([a, b, c]).size).toBe(1);
    const row = (await linkRow(owner.orgId, inv.id))!;
    expect(row.tokenHash).toBe(hashToken(a));
    expect(row.tokenEnc).toBeTruthy();
    expect(row.tokenEnc).not.toContain(a);
    /* Still written until U9, so an older instance can follow it during a deploy. */
    expect(row.token).toBe(a);
    await open(a).expect(200);
  });

  it('a link stored before hashing still opens, and is hashed and given a live expiry', async () => {
    const inv = await raise(owner, { date: '2026-01-01', dueDate: '2026-02-01' });
    const token = `legacy${rnd()}${rnd()}${rnd()}${rnd()}`;
    await outsideTenant('test: a link from before A-32', () =>
      prisma.documentShareLink.create({ data: { accountId: inv.accountId, orgId: owner.orgId, docType: 'INVOICE', docId: inv.id, token, createdByUserId: owner.userId } })
    );
    /* AE5: due date long past, but the reminder already sent still opens. */
    await open(token).expect(200);
    const row = (await linkRow(owner.orgId, inv.id))!;
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
    expect((await credOf(token))?.status).toBe('ACTIVE');
    /* And a reminder now sends that same address. */
    expect((await share(owner, inv.id).expect(200)).body.token).toBe(token);
  });

  it('an encrypted copy made with the older key still gives the same address, and is stored again', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    const before = process.env.MAIL_SECRET_KEY;
    const row = (await linkRow(owner.orgId, inv.id))!;
    try {
      process.env.MAIL_SECRET_KEY = `rotated-${rnd()}`;
      expect((await share(owner, inv.id).expect(200)).body.token).toBe(token);
      const after = (await linkRow(owner.orgId, inv.id))!;
      expect(after.tokenEnc).not.toBe(row.tokenEnc);
    } finally {
      if (before === undefined) delete process.env.MAIL_SECRET_KEY;
      else process.env.MAIL_SECRET_KEY = before;
    }
  });

  it('a copy no key can read gives a new link rather than an empty one', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    const row = (await linkRow(owner.orgId, inv.id))!;
    await outsideTenant('test: unreadable copy', () => prisma.documentShareLink.update({ where: { id: row.id }, data: { tokenEnc: 'a.b.c', token: 'x'.repeat(10) } }));
    const next = (await share(owner, inv.id).expect(201)).body.token;
    expect(next).toBeTruthy();
    expect(next).not.toBe(token);
    await open(next).expect(200);
  });
});

describe('who may make one', () => {
  it('someone who can only view invoices gets the live link, but cannot make a new one', async () => {
    const v = await viewer(owner);
    const fresh = await raise(owner);
    const r = await share(v, fresh.id);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SHARE_LINK_NEEDS_EDIT');
    const made = (await share(owner, fresh.id).expect(201)).body.token;
    expect((await share(v, fresh.id).expect(200)).body.token).toBe(made);
    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${fresh.id}/share`).set(auth(v)).expect(403);
  }, 60_000);

  it('making one is in the audit trail', async () => {
    const inv = await raise(owner);
    await share(owner, inv.id).expect(201);
    const rows = await outsideTenant('test', () => platformPrisma.auditLog.findMany({ where: { orgId: owner.orgId, entityId: inv.id, action: 'SHARE_LINK_CREATED' } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].createdByUserId).toBe(owner.userId);
  });
});

describe('how long one lasts', () => {
  it('90 days past the due date, never less than 90 days from now, within two years of the invoice', () => {
    const now = new Date('2026-10-24T00:00:00Z');
    expect(linkExpiry({ date: '2026-10-01', dueDate: '2026-12-31' }, now).toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(linkExpiry({ date: '2026-01-01', dueDate: '2026-02-01' }, now).toISOString().slice(0, 10)).toBe('2027-01-22');
    expect(linkExpiry({ date: '2026-10-01' }, now).toISOString().slice(0, 10)).toBe('2027-01-22');
    expect(linkExpiry({ date: '2024-01-01', dueDate: '2030-01-01' }, now).toISOString().slice(0, 10)).toBe('2027-01-22');
  });

  it('an expired link no longer opens; a reminder then makes a new one', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    const cred = (await credOf(token))!;
    await outsideTenant('test', () => platformPrisma.credential.update({ where: { id: cred.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await open(token).expect(404);
    const next = (await share(owner, inv.id).expect(201)).body.token;
    expect(next).not.toBe(token);
    await open(next).expect(200);
  });

  it('opening a link does not extend it; a reminder does', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    const cred = (await credOf(token))!;
    const soon = new Date(Date.now() + 5 * DAY);
    await outsideTenant('test', () => platformPrisma.credential.update({ where: { id: cred.id }, data: { expiresAt: soon } }));
    await open(token).expect(200);
    expect((await credOf(token))!.expiresAt!.getTime()).toBe(soon.getTime());
    await share(owner, inv.id).expect(200);
    expect((await credOf(token))!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
  });

  it('is served private: not cached, not indexed, no referrer', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    const r = await open(token).expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('following its invoice', () => {
  it('cancelled: the link says so; reinstated: the same link opens again (AE4)', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    await status(owner, inv.id, 'Cancelled').expect(200);
    const r = await open(token);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('INVOICE_CANCELLED');
    await status(owner, inv.id, 'Unpaid').expect(200);
    await open(token).expect(200);
  });

  it('reinstated after its link ran out: the link is extended and opens', async () => {
    const inv = await raise(owner);
    const token = (await share(owner, inv.id).expect(201)).body.token;
    await status(owner, inv.id, 'Cancelled').expect(200);
    const cred = (await credOf(token))!;
    await outsideTenant('test', () => platformPrisma.credential.update({ where: { id: cred.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await status(owner, inv.id, 'Unpaid').expect(200);
    await open(token).expect(200);
    const ev = await outsideTenant('test', () => platformPrisma.credentialEvent.findMany({ where: { credentialId: cred.id, eventType: 'extended' } }));
    expect(ev.length).toBeGreaterThan(0);
  });

  it('a deleted draft’s link is revoked', async () => {
    const inv = await raise(owner, { status: 'Draft' });
    const token = (await share(owner, inv.id).expect(201)).body.token;
    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${inv.id}`).set(auth(owner)).expect(200);
    await open(token).expect(404);
    expect((await credOf(token))?.status).toBe('REVOKED');
  });
});

describe('payment links', () => {
  const payFor = async (c: Ctx, invId: string) => {
    const made = await request(app).post(`/api/orgs/${c.orgId}/pay-requests`).set(auth(c)).send({ docId: invId, payeeVpa: 'acme@okhdfc', payeeName: 'Acme' }).expect(201);
    return { id: made.body.request.id as string, token: String(made.body.url).split('/pay/')[1] };
  };

  it('cancelling the invoice closes its open payment link: the page says closed and a claim is refused', async () => {
    const inv = await raise(owner);
    const p = await payFor(owner, inv.id);
    await status(owner, inv.id, 'Cancelled').expect(200);
    const page = await request(app).get(`/pay/${p.token}`).expect(200);
    expect(page.text).toMatch(/no longer in use|Link closed/);
    await request(app).post(`/pay/${p.token}/claim`).type('form').send({ utr: '428917365012' }).expect(303);
    const r = await outsideTenant('test', () => prisma.paymentRequest.findUnique({ where: { id: p.id } }));
    expect(r?.status).toBe('CANCELLED');
    expect(r?.payerUtr).toBeNull();
  });

  it('a paid request still shows as paid after its date', async () => {
    const inv = await raise(owner);
    const p = await payFor(owner, inv.id);
    await outsideTenant('test', () => prisma.paymentRequest.update({ where: { id: p.id }, data: { status: 'PAID', paidAt: new Date(), expiresAt: new Date(Date.now() - DAY) } }));
    const cred = await outsideTenant('test', () => platformPrisma.credential.findFirst({ where: { kind: 'PAY_LINK', ownerId: p.id } }));
    await outsideTenant('test', () => platformPrisma.credential.update({ where: { id: cred!.id }, data: { expiresAt: new Date(Date.now() - DAY) } }));
    const page = await request(app).get(`/pay/${p.token}`).expect(200);
    expect(page.text).toContain('Paid — thank you.');
  });

  it('a new payment link replaces the old one, which stops at once', async () => {
    const inv = await raise(owner);
    const first = await payFor(owner, inv.id);
    await payFor(owner, inv.id);
    const page = await request(app).get(`/pay/${first.token}`).expect(200);
    expect(page.text).toMatch(/no longer in use/);
    const cred = await outsideTenant('test', () => platformPrisma.credential.findFirst({ where: { kind: 'PAY_LINK', ownerId: first.id } }));
    expect(cred?.status).toBe('REVOKED');
  });

  it('is served without a referrer', async () => {
    const inv = await raise(owner);
    const p = await payFor(owner, inv.id);
    const page = await request(app).get(`/pay/${p.token}`).expect(200);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
  });
});

