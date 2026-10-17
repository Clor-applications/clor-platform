import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * An approved or locked payroll is a record. Locked cannot be cancelled at
 * all; cancelling an approved one leaves its payslips in the audit log; and
 * reopening a locked period is recorded too.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
};

async function approvedRun() {
  const email = `prot.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Prot Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
  const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] })
    .expect(201);
  const person = await api
    .post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } })
    .expect(201);
  await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
  const period = await api.post(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201);
  const id = run.body.run.id;
  await api.post(c, `/runs/${id}/validate`).expect(200);
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  await api.post(c, `/runs/${id}/submit-review`).expect(200);
  await api.post(c, `/runs/${id}/approve`).expect(200);
  return { c, runId: id, periodId: period.body.period.id };
}

describe('an approved or locked payroll', () => {
  it('cannot be cancelled once locked', async () => {
    const { c, runId } = await approvedRun();
    await api.post(c, `/runs/${runId}/lock`).expect(200);
    expect((await api.post(c, `/runs/${runId}/cancel`).expect(409)).body.code).toBe('RUN_LOCKED');
    expect(await payrollPrisma.salarySlip.count({ where: { runId } })).toBe(1);
  });

  it('leaves its payslips in the audit log when an approved one is cancelled', async () => {
    const { c, runId } = await approvedRun();
    await api.post(c, `/runs/${runId}/cancel`).expect(200);
    const entry = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'PAYROLL_RUN', entityId: runId, action: 'CANCEL' } });
    expect(entry).toBeTruthy();
    const meta = JSON.parse(entry!.metadata || '{}');
    expect(meta.fromStatus).toBe('APPROVED');
    expect(meta.slips).toHaveLength(1);
    expect(meta.slips[0].net).toBe(30000);
  });

  it('records reopening a locked period', async () => {
    const { c, periodId } = await approvedRun();
    await api.post(c, `/periods/${periodId}/lock`, { locked: true }).expect(200);
    await api.post(c, `/periods/${periodId}/lock`, { locked: false }).expect(200);
    const actions = (await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'PAYROLL_PERIOD', entityId: periodId } })).map((e) => e.action).sort();
    expect(actions).toEqual(['LOCK', 'UNLOCK']);
  });
});
