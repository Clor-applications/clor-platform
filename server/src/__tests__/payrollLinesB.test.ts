import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Server picks batch 2, payroll lines:
 * - count × rate on an adjustment and its payslip line (canteen meals, pieces, night shifts);
 * - a salary change inside the month, split by days on the payslip;
 * - a note one payroll leaves for the next;
 * - an employee's ask to skip a loan instalment, which HR agrees to or declines.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { askSkip, nextInstalments } = await import('../services/payroll/skipAsk.js');

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
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `linesb.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Lines Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

async function setUp(c: Ctx) {
  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);
  const basic = await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
  const canteen = await mk({ name: 'Canteen', code: 'CANTEEN', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 60 });
  const pieces = await mk({ name: 'Piece rate', code: 'PIECE', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 50 });
  const recovery = await mk({ name: 'Loan Recovery', code: 'LOANREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: recovery.body.component.id, displayOrder: 80 },
      ],
    })
    .expect(201);
  const months: string[] = [];
  for (const [name, start, end] of [
    ['June', '2026-06-01', '2026-06-30'],
    ['July', '2026-07-01', '2026-07-31'],
    ['August', '2026-08-01', '2026-08-31'],
  ] as const) {
    const p = await api.post(c, '/periods', { name: `${name} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201);
    months.push(p.body.period.id);
  }
  const person = await api
    .post(c, '/employees', { name: 'Meena Iyer', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL' } })
    .expect(201);
  await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);
  return {
    employeeId: person.body.employee.id,
    structureId: structure.body.structure.id,
    canteenId: canteen.body.component.id,
    piecesId: pieces.body.component.id,
    recoveryId: recovery.body.component.id,
    months,
  };
}

const runPayroll = async (c: Ctx, periodId: string) => {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
  await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);
  return run.body.run.id as string;
};
const slipOf = async (c: Ctx, runId: string) => {
  const id = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
  return (await api.get(c, `/slips/${id}`).expect(200)).body.slip;
};

describe('count × rate', () => {
  it('works the amount out from the count and the rate, and the payslip line shows both', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const canteen = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.canteenId, periodId: ids.months[0], amount: 1, quantity: 22, rate: 30, unit: 'Meal' })
      .expect(201);
    /* The amount is the product, whatever amount was sent. */
    expect(canteen.body.adjustment).toMatchObject({ amount: 660, quantity: 22, rate: 30, unit: 'meal' });
    const pieces = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.piecesId, periodId: ids.months[0], quantity: 340, rate: 4.5, unit: 'piece' })
      .expect(201);
    expect(pieces.body.adjustment.amount).toBe(1530);
    await api.post(c, `/adjustments/${canteen.body.adjustment.id}/approve`).expect(200);
    await api.post(c, `/adjustments/${pieces.body.adjustment.id}/approve`).expect(200);

    const slip = await slipOf(c, await runPayroll(c, ids.months[0]));
    expect(slip.deductions.find((l: any) => l.code === 'CANTEEN')).toMatchObject({ amount: 660, quantity: 22, rate: 30, unit: 'meal' });
    expect(slip.earnings.find((l: any) => l.code === 'PIECE')).toMatchObject({ amount: 1530, quantity: 340, rate: 4.5, unit: 'piece' });
    expect(slip.earnings.find((l: any) => l.code === 'BASIC').quantity).toBeUndefined();
  });

  it('asks for both the count and the rate, or neither', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const half = await api.post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.canteenId, periodId: ids.months[0], quantity: 22 });
    expect(half.status).toBe(400);
    expect(half.body.error).toMatch(/both the count and the rate/);
    /* A plain amount still works, and editing it into count × rate replaces the amount. */
    const plain = await api.post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.canteenId, periodId: ids.months[0], amount: 500 }).expect(201);
    expect(plain.body.adjustment).toMatchObject({ amount: 500, quantity: null, rate: null });
    const edited = await api
      .put(c, `/adjustments/${plain.body.adjustment.id}`, { employeeId: ids.employeeId, componentId: ids.canteenId, periodId: ids.months[0], quantity: 10, rate: 25, unit: 'meal' })
      .expect(200);
    expect(edited.body.adjustment).toMatchObject({ amount: 250, quantity: 10, rate: 25 });
  });
});

describe('salary changed inside the month', () => {
  it('splits the payslip by the days at each salary', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await api.post(c, '/assignments', { employeeId: ids.employeeId, structureId: ids.structureId, effectiveFrom: '2026-06-11', annualCtc: 720_000 }).expect(201);
    const slip = await slipOf(c, await runPayroll(c, ids.months[0]));
    expect(slip.ctc.split).toEqual([
      { from: '2026-06-01', days: 10, annualCtc: 600_000, monthly: 50_000 },
      { from: '2026-06-11', days: 20, annualCtc: 720_000, monthly: 60_000 },
    ]);
  });

  it('has no split when one salary covered the month', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const slip = await slipOf(c, await runPayroll(c, ids.months[0]));
    expect(slip.ctc.split).toBeNull();
  });
});

