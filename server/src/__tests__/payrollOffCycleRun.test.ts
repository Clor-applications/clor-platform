import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * An extra pay run (OFF_CYCLE): a second payroll in the same month, beside the
 * regular one, for a late joiner's days, a bonus or arrears.
 *
 * What it holds shut: regular runs stay one per period while extra runs sit
 * beside them; an extra waits for the month's salary to be approved; PF on an
 * extra is the difference it makes under the ceiling, professional tax is not
 * taken twice in a month, and income tax is the whole year's increase taken
 * at once; a late joiner in it is paid their days like any payroll; the
 * payslips say "Extra pay run"; and it is approved, paid and posted like a
 * regular run. April 2026, so twelve months are left in the tax year.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `offc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Extra Run Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  await api.post(ctx, '/statutory/seed').expect(200);
  const { body } = await api.get(ctx, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => ['PF', 'TDS', 'PT'].includes(x.code))) await api.put(ctx, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  return ctx;
}

async function company(c: Ctx) {
  const { ensureLedgerSetup } = await import('../services/ledger.js');
  await ensureLedgerSetup(c.accountId, c.orgId, 'test');
  const expense = await prisma.ledgerAccount.findFirst({ where: { accountId: c.accountId, orgId: c.orgId, isActive: true, controlKind: 'EXPENSES' }, select: { id: true } });
  const owed = await prisma.ledgerAccount.findFirst({ where: { accountId: c.accountId, orgId: c.orgId, isActive: true, accountType: 'LIABILITY' }, select: { id: true } });
  const books = { expenseLedgerId: expense?.id || null, liabilityLedgerId: owed?.id || null };
  const mk = async (payload: Record<string, unknown>) => (await api.post(c, '/components', payload).expect(201)).body.component;
  const basic = await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, expenseLedgerId: expense?.id || null, displayOrder: 1 });
  const special = await mk({ name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', expenseLedgerId: expense?.id || null, displayOrder: 2 });
  const epf = await mk({ name: 'Employee PF', code: 'EPF', type: 'DEDUCTION', ...books, calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 });
  const erpf = await mk({ name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION', ...books, calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20 });
  const pt = await mk({ name: 'Professional Tax', code: 'PT', type: 'DEDUCTION', ...books, calculationMethod: 'STATUTORY', statutoryScheme: 'PT', includeInGross: false, isTaxable: false, displayOrder: 11 });
  const tds = await mk({ name: 'Income tax', code: 'TDS', type: 'DEDUCTION', ...books, calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 12 });
  /* Outside every structure, as a bonus and arrears are: one not in PF wages, one that is (arrears of basic). */
  const bonus = await mk({ name: 'Performance bonus', code: 'BONUS', type: 'EARNING', calculationMethod: 'VARIABLE', expenseLedgerId: expense?.id || null, displayOrder: 30 });
  const arrears = await mk({ name: 'Basic arrears', code: 'BASIC_ARR', type: 'EARNING', calculationMethod: 'VARIABLE', includeInPfWage: true, expenseLedgerId: expense?.id || null, displayOrder: 31 });
  const structure = (
    await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE',
        components: [
          { componentId: basic.id, displayOrder: 1 },
          { componentId: special.id, isBalancing: true, displayOrder: 2 },
          { componentId: epf.id, displayOrder: 10 },
          { componentId: erpf.id, displayOrder: 20 },
          { componentId: pt.id, displayOrder: 11 },
          { componentId: tds.id, displayOrder: 12 },
        ],
      })
      .expect(201)
  ).body.structure.id;
  const period = (await api.post(c, '/periods', { name: `April 2026 ${rnd()}`, startDate: '2026-04-01', endDate: '2026-04-30', paymentDate: '2026-04-30' }).expect(201)).body.period.id;
  return { structure, period, bonus: bonus.id, arrears: arrears.id };
}

async function person(c: Ctx, structureId: string, name: string, annualCtc: number, joined = '2026-04-01') {
  const made = await api
    .post(c, '/employees', {
      name, code: `E${rnd().toUpperCase()}`, dateOfJoining: joined, status: 'ACTIVE',
      payroll: {
        payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', pfApplicable: true, ptApplicable: true, professionalTaxState: 'Karnataka',
        bankAccountName: name, bankAccountNumber: `55500011${Math.floor(Math.random() * 1e6)}`, bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank',
      },
    })
    .expect(201);
  await api.post(c, '/assignments', { employeeId: made.body.employee.id, structureId, effectiveFrom: joined, annualCtc }).expect(201);
  return made.body.employee.id as string;
}

const slipsOf = async (runId: string) => payrollPrisma.salarySlip.findMany({ where: { runId }, include: { lines: true } });
const line = (slips: Awaited<ReturnType<typeof slipsOf>>, employeeId: string, code: string) =>
  Number(slips.find((s) => s.employeeId === employeeId)?.lines.find((l) => l.componentCode === code)?.amount ?? 0);

describe('an extra pay run beside the regular payroll', () => {
  let c: Ctx;
  let ids: Awaited<ReturnType<typeof company>>;
  let high = '';
  let modest = '';
  let late = '';
  let regularId = '';
  let extraId = '';

  beforeAll(async () => {
    c = await makeOwner();
    ids = await company(c);
    /* ₹24 lakh a year: basic ₹1,00,000 a month, well past the PF ceiling; tax in the 25% band. */
    high = await person(c, ids.structure, 'Anika Rao', 2_400_000);
    /* ₹3 lakh: basic ₹12,500, under the ₹15,000 ceiling. */
    modest = await person(c, ids.structure, 'Bharat Iyer', 300_000);
    const regular = await api.post(c, '/runs', { periodId: ids.period }).expect(201);
    regularId = regular.body.run.id;
    expect(regular.body.run.kind).toBe('REGULAR');
    await api.post(c, `/runs/${regularId}/validate`).expect(200);
    await api.post(c, `/runs/${regularId}/calculate`).expect(200);
    /* Joined on the 16th, after the month's payroll was started: not on it. */
    late = await person(c, ids.structure, 'Chitra Menon', 600_000, '2026-04-16');
  });

  it('keeps the regular payroll one per period, and lets an extra run sit beside it', async () => {
    const again = await api.post(c, '/runs', { periodId: ids.period });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('RUN_EXISTS');

    const extra = await api.post(c, '/runs', { periodId: ids.period, kind: 'OFF_CYCLE', people: [] }).expect(201);
    extraId = extra.body.run.id;
    expect(extra.body.run.kind).toBe('OFF_CYCLE');
    expect(extra.body.run.number).not.toBe((await api.get(c, `/runs/${regularId}`).expect(200)).body.run.number);
    /* And a second extra run in the same month is fine too. */
    await api.post(c, '/runs', { periodId: ids.period, kind: 'OFF_CYCLE' }).expect(201);
  });

  it('takes amounts as earnings only, on an extra pay run only', async () => {
    const onRegular = await api.put(c, `/runs/${regularId}/extra-pay`, { employeeId: high, items: [] });
    expect(onRegular.status).toBe(409);
    expect(onRegular.body.code).toBe('NOT_EXTRA_RUN');
    const epf = (await payrollPrisma.salaryComponent.findFirst({ where: { orgId: c.orgId, code: 'EPF' } }))!;
    const deduction = await api.put(c, `/runs/${extraId}/extra-pay`, { employeeId: high, items: [{ componentId: epf.id, amount: 100 }] });
    expect(deduction.status).toBe(400);

    await api.put(c, `/runs/${extraId}/extra-pay`, { employeeId: high, pays: 'EXTRA', items: [{ componentId: ids.bonus, amount: 50_000, reason: 'Q4 bonus' }, { componentId: ids.arrears, amount: 10_000 }] }).expect(200);
    await api.put(c, `/runs/${extraId}/extra-pay`, { employeeId: modest, pays: 'EXTRA', items: [{ componentId: ids.arrears, amount: 5_000, reason: 'Arrears for March' }] }).expect(200);
    const saved = await api.put(c, `/runs/${extraId}/extra-pay`, { employeeId: late, pays: 'SALARY', items: [] }).expect(200);
    expect(saved.body.pays).toBe('SALARY');

    const detail = (await api.get(c, `/runs/${extraId}`).expect(200)).body;
    const anika = detail.employees.find((m: any) => m.employeeId === high);
    expect(anika.pays).toBe('EXTRA');
    expect(anika.extraPay.map((i: any) => i.amount).sort()).toEqual([10_000, 50_000]);
    /* Its own from the start: the regular payroll, still open, does not take them. */
    const rows = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, employeeId: high } });
    expect(rows.every((r) => r.status === 'CONSUMED' && r.consumedByRunId === extraId)).toBe(true);
  });

  it('waits for the month’s salary to be approved before working out an extra', async () => {
    const checks = (await api.post(c, `/runs/${extraId}/validate`).expect(200)).body;
    const codes = (checks.issues || []).filter((i: any) => i.severity === 'ERROR').map((i: any) => i.code);
    expect(codes).toContain('SALARY_RUN_OPEN');
    /* The late joiner, here for salary, is not held up by it, and is not "already paid". */
    expect((checks.issues || []).filter((i: any) => i.employeeId === late && i.severity === 'ERROR')).toEqual([]);
  });

  it('works an extra out on top of the approved salary: PF to the ceiling, PT once, the year’s tax at once', async () => {
    await api.post(c, `/runs/${regularId}/calculate`).expect(200);
    await api.post(c, `/runs/${regularId}/submit-review`).expect(200);
    await api.post(c, `/runs/${regularId}/approve`).expect(200);
    const regular = await slipsOf(regularId);
    expect(line(regular, high, 'EPF')).toBe(1800);
    expect(line(regular, modest, 'EPF')).toBe(1500);
    expect(line(regular, high, 'PT')).toBe(200);
    /* ₹23,500 after the company's PF comes out of the ₹25,000: under Karnataka's ₹25,000 line, so no PT. */
    expect(line(regular, modest, 'PT')).toBe(0);

    const checks = (await api.post(c, `/runs/${extraId}/validate`).expect(200)).body;
    expect((checks.issues || []).filter((i: any) => i.severity === 'ERROR')).toEqual([]);
    await api.post(c, `/runs/${extraId}/calculate`).expect(200);
    const extra = await slipsOf(extraId);
    expect(extra).toHaveLength(3);

    const anika = extra.find((s) => s.employeeId === high)!;
    expect(Number(anika.grossEarnings)).toBe(60_000);
    /* Basic is past the ceiling already: arrears of basic add no PF. */
    expect(line(extra, high, 'EPF')).toBe(0);
    expect(line(extra, high, 'PT')).toBe(0);
    /*
     * The year: April's ₹2,00,000 paid, eleven months more at that, and
     * ₹60,000 once. ₹23,25,000 taxable without it, ₹23,85,000 with it, all in
     * the 25% band: ₹15,000 more tax, with 4% cess ₹15,600, taken in full now
     * rather than spread over the months left.
     */
    expect(line(extra, high, 'TDS')).toBe(15_600);
    expect(Number(anika.netPay)).toBe(60_000 - 15_600);
    /* No salary components again, and no days. */
    expect(line(extra, high, 'BASIC')).toBe(0);
    expect(JSON.parse(anika.inputSnapshotJson).payableDays).toBe(0);

    /* ₹12,500 basic and ₹5,000 arrears: PF wages ₹17,500, capped at ₹15,000, so ₹300 more than the ₹1,500 taken. */
    expect(line(extra, modest, 'EPF')).toBe(300);
    expect(line(extra, modest, 'ER_PF')).toBe(300);
    /* The arrears take the month past ₹25,000: PT is due for the month now, once, on this payslip. */
    expect(line(extra, modest, 'PT')).toBe(200);

    /* The late joiner: fifteen of thirty days, worked out like any payroll (₹25,000 of CTC less the company's PF). */
    const chitra = extra.find((s) => s.employeeId === late)!;
    expect(Number(chitra.grossEarnings)).toBe(24_250);
    expect(line(extra, late, 'BASIC')).toBe(12_500);
    expect(line(extra, late, 'EPF')).toBe(1500);
    expect(JSON.parse(chitra.inputSnapshotJson).payableDays).toBe(15);
  });

  it('marks its payslips "Extra pay run", and only its own', async () => {
    const extra = (await api.get(c, `/slips?runId=${extraId}`).expect(200)).body.slips;
    expect(extra.every((s: any) => s.extraPayRun === true)).toBe(true);
    const regular = (await api.get(c, `/slips?runId=${regularId}`).expect(200)).body.slips;
    expect(regular.every((s: any) => s.extraPayRun === false)).toBe(true);
    const one = (await api.get(c, `/slips/${extra[0].id}`).expect(200)).body.slip;
    expect(one.extraPayRun).toBe(true);
  });

  it('is approved, paid by bank file and posted like a regular payroll', async () => {
    await api.post(c, `/runs/${extraId}/submit-review`).expect(200);
    await api.post(c, `/runs/${extraId}/approve`).expect(200);
    const posted = await api.post(c, `/runs/${extraId}/post`);
    expect(posted.status).toBe(201);

    const preview = (await api.get(c, `/runs/${extraId}/payment-preview`).expect(200)).body.preview;
    expect(preview.payable).toHaveLength(3);
    expect(preview.totalAmount).toBe(Math.round(Number((await slipsOf(extraId)).reduce((t, s) => t + Number(s.netPay), 0))));

    const { ensureLedgerSetup } = await import('../services/ledger.js');
    await ensureLedgerSetup(c.accountId, c.orgId, 'test');
    const bank = await prisma.ledgerAccount.findFirst({ where: { accountId: c.accountId, orgId: c.orgId, isActive: true, OR: [{ controlKind: 'BANK' }, { controlKind: 'CASH' }] }, select: { id: true } });
    const payment = await api.post(c, '/payments', { runId: extraId, paymentDate: '2026-04-30', ledgerAccountId: bank!.id }).expect(201);
    const file = await api.get(c, `/payments/${payment.body.payment.id}/advice?format=csv`).expect(200);
    expect(file.text.split('\n').filter(Boolean)).toHaveLength(4);
  });
});

describe('cancelling an extra pay run', () => {
  it('cancels its own amounts with it, so no other payroll pays them', async () => {
    const c = await makeOwner();
    const ids = await company(c);
    const someone = await person(c, ids.structure, 'Dev Sharma', 600_000);
    const extra = (await api.post(c, '/runs', { periodId: ids.period, kind: 'OFF_CYCLE' }).expect(201)).body.run.id;
    await api.put(c, `/runs/${extra}/extra-pay`, { employeeId: someone, items: [{ componentId: ids.bonus, amount: 7_000 }] }).expect(200);
    /* Replacing the list cancels the old row rather than leaving it owed. */
    await api.put(c, `/runs/${extra}/extra-pay`, { employeeId: someone, items: [{ componentId: ids.bonus, amount: 8_000 }] }).expect(200);
    await api.post(c, `/runs/${extra}/cancel`, { reason: 'Entered in error' }).expect(200);
    const rows = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, employeeId: someone } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);

    /* The month's regular payroll then pays the salary alone. */
    const regular = (await api.post(c, '/runs', { periodId: ids.period }).expect(201)).body.run.id;
    await api.post(c, `/runs/${regular}/calculate`).expect(200);
    const slips = await slipsOf(regular);
    expect(Number(slips[0].grossEarnings)).toBe(48_200);
    expect(slips[0].lines.some((l) => l.componentCode === 'BONUS')).toBe(false);
  });
});
