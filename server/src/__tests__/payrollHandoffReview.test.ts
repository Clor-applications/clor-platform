import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';

/**
 * Review findings on the People hand-offs (PR #82, 30 Oct 2026), each written
 * to fail first: money taken against a full and final that no longer owes it,
 * a recovery People counts before Payroll takes it, a carried deduction lost
 * when its line is edited, a late-mark penalty that outlives its waiver, a
 * hold lifted by the person it holds, and a deduction past the legal share
 * that nobody sees.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { keepSources } = await import('../services/payroll/finalSettlementSources.js');
const { gratuityFor } = await import('../services/payroll/finalSettlement.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  get: (c: Ctx, p: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)),
  post: (c: Ctx, p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
  put: (c: Ctx, p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
};
const peopleApi = (c: Ctx, m: 'get' | 'put' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
const own = <T,>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

async function makeOwner(): Promise<Ctx> {
  const email = `review82.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Review Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org!.accountId, userId: signup.body.user.id };
  await request(app).put(`/api/orgs/${orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token, userId: user.body.user.id };
}

async function leaver(c: Ctx) {
  const person = await api.post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2025-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2025-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  return employeeId;
}

/** A deduction to hang recoveries on (People finds it by its code), a reimbursement earning, and an open month. */
async function recoveryRails(c: Ctx) {
  const comp = await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
  const reimb = await api.post(c, '/components', { name: 'Reimbursement', code: 'REIMB', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, isTaxable: false, displayOrder: 60 }).expect(201);
  const p = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
  return { componentId: comp.body.component.id as string, reimbId: reimb.body.component.id as string, periodId: p.body.period.id as string };
}

const advance = (c: Ctx, employeeId: string, over: Record<string, unknown> = {}) =>
  own(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 5000, status: 'PAID', paidOn: '2026-09-01', ...over } as any }));

const adjustment = (c: Ctx, o: { id: string; employeeId: string; componentId: string; periodId: string; amount: number; status: string; type?: string; carriedByRunId?: string }) =>
  own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id: o.id, accountId: c.accountId, orgId: c.orgId, employeeId: o.employeeId, componentId: o.componentId, periodId: o.periodId, type: o.type || 'DEDUCTION', amount: o.amount, reason: 'test', reference: o.id, status: o.status, approvedAt: o.status === 'APPROVED' ? new Date() : null, carriedByRunId: o.carriedByRunId ?? null, createdByUserId: 'test' } }));

const adv = (c: Ctx, id: string) => own(c, () => peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id } }));
const adjOf = (c: Ctx, id: string) => own(c, () => payrollPrisma.payrollAdjustment.findUniqueOrThrow({ where: { id } }));
const peopleAdvance = async (c: Ctx, id: string) => (await peopleApi(c, 'get', '/money/advances').expect(200)).body.advances.find((a: any) => a.id === id);

describe('a full and final pays only what is owed when it is paid (blockers 1, 12)', () => {
  it('refuses when an advance owes less now: ₹4,000 given back in cash after approval', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const a = await advance(c, employeeId);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.lines.find((l: any) => l.source?.id === a.id).amount).toBe(5000);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { returnedAmount: 4000 } }));
    const r = await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409);
    expect(r.body.code).toBe('SOURCES_CHANGED');
    expect(Number((await adv(c, a.id)).recoveredAmount)).toBe(0);
  }, 120_000);

  it('refuses when the draft recovery it folded in was approved in Payroll before paying', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const a = await advance(c, employeeId, { recoveringAmount: 2000 });
    const key = `advance-recover:${a.id}:${rails.periodId}`;
    await adjustment(c, { id: key, employeeId, ...rails, amount: 2000, status: 'DRAFT' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.lines.find((l: any) => l.source?.id === a.id).amount).toBe(5000);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await own(c, () => payrollPrisma.payrollAdjustment.update({ where: { id: key }, data: { status: 'APPROVED', approvedAt: new Date() } }));
    expect((await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409)).body.code).toBe('SOURCES_CHANGED');
    expect((await adjOf(c, key)).status).toBe('APPROVED');
  }, 120_000);

  it('refuses when a loan owes more than when it was worked out (a run cancelled since)', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const loan = await own(c, async () => {
      const row = await payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId, type: 'LOAN', principal: 6000, startDate: '2026-08-01', outstandingBalance: 3000, status: 'ACTIVE', createdByUserId: 'test' } });
      await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: row.id, sequence: 2, dueAmount: 3000, principalAmount: 3000, interestAmount: 0, status: 'PENDING' } });
      return row;
    });
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await own(c, async () => {
      await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: loan.id, sequence: 1, dueAmount: 3000, principalAmount: 3000, interestAmount: 0, status: 'PENDING' } });
      await payrollPrisma.payrollLoan.update({ where: { id: loan.id }, data: { outstandingBalance: 6000 } });
    });
    expect((await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409)).body.code).toBe('SOURCES_CHANGED');
  }, 120_000);
});