describe('a note for next month', () => {
  it('shows the note June left at the top of July', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const june = await runPayroll(c, ids.months[0]);
    const saved = await api.put(c, `/runs/${june}/note-for-next`, { note: "Meena's arrears are due in July" }).expect(200);
    expect(saved.body.run.noteForNext).toBe("Meena's arrears are due in July");
    const july = await runPayroll(c, ids.months[1]);
    const read = (await api.get(c, `/runs/${july}`).expect(200)).body.run;
    expect(read.earlierNote).toMatchObject({ text: "Meena's arrears are due in July", runId: june });
    /* June itself has nothing before it. */
    expect((await api.get(c, `/runs/${june}`).expect(200)).body.run.earlierNote).toBeNull();
    /* Clearing it. */
    await api.put(c, `/runs/${june}/note-for-next`, { note: '' }).expect(200);
    expect((await api.get(c, `/runs/${july}`).expect(200)).body.run.earlierNote).toBeNull();
  });
});

describe('asking to skip an instalment', () => {
  const loanFor = async (c: Ctx, ids: Awaited<ReturnType<typeof setUp>>) => {
    const made = await api
      .post(c, '/loans', { employeeId: ids.employeeId, principal: 30_000, interestRate: 0, startDate: '2026-06-01', recoveryStartPeriodId: ids.months[0], installmentCount: 3, recoveryComponentId: ids.recoveryId })
      .expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return made.body.loan.id as string;
  };

  it('lets the employee ask once for the next one; HR sees it and agrees', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await loanFor(c, ids);
    const next = (await nextInstalments(c.orgId, [loanId])).get(loanId)!;
    expect(next).toMatchObject({ amount: 10_000, skipAsked: false });

    /* Somebody else cannot ask for it. */
    await expect(askSkip({ orgId: c.orgId, employeeId: 'someone-else' }, next.id, 'Hospital bills')).rejects.toMatchObject({ status: 404 });
    await expect(askSkip({ orgId: c.orgId, employeeId: ids.employeeId }, next.id, '')).rejects.toMatchObject({ code: 'REASON_NEEDED' });
    await askSkip({ orgId: c.orgId, employeeId: ids.employeeId }, next.id, 'Hospital bills this month');
    await expect(askSkip({ orgId: c.orgId, employeeId: ids.employeeId }, next.id, 'again')).rejects.toMatchObject({ code: 'ALREADY_ASKED' });
    /* Only the next one. */
    const loan = (await api.get(c, `/loans/${loanId}`).expect(200)).body.loan;
    const second = loan.installments.find((i: any) => i.sequence === 2);
    await expect(askSkip({ orgId: c.orgId, employeeId: ids.employeeId }, second.id, 'Later one')).rejects.toMatchObject({ code: 'NOT_NEXT' });

    const list = (await api.get(c, '/loans').expect(200)).body.loans;
    expect(list.find((l: any) => l.id === loanId).skipAsk).toMatchObject({ installmentId: next.id, amount: 10_000, reason: 'Hospital bills this month' });
    expect(loan.installments.find((i: any) => i.id === next.id).skipAsk).toMatchObject({ reason: 'Hospital bills this month' });

    const agreed = await api.post(c, `/loans/${loanId}/installments/${next.id}`, { action: 'SKIP' }).expect(200);
    expect(agreed.body.loan.outstandingBalance).toBe(30_000);
    const after = (await api.get(c, `/loans/${loanId}`).expect(200)).body.loan.installments.find((i: any) => i.id === next.id);
    expect(after).toMatchObject({ status: 'SKIPPED', skipAsk: null });
  });

  it('declining clears the ask and leaves the instalment due', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await loanFor(c, ids);
    const next = (await nextInstalments(c.orgId, [loanId])).get(loanId)!;
    await api.post(c, `/loans/${loanId}/installments/${next.id}`, { action: 'DECLINE_SKIP' }).expect(409);
    await askSkip({ orgId: c.orgId, employeeId: ids.employeeId }, next.id, 'School fees');
    await api.post(c, `/loans/${loanId}/installments/${next.id}`, { action: 'DECLINE_SKIP' }).expect(200);
    const row = (await api.get(c, `/loans/${loanId}`).expect(200)).body.loan.installments.find((i: any) => i.id === next.id);
    expect(row).toMatchObject({ status: 'PENDING', skipAsk: null });
    expect((await nextInstalments(c.orgId, [loanId])).get(loanId)!.skipAsked).toBe(false);
  });
});
