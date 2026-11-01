import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * What People hands Payroll (30 Oct 2026):
 *  1. an absconding hold stops the full and final being paid until it is lifted, with a reason;
 *  2. advances, claims and loans appear in the settlement, traced, and close once when paid;
 *  3. instalments give way to the share of wages deductions may take, and move to the next run;
 *  4. a late-mark penalty a cut-off left uncharged is charged by the next run, once.
 * Every company here is one owner with no staff (the smallest customer), unless a test adds a role.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { capDeductions } = await import('../services/payroll/deductionCap.js');

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
  get: (c: Ctx, p: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)),
  post: (c: Ctx, p: string, b?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
  put: (c: Ctx, p: string, b?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(b as any),
};
const own = <T,>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

/*
 * Final wages large enough that the recovery limit (setting 4, fnfRecoveryCap.ts)
 * never binds: these tests are about each source closing once, not the limit
 * (payrollFnfRecoveryCap.test.ts covers that).
 */
const roomy = async (c: Ctx, s: any) =>
  (await api.put(c, `/settlements/${s.id}`, { lines: [...s.lines.filter((l: any) => l.code !== 'NOTICE'), { code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 1_000_000, explanation: '' }] }).expect(200)).body.settlement;
const startRoomy = async (c: Ctx, employeeId: string) => roomy(c, (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement);


async function makeOwner(): Promise<Ctx> {
  const email = `handoff.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Handoff Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  return c;
}

/** Somebody in the same company with a role that cannot approve pay. */
async function employeeLogin(boss: Ctx): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === 'Viewer') || (roles.roles || roles).find((r: any) => /view|employee|staff/i.test(r.name));
  const email = `viewer.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Vinay Viewer', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token };
}

async function leaver(c: Ctx) {
  const person = await api.post(c, '/employees', { name: 'Ravi Kumar', code: `E${rnd()}`, dateOfJoining: '2025-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', dateOfJoining: '2025-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  return employeeId;
}
const holdOn = (c: Ctx, employeeId: string, reason = 'Absconded; ID card and laptop not returned') =>
  own(c, () => peoplePrisma.absenceCase.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, fromDate: '2026-10-01', lastAbsentDate: '2026-10-14', days: 14, status: 'ABSCONDED', holdReason: reason, heldAt: new Date(), heldByUserId: 'hr' } }));

describe('an absconding hold', () => {
  it('shows Held, refuses payment, and pays only once lifted with a recorded reason', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const absence = await holdOn(c, employeeId);

    const waiting = (await api.get(c, '/settlements').expect(200)).body.waiting;
    expect(waiting.find((p: any) => p.id === employeeId).held).toBe(true);

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.hold).toMatchObject({ reason: 'Absconded; ID card and laptop not returned' });
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);

    const refused = await api.post(c, `/settlements/${s.id}/paid`, { reference: 'UTR1' }).expect(409);
    expect(refused.body.code).toBe('SETTLEMENT_HELD');
    expect((await payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('APPROVED');

    expect((await api.post(c, `/settlements/${s.id}/release-hold`, { reason: ' ' }).expect(400)).body.code).toBe('REASON_NEEDED');
    const lifted = (await api.post(c, `/settlements/${s.id}/release-hold`, { reason: 'Came in to settle, 4 Nov' }).expect(200)).body.settlement;
    expect(lifted.hold).toBeNull();
    /* Recorded in People, and here. */
    const after = await own(c, () => peoplePrisma.absenceCase.findUniqueOrThrow({ where: { id: absence.id } }));
    expect(after.holdReleaseNote).toBe('Came in to settle, 4 Nov');
    expect(after.holdReleasedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 150));
    const audit = await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'PAYROLL_SETTLEMENT', action: 'RELEASE_HOLD' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].message).toContain('Came in to settle, 4 Nov');

    expect((await api.post(c, `/settlements/${s.id}/release-hold`, { reason: 'Again please' }).expect(409)).body.code).toBe('NOT_HELD');
    expect((await api.post(c, `/settlements/${s.id}/paid`, { reference: 'UTR1' }).expect(200)).body.settlement.status).toBe('PAID');
  }, 120_000);

  it('nothing is forfeited: holding changes no line, and a hold lifted in People frees it here', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const free = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const absence = await holdOn(c, employeeId);
    const held = (await api.post(c, `/settlements/${free.id}/recalculate`).expect(200)).body.settlement;
    expect(held.hold).toBeTruthy();
    expect(held.lines).toEqual(free.lines);
    expect(held.netPayable).toBe(free.netPayable);
    await own(c, () => peoplePrisma.absenceCase.update({ where: { id: absence.id }, data: { holdReleasedAt: new Date(), holdReleaseNote: 'Released by HR' } }));
    expect((await api.get(c, '/settlements').expect(200)).body.settlements[0].hold).toBeNull();
  }, 120_000);

  it('refuses another role and another company', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    await holdOn(c, employeeId);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const viewer = await employeeLogin(c);
    expect((await api.post(viewer, `/settlements/${s.id}/release-hold`, { reason: 'I say so' })).status).toBe(403);
    const other = await makeOwner();
    expect((await api.post(other, `/settlements/${s.id}/release-hold`, { reason: 'Not mine' })).status).toBe(404);
    expect((await api.get(c, '/settlements').expect(200)).body.settlements[0].hold).toBeTruthy();
  }, 120_000);
});

