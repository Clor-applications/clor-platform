import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Payslips in the employee app: the person's own, only once the payroll is
 * final (locked, paid or posted), with PAN and bank account masked.
 */
const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('portal payslips', () => {
  it('shows a payslip only after the payroll is locked, with PAN and account masked', async () => {
    const email = `slip.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Slip Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
    const post = (p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any);

    const basic = await post('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await post('/structures', { name: `S ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const person = await post('/employees', {
      name: 'Ravi', code: 'P101', dateOfJoining: '2026-01-01', status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankName: 'SBI', ifsc: 'SBIN0000001' },
    }).expect(201);
    const employeeId = person.body.employee.id;
    await post('/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    const period = await post('/periods', { name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
    const run = (await post('/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
    for (const s of ['validate', 'calculate', 'submit-review', 'approve']) await post(`/runs/${run}/${s}`).expect(200);

    const access = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
    const code = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: 'P101', activationCode: code, password: 'mine pass 1' }).expect(200)).body.token;
    const me = { Authorization: `Bearer ${token}` };

    /* Approved but not locked: not yet the employee's to see. */
    expect((await request(app).get('/api/portal/payslips').set(me).expect(200)).body).toMatchObject({ available: true, slips: [] });
    const slipId = (await payrollPrisma.salarySlip.findFirstOrThrow({ where: { orgId: c.orgId, employeeId } })).id;
    await request(app).get(`/api/portal/payslips/${slipId}`).set(me).expect(404);

    await post(`/runs/${run}/lock`).expect(200);
    const list = (await request(app).get('/api/portal/payslips').set(me).expect(200)).body;
    expect(list.slips).toHaveLength(1);
    expect(list.slips[0]).toMatchObject({ id: slipId, period: 'September 2026', gross: 30_000 });

    const slip = (await request(app).get(`/api/portal/payslips/${slipId}`).set(me).expect(200)).body.slip;
    expect(slip.earnings).toEqual([{ name: 'Basic', amount: 30_000 }]);
    expect(slip.net).toBe(list.slips[0].net);
    expect(slip.employee.pan).toBe('••••••234F');
    expect(slip.employee.account).toBe('••••••••9012');
    expect(JSON.stringify(slip)).not.toContain('ABCDE1234F');
  }, 60_000);
});
