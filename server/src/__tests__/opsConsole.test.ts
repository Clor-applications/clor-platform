import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * The Clor operator console (W-8.2): Clor staff only, with an authenticator,
 * a fresh code for every change, every change on the record, and a suspended
 * account closed to everybody until reinstated.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(): Promise<Ctx> {
  const email = `ops.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Ops Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId, email };
}
/** Enrol an authenticator; returns a function giving a fresh code. */
async function authenticator(c: Ctx) {
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any);
  const { secret } = (await sec('/two-factor/setup').expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  return (n = 0) => codeAt(secret, stepNow() + n);
}
const stepUp = async (op: Ctx, code: string) => (await request(app).post('/api/ops/step-up').set(bearer(op)).send({ code }).expect(200)).body.token as string;

describe('the operator console', () => {
  it('is closed to customers, to anyone unsigned, and to an operator without an authenticator', async () => {
    const op = await company();
    const c = await company();
    await request(app).get('/api/ops/overview').expect(401);
    expect((await request(app).get('/api/ops/accounts').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    expect((await request(app).get('/api/ops/accounts').set(bearer(op)).expect(403)).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  }, 60_000);

  it('lets an operator set up an authenticator from the console, and nobody else', async () => {
    const op = await company();
    const c = await company();
    /* A customer cannot use the console's set-up. */
    expect((await request(app).post('/api/ops/two-factor/setup').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    const { secret } = (await request(app).post('/api/ops/two-factor/setup').set(bearer(op)).expect(200)).body;
    expect((await request(app).post('/api/ops/two-factor/enable').set(bearer(op)).send({ code: '000000' }).expect(400)).body.code).toBe('BAD_CODE');
    const on = (await request(app).post('/api/ops/two-factor/enable').set(bearer(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body;
    expect(on.recoveryCodes.length).toBeGreaterThan(0);
    /* Now the console opens, and a second set-up is refused. */
    expect((await request(app).get('/api/ops/me').set(bearer(op)).expect(200)).body.role).toBe('SUPER_ADMIN');
    expect((await request(app).post('/api/ops/two-factor/setup').set(bearer(op)).expect(409)).body.code).toBe('ALREADY_ENABLED');
    const logged = await platformPrisma.operatorAuditEvent.findFirst({ where: { operatorUserId: op.userId, action: 'TWO_FACTOR_ENABLED' } });
    expect(logged).not.toBeNull();
  }, 60_000);

  it('shows a bootstrap operator every account, its owner and its plan, and one account in detail', async () => {
    const op = await company();
    const c = await company();
    await authenticator(op);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    expect((await request(app).get('/api/ops/me').set(bearer(op)).expect(200)).body.role).toBe('SUPER_ADMIN');
    const list = (await request(app).get('/api/ops/accounts').query({ q: c.email }).set(bearer(op)).expect(200)).body;
    expect(list.total).toBe(1);
    /* Found by its company's code and by a person's ID too, old or new. */
    const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId }, select: { code: true } });
    const owner = await platformPrisma.user.findUniqueOrThrow({ where: { id: c.userId }, select: { code: true } });
    const old = `ZZ${rnd().toUpperCase()}-C100`;
    await platformPrisma.org.update({ where: { id: c.orgId }, data: { legacyCode: old } });
    for (const q of [org.code!, owner.code!, old.toLowerCase()]) {
      const hit = (await request(app).get('/api/ops/accounts').query({ q }).set(bearer(op)).expect(200)).body;
      expect(hit.accounts.map((a: any) => a.id)).toContain(c.accountId);
    }
    expect(list.accounts[0]).toMatchObject({ id: c.accountId, companies: 1, users: 1, owner: { email: c.email } });
    const one = (await request(app).get(`/api/ops/accounts/${c.accountId}`).set(bearer(op)).expect(200)).body;
    expect(one.members[0]).toMatchObject({ role: 'OWNER', email: c.email });
    expect(one.companies).toHaveLength(1);
    const ov = (await request(app).get('/api/ops/overview').set(bearer(op)).expect(200)).body;
    expect(ov.signups).toHaveLength(30);
    expect(ov.accounts).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('suspends an account only with a fresh code; the customer is shut out, sees why, and is let back in', async () => {
    const op = await company();
    const c = await company();
    const code = await authenticator(op);
    process.env.CLOR_OPERATOR_USER_IDS = op.userId;
    await request(app).get('/api/branches').set(at(c)).expect((r) => expect(r.status).not.toBe(403));

    const noCode = await request(app).post(`/api/ops/accounts/${c.accountId}/suspend`).set(bearer(op)).send({ reason: 'Unpaid invoice' }).expect(403);
    expect(noCode.body.code).toBe('STEP_UP_REQUIRED');
    const token = await stepUp(op, code());
    await request(app).post(`/api/ops/accounts/${c.accountId}/suspend`).set({ ...bearer(op), 'x-step-up': token }).send({ reason: 'Unpaid invoice' }).expect(200);

    const shut = await request(app).get('/api/branches').set(at(c)).expect(403);
    expect(shut.body.code).toBe('ACCOUNT_SUSPENDED');

    await request(app).post(`/api/ops/accounts/${c.accountId}/reinstate`).set({ ...bearer(op), 'x-step-up': token }).send({ reason: 'Paid' }).expect(200);
    await request(app).get('/api/branches').set(at(c)).expect((r) => expect(r.status).not.toBe(403));

    const log = (await request(app).get('/api/ops/audit').query({ accountId: c.accountId }).set(bearer(op)).expect(200)).body.events;
    expect(log.map((e: any) => e.action)).toEqual(['ACCOUNT_REINSTATED', 'ACCOUNT_SUSPENDED']);
    expect(log[1].detail).toMatchObject({ reason: 'Unpaid invoice' });
    /* The customer's own security record shows that Clor acted. */
    const seen = await platformPrisma.authEvent.findMany({ where: { accountId: c.accountId, eventType: { startsWith: 'OPERATOR_' } } });
    expect(seen.map((e) => e.eventType).sort()).toEqual(['OPERATOR_ACCOUNT_REINSTATED', 'OPERATOR_ACCOUNT_SUSPENDED']);
  }, 60_000);

  it('keeps the operator record append-only', async () => {
    const op = await company();
    const row = await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: op.userId, action: 'TEST' } });
    await expect(platformPrisma.operatorAuditEvent.update({ where: { id: row.id }, data: { action: 'CHANGED' } })).rejects.toThrow(/append_only/);
    await expect(platformPrisma.operatorAuditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append_only/);
  }, 60_000);

  it('lets a super admin add a support operator, who cannot touch billing or other operators', async () => {
    const boss = await company();
    const sup = await company();
    const c = await company();
    const bossCode = await authenticator(boss);
    const supCode = await authenticator(sup);
    process.env.CLOR_OPERATOR_USER_IDS = boss.userId;
    const bt = await stepUp(boss, bossCode());
    await request(app).post('/api/ops/operators').set({ ...bearer(boss), 'x-step-up': bt }).send({ email: sup.email, role: 'SUPPORT' }).expect(201);
    expect((await request(app).get('/api/ops/me').set(bearer(sup)).expect(200)).body.role).toBe('SUPPORT');
    const st = await stepUp(sup, supCode());
    expect((await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set({ ...bearer(sup), 'x-step-up': st }).send({ days: 7, reason: 'Asked' }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await request(app).get('/api/ops/operators').set(bearer(sup)).expect(403)).body.code).toBe('OPERATOR_ROLE');
    /* Switched off, they are no operator at all. */
    await request(app).patch(`/api/ops/operators/${sup.userId}`).set({ ...bearer(boss), 'x-step-up': bt }).send({ active: false }).expect(200);
    expect((await request(app).get('/api/ops/me').set(bearer(sup)).expect(403)).body.code).toBe('OPERATOR_ONLY');
  }, 90_000);
});