describe('advances and loans in the full and final', () => {
  const advance = (c: Ctx, employeeId: string, over: Record<string, unknown> = {}) =>
    own(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 5000, status: 'PAID', paidOn: '2026-09-01', settledAmount: 1000, ...over } as any }));
  const claim = (c: Ctx, employeeId: string) =>
    own(c, () => peoplePrisma.expenseClaim.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `EXP-${rnd()}`, title: 'Client lunch', status: 'APPROVED', claimedTotal: 2000, approvedTotal: 2000 } as any }));
  const loan = (c: Ctx, employeeId: string, type: string, parts: number[]) =>
    own(c, async () => {
      const total = parts.reduce((a, b) => a + b, 0);
      const row = await payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId, type, principal: total, startDate: '2026-08-01', outstandingBalance: total, status: 'ACTIVE', createdByUserId: 'test' } });
      for (const [i, due] of parts.entries()) await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: row.id, sequence: i + 1, dueAmount: due, principalAmount: due, interestAmount: 0, status: 'PENDING' } });
      return row;
    });

  it('lists each one traced to its source and closes each exactly once', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const adv = await advance(c, employeeId);
    const exp = await claim(c, employeeId);
    const sal = await loan(c, employeeId, 'SALARY_ADVANCE', [3000]);
    const other = await loan(c, employeeId, 'LOAN', [2000, 2000]);

    const s = await startRoomy(c, employeeId);
    const of = (id: string) => s.lines.find((l: any) => l.source?.id === id);
    expect(of(adv.id)).toMatchObject({ kind: 'DEDUCTION', amount: 4000, source: { type: 'ADVANCE', ref: adv.number } });
    expect(of(exp.id)).toMatchObject({ kind: 'EARNING', amount: 2000, source: { type: 'CLAIM', ref: exp.number } });
    expect(of(sal.id)).toMatchObject({ kind: 'DEDUCTION', amount: 3000, source: { type: 'LOAN', ref: sal.number } });
    expect(of(other.id)).toMatchObject({ kind: 'DEDUCTION', amount: 4000, source: { type: 'LOAN', ref: other.number } });

    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    /* Two clicks at once: one payment, one close. */
    const [a, b] = await Promise.all([api.post(c, `/settlements/${s.id}/paid`, {}), api.post(c, `/settlements/${s.id}/paid`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const check = async () => {
      const [ad, cl, sl, ol] = await own(c, () => Promise.all([
        peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id: adv.id } }),
        peoplePrisma.expenseClaim.findUniqueOrThrow({ where: { id: exp.id } }),
        payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: sal.id } }),
        payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: other.id } }),
      ]));
      expect(ad).toMatchObject({ status: 'CLOSED' });
      expect(Number(ad.recoveredAmount)).toBe(4000);
      expect(cl).toMatchObject({ status: 'PAID', payMode: 'SALARY', payrollPeriodName: 'Full and final settlement' });
      expect(sl.status).toBe('COMPLETED');
      expect(ol.status).toBe('COMPLETED');
      expect(Number(ol.outstandingBalance)).toBe(0);
    };
    await check();
    /* The retry route closes nothing a second time. */
    expect((await api.post(c, `/settlements/${s.id}/close-sources`).expect(200)).body.closed).toEqual([]);
    await check();
    /* Nothing is left for a new settlement to propose. */
    const fresh = (await api.get(c, '/settlements').expect(200)).body.settlements[0];
    expect(fresh.sourcesClosedAt).toBeTruthy();
    const installments = await own(c, () => payrollPrisma.payrollLoanInstallment.findMany({ where: { loanId: other.id } }));
    expect(installments.every((i) => i.status === 'SETTLED')).toBe(true);
  }, 120_000);

  it('never takes a source from the request', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const stranger = await leaver(c);
    const theirs = await advance(c, stranger);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const forged = [...s.lines, { code: 'FORGED', label: 'Forged', kind: 'DEDUCTION', amount: 100, explanation: '', source: { type: 'ADVANCE', id: theirs.id } }];
    const saved = (await api.put(c, `/settlements/${s.id}`, { lines: forged }).expect(200)).body.settlement;
    expect(saved.lines.find((l: any) => l.code === 'FORGED').source).toBeUndefined();
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    const after = await own(c, () => peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id: theirs.id } }));
    expect(Number(after.recoveredAmount)).toBe(0);
  }, 120_000);

  it('refuses to pay when a source changed since approval', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const adv = await advance(c, employeeId);
    const s = await startRoomy(c, employeeId);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: adv.id }, data: { status: 'CLOSED' } }));
    const r = await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409);
    expect(r.body.code).toBe('SOURCES_CHANGED');
    expect(r.body.error).toContain(adv.number);
  }, 120_000);

  it('a line edited down leaves the rest owed, on an advance and on a loan', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const adv = await advance(c, employeeId);
    const lent = await loan(c, employeeId, 'LOAN', [2000, 2000]);
    const s = await startRoomy(c, employeeId);
    const edited = s.lines.map((l: any) => (l.source?.id === adv.id ? { ...l, amount: 3000 } : l.source?.id === lent.id ? { ...l, amount: 2500 } : l));
    await api.put(c, `/settlements/${s.id}`, { lines: edited }).expect(200);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    const [ad, ln] = await own(c, () => Promise.all([peoplePrisma.employeeAdvance.findUniqueOrThrow({ where: { id: adv.id } }), payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: lent.id } })]));
    expect(ad.status).toBe('PAID');
    expect(Number(ad.recoveredAmount)).toBe(3000);
    expect(ln.status).toBe('ACTIVE');
    expect(Number(ln.outstandingBalance)).toBe(1500);
  }, 120_000);
});

