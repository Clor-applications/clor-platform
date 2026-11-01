import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../app.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { safeUrl } from '../utils/safeUrl.js';
import { withoutLinkTokens } from '../services/mailer.js';
import { purgeExpiredRecords } from '../services/retention.js';

/**
 * Sign-in identity, sessions and the records kept about them.
 *
 * Found in the compliance audit: the admin of any company that had invited
 * somebody could reset that person's password or move their email — and so
 * take over their own companies; a signed-out or deactivated user's token
 * kept working; access logs and the email outbox kept live tokens.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string; email: string; userId?: string };
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const rnd = () => Math.random().toString(36).slice(2, 8);
const PW = 'Passw0rd!23';

async function owner(name: string): Promise<Ctx> {
  const email = `idt.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PW, name }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${name} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
}

const login = (email: string, password = PW) =>
  request(app).post('/api/auth/login').send({ emailOrUsername: email, password });

let alice: Ctx; // owns her own company
let mallory: Ctx; // admin of another company that invites Alice

beforeAll(async () => {
  alice = await owner('Alice Co');
  mallory = await owner('Mallory Co');
  /* Alice confirmed her address; only a confirmed login from another account can be invited (A-02). */
  await platformPrisma.user.updateMany({ where: { email: alice.email }, data: { emailVerifiedAt: new Date() } });
  const invited = await request(app)
    .post('/api/users')
    .set(auth(mallory))
    .send({ email: alice.email, fullName: 'Alice', password: 'Whatever!234', orgIds: [mallory.orgId], branchIdsByOrg: { [mallory.orgId]: [mallory.branchId] } })
    .expect(201);
  alice.userId = invited.body.user.id;
}, 60_000);

