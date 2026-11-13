import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Support grants end to end (docs/workspace/SUPPORT_GRANTS.md): CLOR staff
 * open a customer's company only after the customer says yes, see what the
 * customer agreed to, never salary, documents or bank details, and leave a
 * line in the customer's audit log for what they opened.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: { token: string; orgId: string; branchId: string }) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(label: string): Promise<Ctx> {
  const email = `sg.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: `${label} owner` }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SG ${label} ${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string; accountId: string };
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, accountId: claims.accountId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return c;
}

/** A member of CLOR staff with an authenticator, and a fresh console step-up. */
async function operator() {
  const op = await company('staff');
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  const stepUp = (await request(app).post('/api/ops/step-up').set({ Authorization: `Bearer ${op.token}` }).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { ...op, ops: { Authorization: `Bearer ${op.token}`, 'x-step-up': stepUp } };
}

const ask = (op: Awaited<ReturnType<typeof operator>>, c: Ctx, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/ops/accounts/${c.accountId}/support-grants`).set(op.ops).send({ orgId: c.orgId, reason: 'Customer says invoices will not save', ...body });
/** CLOR staff, inside the customer's company. */
const inside = (op: Ctx, c: Ctx) => ({ token: op.token, orgId: c.orgId, branchId: c.branchId });
const customerGrants = async (c: Ctx) => (await request(app).get(`/api/orgs/${c.orgId}/support-grants`).set(at(c)).expect(200)).body.grants;
const auditLines = (c: Ctx) => outsideTenant('test: the customer audit log', () => platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'SupportGrant' }, orderBy: { createdAt: 'asc' } }));

describe('a support grant', () => {
  it('opens nothing until the customer says yes, then lets staff read and nothing more', async () => {
    const c = await company('customer');
    const op = await operator();
    const staff = inside(op, c);

    /* Before anything: staff are strangers here. */
    expect((await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(staff))).status).toBe(403);

    const asked = await ask(op, c).expect(201);
    expect(asked.body.grant.state).toBe('PENDING');
    /* Asked is not approved. */
    expect((await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(staff))).status).toBe(403);
    /* A second ask while the first waits is refused. */
    expect((await ask(op, c)).status).toBe(409);

    const [pending] = await customerGrants(c);
    expect(pending).toMatchObject({ state: 'PENDING', scope: 'READ_ONLY', reason: 'Customer says invoices will not save' });

    await request(app).post(`/api/orgs/${c.orgId}/support-grants/${pending.id}/approve`).set(at(c)).send({}).expect(200);
    const [live] = await customerGrants(c);
    expect(live.state).toBe('ACTIVE');
    /* A day, from the moment of approval. */
    const hours = (+new Date(live.expiresAt) - +new Date(live.approvedAt)) / 3_600_000;
    expect(hours).toBe(24);

    /* Reads work, and the app lists the company for them, marked as support. */
    await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(staff)).expect(200);
    const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${op.token}`).expect(200)).body;
    expect(me.orgs.find((o: any) => o.orgId === c.orgId)).toMatchObject({ supportGrant: { scope: 'READ_ONLY' } });

    /* Writes do not. */
    const write = await request(app).post(`/api/orgs/${c.orgId}/branches`).set(at(staff)).send({ name: 'Should not exist' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('SUPPORT_GRANT_READ_ONLY');

    /* Pay stays shut even to read; the customer's own owner still reaches it. */
    const pay = await request(app).get(`/api/orgs/${c.orgId}/payroll/components`).set(at(staff));
    expect(pay.status).toBe(403);
    expect(pay.body.code).toBe('SUPPORT_GRANT_CLOSED');
    await request(app).get(`/api/orgs/${c.orgId}/payroll/components`).set(at(c)).expect(200);

    /* Staff cannot approve their own grants or change who gets in. */
    const self = await request(app).post(`/api/orgs/${c.orgId}/support-grants/${live.id}/end`).set(at(staff)).send({});
    expect(self.status).toBe(403);

    /* The customer reads what happened. */
    const lines = await auditLines(c);
    expect(lines.map((l) => l.action)).toEqual(expect.arrayContaining(['REQUESTED', 'APPROVED', 'VIEWED']));
    expect(lines.find((l) => l.action === 'VIEWED')?.message).toMatch(/ledger\/accounts/);

    /* Ended by the customer: closed at once. */
    await request(app).post(`/api/orgs/${c.orgId}/support-grants/${live.id}/end`).set(at(c)).send({}).expect(200);
    expect((await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(staff))).status).toBe(403);
    expect((await customerGrants(c))[0].state).toBe('ENDED');
  }, 120_000);

  it('lets staff change things only where the customer agreed to it', async () => {
    const c = await company('customer');
    const op = await operator();
    const staff = inside(op, c);
    await ask(op, c, { scope: 'READ_WRITE' }).expect(201);
    const [g] = await customerGrants(c);
    await request(app).post(`/api/orgs/${c.orgId}/support-grants/${g.id}/approve`).set(at(c)).send({ hours: 2 }).expect(200);
    const branch = await request(app).post(`/api/orgs/${c.orgId}/branches`).set(at(staff)).send({ name: `Fixed by support ${rnd()}`, state: 'Karnataka' });
    /* Past the grant and the permission check: whatever the route says next is the route's own answer. */
    expect(branch.status).not.toBe(403);
    expect(branch.body.code).toBeUndefined();
    expect((await auditLines(c)).some((l) => l.action === 'CHANGED')).toBe(true);
  }, 120_000);

  it('can be narrowed by the customer, never widened', async () => {
    const c = await company('customer');
    const op = await operator();
    await ask(op, c).expect(201);
    const [g] = await customerGrants(c);
    const wider = await request(app).post(`/api/orgs/${c.orgId}/support-grants/${g.id}/approve`).set(at(c)).send({ scope: 'READ_WRITE' });
    expect(wider.status).toBe(400);
    expect((await request(app).post(`/api/orgs/${c.orgId}/support-grants/${g.id}/approve`).set(at(c)).send({ hours: 500 })).status).toBe(400);
  }, 120_000);

  it('is refused to anyone who is not CLOR support', async () => {
    const c = await company('customer');
    const stranger = await company('stranger');
    const r = await request(app).post(`/api/ops/accounts/${c.accountId}/support-grants`).set('Authorization', `Bearer ${stranger.token}`).send({ orgId: c.orgId, reason: 'Let me in please, I am support' });
    expect(r.status).toBe(403);
  }, 120_000);

  it('stops opening the company once the person is no longer CLOR staff', async () => {
    const c = await company('customer');
    const op = await operator();
    await ask(op, c).expect(201);
    const [g] = await customerGrants(c);
    await request(app).post(`/api/orgs/${c.orgId}/support-grants/${g.id}/approve`).set(at(c)).send({}).expect(200);
    await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(inside(op, c))).expect(200);
    delete process.env.CLOR_OPERATOR_USER_IDS;
    expect((await request(app).get(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(inside(op, c)))).status).toBe(403);
  }, 120_000);
});