describe('the share of wages', () => {
  it('takes the least of what is due, the limit and net pay, oldest first', () => {
    const r = capDeductions({ percent: 50, wages: 10_000, counted: 2_000, netPay: 8_000, items: [{ key: 'old', due: 2_000 }, { key: 'new', due: 2_000 }] });
    expect(r.limit).toBe(5_000);
    expect(r.taken.get('old')).toBe(2_000);
    expect(r.taken.get('new')).toBe(1_000);
    expect(r.carried).toBe(1_000);
    /* Statutory alone past the limit: nothing more is taken, nothing goes negative. */
    expect(capDeductions({ percent: 50, wages: 1_000, counted: 900, netPay: 100, items: [{ key: 'a', due: 500 }] }).taken.get('a')).toBe(0);
    expect(capDeductions({ percent: 50, wages: 0, counted: 0, netPay: 0, items: [{ key: 'a', due: 500 }] }).carried).toBe(500);
  });

  it('is a setting, 50 by default, never above 50, for those allowed', async () => {
    const c = await makeOwner();
    expect((await api.get(c, '/settings/deduction-cap').expect(200)).body).toEqual({ percent: 50, countsStatutory: true, countsPenalties: true });
    expect((await api.put(c, '/settings/deduction-cap', { percent: 75, countsStatutory: true }).expect(400)).body.error).toMatch(/10% and 50%/);
    expect((await api.put(c, '/settings/deduction-cap', { percent: 40, countsStatutory: false }).expect(200)).body).toEqual({ percent: 40, countsStatutory: false, countsPenalties: true });
    const viewer = await employeeLogin(c);
    expect((await api.put(viewer, '/settings/deduction-cap', { percent: 20, countsStatutory: true })).status).toBe(403);
    const other = await makeOwner();
    expect((await api.get(other, '/settings/deduction-cap').expect(200)).body.percent).toBe(50);
  }, 120_000);

  /* ₹50,000 a month, a ₹60,000 loan over 6: ₹10,000 an instalment. */
  async function setUp(c: Ctx, ranges: Array<[string, string]>, extra?: { fixedDeduction?: number; pf?: boolean }) {
    const mk = (b: any) => api.post(c, '/components', b).expect(201);
    const basic = await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, displayOrder: 1 });
    const recovery = await mk({ name: 'Loan Recovery', code: 'LOANREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 });
    const components = [{ componentId: basic.body.component.id, displayOrder: 1 }, { componentId: recovery.body.component.id, displayOrder: 80 }] as any[];
    if (extra?.pf) {
      await api.post(c, '/statutory/seed').expect(200);
      const { body } = await api.get(c, '/statutory').expect(200);
      await api.put(c, `/statutory/schemes/${body.schemes.find((x: any) => x.code === 'PF').id}`, { isEnabled: true }).expect(200);
      const pf = await mk({ name: 'Employee PF', code: 'EPF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 });
      components.push({ componentId: pf.body.component.id, displayOrder: 10 });
    }
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components }).expect(201);
    const periods: string[] = [];
    for (const [i, [startDate, endDate]] of ranges.entries()) {
      const p = await api.post(c, '/periods', { name: `Period ${i + 1} ${rnd()}`, startDate, endDate, paymentDate: endDate }).expect(201);
      periods.push(p.body.period.id);
    }
    const person = await api.post(c, '/employees', { name: 'Tanmay', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: Boolean(extra?.pf) } }).expect(201);
    const employeeId = person.body.employee.id as string;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }).expect(201);
    const made = await api.post(c, '/loans', { employeeId, principal: 60_000, interestRate: 0, startDate: ranges[0][0], recoveryStartPeriodId: periods[0], installmentCount: 6, recoveryComponentId: recovery.body.component.id }).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return { employeeId, periods, loanId: made.body.loan.id as string, recoveryId: recovery.body.component.id as string };
  }
  const startRun = async (c: Ctx, periodId: string) => (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id as string;
  const calc = async (c: Ctx, runId: string) => {
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    return api.post(c, `/runs/${runId}/calculate`).expect(200);
  };
  const slip = async (c: Ctx, runId: string) => {
    const id = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    return (await api.get(c, `/slips/${id}`).expect(200)).body.slip;
  };
  const loanOf = async (c: Ctx, id: string) => (await api.get(c, `/loans/${id}`).expect(200)).body.loan;
  const CALENDAR: Array<[string, string]> = [['2026-06-01', '2026-06-30'], ['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31']];
  const WAGE_MONTH: Array<[string, string]> = [['2026-05-26', '2026-06-25'], ['2026-06-26', '2026-07-25'], ['2026-07-26', '2026-08-25']];

  for (const [name, ranges] of [['calendar months', CALENDAR], ['26th to 25th pay periods', WAGE_MONTH]] as const) {
    it(`moves the extra instalment to the next run with a note, nothing dropped (${name})`, async () => {
      const c = await makeOwner();
      await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true }).expect(200);
      const ids = await setUp(c, ranges);

      const first = await startRun(c, ids.periods[0]);
      await calc(c, first);
      const s1 = await slip(c, first);
      expect(s1.totalDeductions).toBe(5000);
      expect(s1.deductions.find((l: any) => l.amount > 0).name).toBe('Loan Recovery (₹5,000 of ₹10,000; ₹5,000 next month)');
      expect(s1.deductionNote).toMatchObject({ percent: 10, wages: 50_000, limit: 5000, total: 5000, reason: 'LIMIT', carried: [{ label: 'Loan Recovery', amount: 5000 }] });
      const run1 = (await api.get(c, `/runs/${first}`).expect(200)).body.run;
      expect(run1.deductionCapMessage).toBe('Deductions held to 10% of wages for 1 person: ₹5,000 carried to next month.');
      expect((await loanOf(c, ids.loanId)).outstanding).toBe(55_000);

      /* Recalculating does not carry it twice. */
      await calc(c, first);
      expect((await loanOf(c, ids.loanId)).outstanding).toBe(55_000);
      expect((await loanOf(c, ids.loanId)).installments.filter((i: any) => i.carriedFromId)).toHaveLength(1);

      /* The next run takes the carried part first; its own instalment moves on in turn. */
      const second = await startRun(c, ids.periods[1]);
      await calc(c, second);
      const s2 = await slip(c, second);
      expect(s2.totalDeductions).toBe(5000);
      expect(s2.deductions.find((l: any) => l.amount > 0).name).toMatch(/^Loan Recovery \(carried from Period 1/);
      expect(s2.deductionNote.total).toBe(10_000);
      /* Every rupee is taken or still owed. */
      const l = await loanOf(c, ids.loanId);
      expect(l.outstanding).toBe(50_000);
      expect(l.installments.reduce((t: number, i: any) => t + i.dueAmount, 0)).toBe(60_000);

      /* The first run cannot be pulled from under the second. */
      expect((await api.post(c, `/runs/${first}/calculate`).expect(409)).body.code).toBe('CARRY_TAKEN');
      expect((await api.post(c, `/runs/${first}/cancel`, {}).expect(409)).body.code).toBe('CARRY_TAKEN');
    }, 180_000);
  }

  it('cancelling the run puts the whole instalment back', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true }).expect(200);
    const ids = await setUp(c, CALENDAR);
    const run = await startRun(c, ids.periods[0]);
    await calc(c, run);
    await api.post(c, `/runs/${run}/cancel`, {}).expect(200);
    const l = await loanOf(c, ids.loanId);
    expect(l.outstanding).toBe(60_000);
    expect(l.installments).toHaveLength(6);
    expect(l.installments[0]).toMatchObject({ status: 'PENDING', dueAmount: 10_000 });
  }, 180_000);

  it('leaves alone a payslip within the limit', async () => {
    const c = await makeOwner();
    const ids = await setUp(c, CALENDAR);
    const run = await startRun(c, ids.periods[0]);
    await calc(c, run);
    const s = await slip(c, run);
    expect(s.totalDeductions).toBe(10_000);
    expect(s.deductionNote).toBeNull();
    expect((await api.get(c, `/runs/${run}`).expect(200)).body.run.deductionCapMessage).toBeNull();
  }, 180_000);

  it('gives way on an advance recovery too, and warns when entered deductions pass the limit alone', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true }).expect(200);
    const ids = await setUp(c, CALENDAR);
    const add = (id: string, amount: number) =>
      own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id, accountId: c.accountId, orgId: c.orgId, employeeId: ids.employeeId, componentId: ids.recoveryId, periodId: ids.periods[0], type: 'DEDUCTION', amount, reason: 'test', status: 'APPROVED', approvedAt: new Date(), createdByUserId: 'test' } }));
    await add(`advance-recover:${rnd()}:p`, 1000);
    await add(`fine-${rnd()}`, 6000);
    const run = await startRun(c, ids.periods[0]);
    const r = await calc(c, run);
    expect(r.body.issues.map((i: any) => i.code)).toContain('DEDUCTIONS_OVER_LIMIT');
    const s = await slip(c, run);
    /* The entered ₹6,000 stands; neither instalment nor the recovery is taken on top. */
    expect(s.totalDeductions).toBe(6000);
    expect(s.deductionNote.total).toBe(11_000);
  }, 180_000);

  it('counts statutory deductions only as the setting says', async () => {
    const c = await makeOwner();
    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: true }).expect(200);
    const ids = await setUp(c, CALENDAR, { pf: true });
    const run = await startRun(c, ids.periods[0]);
    await calc(c, run);
    const counted = await slip(c, run);
    const pf = counted.deductions.find((l: any) => l.code === 'EPF')?.amount;
    expect(pf).toBeGreaterThan(0);
    expect(counted.deductions.find((l: any) => l.code === 'LOANREC' && l.amount > 0).amount).toBe(5000 - pf);

    await api.put(c, '/settings/deduction-cap', { percent: 10, countsStatutory: false }).expect(200);
    await calc(c, run);
    const notCounted = await slip(c, run);
    expect(notCounted.deductions.find((l: any) => l.code === 'LOANREC' && l.amount > 0).amount).toBe(5000);
  }, 180_000);
});

