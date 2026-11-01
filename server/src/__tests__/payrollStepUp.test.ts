import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Authenticator codes (RFC 6238) and step-up for money-moving payroll
 * actions: off unless the company asks; then a code within fifteen minutes,
 * used once; a recovery code once; a step-up token that is nobody else's.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { base32Encode, codeAt, stepNow, verifyCode } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

describe('TOTP', () => {
  it('matches the RFC 6238 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(codeAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
  });

  it('allows one step of clock drift, and no code twice', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const at = 1_800_000_000_000;
    const now = stepNow(at);
    expect(verifyCode(secret, codeAt(secret, now - 1), null, at)).toBe(now - 1);
    expect(verifyCode(secret, codeAt(secret, now - 2), null, at)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, now), now, at)).toBeNull();
    expect(verifyCode(secret, 'abcdef', null, at)).toBeNull();
  });
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId, ...extra });
const sec = (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/security${path}`).set(at(c)).send(body as any);

async function makeOwner(): Promise<Ctx> {
  const email = `step.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Step Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
  return c;
}

/** A run ready to approve. */
async function runInReview(c: Ctx) {
  const post = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any);
  const basic = await post('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await post('/structures', { name: `S ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  const person = await post('/employees', { name: 'Ravi', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  await post('/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  const period = await post('/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = (await post('/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  for (const s of ['validate', 'calculate', 'submit-review']) await post(`/runs/${run}/${s}`).expect(200);
  return { approve: (headers: Record<string, string> = {}) => request(app).post(`/api/orgs/${c.orgId}/payroll/runs/${run}/approve`).set(at(c, headers)) };
}

const policy = async (c: Ctx, on: boolean) => {
  const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
  await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...current, requirePayrollStepUp: on }).expect(200);
};

describe('step-up for payroll', () => {
  it('asks nothing unless the company switches it on', async () => {
    const c = await makeOwner();
    const run = await runInReview(c);
    await run.approve().expect(200);
  });

  it('needs an authenticator set up, then a fresh code, used once', async () => {
    const c = await makeOwner();
    const run = await runInReview(c);
    await policy(c, true);
    expect((await run.approve().expect(403)).body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');

    const { secret, uri } = (await sec(c, '/two-factor/setup').expect(200)).body;
    expect(uri).toContain(`secret=${secret}`);
    await sec(c, '/two-factor/enable', { code: '000000' }).expect(400);
    await clearOfStepEdge();
    const s0 = stepNow();
    const enabled = (await sec(c, '/two-factor/enable', { code: codeAt(secret, s0) }).expect(200)).body;
    expect(enabled.recoveryCodes).toHaveLength(8);

    expect((await run.approve().expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    /* The code just used to switch it on cannot be used again. */
    expect((await sec(c, '/step-up', { code: codeAt(secret, s0) }).expect(400)).body.code).toBe('BAD_CODE');
    const next = codeAt(secret, s0 + 1);
    const { token } = (await sec(c, '/step-up', { code: next }).expect(200)).body;
    await sec(c, '/step-up', { code: next }).expect(400);

    /* Not an access token, and not one for a forged value. */
    await request(app).get(`/api/orgs/${c.orgId}/payroll/runs`).set({ ...at(c), Authorization: `Bearer ${token}` }).expect(401);
    await run.approve({ 'x-step-up': `${token}x` }).expect(403);
    await run.approve({ 'x-step-up': token }).expect(200);
  });

  it('takes a recovery code once, and is somebody else’s token for nobody else', async () => {
    const c = await makeOwner();
    await policy(c, true);
    const { secret } = (await sec(c, '/two-factor/setup').expect(200)).body;
    await clearOfStepEdge();
    const { recoveryCodes } = (await sec(c, '/two-factor/enable', { code: codeAt(secret, stepNow()) }).expect(200)).body;
    const { token } = (await sec(c, '/step-up', { code: recoveryCodes[0] }).expect(200)).body;
    await sec(c, '/step-up', { code: recoveryCodes[0] }).expect(400);
    expect((await request(app).get(`/api/orgs/${c.orgId}/security/two-factor`).set(at(c)).expect(200)).body).toMatchObject({ enabled: true, recoveryCodesLeft: 7, payrollStepUp: true });

    const other = await makeOwner();
    await policy(other, true);
    const s2 = (await sec(other, '/two-factor/setup').expect(200)).body.secret;
    await clearOfStepEdge();
    await sec(other, '/two-factor/enable', { code: codeAt(s2, stepNow()) }).expect(200);
    const run = await runInReview(other);
    expect((await run.approve({ 'x-step-up': token }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');

    await sec(c, '/two-factor/disable', { password: 'wrong', code: recoveryCodes[1] }).expect(400);
    /* A-10: the password alone no longer takes the second factor off. */
    expect((await sec(c, '/two-factor/disable', { password: 'Passw0rd!23' }).expect(400)).body.code).toBe('BAD_CODE');
    await sec(c, '/two-factor/disable', { password: 'Passw0rd!23', code: recoveryCodes[1] }).expect(200);
  });
});
