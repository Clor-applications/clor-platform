import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-006 (Batch 11): an accountant or auditor from another account reached a
 * client company by a plain membership — no record of the client's consent, no
 * scope, no end, nothing the client could pause. Now an engagement, granted by
 * the client's administrator, is what lets them in: scoped to apps, possibly
 * dated, paused or ended by the client, never changed by the person it covers.
 * Cases from Clor R&D/05 §10 that apply without partner accounts.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string; email: string };
const at = (c: { token: string; orgId: string; branchId: string }) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(label: string): Promise<Ctx> {
  const email = `oa.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `OA ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId, email };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return c;
}
const login = async (email: string) => (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200)).body.token as string;

/** The firm's accountant, invited into the client with the client's owner role and the given terms. */
async function invite(client: Ctx, firm: Ctx, terms?: Record<string, unknown>) {
  await outsideTenant('test: the accountant confirmed their address', () => platformPrisma.user.update({ where: { id: firm.userId }, data: { emailVerifiedAt: new Date() } }));
  const r = await request(app)
    .post('/api/users')
    .set(at(client))
    .send({ email: firm.email, fullName: 'Firm accountant', password: 'Irrelevant!23', orgIds: [client.orgId], branchIdsByOrg: { [client.orgId]: [client.branchId] }, ...(terms ? { outsideAccess: terms } : {}) });
  if (r.status === 201) {
    const role = await outsideTenant('test', () => platformPrisma.role.findFirst({ where: { orgId: client.orgId }, select: { id: true } }));
    await request(app).post(`/api/orgs/${client.orgId}/users/${firm.userId}/roles`).set(at(client)).send({ roleId: role!.id }).expect(201);
  }
  return r;
}
/** The accountant, working in the client company. */
const asAccountant = async (client: Ctx, firm: Ctx) => ({ token: await login(firm.email), orgId: client.orgId, branchId: client.branchId });
const engagementOf = (client: Ctx, firm: Ctx) =>
  outsideTenant('test: the engagement', () => platformPrisma.outsideAccess.findUnique({ where: { orgId_userId: { orgId: client.orgId, userId: firm.userId } } }));
const books = (who: { token: string; orgId: string; branchId: string }) => request(app).get(`/api/orgs/${who.orgId}/ledger/accounts`).set(at(who));
const payroll = (who: { token: string; orgId: string; branchId: string }) => request(app).get(`/api/orgs/${who.orgId}/payroll/components`).set(at(who));
const meOrgs = async (token: string) => ((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200)).body.orgs || []).map((o: any) => o.orgId);
const admin = (client: Ctx) => ({
  list: () => request(app).get(`/api/orgs/${client.orgId}/outside-access`).set(at(client)),
  patch: (id: string, b: unknown) => request(app).patch(`/api/orgs/${client.orgId}/outside-access/${id}`).set(at(client)).send(b as any),
  post: (id: string, verb: string, b: unknown = {}) => request(app).post(`/api/orgs/${client.orgId}/outside-access/${id}/${verb}`).set(at(client)).send(b as any),
});

describe('letting an accountant in is the client’s recorded consent', () => {
  it('adding them records who granted what; their own company is unaffected', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm, { apps: ['accounting'] }).then((r) => expect(r.status).toBe(201));
    const row = await engagementOf(client, firm);
    expect(row).toMatchObject({ status: 'ACTIVE', apps: 'accounting', approvedByUserId: client.userId, homeAccountId: firm.accountId, accountId: client.accountId });
    const list = (await admin(client).list().expect(200)).body.outsideAccess;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ person: { email: firm.email }, effective: 'ACTIVE', apps: ['accounting'], grantedBy: expect.any(String), from: { name: expect.stringMatching(/^OA firm /) } });
    /* The firm's own company is theirs: no engagement asked of them there. */
    await books({ token: await login(firm.email), orgId: firm.orgId, branchId: firm.branchId }).expect(200);
  }, 90_000);

  it('only the apps the client gave: Books yes, Payroll no (05 §10 row 5)', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm, { apps: ['accounting'] });
    const acc = await asAccountant(client, firm);
    await books(acc).expect(200);
    const r = await payroll(acc);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('APP_NOT_IN_ENGAGEMENT');
    /* The client's own owner still reaches Payroll. */
    await payroll(client).expect(200);
  }, 90_000);

  it('terms that make no sense are refused before anything is written', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    expect((await invite(client, firm, { apps: ['bogus'] })).status).toBe(400);
    expect((await invite(client, firm, { expiresAt: '2001-01-01' })).status).toBe(400);
    const member = await outsideTenant('test', () => platformPrisma.userOrgMembership.count({ where: { orgId: client.orgId, userId: firm.userId } }));
    expect(member).toBe(0);
  }, 90_000);
});