describe('late-mark penalties after an early cut-off', () => {
  const peopleApi = (c: Ctx, m: 'put' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
  const payAmount = (s: any) => s.deductions.filter((l: any) => l.name.startsWith('Late-mark penalty'));
  const record = (c: Ctx, employeeId: string, date: string, late: number) =>
    own(c, () => peoplePrisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { accountId: c.accountId, orgId: c.orgId, employeeId, date, status: 'PRESENT', source: 'MANUAL', checkIn: new Date(`${date}T04:00:00Z`), checkOut: new Date(`${date}T12:30:00Z`), lateMinutes: late, earlyOutMinutes: 0, workedMinutes: 480, createdByUserId: 'test' },
      update: { lateMinutes: late },
    }));

  /** Basic ₹30,000; four late marks; one penalty day under "every 4, a full day". */
  async function setUp(c: Ctx) {
    await api.put(c, '/settings/provisional-days', { enabled: true, cutoffDay: 25 }).expect(200);
    const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
    const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
    const person = await api.post(c, '/employees', { name: 'Asha', code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
    const employeeId = person.body.employee.id as string;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 360_000 }).expect(201);
    await peopleApi(c, 'put', '/attendance-rules', { marksFrom: 'THIS_MONTH', marks: { on: true, cutMode: 'HALF_DAY_PER_N', late: { on: true, every: 4, free: 0, graceMinutes: 0 }, cost: 1, takeFrom: [] } }).expect(200);
    await own(c, () => peoplePrisma.attendanceRuleVersion.updateMany({ where: { orgId: c.orgId }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } }));
    return employeeId;
  }
  const period = async (c: Ctx, name: string, startDate: string, endDate: string) => {
    const p = await api.post(c, '/periods', { name: `${name} ${rnd()}`, startDate, endDate, paymentDate: endDate }).expect(201);
    return { periodId: p.body.period.id as string, runId: (await api.post(c, '/runs', { periodId: p.body.period.id }).expect(201)).body.run.id as string };
  };
  const close = async (c: Ctx, runId: string) => {
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    await payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'LOCKED' } });
  };
  const slipOf = async (c: Ctx, runId: string) => {
    const id = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    return (await api.get(c, `/slips/${id}`).expect(200)).body.slip;
  };

  it('the next run charges the month the cut-off left uncharged, once, and it does not eat the share of wages', async () => {
    const c = await makeOwner();
    const employeeId = await setUp(c);
    const sept = await period(c, 'Sept', '2026-09-01', '2026-09-30');
    await api.post(c, `/runs/${sept.runId}/inputs/from-attendance`).expect(200);
    await close(c, sept.runId);
    expect((await slipOf(c, sept.runId)).deductions).toEqual([]);

    /* Late on four days after the cut-off; recorded as they happen. */
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']) await record(c, employeeId, d, 30);

    const oct = await period(c, 'Oct', '2026-10-01', '2026-10-31');
    /* Not decided yet: refused rather than guessed. */
    expect((await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(409)).body.code).toBe('PENALTIES_UNDECIDED');
    await peopleApi(c, 'post', '/late-marks/apply', { month: '2026-09' }).expect(200);

    const pulled = (await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200)).body;
    expect(pulled.latePenalties).toEqual([expect.objectContaining({ employeeId, month: '2026-09', days: 1, amount: 1000, status: 'APPROVED' })]);
    /* Taking the days again does not charge it twice. */
    await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200);
    expect(await payrollPrisma.payrollAdjustment.count({ where: { orgId: c.orgId, periodId: oct.periodId, id: { startsWith: 'late-penalty:' }, status: { not: 'CANCELLED' } } })).toBe(1);

    await close(c, oct.runId);
    const s = await slipOf(c, oct.runId);
    expect(payAmount(s)).toEqual([expect.objectContaining({ amount: 1000, name: expect.stringContaining('September 2026') })]);
    expect(s.deductionNote).toBeNull();

    /* And the run after that leaves it alone. */
    const nov = await period(c, 'Nov', '2026-11-01', '2026-11-30');
    const later = (await api.post(c, `/runs/${nov.runId}/inputs/from-attendance`).expect(200)).body;
    expect(later.latePenalties).toEqual([]);
    expect(await payrollPrisma.payrollAdjustment.count({ where: { orgId: c.orgId, periodId: nov.periodId, id: { startsWith: 'late-penalty:' } } })).toBe(0);
  }, 240_000);

  it('a waived month charges nothing', async () => {
    const c = await makeOwner();
    const employeeId = await setUp(c);
    const sept = await period(c, 'Sept', '2026-09-01', '2026-09-30');
    await api.post(c, `/runs/${sept.runId}/inputs/from-attendance`).expect(200);
    await close(c, sept.runId);
    for (const d of ['2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30']) await record(c, employeeId, d, 30);
    await peopleApi(c, 'post', `/late-marks/${employeeId}/waive`, { month: '2026-09', reason: 'Road closed that week' }).expect(201);
    const oct = await period(c, 'Oct', '2026-10-01', '2026-10-31');
    expect((await api.post(c, `/runs/${oct.runId}/inputs/from-attendance`).expect(200)).body.latePenalties).toEqual([]);
  }, 240_000);

  it('26th to 25th: a cut-off inside the period leaves no month owed, so nothing is charged twice', async () => {
    const c = await makeOwner();
    await setUp(c);
    await api.put(c, '/settings/provisional-days', { enabled: true, cutoffDay: 20 }).expect(200);
    const first = await period(c, 'Sep-Oct', '2026-08-26', '2026-09-25');
    await api.post(c, `/runs/${first.runId}/inputs/from-attendance`).expect(200);
    await close(c, first.runId);
    const second = await period(c, 'Oct-Nov', '2026-09-26', '2026-10-25');
    /* September's last day is in this period, so this run charges it the ordinary way, not as a catch-up. */
    expect((await api.post(c, `/runs/${second.runId}/inputs/from-attendance`).expect(200)).body.latePenalties).toEqual([]);
    expect(await payrollPrisma.payrollAdjustment.count({ where: { orgId: c.orgId, id: { startsWith: 'late-penalty:' } } })).toBe(0);
  }, 240_000);
});
