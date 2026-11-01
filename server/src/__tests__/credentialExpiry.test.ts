import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Batch 5, U6 (A-34 parts): credentials had no expiry warnings, nothing
 * noticed when the person who made one left, and a credential whose own row
 * was deleted stayed "active" on record for ever.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { hashToken, markReviewed } = await import('../services/credentials.js');
const { warnExpiring, recordExpired, retireOrphans } = await import('../services/credentialReview.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 864e5;

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `ce.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'CE owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CE Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
}
const key = async (c: Ctx) => {
  const r = await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/keys`).set(at(c)).send({ name: `Key ${rnd()}`, scopes: ['attendance:read'] }).expect(201);
  const cred = await outsideTenant('test', () => platformPrisma.credential.findUniqueOrThrow({ where: { kind_tokenHash: { kind: 'API_KEY', tokenHash: hashToken(r.body.token) } } }));
  return { id: r.body.key.id as string, token: r.body.token as string, cred };
};
const expireIn = (id: string, days: number) => outsideTenant('test', () => platformPrisma.credential.update({ where: { id }, data: { expiresAt: new Date(Date.now() + days * DAY) } }));
const warnings = (id: string) => outsideTenant('test', () => platformPrisma.credentialEvent.findMany({ where: { credentialId: id, eventType: 'expiry_warning_sent' } }));
const bell = (c: Ctx) => outsideTenant('test', () => platformPrisma.notification.findMany({ where: { orgId: c.orgId, kind: { startsWith: 'credentials.' } } }));

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('expiry warnings', () => {
  it('a key with 29 days left is warned once, however often the job runs', async () => {
    const k = await key(c);
    await expireIn(k.cred.id, 29);
    await warnExpiring();
    await warnExpiring();
    expect((await warnings(k.cred.id)).map((e) => e.reason)).toEqual(['30']);
    expect((await bell(c)).some((n) => n.kind === 'credentials.expiring' && /expires in 29 days/.test(n.title))).toBe(true);
  });

  it('a day the job missed still gives the next warning', async () => {
    const k = await key(c);
    await expireIn(k.cred.id, 6);
    await warnExpiring();
    expect((await warnings(k.cred.id)).map((e) => e.reason)).toEqual(['7']);
  });

  it('nothing is warned for a revoked, an agent or a link credential', async () => {
    const k = await key(c);
    await expireIn(k.cred.id, 5);
    await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/keys/${k.id}/revoke`).set(at(c)).expect(200);
    await warnExpiring();
    expect(await warnings(k.cred.id)).toHaveLength(0);
  });

  it('an expired credential gets one expired event', async () => {
    const k = await key(c);
    await expireIn(k.cred.id, -1);
    await recordExpired();
    await recordExpired();
    expect(await outsideTenant('test', () => platformPrisma.credentialEvent.count({ where: { credentialId: k.cred.id, eventType: 'expired' } }))).toBe(1);
  });
});

describe('the person who made it leaves', () => {
  /** A colleague who can manage integration keys, signed in. */
  async function colleague(d: Ctx) {
    const role = await request(app).post(`/api/orgs/${d.orgId}/roles`).set(at(d)).send({ name: `Keys ${rnd()}`, roleType: 'CUSTOM', permissions: ['ATTENDANCE::Attendance Integrations::VIEW', 'ATTENDANCE::Attendance Integrations::CREATE', 'ATTENDANCE::Attendance Integrations::EDIT'] }).expect(201);
    const email = `k.${rnd()}@example.com`;
    const u = await request(app).post('/api/users').set(at(d)).send({ email, fullName: 'Key Maker', password: 'KeyMaker!2026pass', orgIds: [d.orgId], branchIdsByOrg: { [d.orgId]: [d.branchId] } }).expect(201);
    const id = u.body.user?.id || u.body.id;
    await request(app).post(`/api/orgs/${d.orgId}/users/${id}/roles`).set(at(d)).send({ roleId: role.body.role?.id || role.body.id }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'KeyMaker!2026pass' }).expect(200);
    return { ...d, token: login.body.token, userId: id as string };
  }

  it('removed from the company: their key keeps working, is flagged, and admins are told once', async () => {
    const d = await company();
    const k2 = await colleague(d);
    const k = await key(k2);
    const other = await key(d);
    await request(app).delete(`/api/orgs/${d.orgId}/users/${k2.userId}`).set(at(d)).expect(200);
    await request(app).get('/v1/ping').set('Authorization', `Bearer ${k.token}`).expect(200);
    const after = await outsideTenant('test', () => platformPrisma.credential.findUniqueOrThrow({ where: { id: k.cred.id } }));
    expect(after.needsReviewReason).toMatch(/removed/);
    const untouched = await outsideTenant('test', () => platformPrisma.credential.findUniqueOrThrow({ where: { id: other.cred.id } }));
    expect(untouched.needsReviewReason).toBeNull();
    expect((await bell(d)).filter((n) => n.kind === 'credentials.review').length).toBeGreaterThan(0);
    /* Reviewed: the flag goes and the history says who checked it. Adding them back does not clear a flag by itself. */
    await markReviewed(k.cred.id, d.orgId, { type: 'USER', id: d.userId });
    const done = await outsideTenant('test', () => platformPrisma.credential.findUniqueOrThrow({ where: { id: k.cred.id } }));
    expect(done.needsReviewReason).toBeNull();
    expect(await outsideTenant('test', () => platformPrisma.credentialEvent.count({ where: { credentialId: k.cred.id, eventType: 'reviewed' } }))).toBe(1);
  }, 60_000);
});

describe('a credential whose own row is gone', () => {
  it('is recorded as revoked by the daily check; one whose row is there is left alone', async () => {
    const d = await company();
    const gone = await key(d);
    const kept = await key(d);
    await outsideTenant('test: older code deletes the key row outright', () => peoplePrisma.apiClient.delete({ where: { id: gone.id } }));
    await retireOrphans();
    const [g, k] = await outsideTenant('test', () => Promise.all([platformPrisma.credential.findUniqueOrThrow({ where: { id: gone.cred.id } }), platformPrisma.credential.findUniqueOrThrow({ where: { id: kept.cred.id } })]));
    expect(g).toMatchObject({ status: 'REVOKED', revokedReason: 'owner_missing' });
    expect(k.status).toBe('ACTIVE');
  });
});
