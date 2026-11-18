import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Payslips in the employee app: the person's own, only once the payroll is
 * final (locked, paid or posted), with PAN and bank account masked.
 */
const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
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
    /* Nothing moved: no note. */
    expect(slip.deductionNote).toBeNull();
    expect(slip.leaving).toBe(false);

    /* A deduction held to the legal share and moved on: the employee's copy says so, as Payroll's does (deductionCap.ts). */
    const note = { percent: 50, wages: 30_000, limit: 15_000, counted: 2_000, reason: 'LIMIT', total: 4_000, carried: [{ label: 'Loan Recovery', amount: 4_000 }] };
    await payrollPrisma.salarySlip.update({ where: { id: slipId }, data: { deductionNote: note } });
    const carried = (await request(app).get(`/api/portal/payslips/${slipId}`).set(me).expect(200)).body.slip;
    expect(carried.deductionNote).toEqual(note);

    /* Since April: this financial year so far, read from final payslips. No PF on this payslip, so no PF card. */
    expect(slip.sinceApril).toMatchObject({ from: '2026-04-01', payslips: 1, gross: 30_000, tax: 0, pf: 0, net: slip.net });
    expect(slip.pf).toBeNull();
    expect(list.pfSaved).toBeNull();

    /* A payslip that carried PF: the employee's PF line, and the company's share split into pension (EPS) and fund (EPF)
       as the statutory snapshot recorded it. The figures are read back, never worked out again. */
    const pfComponent = await payrollPrisma.salaryComponent.findFirst({ where: { orgId: c.orgId, statutoryScheme: 'PF' } })
      ?? await payrollPrisma.salaryComponent.create({ data: { accountId: (await payrollPrisma.salarySlip.findUniqueOrThrow({ where: { id: slipId } })).accountId, orgId: c.orgId, name: 'Provident Fund', code: `PF${rnd()}`, type: 'DEDUCTION', statutoryScheme: 'PF', createdByUserId: 'test' } as any });
    const held = await payrollPrisma.salarySlip.findUniqueOrThrow({ where: { id: slipId } });
    await payrollPrisma.salarySlipLine.create({ data: { accountId: held.accountId, orgId: c.orgId, slipId, componentId: pfComponent.id, componentCode: pfComponent.code, componentName: pfComponent.name, type: 'DEDUCTION', amount: 1_800, displayOrder: 9 } });
    await payrollPrisma.salarySlip.update({ where: { id: slipId }, data: { statutorySnapshotJson: JSON.stringify({ results: [{ scheme: 'PF', employee: 1_800, employer: 1_800, employerSplit: { EPS: 1_250, EPF: 550 } }] }) } });
    const withPf = (await request(app).get(`/api/portal/payslips/${slipId}`).set(me).expect(200)).body.slip;
    expect(withPf.pf).toEqual({ employee: 1_800, pension: 1_250, employer: 550 });
    expect(withPf.sinceApril).toMatchObject({ pf: 1_800, gross: 30_000 });
    const saved = (await request(app).get('/api/portal/payslips').set(me).expect(200)).body.pfSaved;
    expect(saved).toEqual({ since: held.payrollDate, payslips: 1, employee: 1_800, employer: 550, pension: 1_250, fund: 2_350 });
  }, 60_000);
});