describe("another company's admin", () => {
  it("cannot reset an invited person's password", async () => {
    const res = await request(app)
      .post(`/api/orgs/${mallory.orgId}/users/${alice.userId}/password`)
      .set(auth(mallory))
      .send({ password: 'Taken0ver!234' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('foreign_identity');
    await login(alice.email).expect(200);
    expect((await login(alice.email, 'Taken0ver!234')).status).not.toBe(200);
  });

  it("cannot move an invited person's email to an address they control", async () => {
    const res = await request(app)
      .patch(`/api/orgs/${mallory.orgId}/users/${alice.userId}`)
      .set(auth(mallory))
      .send({ email: `mallory.${rnd()}@example.com` });
    expect(res.status).toBe(403);
    const row = await platformPrisma.user.findUnique({ where: { id: alice.userId! }, select: { email: true } });
    expect(row?.email).toBe(alice.email);
  });

  it("cannot switch off or rename an invited person everywhere", async () => {
    for (const change of [{ isActive: false }, { fullName: 'Renamed by Mallory' }]) {
      const res = await request(app).patch(`/api/orgs/${mallory.orgId}/users/${alice.userId}`).set(auth(mallory)).send(change);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('foreign_identity');
    }
    const row = await platformPrisma.user.findUnique({ where: { id: alice.userId! }, select: { isActive: true, fullName: true } });
    expect(row?.isActive).toBe(true);
    expect(row?.fullName).not.toBe('Renamed by Mallory');
    await login(alice.email).expect(200);
  });

  it('can still manage people created in its own account, and a reset signs them out', async () => {
    const email = `own.${Date.now()}.${rnd()}@example.com`;
    const made = await request(app)
      .post('/api/users')
      .set(auth(mallory))
      .send({ email, fullName: 'Own staff', password: PW, orgIds: [mallory.orgId], branchIdsByOrg: { [mallory.orgId]: [mallory.branchId] } })
      .expect(201);
    const session = await login(email).expect(200);
    await request(app).post(`/api/orgs/${mallory.orgId}/users/${made.body.user.id}/password`).set(auth(mallory)).send({ password: 'Fresh!23456' }).expect(200);
    // The token issued before the reset no longer works.
    await request(app).get(`/api/orgs/${mallory.orgId}/warehouses`).set({ ...auth(mallory), Authorization: `Bearer ${session.body.token}` }).expect(401);
    await login(email, 'Fresh!23456').expect(200);
  });
});

/*
 * A-01: the owner runs two companies of one account, X and Y. Mallory is an
 * administrator of X only. Her rights in X used to be enough to move the
 * owner's email, reset his password or switch him off — and with them, take
 * over Y. A directory (SCIM) token minted in X could do the same.
 */
describe('an administrator of a sibling company', () => {
  let ownerCtx: Ctx;
  let ownerId: string;
  let yOrgId: string;
  let mal: Ctx;

  beforeAll(async () => {
    ownerCtx = await owner('Group X');
    ownerId = (await platformPrisma.user.findFirstOrThrow({ where: { email: ownerCtx.email }, select: { id: true } })).id;
    const y = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${ownerCtx.token}`)
      .send({ companyName: `Group Y ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    yOrgId = y.body.company.orgId;
    const malEmail = `mal.${Date.now()}.${rnd()}@example.com`;
    const made = await request(app)
      .post('/api/users')
      .set(auth(ownerCtx))
      .send({ email: malEmail, fullName: 'Mallory', password: PW, orgIds: [ownerCtx.orgId], branchIdsByOrg: { [ownerCtx.orgId]: [ownerCtx.branchId] } })
      .expect(201);
    const adminRole = await platformPrisma.role.findFirstOrThrow({ where: { orgId: ownerCtx.orgId, roleType: 'ADMIN' }, select: { id: true, accountId: true } });
    await platformPrisma.userRoleAssignment.create({ data: { accountId: adminRole.accountId, orgId: ownerCtx.orgId, userId: made.body.user.id, roleId: adminRole.id, createdByUserId: ownerId } });
    const s = await login(malEmail).expect(200);
    mal = { token: s.body.token, orgId: ownerCtx.orgId, branchId: ownerCtx.branchId, email: malEmail };
  }, 60_000);

  it("cannot move the owner's email, reset his password or switch him off", async () => {
    const steal = `mal.owns.${rnd()}@example.com`;
    for (const res of [
      await request(app).patch(`/api/orgs/${mal.orgId}/users/${ownerId}`).set(auth(mal)).send({ email: steal }),
      await request(app).post(`/api/orgs/${mal.orgId}/users/${ownerId}/password`).set(auth(mal)).send({ password: 'Taken0ver!234' }),
      await request(app).patch(`/api/orgs/${mal.orgId}/users/${ownerId}`).set(auth(mal)).send({ isActive: false }),
    ]) {
      expect(res.status).toBe(403);
      expect(['identity_elsewhere', 'admin_only', 'last_admin']).toContain(res.body.code);
    }
    const row = await platformPrisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true, isActive: true } });
    expect(row.email).toBe(ownerCtx.email);
    expect(row.isActive).toBe(true);
    await login(ownerCtx.email).expect(200);
    expect(await platformPrisma.userOrgMembership.count({ where: { userId: ownerId, orgId: yOrgId } })).toBe(1);
  });

  it("cannot do it through a directory token minted in her company", async () => {
    const minted = await request(app).post(`/api/orgs/${mal.orgId}/security/scim`).set(auth(mal)).send({}).expect(201);
    const scim = { Authorization: `Bearer ${minted.body.token}`, 'content-type': 'application/scim+json' };
    const res = await request(app)
      .put(`/scim/v2/Users/${ownerId}`)
      .set(scim)
      .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `mal.scim.${rnd()}@example.com` });
    expect(res.status).toBe(403);
    const off = await request(app)
      .patch(`/scim/v2/Users/${ownerId}`)
      .set(scim)
      .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(off.status).toBe(403);
    const row = await platformPrisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true, isActive: true } });
    expect(row.email).toBe(ownerCtx.email);
    expect(row.isActive).toBe(true);
  });

  it('still lets the owner manage staff who work only where he administers', async () => {
    const email = `staff.${Date.now()}.${rnd()}@example.com`;
    const made = await request(app)
      .post('/api/users')
      .set(auth(ownerCtx))
      .send({ email, fullName: 'Staff', password: PW, orgIds: [ownerCtx.orgId], branchIdsByOrg: { [ownerCtx.orgId]: [ownerCtx.branchId] } })
      .expect(201);
    await request(app).patch(`/api/orgs/${ownerCtx.orgId}/users/${made.body.user.id}`).set(auth(ownerCtx)).send({ email: `moved.${rnd()}@example.com` }).expect(200);
    await request(app).post(`/api/orgs/${ownerCtx.orgId}/users/${made.body.user.id}/password`).set(auth(ownerCtx)).send({ password: 'Fresh!23456' }).expect(200);
  });
});