describe('a recovery approved in Payroll and not yet taken (blocker 2)', () => {
  it('appears as its own traced line, is taken once, and People closes the advance at ₹5,000', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const a = await advance(c, employeeId, { recoveringAmount: 2000 });
    const key = `advance-recover:${a.id}:${rails.periodId}`;
    await adjustment(c, { id: key, employeeId, ...rails, amount: 2000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));

    /* Approved in Payroll is not taken: People still says "being taken from salary". */
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovering: 2000, recovered: 0 });

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const traced = s.lines.filter((l: any) => l.source && (l.source.id === a.id || l.source.id === key));
    expect(traced.map((l: any) => [l.source.type, l.amount]).sort()).toEqual([['ADVANCE', 3000], ['CARRY', 2000]]);

    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect((await adjOf(c, key)).status).toBe('CONSUMED');
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'CLOSED', recovering: 0, recovered: 5000 });
    /* A later run in that month does not take it again. */
    const run = (await api.post(c, '/runs', { periodId: rails.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${run}/validate`).expect(200);
    await api.post(c, `/runs/${run}/calculate`);
    expect((await adjOf(c, key)).consumedByRunId).toBe(`settlement:${s.id}`);
  }, 180_000);

  it('a recovery line edited down keeps the rest owed and the link live in People', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const a = await advance(c, employeeId, { recoveringAmount: 2000 });
    const key = `advance-recover:${a.id}:${rails.periodId}`;
    await adjustment(c, { id: key, employeeId, ...rails, amount: 2000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const edited = s.lines.map((l: any) => (l.source?.id === key ? { ...l, amount: 500 } : l));
    await api.put(c, `/settlements/${s.id}`, { lines: edited }).expect(200);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    const rest = await own(c, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, carriedFromId: key } }));
    expect(rest.map((r) => [r.status, Number(r.amount)])).toEqual([['APPROVED', 1500]]);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovering: 1500, recovered: 3500 });
    /* Listing again does not lose it. */
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovering: 1500, recovered: 3500 });
  }, 180_000);
});

describe('a recovery past the share of wages (blocker 3)', () => {
  it('People counts what the payslip took, and closes only when the carried rest is taken', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const recovery = await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: recovery.body.component.id, displayOrder: 85 }] }).expect(201);
    const periods: string[] = [];
    for (const [s, e] of [['2026-06-01', '2026-06-30'], ['2026-07-01', '2026-07-31']]) periods.push((await api.post(c, '/periods', { name: `P ${s} ${rnd()}`, startDate: s, endDate: e, paymentDate: e }).expect(201)).body.period.id);
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = person.body.employee.id;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);

    const a = await advance(c, employeeId, { amount: 8000, recoveringAmount: 8000 });
    const key = `advance-recover:${a.id}:${periods[0]}`;
    await adjustment(c, { id: key, employeeId, componentId: recovery.body.component.id, periodId: periods[0], amount: 8000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));

    const calc = async (runId: string) => {
      await api.post(c, `/runs/${runId}/validate`).expect(200);
      return api.post(c, `/runs/${runId}/calculate`).expect(200);
    };
    const first = (await api.post(c, '/runs', { periodId: periods[0] }).expect(201)).body.run.id;
    await calc(first);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 5000, recovering: 3000 });
    /* The payslip's record says what it took, not what was due. */
    const slip = await own(c, () => payrollPrisma.salarySlip.findFirstOrThrow({ where: { orgId: c.orgId, runId: first } }));
    expect(JSON.parse(slip.adjustmentSnapshotJson).find((x: any) => x.id === key).amount).toBe(5000);
    /* Recalculating counts nothing twice. */
    await calc(first);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 5000, recovering: 3000 });

    const second = (await api.post(c, '/runs', { periodId: periods[1] }).expect(201)).body.run.id;
    await calc(second);
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'CLOSED', recovered: 8000, recovering: 0 });
  }, 240_000);
});

describe('carried deductions (blocker 4)', () => {
  it('a carried line edited down in the full and final keeps the rest carried', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const id = `carry-${rnd()}`;
    await adjustment(c, { id, employeeId, ...rails, amount: 5000, status: 'APPROVED', carriedByRunId: 'run-earlier' });
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const edited = s.lines.map((l: any) => (l.source?.id === id ? { ...l, amount: 1000 } : l));
    await api.put(c, `/settlements/${s.id}`, { lines: edited }).expect(200);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect(await adjOf(c, id)).toMatchObject({ status: 'CONSUMED' });
    expect(Number((await adjOf(c, id)).amount)).toBe(1000);
    const rest = await own(c, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, carriedFromId: id } }));
    expect(rest.map((r) => [r.status, Number(r.amount)])).toEqual([['APPROVED', 4000]]);
  }, 120_000);

  it('a carried row is not edited, and is cancelled only with a recorded reason', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const id = `carry-${rnd()}`;
    await adjustment(c, { id, employeeId, ...rails, amount: 5000, status: 'APPROVED', carriedByRunId: 'run-earlier' });
    expect((await api.put(c, `/adjustments/${id}`, { employeeId, componentId: rails.componentId, periodId: rails.periodId, amount: 100, reason: 'less' }).expect(409)).body.code).toBe('CARRIED');
    expect((await api.post(c, `/adjustments/${id}/cancel`, {}).expect(400)).body.code).toBe('REASON_NEEDED');
    expect((await adjOf(c, id)).status).toBe('APPROVED');
    await api.post(c, `/adjustments/${id}/cancel`, { reason: 'Waived by the owner on 30 Oct' }).expect(200);
    const after = await adjOf(c, id);
    expect(after.status).toBe('CANCELLED');
    expect(after.reason).toContain('Waived by the owner on 30 Oct');
  }, 120_000);
});

describe('settlement guards (blockers 6, 9, 10)', () => {
  it('the person held cannot lift their own hold, approve or pay their own settlement', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    await own(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2026-10-01', lastAbsentDate: '2026-10-14', days: 14, status: 'ABSCONDED', holdReason: 'Absconded', heldAt: new Date(), heldByUserId: 'hr' } }));
    /* Worked out while the record was not yet theirs: since QA of #82 (F2) nobody starts their own. */
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    await own(c, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: c.userId } }));
    expect((await api.post(c, `/settlements/${s.id}/release-hold`, { reason: 'Letting myself off' }).expect(403)).body.code).toBe('OWN_RECORD');
    expect((await api.post(c, `/settlements/${s.id}/approve`).expect(403)).body.code).toBe('OWN_RECORD');
    await own(c, () => payrollPrisma.finalSettlement.update({ where: { id: s.id }, data: { status: 'APPROVED' } }));
    expect((await api.post(c, `/settlements/${s.id}/paid`, {}).expect(403)).body.code).toBe('OWN_RECORD');
  }, 120_000);

  it('lifting a hold needs People edit as HR, and the authenticator where the company asks', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    await own(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2026-10-01', lastAbsentDate: '2026-10-14', days: 14, status: 'ABSCONDED', holdReason: 'Absconded', heldAt: new Date(), heldByUserId: 'hr' } }));
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const payrollOnly = await colleague(c, ['PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::APPROVE']);
    expect((await api.post(payrollOnly, `/settlements/${s.id}/release-hold`, { reason: 'Came in to settle' })).status).toBe(403);
    const policy = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
    await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...policy, requirePayrollStepUp: true }).expect(200);
    const r = await api.post(c, `/settlements/${s.id}/release-hold`, { reason: 'Came in to settle' }).expect(403);
    expect(['STEP_UP_REQUIRED', 'TWO_FACTOR_SETUP_REQUIRED']).toContain(r.body.code);
  }, 120_000);

  it('a claim waiting in Payroll as a draft is paid by the full and final, and the draft goes', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const claim = await own(c, () => peoplePrisma.expenseClaim.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `EXP-${rnd()}`, title: 'Client lunch', status: 'WITH_SALARY', payMode: 'SALARY', claimedTotal: 2000, approvedTotal: 2000 } as any }));
    const key = `expense-claim:${claim.id}`;
    await adjustment(c, { id: key, employeeId, componentId: rails.reimbId, periodId: rails.periodId, amount: 2000, status: 'DRAFT', type: 'EARNING' });
    await own(c, () => peoplePrisma.expenseClaim.update({ where: { id: claim.id }, data: { payrollAdjustmentId: key } }));
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.lines.find((l: any) => l.source?.id === claim.id)).toMatchObject({ kind: 'EARNING', amount: 2000 });
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect((await adjOf(c, key)).status).toBe('CANCELLED');
    expect((await own(c, () => peoplePrisma.expenseClaim.findUniqueOrThrow({ where: { id: claim.id } }))).status).toBe('PAID');
  }, 120_000);

  it('closing again after the records were closed recovers nothing twice', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const a = await advance(c, employeeId);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const edited = s.lines.map((l: any) => (l.source?.id === a.id ? { ...l, amount: 3000 } : l));
    await api.put(c, `/settlements/${s.id}`, { lines: edited }).expect(200);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect(Number((await adv(c, a.id)).recoveredAmount)).toBe(3000);
    /* HR later starts another recovery on the ₹2,000 left: the link moves on. */
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: 'advance-recover:later' } }));
    expect((await api.post(c, `/settlements/${s.id}/close-sources`).expect(200)).body.closed).toEqual([]);
    expect(Number((await adv(c, a.id)).recoveredAmount)).toBe(3000);
  }, 120_000);
});

describe('late-mark penalties on a re-pull (blocker 5)', () => {
  const record = (c: Ctx, employeeId: string, date: string, late: number) =>
    own(c, () => peoplePrisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { accountId: c.accountId, orgId: c.orgId, employeeId, date, status: 'PRESENT', source: 'MANUAL', checkIn: new Date(`${date}T04:00:00Z`), checkOut: new Date(`${date}T12:30:00Z`), lateMinutes: late, earlyOutMinutes: 0, workedMinutes: 480, createdByUserId: 'test' },
      update: { lateMinutes: late },
    }));
  const period = async (c: Ctx, name: string, startDate: string, endDate: string) => {
    const p = await api.post(c, '/periods', { name: `${name} ${rnd()}`, startDate, endDate, paymentDate: endDate }).expect(201);
    return { periodId: p.body.period.id as string, runId: (await api.post(c, '/runs', { periodId: p.body.period.id }).expect(201)).body.run.id as string };
  };
  const calc = async (c: Ctx, runId: string) => {
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
  };
  const penaltyLines = async (c: Ctx, runId: string) => {
    const id = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    return (await api.get(c, `/slips/${id}`).expect(200)).body.slip.deductions.filter((l: any) => l.name.startsWith('Late-mark penalty'));
  };
  /** September paid before it ended, four late marks after the cut-off, the month applied; October's run pulled and calculated. */
  async function setUp(c: Ctx) {
    await api.put(c, '/settings/provisional-days', { enabled: true, cutoffDay: 25 }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const person = await api.post(c, '/employees', { name: 'Asha', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = person.body.employee.id as string;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    await peopleApi(c, 'put', '/attendance-rules', { marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { on: true, every: 4, free: 0, graceMinutes: 0 }, cost: 1, takeFrom: [] } }).expect(200);
    await own(c, () => peoplePrisma.attendanceRuleVersion.updateMany({ where: { orgId: c.orgId }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } }));
    const sept = await period(c, 'Sept', '2026-09-01', '2026-09-30');
    await api.post(c, `/runs/${sept.runId}/inputs/from-attendance`).expect(200);
    await calc(c, sept.runId);
    await payrollPrisma.payrollRun.update({ where: { id: sept.runId }, data: { status: 'LOCKED' } });
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']) await record(c, employeeId, d, 30);
    await peopleApi(c, 'post', '/late-marks/apply', { month: '2026-09' }).expect(200);
    const oct = await period(c, 'Oct', '2026-10-01', '2026-10-31');
    await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200);
    await calc(c, oct.runId);
    expect((await penaltyLines(c, oct.runId)).map((l: any) => l.amount)).toEqual([1000]);
    return { employeeId, oct, id: `late-penalty:2026-09:${employeeId}` };
  }

  it('waived after the run took it: the next pull and calculation drop it', async () => {
    const c = await makeOwner();
    const { employeeId, oct } = await setUp(c);
    await peopleApi(c, 'post', `/late-marks/${employeeId}/undo`, { month: '2026-09' }).expect(200);
    await peopleApi(c, 'post', `/late-marks/${employeeId}/waive`, { month: '2026-09', reason: 'Road closed that week' }).expect(201);
    await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200);
    await calc(c, oct.runId);
    expect(await penaltyLines(c, oct.runId)).toEqual([]);
  }, 240_000);

  it('cancelled in Payroll stays cancelled, and an amount edited by hand stays as entered', async () => {
    const c = await makeOwner();
    const { employeeId, oct, id } = await setUp(c);
    /* Edited by hand: ₹700, approved. */
    const row = await adjOf(c, id);
    await own(c, () => payrollPrisma.payrollAdjustment.update({ where: { id }, data: { status: 'APPROVED', consumedByRunId: null } }));
    await api.put(c, `/adjustments/${id}`, { employeeId, componentId: row.componentId, periodId: oct.periodId, amount: 700, reason: 'Late-mark penalty for September 2026: agreed at ₹700' }).expect(200);
    await api.post(c, `/adjustments/${id}/approve`).expect(200);
    await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200);
    expect(Number((await adjOf(c, id)).amount)).toBe(700);
    /* Cancelled by hand. */
    await api.post(c, `/adjustments/${id}/cancel`, {}).expect(200);
    await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200);
    expect((await adjOf(c, id)).status).toBe('CANCELLED');
    await calc(c, oct.runId);
    expect(await penaltyLines(c, oct.runId)).toEqual([]);
  }, 240_000);
});

describe('the share of wages, seen and decided (items 7, 8)', () => {
  async function oneRun(c: Ctx, annualCtc = 600_000) {
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const fine = await api.post(c, '/components', { name: 'Damage recovery', code: 'DAMAGE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = person.body.employee.id;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc }).expect(201);
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    return { employeeId, periodId, runId, fineId: fine.body.component.id };
  }
  const calc = async (c: Ctx, runId: string) => {
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    return api.post(c, `/runs/${runId}/calculate`).expect(200);
  };

  it('entered deductions past the limit are saved on the run, shown, and block review until a reason is recorded', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true, countsPenalties: true }).expect(200);
    const r = await oneRun(c);
    await adjustment(c, { id: `fine-${rnd()}`, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 6000, status: 'APPROVED' });
    await calc(c, r.runId);
    /* Validating again does not wipe it. */
    await api.post(c, `/runs/${r.runId}/validate`).expect(200);
    const run = (await api.get(c, `/runs/${r.runId}`).expect(200)).body.run;
    expect(run.overLimit).toMatchObject({ people: [expect.objectContaining({ employeeId: r.employeeId, counted: 6000, limit: 5000 })], reason: null });
    expect(run.warningCount).toBeGreaterThan(0);
    /* Not silently altered. */
    const slipId = (await api.get(c, `/slips?runId=${r.runId}`).expect(200)).body.slips[0].id;
    expect((await api.get(c, `/slips/${slipId}`).expect(200)).body.slip.totalDeductions).toBe(6000);

    expect((await api.post(c, `/runs/${r.runId}/submit-review`, {}).expect(409)).body.code).toBe('DEDUCTIONS_OVER_LIMIT');
    expect((await api.post(c, `/runs/${r.runId}/over-limit-reason`, { reason: ' ' }).expect(400)).body.code).toBe('REASON_NEEDED');
    const viewer = await colleague(c, ['PAYROLL::Payroll Runs::VIEW']);
    expect((await api.post(viewer, `/runs/${r.runId}/over-limit-reason`, { reason: 'Signed damage agreement' })).status).toBe(403);
    await api.post(c, `/runs/${r.runId}/over-limit-reason`, { reason: 'Signed damage agreement, 12 Jun' }).expect(200);
    expect((await api.get(c, `/runs/${r.runId}`).expect(200)).body.run.overLimit.reason).toBe('Signed damage agreement, 12 Jun');
    await api.post(c, `/runs/${r.runId}/submit-review`, {}).expect(200);
    await new Promise((x) => setTimeout(x, 150));
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, entity: 'PAYROLL_RUN', action: 'OVER_LIMIT_REASON' } })).toBe(1);
  }, 180_000);

  it('approval is blocked too when the reason is missing', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true, countsPenalties: true }).expect(200);
    const r = await oneRun(c);
    await adjustment(c, { id: `fine-${rnd()}`, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 6000, status: 'APPROVED' });
    await calc(c, r.runId);
    await own(c, () => payrollPrisma.payrollRun.update({ where: { id: r.runId }, data: { status: 'REVIEW' } }));
    expect((await api.post(c, `/runs/${r.runId}/approve`, {}).expect(409)).body.code).toBe('DEDUCTIONS_OVER_LIMIT');
  }, 180_000);

  it('statutory deductions alone past the limit only warn', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true, countsPenalties: true }).expect(200);
    await api.post(c, '/statutory/seed').expect(200);
    const { body } = await api.get(c, '/statutory').expect(200);
    await api.put(c, `/statutory/schemes/${body.schemes.find((x: any) => x.code === 'PF').id}`, { isEnabled: true }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, displayOrder: 1 }).expect(201);
    const pf = await api.post(c, '/components', { name: 'Employee PF', code: 'EPF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: pf.body.component.id, displayOrder: 10 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true } }).expect(201);
    await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 120_000 }).expect(201);
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    const out = await calc(c, runId);
    expect(out.body.issues.map((i: any) => i.code)).toContain('STATUTORY_OVER_LIMIT');
    expect((await api.get(c, `/runs/${runId}`).expect(200)).body.run.overLimit).toBeNull();
    await api.post(c, `/runs/${runId}/submit-review`, {}).expect(200);
  }, 180_000);

  it('late-mark penalties count toward the limit by default, as a setting', async () => {
    const c = await makeOwner();
    expect((await api.get(c, '/settings/deduction-cap').expect(200)).body).toEqual({ percent: 50, countsStatutory: true, countsPenalties: true });
    const r = await oneRun(c, 360_000);
    await adjustment(c, { id: `late-penalty:2026-05:${r.employeeId}`, employeeId: r.employeeId, componentId: r.fineId, periodId: r.periodId, amount: 30_000, status: 'APPROVED' });
    await calc(c, r.runId);
    expect((await api.get(c, `/runs/${r.runId}`).expect(200)).body.run.overLimit?.people).toHaveLength(1);
    await api.put(c, '/settings/deduction-cap', { percent: 50, countsStatutory: true, countsPenalties: false }).expect(200);
    await calc(c, r.runId);
    expect((await api.get(c, `/runs/${r.runId}`).expect(200)).body.run.overLimit).toBeNull();
  }, 180_000);
});

describe('calculating at once (item 11)', () => {
  it('three calculations of one run at the same time all answer, and leave one set of payslips', async () => {
    const c = await makeOwner();
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    for (let i = 0; i < 3; i += 1) {
      const p = await api.post(c, '/employees', { name: `P${i}`, code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
      await api.post(c, '/assignments', { employeeId: p.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    }
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    const out = await Promise.all([0, 1, 2].map(() => api.post(c, `/runs/${runId}/calculate`)));
    expect(out.map((o) => o.status)).toEqual([200, 200, 200]);
    expect(await own(c, () => payrollPrisma.salarySlip.count({ where: { orgId: c.orgId, runId } }))).toBe(3);
  }, 180_000);
});

describe('small things (nits)', () => {
  it('two lines with one code do not both carry the source', () => {
    const before = [{ code: 'ADVANCE_A', label: 'A', kind: 'DEDUCTION', amount: 100, explanation: '', source: { type: 'ADVANCE', id: 'a1' } }] as any;
    const next = keepSources([{ ...before[0], source: undefined }, { ...before[0], source: undefined }] as any, before);
    expect(next.filter((l: any) => l.source)).toHaveLength(1);
  });
  it('one year is "1 year", not "1 years"', () => {
    const g = gratuityFor(30_000, '2025-01-01', '2026-03-15', { minimumYears: 5, cap: 2_000_000 } as any);
    expect(g.explanation).toContain('Served 1 year 2 months');
  });
});

/*
 * Re-review of PR #82 at 644878d3: paying a full and final while the same
 * person's payroll is being calculated, deductions past the limit when the
 * statutory ones alone already pass it, a recovery People sends after the
 * settlement was worked out, the person held lifting their own hold in
 * People, and a recalculation between the check and the move to review.
 */
describe('re-review: paying a full and final while the payroll is being calculated (should-fix 2)', () => {
  /** A leaver on a structure that can take recoveries, a settlement approved, and October's run validated. */
  async function setUp(c: Ctx) {
    const rails = await recoveryRails(c);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: rails.componentId, displayOrder: 85 }] }).expect(201);
    const employeeId = await leaver(c);
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2025-03-01', annualCtc: 600_000 }).expect(201);
    return { ...rails, employeeId };
  }
  /** Calculate, with the settlement marked paid after the calculation has read what it takes and before it writes. */
  async function calculateWhilePaying(c: Ctx, runId: string, settlementId: string) {
    const slipDelegate = payrollPrisma.salarySlip as any;
    const original = slipDelegate.findMany.bind(slipDelegate);
    let paid: request.Response | null = null;
    const spy = vi.spyOn(slipDelegate, 'findMany').mockImplementation(async (args: any) => {
      /* The read of last month's payslips comes after every row the calculation takes has been read. */
      if (!paid && args?.where?.periodId?.not) paid = await api.post(c, `/settlements/${settlementId}/paid`, {});
      return original(args);
    });
    try {
      const out = await api.post(c, `/runs/${runId}/calculate`);
      return { out, paid: paid as request.Response | null };
    } finally {
      spy.mockRestore();
    }
  }

  it('a recovery waiting in Payroll is taken once: by the settlement, not again by the payslip', async () => {
    const c = await makeOwner();
    const r = await setUp(c);
    const a = await advance(c, r.employeeId, { recoveringAmount: 2000 });
    const key = `advance-recover:${a.id}:${r.periodId}`;
    await adjustment(c, { id: key, employeeId: r.employeeId, componentId: r.componentId, periodId: r.periodId, amount: 2000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));
    const s = (await api.post(c, '/settlements', { employeeId: r.employeeId }).expect(201)).body.settlement;
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);

    const { out, paid } = await calculateWhilePaying(c, runId, s.id);
    expect(paid?.status).toBe(200);
    expect(out.status).toBe(200);
    /* The settlement took it; the payslip did not take it again. */
    expect(await adjOf(c, key)).toMatchObject({ status: 'CONSUMED', consumedByRunId: `settlement:${s.id}` });
    const slip = await own(c, () => payrollPrisma.salarySlip.findFirstOrThrow({ where: { orgId: c.orgId, runId }, include: { lines: true } }));
    expect(slip.lines.filter((l) => l.componentCode === 'ADVREC' && Number(l.amount) > 0)).toEqual([]);
    expect(JSON.parse(slip.adjustmentSnapshotJson).map((x: any) => x.id)).not.toContain(key);
  }, 240_000);

  it('a loan instalment is taken once: the settlement settles it and the payslip leaves it', async () => {
    const c = await makeOwner();
    const r = await setUp(c);
    const loan = await own(c, async () => {
      const row = await payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId: r.employeeId, type: 'LOAN', principal: 3000, startDate: '2026-08-01', outstandingBalance: 3000, status: 'ACTIVE', recoveryComponentId: r.componentId, createdByUserId: 'test' } as any });
      await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: row.id, periodId: r.periodId, sequence: 1, dueAmount: 3000, principalAmount: 3000, interestAmount: 0, status: 'PENDING' } });
      return row;
    });
    const s = (await api.post(c, '/settlements', { employeeId: r.employeeId }).expect(201)).body.settlement;
    expect(s.lines.find((l: any) => l.source?.id === loan.id)?.amount).toBe(3000);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);

    const { out, paid } = await calculateWhilePaying(c, runId, s.id);
    expect(paid?.status).toBe(200);
    expect(out.status).toBe(200);
    const inst = await own(c, () => payrollPrisma.payrollLoanInstallment.findMany({ where: { orgId: c.orgId, loanId: loan.id } }));
    expect(inst.map((i) => [i.status, i.slipId])).toEqual([['SETTLED', null]]);
    const slip = await own(c, () => payrollPrisma.salarySlip.findFirstOrThrow({ where: { orgId: c.orgId, runId }, include: { lines: true } }));
    expect(slip.lines.filter((l) => l.componentCode === 'ADVREC' && Number(l.amount) > 0)).toEqual([]);
  }, 240_000);

  it('the other way round: a calculation that took it first stops the payment', async () => {
    const c = await makeOwner();
    const r = await setUp(c);
    const a = await advance(c, r.employeeId, { recoveringAmount: 2000 });
    const key = `advance-recover:${a.id}:${r.periodId}`;
    await adjustment(c, { id: key, employeeId: r.employeeId, componentId: r.componentId, periodId: r.periodId, amount: 2000, status: 'APPROVED' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));
    const s = (await api.post(c, '/settlements', { employeeId: r.employeeId }).expect(201)).body.settlement;
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    const runId = (await api.post(c, '/runs', { periodId: r.periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect((await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409)).body.code).toBe('SOURCES_CHANGED');
    expect(await adjOf(c, key)).toMatchObject({ status: 'CONSUMED', consumedByRunId: runId });
  }, 240_000);
});

describe('re-review: statutory deductions alone past the limit, with a fine entered on top (should-fix 3)', () => {
  it('the entered fine is gated like any other, and the warning does not say nothing else was taken', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true, countsPenalties: true }).expect(200);
    await api.post(c, '/statutory/seed').expect(200);
    const { body } = await api.get(c, '/statutory').expect(200);
    await api.put(c, `/statutory/schemes/${body.schemes.find((x: any) => x.code === 'PF').id}`, { isEnabled: true }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, displayOrder: 1 }).expect(201);
    const pf = await api.post(c, '/components', { name: 'Employee PF', code: 'EPF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 }).expect(201);
    const fine = await api.post(c, '/components', { name: 'Damage recovery', code: 'DAMAGE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: pf.body.component.id, displayOrder: 10 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true } }).expect(201);
    const employeeId = person.body.employee.id;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 120_000 }).expect(201);
    await adjustment(c, { id: `fine-${rnd()}`, employeeId, componentId: fine.body.component.id, periodId, amount: 500, status: 'APPROVED' });
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    const out = await api.post(c, `/runs/${runId}/calculate`).expect(200);

    const codes = out.body.issues.map((i: any) => i.code);
    expect(codes).toContain('STATUTORY_OVER_LIMIT');
    expect(codes).toContain('DEDUCTIONS_OVER_LIMIT');
    const words = out.body.issues.filter((i: any) => i.code === 'STATUTORY_OVER_LIMIT').map((i: any) => i.message).join(' ');
    expect(words).not.toContain('Nothing else was taken on top');
    const run = (await api.get(c, `/runs/${runId}`).expect(200)).body.run;
    expect(run.overLimit?.people).toEqual([expect.objectContaining({ employeeId, limit: 1000 })]);
    expect((await api.post(c, `/runs/${runId}/submit-review`, {}).expect(409)).body.code).toBe('DEDUCTIONS_OVER_LIMIT');
    await api.post(c, `/runs/${runId}/over-limit-reason`, { reason: 'Signed damage agreement, 12 Jun' }).expect(200);
    await api.post(c, `/runs/${runId}/submit-review`, {}).expect(200);
  }, 180_000);
});

describe('re-review: a recovery People sends after the full and final was worked out (should-fix 4)', () => {
  it('blocks paying: the settlement did not know of the draft', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const rails = await recoveryRails(c);
    const a = await advance(c, employeeId);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.lines.find((l: any) => l.source?.id === a.id).amount).toBe(5000);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    /* People sends ₹2,000 of it to Payroll as a draft recovery. */
    const key = `advance-recover:${a.id}:${rails.periodId}`;
    await adjustment(c, { id: key, employeeId, ...rails, amount: 2000, status: 'DRAFT' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { recoveringAmount: 2000, payrollAdjustmentId: key } }));
    expect((await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409)).body.code).toBe('SOURCES_CHANGED');
    expect((await adjOf(c, key)).status).toBe('DRAFT');
    expect(Number((await adv(c, a.id)).recoveredAmount)).toBe(0);
  }, 120_000);
});

describe('re-review: the person held cannot lift their own hold in People (should-fix 5)', () => {
  it('an HR user who is the person held is refused; the owner lifts it', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const hr = await colleague(c, ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT']);
    await own(c, () => peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: hr.userId } }));
    const held = await own(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2026-10-01', lastAbsentDate: '2026-10-14', days: 14, status: 'ABSCONDED', holdReason: 'Absconded', heldAt: new Date(), heldByUserId: 'hr' } }));
    const r = await peopleApi(hr, 'post', `/absences/${held.id}/release`, { note: 'Letting myself off' }).expect(403);
    expect(r.body.code).toBe('OWN_RECORD');
    expect((await own(c, () => peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: held.id } }))).holdReleasedAt).toBeNull();
    await peopleApi(c, 'post', `/absences/${held.id}/release`, { note: 'Came in to settle, 4 Nov' }).expect(200);
    expect((await own(c, () => peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: held.id } }))).holdReleasedAt).not.toBeNull();
  }, 120_000);
});

describe('re-review: recalculated between the check and the move to review (nit 6)', () => {
  it('is not sent for review on the reason given for the figures before', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true, countsPenalties: true }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const fine = await api.post(c, '/components', { name: 'Damage recovery', code: 'DAMAGE', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 70 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: fine.body.component.id, displayOrder: 70 }] }).expect(201);
    const periodId = (await api.post(c, '/periods', { name: `June ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-06-30' }).expect(201)).body.period.id;
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);
    await adjustment(c, { id: `fine-${rnd()}`, employeeId: person.body.employee.id, componentId: fine.body.component.id, periodId, amount: 6000, status: 'APPROVED' });
    const runId = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    await api.post(c, `/runs/${runId}/over-limit-reason`, { reason: 'Signed damage agreement, 12 Jun' }).expect(200);
    /* What the send-for-review check reads: the run with its reason, before the recalculation. */
    const stale = await own(c, () => payrollPrisma.payrollRun.findFirstOrThrow({ where: { id: runId } }));
    await new Promise((x) => setTimeout(x, 20));
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    const runDelegate = payrollPrisma.payrollRun as any;
    const spy = vi.spyOn(runDelegate, 'findFirst').mockImplementationOnce(async () => stale);
    try {
      const r = await api.post(c, `/runs/${runId}/submit-review`, {});
      expect(r.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
    const after = (await api.get(c, `/runs/${runId}`).expect(200)).body.run;
    expect(after.status).toBe('CALCULATED');
    expect(after.overLimit.reason).toBeNull();
  }, 180_000);
});