describe('the client stops it', () => {
  it('paused: denied, and the company leaves their list; resumed: back (05 §10 rows 3, 6)', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm);
    const acc = await asAccountant(client, firm);
    const id = (await engagementOf(client, firm))!.id;
    expect(await meOrgs(acc.token)).toContain(client.orgId);

    await admin(client).post(id, 'suspend', { reason: 'Audit paused' }).expect(200);
    const r = await books(acc);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('OUTSIDE_ACCESS_SUSPENDED');
    expect(await meOrgs(acc.token)).not.toContain(client.orgId);
    expect(await meOrgs(acc.token)).toContain(firm.orgId);

    await admin(client).post(id, 'resume').expect(200);
    await books(acc).expect(200);
  }, 90_000);

  it('past its end: denied, the record kept (05 §10 row 7)', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm, { expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
    const acc = await asAccountant(client, firm);
    await books(acc).expect(200);
    const row = (await engagementOf(client, firm))!;
    await outsideTenant('test: the end date passes', () => platformPrisma.outsideAccess.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const r = await books(acc);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('OUTSIDE_ACCESS_EXPIRED');
    expect((await admin(client).list().expect(200)).body.outsideAccess[0].effective).toBe('EXPIRED');
  }, 90_000);

  it('ended: denied; cannot be resumed; adding them again is a fresh grant', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm);
    const acc = await asAccountant(client, firm);
    const id = (await engagementOf(client, firm))!.id;
    await admin(client).post(id, 'revoke', { reason: 'Engagement over' }).expect(200);
    expect((await books(acc)).body.code).toBe('OUTSIDE_ACCESS_ENDED');
    expect((await admin(client).post(id, 'resume')).status).toBe(409);
    const again = await invite(client, firm, { apps: ['accounting'] });
    expect(again.status).toBe(200);
    expect(again.body.regranted).toBe(true);
    await books(acc).expect(200);
    expect(await engagementOf(client, firm)).toMatchObject({ status: 'ACTIVE', apps: 'accounting', endedAt: null });
  }, 90_000);

  it('a membership with no engagement opens nothing', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm);
    const acc = await asAccountant(client, firm);
    await outsideTenant('test: as an older release or a hand edit would leave it', () => platformPrisma.outsideAccess.deleteMany({ where: { orgId: client.orgId, userId: firm.userId } }));
    expect((await books(acc)).body.code).toBe('OUTSIDE_ACCESS_ENDED');
  }, 90_000);

  it('every change is in the client’s Company trail in words', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm);
    const id = (await engagementOf(client, firm))!.id;
    await admin(client).patch(id, { apps: ['accounting', 'payroll'], expiresAt: new Date(Date.now() + 10 * 864e5).toISOString() }).expect(200);
    await admin(client).post(id, 'suspend').expect(200);
    await new Promise((r) => setTimeout(r, 200));
    const trail = JSON.stringify((await request(app).get(`/api/orgs/${client.orgId}/audit?app=company&limit=50`).set(at(client)).expect(200)).body);
    expect(trail).toContain('Changed what an outside person may use, or until when');
    expect(trail).toContain('Paused an outside person’s access');
  }, 90_000);
});

describe('who may change it', () => {
  it('never the person it covers, even an administrator there', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm, { apps: ['accounting'] });
    const acc = await asAccountant(client, firm);
    const id = (await engagementOf(client, firm))!.id;
    const own = await request(app).patch(`/api/orgs/${client.orgId}/outside-access/${id}`).set(at(acc)).send({ apps: ['accounting', 'payroll'] });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('own_access');
    expect((await request(app).post(`/api/orgs/${client.orgId}/outside-access/${id}/resume`).set(at(acc))).status).toBe(403);
  }, 90_000);

  it('another company sees none of it', async () => {
    const [client, firm, other] = await Promise.all([company('client'), company('firm'), company('other')]);
    await invite(client, firm);
    const id = (await engagementOf(client, firm))!.id;
    expect((await admin(other).list().expect(200)).body.outsideAccess).toEqual([]);
    expect((await admin(other).post(id, 'revoke')).status).toBe(404);
  }, 120_000);
});

describe('at deploy', () => {
  it('everyone already let in from another account keeps their access, carried over', async () => {
    const [client, firm] = await Promise.all([company('client'), company('firm')]);
    await invite(client, firm);
    const sql = fs.readFileSync(path.resolve('prisma/platform/migrations/20261024140000_outside_access/migration.sql'), 'utf8');
    const backfill = sql.slice(sql.indexOf('INSERT INTO "OutsideAccess"'), sql.indexOf('RESET clor.bypass;')).trim().replace(/;$/, '');
    const ROLLBACK = new Error('rollback');
    let after: any = null;
    await outsideTenant('test: the backfill on a database that had memberships only', () =>
      platformPrisma
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('clor.bypass', 'on', true)`);
          await tx.$executeRawUnsafe(`DELETE FROM "OutsideAccess" WHERE "orgId" = $1`, client.orgId);
          await tx.$executeRawUnsafe(backfill);
          after = await tx.outsideAccess.findUnique({ where: { orgId_userId: { orgId: client.orgId, userId: firm.userId } } });
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        })
    );
    expect(after).toMatchObject({ status: 'ACTIVE', apps: null, expiresAt: null, approvedByUserId: null, homeAccountId: firm.accountId });
  }, 90_000);

  it('the table is under forced row-level security', async () => {
    const rows = await outsideTenant('test', () =>
      platformPrisma.$queryRawUnsafe<Array<{ relforcerowsecurity: boolean }>>(`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'OutsideAccess' AND relkind = 'r'`)
    );
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });
});