/*
 * A-04: whoever creates a company becomes its Administrator. A clerk the
 * owner added could create one and, as its admin, manage memberships across
 * the account. Only the account's first company, or an administrator, now.
 */
describe('adding a company', () => {
  it('is refused to a member who administers nothing in the account', async () => {
    const boss = await owner('Clerk Co');
    const email = `clerk.${Date.now()}.${rnd()}@example.com`;
    await request(app)
      .post('/api/users')
      .set(auth(boss))
      .send({ email, fullName: 'Clerk', password: PW, orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } })
      .expect(201);
    const clerk = await login(email).expect(200);
    const res = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${clerk.body.token}`)
      .send({ companyName: `Clerk Own ${rnd()}`, state: 'Karnataka' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ACCOUNT_ADMIN');
    const accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: boss.orgId }, select: { accountId: true } })).accountId;
    expect(await platformPrisma.org.count({ where: { accountId } })).toBe(1);
  });

  it("is still the owner's to do", async () => {
    const boss = await owner('Second Co');
    await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${boss.token}`)
      .send({ companyName: `Second ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
  });
});

/* A-10: smaller identity checks. */
describe('token and echo hygiene', () => {
  it('refuses an access token signed with another algorithm, even with the right secret', async () => {
    const c = await owner('Alg Co');
    const claims = jwt.decode(c.token) as any;
    const forged = jwt.sign({ userId: claims.userId, accountId: claims.accountId, sid: claims.sid }, process.env.JWT_SECRET || 'dev-secret', {
      algorithm: 'HS512',
      issuer: process.env.JWT_ISSUER || 'accounting',
      audience: process.env.JWT_AUDIENCE || 'accounting-web',
    });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('does not echo a company the person is not in as their active one', async () => {
    const a = await owner('Echo A');
    const b = await owner('Echo B');
    const me = await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${a.token}`, 'x-org-id': b.orgId }).expect(200);
    expect(me.body.activeOrgId).toBeNull();
    const own = await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${a.token}`, 'x-org-id': a.orgId }).expect(200);
    expect(own.body.activeOrgId).toBe(a.orgId);
  });
});

describe('an access token', () => {
  it('stops working once its session is signed out', async () => {
    const c = await owner('Signout Co');
    const s = await login(c.email).expect(200);
    const as = { ...auth(c), Authorization: `Bearer ${s.body.token}` };
    await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(as).expect(200);
    const u = await platformPrisma.user.findFirstOrThrow({ where: { email: c.email }, select: { id: true } });
    await platformPrisma.session.updateMany({ where: { revokedAt: null, userId: u.id }, data: { revokedAt: new Date() } });
    const after = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(as).expect(401);
    expect(after.body.code).toBe('session_ended');
  });

  /*
   * A-08: the "still signed in?" answer was cached 30 s per instance and only
   * the instance that handled the sign-out cleared it. A revoke written
   * elsewhere (another instance) must bite within seconds, not half a minute.
   */
  it('stops working within seconds when another instance ends its session', async () => {
    const saved = process.env.ACCESS_CACHE_TTL_MS;
    process.env.ACCESS_CACHE_TTL_MS = '30000';
    try {
      const c = await owner('Other Instance Co');
      const s = await login(c.email).expect(200);
      const as = { ...auth(c), Authorization: `Bearer ${s.body.token}` };
      await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(as).expect(200);
      const u = await platformPrisma.user.findFirstOrThrow({ where: { email: c.email }, select: { id: true } });
      // Written straight to the database, as another API instance's sign-out would be: this instance's cache is not told.
      await platformPrisma.session.updateMany({ where: { revokedAt: null, userId: u.id }, data: { revokedAt: new Date() } });
      await new Promise((r) => setTimeout(r, 5_500));
      const after = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(as);
      expect(after.status).toBe(401);
    } finally {
      if (saved === undefined) delete process.env.ACCESS_CACHE_TTL_MS;
      else process.env.ACCESS_CACHE_TTL_MS = saved;
    }
  }, 30_000);

  it('stops working once the person is deactivated', async () => {
    const c = await owner('Inactive Co');
    await platformPrisma.user.updateMany({ where: { email: c.email }, data: { isActive: false } });
    const res = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(auth(c)).expect(401);
    expect(res.body.code).toBe('inactive');
  });

  /* A-03: these sign-in routes once checked only the signature, so a
     signed-out or deactivated token could still rename the person (a login
     credential) or create a company until it expired. */
  it("is refused by the account routes too once its session is signed out", async () => {
    const c = await owner('Signout Me Co');
    const s = await login(c.email).expect(200);
    const as = { Authorization: `Bearer ${s.body.token}` };
    await request(app).get('/api/auth/me').set(as).expect(200);
    const u = await platformPrisma.user.findFirstOrThrow({ where: { email: c.email }, select: { id: true } });
    await platformPrisma.session.updateMany({ where: { revokedAt: null, userId: u.id }, data: { revokedAt: new Date() } });
    const calls = [
      request(app).get('/api/auth/me').set(as),
      request(app).get('/api/auth/sessions').set(as),
      request(app).post('/api/auth/sessions/revoke-all').set(as),
      request(app).patch('/api/auth/me').set(as).send({ username: `taken${rnd()}` }),
      request(app).post('/api/auth/setup-company').set(as).send({ companyName: `Ghost ${rnd()}`, state: 'Karnataka' }),
      request(app).post('/api/auth/resend-verification').set(as),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('session_ended');
    }
  });

  it('is refused by the account routes once the person is deactivated', async () => {
    const c = await owner('Inactive Me Co');
    await platformPrisma.user.updateMany({ where: { email: c.email }, data: { isActive: false } });
    const as = { Authorization: `Bearer ${c.token}` };
    for (const res of await Promise.all([
      request(app).patch('/api/auth/me').set(as).send({ username: `taken${rnd()}` }),
      request(app).post('/api/auth/setup-company').set(as).send({ companyName: `Ghost ${rnd()}`, state: 'Karnataka' }),
    ])) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('inactive');
    }
  });
});

describe('records about people', () => {
  it('lets a person download what is held about them, without secrets', async () => {
    const c = await owner('Export Me');
    const res = await request(app).get('/api/auth/me/export').set({ Authorization: `Bearer ${c.token}` }).expect(200);
    expect(res.body.profile.email).toBe(c.email);
    expect(res.body.companies.length).toBe(1);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|refreshTokenHash|tokenHash/);
  });

  it('records which notice was accepted at sign-up', async () => {
    const email = `notice.${Date.now()}.${rnd()}@example.com`;
    await request(app).post('/api/auth/signup').send({ email, password: PW, name: 'N', noticeVersion: '2026-10-02' }).expect(200);
    const u = await platformPrisma.user.findFirst({ where: { email }, select: { noticeVersion: true, noticeAcceptedAt: true } });
    expect(u?.noticeVersion).toBe('2026-10-02');
    expect(u?.noticeAcceptedAt).toBeTruthy();
  });

  it('keeps share tokens, GSTINs and search terms out of the access log', () => {
    expect(safeUrl('/api/public/invoice/AbC_123-xyz')).toBe('/api/public/invoice/[token]');
    expect(safeUrl('/api/gstin/29ABCDE1234F1Z5')).toBe('/api/gstin/[gstin]');
    expect(safeUrl('/api/orgs/o1/items?search=Mango&limit=5')).toBe('/api/orgs/o1/items?search=[redacted]&limit=5');
    expect(safeUrl('/api/orgs/o1/invoices')).toBe('/api/orgs/o1/invoices');
  });

  it('removes link tokens from a sent email copy', () => {
    expect(withoutLinkTokens('Reset: https://x.test/?token=abc.DEF-123 now')).toBe('Reset: https://x.test/?token=[removed-after-sending] now');
  });

  it('deletes expired sign-in records', async () => {
    const c = await owner('Retention Co');
    const user = await platformPrisma.user.findFirstOrThrow({ where: { email: c.email } });
    const old = new Date(Date.now() - 200 * 86_400_000);
    const s = await platformPrisma.session.create({
      data: { accountId: user.accountId, userId: user.id, refreshTokenHash: `h-${rnd()}${rnd()}`, expiresAt: old, revokedAt: old },
    });
    await purgeExpiredRecords();
    expect(await platformPrisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
