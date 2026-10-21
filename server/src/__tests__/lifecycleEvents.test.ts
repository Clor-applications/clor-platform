import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import http from 'node:http';

/**
 * Lifecycle events (HR research: EmployeeTransferred, EmploymentEnded,
 * PayrollPeriodLocked): other systems hear about moves, leaving, rehiring
 * and a locked pay run, whichever screen made them.
 */
/* The test receiver listens on 127.0.0.1, which deliveries refuse unless allowed. */
process.env.INTEGRATIONS_ALLOW_PRIVATE = 'true';
const { buildApp } = await import('../app.js');
const { flushWebhooks } = await import('../services/attendance/webhooks.js');

const app = buildApp().listen(0);
const got: Array<{ event: string; data: any }> = [];
const sink = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const j = JSON.parse(body);
      got.push({ event: j.event, data: j.data });
    } catch {
      /* not ours */
    }
    res.statusCode = 204;
    res.end();
  });
}).listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await new Promise((done) => sink.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('lifecycle events', () => {
  it('sends transferred, left, rehired and payroll.locked', async () => {
    const email = `life.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Life Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
    const port = (sink.address() as any).port;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/webhooks`).set(at(c))
      .send({ name: 'HRMS', url: `http://127.0.0.1:${port}/clor`, events: ['employee.transferred', 'employee.left', 'employee.rehired', 'payroll.locked'] }).expect(201);
    const people = (m: 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

    const ops = (await people('post', '/structure/departments', { name: 'Operations' }).expect(201)).body.item;
    const e = (await people('post', '/employees', { name: 'Ravi', code: 'L1', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    await people('post', '/employees/transfer', { employeeIds: [e.id], field: 'departmentId', targetId: ops.id, effectiveDate: '2026-11-01' }).expect(200);
    await people('post', `/employees/${e.id}/resign`, { lastDay: '2026-12-31', leavingType: 'RESIGNED' }).expect(200);
    await people('post', `/employees/${e.id}/rehire`, { rejoinDate: '2027-02-01' }).expect(200);

    /* A pay run locked. */
    const post = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any);
    const basic = await post('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await post('/structures', { name: `S ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const p = await post('/employees', { name: 'Paid', code: 'L2', dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    await post('/assignments', { employeeId: p.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    const period = await post('/periods', { name: 'Sept', startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
    const run = (await post('/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
    for (const s of ['validate', 'calculate', 'submit-review', 'approve', 'lock']) await post(`/runs/${run}/${s}`).expect(200);

    await flushWebhooks();
    const events = got.map((g) => g.event);
    expect(events).toEqual(expect.arrayContaining(['employee.transferred', 'employee.left', 'employee.rehired', 'payroll.locked']));
    const moved = got.find((g) => g.event === 'employee.transferred')!.data;
    expect(moved).toMatchObject({ field: 'departmentId', to: { id: ops.id, name: 'Operations' }, effectiveDate: '2026-11-01', source: 'TRANSFER', employee: { id: e.id, code: 'L1' } });
    expect(got.filter((g) => g.event === 'employee.left')).toHaveLength(1);
    expect(got.find((g) => g.event === 'payroll.locked')!.data).toMatchObject({ runId: run, status: 'LOCKED' });
  }, 90_000);
});
