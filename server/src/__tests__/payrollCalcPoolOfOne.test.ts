import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Production runs the payroll client with one connection
 * (scripts/cloudrun-start.sh: DB_POOL_PAYROLL, default 1). A calculation
 * that holds a connection while it asks for another waits on itself and
 * times out: in the re-review of PR #82, calculate answered 500 after ten
 * seconds.
 *
 * This file sets the payroll pool to one before the app is loaded (each test
 * file gets its own modules), so every calculation here runs as it does in
 * production.
 */
const url = new URL(process.env.PAYROLL_DATABASE_URL!);
url.searchParams.set('connection_limit', '1');
url.searchParams.set('pool_timeout', '10');
process.env.PAYROLL_DATABASE_URL = url.toString();

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
};

async function makeOwner(): Promise<Ctx> {
  const email = `pool1.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Pool Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

async function runWithPeople(c: Ctx, n: number) {
  const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
  for (let i = 0; i < n; i += 1) {
    const p = await api.post(c, '/employees', { name: `P${i}`, code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    await api.post(c, '/assignments', { employeeId: p.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  }
  const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id as string;
  await api.post(c, `/runs/${runId}/validate`).expect(200);
  return runId;
}

const slips = (c: Ctx, runId: string) => runInTenant(c.orgId, () => payrollPrisma.salarySlip.count({ where: { orgId: c.orgId, runId } }));

describe('calculating with one payroll connection, as production does', () => {
  it('the pool here really is one connection', () => {
    expect(new URL(process.env.PAYROLL_DATABASE_URL!).searchParams.get('connection_limit')).toBe('1');
  });

  it('a calculation answers, and recalculating answers again', async () => {
    const c = await makeOwner();
    const runId = await runWithPeople(c, 2);
    const first = await api.post(c, `/runs/${runId}/calculate`);
    expect(first.status).toBe(200);
    expect(first.body.calculated).toBe(2);
    expect((await api.post(c, `/runs/${runId}/calculate`)).status).toBe(200);
    expect(await slips(c, runId)).toBe(2);
  }, 120_000);

  it('three calculations at once all answer, one after another, and leave one set of payslips', async () => {
    const c = await makeOwner();
    const runId = await runWithPeople(c, 2);
    const out = await Promise.all([0, 1, 2].map(() => api.post(c, `/runs/${runId}/calculate`)));
    expect(out.map((o) => o.status)).toEqual([200, 200, 200]);
    expect(await slips(c, runId)).toBe(2);
    /* Let go after: nothing is left marked as being calculated. */
    const run = await runInTenant(c.orgId, () => payrollPrisma.payrollRun.findFirstOrThrow({ where: { id: runId } }));
    expect((run as any).calcLeaseToken).toBeNull();
  }, 180_000);

  it('cancelling a calculated payroll answers too', async () => {
    const c = await makeOwner();
    const runId = await runWithPeople(c, 1);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect((await api.post(c, `/runs/${runId}/cancel`)).status).toBe(200);
    expect(await slips(c, runId)).toBe(0);
  }, 120_000);
});
