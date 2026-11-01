import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';

/*
 * A seam for the race in review of #86: whatever is set here runs as the Paid
 * route reaches its stale-sources check, which is after the route's first
 * check of the limit and before the payment's transaction.
 */
const between = vi.hoisted(() => ({ fn: null as null | (() => Promise<void>) }));
vi.mock('../services/payroll/finalSettlementSources.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/payroll/finalSettlementSources.js')>();
  return {
    ...real,
    staleSources: async (...a: Parameters<typeof real.staleSources>) => {
      const fn = between.fn;
      between.fn = null;
      if (fn) await fn();
      return real.staleSources(...a);
    },
  };
});

/**
 * Setting 4 (owner, 31 Oct 2026): a full and final recovers loans and
 * advances only up to the company's share (50%, never more) of the final
 * wages (Code on Wages 2019 s.18(3)): days worked, notice pay owed, leave
 * encashment, other earnings; never gratuity or reimbursements. The rest
 * stays owed by the person, visible in People, and is never counted twice.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { applyRecoveryCap, withRecoverWishes, leavingSlipBasis } = await import('../services/payroll/fnfRecoveryCap.js');
const { financeFound } = await import('../services/people/engagement/clearance.js');

const app = buildApp().listen(0, '127.0.0.1');
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
const own = <T,>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);

async function makeOwner(): Promise<Ctx> {
  const email = `fnfcap.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Cap Co ${rnd()}`, state: 'Karnataka' }).expect(200);
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

const loan = (c: Ctx, employeeId: string, parts: number[], type = 'LOAN') =>
  own(c, async () => {
    const total = parts.reduce((a, b) => a + b, 0);
    const row = await payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `L-${rnd()}`, employeeId, type, principal: total, startDate: '2026-08-01', outstandingBalance: total, status: 'ACTIVE', createdByUserId: 'test' } });
    for (const [i, due] of parts.entries()) await payrollPrisma.payrollLoanInstallment.create({ data: { accountId: c.accountId, orgId: c.orgId, loanId: row.id, sequence: i + 1, dueAmount: due, principalAmount: due, interestAmount: 0, status: 'PENDING' } });
    return row;
  });
const advance = (c: Ctx, employeeId: string, over: Record<string, unknown> = {}) =>
  own(c, () => peoplePrisma.employeeAdvance.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `ADV-${rnd()}`, purpose: 'Site visit', amount: 4000, status: 'PAID', paidOn: '2026-09-01', ...over } as any }));
const claim = (c: Ctx, employeeId: string, amount: number) =>
  own(c, () => peoplePrisma.expenseClaim.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId, number: `EXP-${rnd()}`, title: 'Client lunch', status: 'APPROVED', claimedTotal: amount, approvedTotal: amount } as any }));
const peopleAdvance = async (c: Ctx, id: string) =>
  (await request(app).get(`/api/orgs/${c.orgId}/people/money/advances`).set(at(c)).expect(200)).body.advances.find((a: any) => a.id === id);

/** HR's edit of the draft: the lines as they are, with these earnings added. */
const withEarnings = (lines: any[], extra: Array<{ code: string; label: string; amount: number }>) => [
  ...lines.filter((l) => !extra.some((e) => e.code === l.code)),
  ...extra.map((e) => ({ ...e, kind: 'EARNING', explanation: '' })),
];
const bySource = (s: any, id: string) => s.lines.find((l: any) => l.source?.id === id);

/** Meena: ₹20,000 a month, October's payroll approved, then leaving on 14 October. */
async function paidInOctober(c: Ctx) {
  const basic = await api.post(c, '/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201);
  const structure = await api.post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2025-01-01', status: 'ACTIVE', components: [{ componentId: basic.body.component.id, displayOrder: 1 }] }).expect(201);
  const person = await api.post(c, '/employees', { name: 'Meena Iyer', code: `E${rnd()}`, dateOfJoining: '2025-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201);
  const employeeId = person.body.employee.id as string;
  await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2025-03-01', annualCtc: 240_000 }).expect(201);
  const period = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
  const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id as string;
  await api.post(c, `/runs/${run}/validate`).expect(200);
  await api.post(c, `/runs/${run}/calculate`).expect(200);
  await api.post(c, `/runs/${run}/submit-review`).expect(200);
  await api.post(c, `/runs/${run}/approve`).expect(200);
  await api.put(c, `/employees/${employeeId}`, { name: 'Meena Iyer', dateOfJoining: '2025-03-01', dateOfLeaving: '2026-10-14', status: 'LEFT' }).expect(200);
  return { employeeId, run };
}

describe('the arithmetic', () => {
  const loanLine = (id: string, owed: number) => ({ code: `LOAN_${id}`, label: 'Loan', kind: 'DEDUCTION' as const, amount: owed, explanation: '', source: { type: 'LOAN' as const, id, owed } });

  it('holds recoveries to half of the final wages, oldest first; the rest stays owed', () => {
    const { lines, cap } = applyRecoveryCap(
      [{ code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 10000, explanation: '' }, loanLine('a', 3000), loanLine('b', 6000)],
      { percent: 50, slip: null }
    );
    expect(lines.filter((l) => l.kind === 'DEDUCTION').map((l) => [l.amount, l.recover])).toEqual([
      [3000, { due: 3000, wanted: 3000, capped: 0 }],
      [2000, { due: 6000, wanted: 6000, capped: 4000 }],
    ]);
    expect(cap).toMatchObject({ percent: 50, finalWages: 10000, limit: 5000, room: 5000, due: 9000, recovered: 5000, heldBack: 4000, owed: 4000 });
  });

  it('recovers in full when the limit is not reached', () => {
    const { lines, cap } = applyRecoveryCap([{ code: 'NOTICE', label: 'Notice', kind: 'EARNING', amount: 40000, explanation: '' }, loanLine('a', 3000)], { percent: 50, slip: null });
    expect(lines[1].amount).toBe(3000);
    expect(cap).toMatchObject({ recovered: 3000, heldBack: 0, owed: 0 });
  });

  it('never counts gratuity or reimbursements; counts encashment and days worked; other deductions come first', () => {
    const { cap, lines } = applyRecoveryCap(
      [
        { code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: 200000, explanation: '' },
        { code: 'CLAIM_E1', label: 'Expense claim', kind: 'EARNING', amount: 5000, explanation: '', source: { type: 'CLAIM', id: 'c1', owed: 5000 } },
        { code: 'REIMBURSE_3', label: 'Reimbursement', kind: 'EARNING', amount: 1000, explanation: '', source: { type: 'CARRY', id: 'r1', owed: 1000 } },
        { code: 'LEAVE_EARNED', label: 'Earned encashment', kind: 'EARNING', amount: 6000, explanation: '' },
        { code: 'NOTICE', label: 'Notice not served', kind: 'DEDUCTION', amount: 1000, explanation: '' },
        loanLine('a', 50000),
      ],
      { percent: 50, slip: { wages: 14000, deducted: 2000, ref: 'SLIP-1', periodName: 'October' } }
    );
    /* 50% × (6,000 + 14,000) = 10,000, less 1,000 entered and 2,000 the payslip took. */
    expect(cap).toMatchObject({ settlementWages: 6000, finalWages: 20000, otherDeductions: 3000, limit: 10000, recovered: 7000, owed: 43000 });
    expect(lines.at(-1)!.amount).toBe(7000);
  });

  it('never goes past half, and is stricter when the company says so', () => {
    const lines = [{ code: 'NOTICE', label: 'Notice', kind: 'EARNING' as const, amount: 10000, explanation: '' }, loanLine('a', 9000)];
    expect(applyRecoveryCap(lines, { percent: 80, slip: null }).cap.limit).toBe(5000);
    expect(applyRecoveryCap(lines, { percent: 0, slip: null }).lines[1].amount).toBe(0);
  });

  it('takes what a recovery is owed from the saved lines, never from the request', () => {
    const before = applyRecoveryCap([{ code: 'NOTICE', label: 'Notice', kind: 'EARNING', amount: 2000, explanation: '' }, loanLine('a', 9000)], { percent: 50, slip: null }).lines;
    const forged = before.map((l) => (l.source ? { ...l, recover: { due: 1, wanted: 1, capped: 0 } } : l));
    const next = withRecoverWishes(forged as any, before);
    expect(next[1].recover).toEqual({ due: 9000, wanted: 9000, capped: 0 });
    /* HR asks for less: kept. More than owed: never. */
    expect(withRecoverWishes([before[0], { ...before[1], amount: 500 }], before)[1].recover!.wanted).toBe(500);
    expect(withRecoverWishes([before[0], { ...before[1], amount: 99999 }], before)[1].recover!.wanted).toBe(9000);
  });
});

describe('a settlement held to the limit', () => {
  it('when the limit binds, recovers half the final wages; the rest stays owed on the loan and the advance in People; paid once', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [3000, 3000]);
    const a = await advance(c, employeeId);

    const proposed = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    /* Nothing counts as final wages yet (no payslip, notice 0): nothing comes off, all of it stays owed. */
    expect(bySource(proposed, l.id)).toMatchObject({ amount: 0, recover: { due: 6000, capped: 6000 } });
    expect(proposed.recoveryCap).toMatchObject({ percent: 50, finalWages: 0, recovered: 0, owed: 10000, slip: null });

    /* HR enters notice pay owed: ₹8,000, so ₹4,000 can come off. */
    const s = (await api.put(c, `/settlements/${proposed.id}`, { lines: withEarnings(proposed.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 8000 }]) }).expect(200)).body.settlement;
    expect(bySource(s, l.id)).toMatchObject({ amount: 4000, recover: { due: 6000, wanted: 6000, capped: 2000 } });
    expect(bySource(s, a.id)).toMatchObject({ amount: 0, recover: { due: 4000, capped: 4000 } });
    expect(s.recoveryCap).toMatchObject({ finalWages: 8000, limit: 4000, recovered: 4000, heldBack: 6000, owed: 6000 });
    expect(s.netPayable).toBe(4000);

    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    const [x, y] = await Promise.all([api.post(c, `/settlements/${s.id}/paid`, {}), api.post(c, `/settlements/${s.id}/paid`, {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);

    const check = async () => {
      const ln = await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }));
      const inst = await own(c, () => payrollPrisma.payrollLoanInstallment.findMany({ where: { loanId: l.id }, orderBy: { sequence: 'asc' } }));
      /* Recovered + owed = what was lent. */
      expect(ln).toMatchObject({ status: 'ACTIVE' });
      expect(Number(ln.outstandingBalance)).toBe(2000);
      expect(inst.map((i) => [i.status, Number(i.dueAmount)])).toEqual([['SETTLED', 3000], ['PENDING', 2000]]);
      expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 0, open: 4000 });
      /* People's leaving shows what is still owed. */
      const found = await own(c, () => financeFound(c.orgId, employeeId));
      expect(found.lines.map((f) => [f.direction, f.amount]).sort()).toEqual([['OWES', 2000], ['OWES', 4000]]);
    };
    await check();
    expect((await api.post(c, `/settlements/${s.id}/close-sources`).expect(200)).body.closed).toEqual([]);
    await check();
    /* Nothing proposed again: one settlement per leaving. */
    expect((await api.post(c, '/settlements', { employeeId }).expect(409)).body.code).toBe('SETTLEMENT_EXISTS');
  }, 180_000);

  it('when the limit does not bind, recovers in full and closes everything', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [3000]);
    const a = await advance(c, employeeId);
    const proposed = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const s = (await api.put(c, `/settlements/${proposed.id}`, { lines: withEarnings(proposed.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 30000 }]) }).expect(200)).body.settlement;
    expect(s.recoveryCap).toMatchObject({ limit: 15000, recovered: 7000, heldBack: 0, owed: 0 });
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);
    expect((await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }))).status).toBe('COMPLETED');
    expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'CLOSED', recovered: 4000, open: 0 });
  }, 180_000);

  it('leaves gratuity and reimbursements out of final wages, and counts leave encashment', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [10000]);
    await claim(c, employeeId, 9000);
    const proposed = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const lines = withEarnings(proposed.lines, [
      { code: 'GRATUITY', label: 'Gratuity', amount: 100000 },
      { code: 'LEAVE_EARNED', label: 'Earned encashment', amount: 6000 },
    ]);
    const s = (await api.put(c, `/settlements/${proposed.id}`, { lines }).expect(200)).body.settlement;
    /* Only the ₹6,000 encashment is wages: ₹3,000 comes off; the ₹9,000 claim and ₹1,00,000 gratuity do not count. */
    expect(s.recoveryCap).toMatchObject({ settlementWages: 6000, finalWages: 6000, limit: 3000, recovered: 3000, owed: 7000 });
    expect(bySource(s, l.id).amount).toBe(3000);
  }, 120_000);

  it('counts the leaving month’s approved payslip as days worked', async () => {
    const c = await makeOwner();
    const { employeeId } = await paidInOctober(c);
    const l = await loan(c, employeeId, [50000]);

    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const slip = s.recoveryCap.slip;
    expect(slip.wages).toBeGreaterThan(0);
    expect(s.recoveryCap.finalWages).toBeCloseTo(slip.wages + s.recoveryCap.settlementWages, 2);
    expect(bySource(s, l.id).amount).toBeCloseTo(Math.max(0, s.recoveryCap.finalWages / 2 - s.recoveryCap.otherDeductions), 2);
  }, 180_000);

  it('review of #86: the leaving month’s payroll cancelled after approval stops Paid; worked out again, it recovers what the limit now allows', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await paidInOctober(c);
    const l = await loan(c, employeeId, [50000]);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(bySource(s, l.id).amount).toBeGreaterThan(0);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);

    /* The October payroll is cancelled: the days worked it counted are gone. */
    await api.post(c, `/runs/${run}/cancel`, { reason: 'Redone' }).expect(200);
    const refused = await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409);
    expect(refused.body.code).toBe('RECOVERY_CAP_CHANGED');
    expect(refused.body.error).toMatch(/leaving month's payroll changed/);
    expect(refused.body.error).toMatch(/Cancel it and work it out again/);
    const ln = await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }));
    expect(Number(ln.outstandingBalance)).toBe(50000);
    expect((await own(c, () => payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } }))).status).toBe('APPROVED');

    /* Cancelled and worked out again: nothing comes off, as no final wages are left. */
    await api.post(c, `/settlements/${s.id}/cancel`).expect(200);
    const again = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(again.recoveryCap.slip).toBeNull();
    expect(bySource(again, l.id).amount).toBe(0);
  }, 240_000);

  it('review of #86: the payroll cancelled after Paid checked the limit, before it pays: refused inside the payment, nothing closed', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await paidInOctober(c);
    const l = await loan(c, employeeId, [50000]);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const wages = s.recoveryCap.slip.wages;
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);

    /* The first check passes on the approved payslip; the cancel lands just after it. */
    between.fn = async () => {
      await api.post(c, `/runs/${run}/cancel`, { reason: 'Redone' }).expect(200);
    };
    const refused = await api.post(c, `/settlements/${s.id}/paid`, {}).expect(409);
    expect(between.fn).toBeNull();
    expect(refused.body.code).toBe('RECOVERY_CAP_CHANGED');
    /* It says what limits the recovery now, not just that something changed. */
    expect(refused.body.error).toContain(`its payslip no longer counts, so the ₹${wages.toLocaleString('en-IN')} of days worked is gone`);
    expect(refused.body.error).toMatch(/is left for loans and advances, and this recovers ₹/);
    const ln = await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }));
    expect(Number(ln.outstandingBalance)).toBe(50000);
    expect((await own(c, () => payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } }))).status).toBe('APPROVED');
  }, 240_000);

  it('review of #86: while a settlement is checked, the leaving month’s payroll cannot be cancelled until it is done', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await paidInOctober(c);
    let cancelled: Promise<request.Response> | null = null;
    const statusOf = () => own(c, () => payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: run } })).then((r) => r.status);
    await own(c, () =>
      payrollPrisma.$transaction(async (tx) => {
        const basis = await leavingSlipBasis(c.orgId, employeeId, '2026-10-14', tx, { lock: true });
        expect(basis?.wages).toBeGreaterThan(0);
        cancelled = api.post(c, `/runs/${run}/cancel`, { reason: 'Redone' }).then((r) => r);
        await new Promise((r) => setTimeout(r, 1500));
        /* The cancel waits on the run's row this transaction holds. */
        expect(await statusOf()).toBe('APPROVED');
      }, { timeout: 30_000 })
    );
    expect((await cancelled!).status).toBe(200);
    expect(await statusOf()).toBe('CANCELLED');
  }, 240_000);

  it('review of #86: a payslip redone higher lets it recover more: the screen is told the saved figures are from the earlier payslip', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await paidInOctober(c);
    const l = await loan(c, employeeId, [500000]);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(s.recoveryCap.heldBack).toBeGreaterThan(0);
    expect(s.recoveryCapNewer).toBeNull();
    const was = bySource(s, l.id).amount;

    /* The payslip counted more days worked now (as a redone, higher payroll would). */
    await own(c, async () => {
      const slip = await payrollPrisma.salarySlip.findFirstOrThrow({ where: { runId: run, employeeId } });
      const snap = JSON.parse(slip.inputSnapshotJson || '{}');
      snap.capBasis = { wages: snap.capBasis.wages + 10000, deducted: snap.capBasis.deducted };
      await payrollPrisma.salarySlip.update({ where: { id: slip.id }, data: { inputSnapshotJson: JSON.stringify(snap) } });
    });
    const listed = (await api.get(c, '/settlements').expect(200)).body.settlements.find((x: any) => x.id === s.id);
    expect(listed.recoveryCapNewer.recovered).toBeCloseTo(s.recoveryCap.recovered + 5000, 2);
    expect(listed.recoveryCapNewer.slip.wages).toBeCloseTo(s.recoveryCap.slip.wages + 10000, 2);
    /* The saved figures stand until it is worked out again; approving is still allowed (it recovers less, never more). */
    expect(bySource(listed, l.id).amount).toBe(was);
    const again = (await api.post(c, `/settlements/${s.id}/recalculate`).expect(200)).body.settlement;
    expect(bySource(again, l.id).amount).toBeCloseTo(was + 5000, 2);
    expect(again.recoveryCapNewer).toBeNull();
  }, 240_000);

  it('review of #86: a draft is not approved once its payroll is cancelled', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await paidInOctober(c);
    await loan(c, employeeId, [50000]);
    const s = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    await api.post(c, `/runs/${run}/cancel`, { reason: 'Redone' }).expect(200);
    const refused = await api.post(c, `/settlements/${s.id}/approve`).expect(409);
    expect(refused.body.code).toBe('RECOVERY_CAP_CHANGED');
    expect(refused.body.error).toMatch(/Work it out again before approving/);
    /* Worked out again from today's records, it goes ahead. */
    await api.post(c, `/settlements/${s.id}/recalculate`).expect(200);
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
  }, 240_000);

  it('works out again: a wage line raised lets the recovery grow back, HR’s smaller figure stays, and Work out again starts over', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [10000]);
    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    let s = (await api.put(c, `/settlements/${p.id}`, { lines: withEarnings(p.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 6000 }]) }).expect(200)).body.settlement;
    expect(bySource(s, l.id).amount).toBe(3000);
    s = (await api.put(c, `/settlements/${p.id}`, { lines: withEarnings(s.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 40000 }]) }).expect(200)).body.settlement;
    expect(bySource(s, l.id).amount).toBe(10000);
    /* HR recovers only ₹2,000 here: kept, the rest stays owed. A forged "owed" in the request changes nothing. */
    s = (await api.put(c, `/settlements/${p.id}`, { lines: s.lines.map((x: any) => (x.source?.id === l.id ? { ...x, amount: 2000, recover: { due: 2000, wanted: 2000, capped: 0 } } : x)) }).expect(200)).body.settlement;
    expect(bySource(s, l.id)).toMatchObject({ amount: 2000, recover: { due: 10000, wanted: 2000, capped: 0 } });
    expect(s.recoveryCap).toMatchObject({ recovered: 2000, heldBack: 0, owed: 8000 });
    s = (await api.post(c, `/settlements/${p.id}/recalculate`).expect(200)).body.settlement;
    expect(bySource(s, l.id)).toMatchObject({ amount: 0, recover: { due: 10000 } });
  }, 120_000);

  it('a recovery waiting in Payroll held back in part: the part held back is open on the advance in People, counted once', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const comp = await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
    const period = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
    const a = await advance(c, employeeId, { amount: 3000, recoveringAmount: 3000 });
    const key = `advance-recover:${a.id}:${period.body.period.id}`;
    await own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id: key, accountId: c.accountId, orgId: c.orgId, employeeId, componentId: comp.body.component.id, periodId: period.body.period.id, type: 'DEDUCTION', amount: 3000, reason: 'test', reference: key, status: 'APPROVED', approvedAt: new Date(), recoveryBase: 0, createdByUserId: 'test' } }));
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));

    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const s = (await api.put(c, `/settlements/${p.id}`, { lines: withEarnings(p.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 2000 }]) }).expect(200)).body.settlement;
    expect(bySource(s, key)).toMatchObject({ kind: 'DEDUCTION', amount: 1000, recover: { due: 3000, capped: 2000 } });
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    await api.post(c, `/settlements/${s.id}/paid`, {}).expect(200);

    const check = async () => {
      const rows = await own(c, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, OR: [{ id: key }, { reference: key }] } }));
      /* Taken ₹1,000; nothing left carried in Payroll for a later run to take as well. */
      expect(rows.map((r) => [r.status, Number(r.amount)])).toEqual([['CONSUMED', 1000]]);
      expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 1000, recovering: 0, open: 2000 });
    };
    await check();
    expect((await api.post(c, `/settlements/${s.id}/close-sources`).expect(200)).body.closed).toEqual([]);
    await check();
  }, 180_000);

  it('keeps the share it was worked out with; Work out again takes today’s', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [10000]);
    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    await api.put(c, '/settings/fnf-recovery', { percent: 20 }).expect(200);
    let s = (await api.put(c, `/settlements/${p.id}`, { lines: withEarnings(p.lines, [{ code: 'NOTICE', label: 'Notice pay', amount: 10000 }]) }).expect(200)).body.settlement;
    expect(s.recoveryCap.percent).toBe(50);
    expect(bySource(s, l.id).amount).toBe(5000);
    s = (await api.post(c, `/settlements/${p.id}/recalculate`).expect(200)).body.settlement;
    expect(s.recoveryCap.percent).toBe(20);
  }, 120_000);
});

describe('review of #86: where the limit binds', () => {
  const rails = async (c: Ctx) => {
    const comp = await api.post(c, '/components', { name: 'Advance recovery', code: 'ADVREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 85 }).expect(201);
    const period = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
    return { componentId: comp.body.component.id as string, periodId: period.body.period.id as string };
  };
  const adjustment = (c: Ctx, o: { id: string; employeeId: string; componentId: string; periodId: string; amount: number; status: string; carriedByRunId?: string }) =>
    own(c, () => payrollPrisma.payrollAdjustment.create({ data: { id: o.id, accountId: c.accountId, orgId: c.orgId, employeeId: o.employeeId, componentId: o.componentId, periodId: o.periodId, type: 'DEDUCTION', amount: o.amount, reason: 'Carried from September', reference: o.id, status: o.status, approvedAt: o.status === 'APPROVED' ? new Date() : null, carriedByRunId: o.carriedByRunId ?? null, createdByUserId: 'test' } }));
  const notice = async (c: Ctx, s: any, amount: number) => (await api.put(c, `/settlements/${s.id}`, { lines: withEarnings(s.lines, [{ code: 'NOTICE', label: 'Notice pay', amount }]) }).expect(200)).body.settlement;
  const payTwice = async (c: Ctx, s: any) => {
    await api.post(c, `/settlements/${s.id}/approve`).expect(200);
    const [x, y] = await Promise.all([api.post(c, `/settlements/${s.id}/paid`, {}), api.post(c, `/settlements/${s.id}/paid`, {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  };

  it('an advance line that folds in a draft recovery: the part recovered is counted once, the rest open in People', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const r = await rails(c);
    /* ₹4,000 paid out; ₹3,000 of it sent to Payroll and still a draft there. */
    const a = await advance(c, employeeId, { recoveringAmount: 3000 });
    const key = `advance-recover:${a.id}:${r.periodId}`;
    await adjustment(c, { id: key, employeeId, ...r, amount: 3000, status: 'DRAFT' });
    await own(c, () => peoplePrisma.employeeAdvance.update({ where: { id: a.id }, data: { payrollAdjustmentId: key } }));

    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    expect(bySource(p, a.id)).toMatchObject({ source: { type: 'ADVANCE', draftId: key }, recover: { due: 4000 } });
    const s = await notice(c, p, 4000);
    expect(bySource(s, a.id)).toMatchObject({ amount: 2000, recover: { due: 4000, capped: 2000 } });
    await payTwice(c, s);

    const check = async () => {
      expect((await own(c, () => payrollPrisma.payrollAdjustment.findUniqueOrThrow({ where: { id: key } }))).status).toBe('CANCELLED');
      expect(await peopleAdvance(c, a.id)).toMatchObject({ status: 'PAID', recovered: 2000, recovering: 0, open: 2000 });
    };
    await check();
    expect((await api.post(c, `/settlements/${s.id}/close-sources`).expect(200)).body.closed).toEqual([]);
    await check();
  }, 180_000);

  it('a corrected carried row back for approval: the part recovered is taken once, the rest stays waiting in Payroll', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const r = await rails(c);
    const key = `carried-${rnd()}`;
    await adjustment(c, { id: key, employeeId, ...r, amount: 3000, status: 'DRAFT', carriedByRunId: 'run-september' });

    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const s = await notice(c, p, 2000);
    expect(bySource(s, key)).toMatchObject({ kind: 'DEDUCTION', amount: 1000, recover: { due: 3000, capped: 2000 } });
    await payTwice(c, s);

    const rows = async () => (await own(c, () => payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, OR: [{ id: key }, { carriedFromId: key }] }, orderBy: { createdAt: 'asc' } }))).map((x) => [x.status, Number(x.amount)]);
    /* ₹1,000 taken by the settlement, ₹2,000 still owed: 1,000 + 2,000 = 3,000, nothing twice. */
    expect(await rows()).toEqual([['CONSUMED', 1000], ['APPROVED', 2000]]);
    await api.post(c, `/settlements/${s.id}/close-sources`).expect(200);
    expect(await rows()).toEqual([['CONSUMED', 1000], ['APPROVED', 2000]]);
  }, 180_000);

  it('a loan instalment taken in part: the instalment shrinks by what was recovered and the balance is what is still owed', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [5000, 5000]);
    const p = (await api.post(c, '/settlements', { employeeId }).expect(201)).body.settlement;
    const s = await notice(c, p, 7000);
    expect(bySource(s, l.id)).toMatchObject({ amount: 3500, recover: { due: 10000, capped: 6500 } });
    await payTwice(c, s);

    const check = async () => {
      const ln = await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }));
      const inst = await own(c, () => payrollPrisma.payrollLoanInstallment.findMany({ where: { loanId: l.id }, orderBy: { sequence: 'asc' } }));
      expect(inst.map((i) => [i.status, Number(i.dueAmount)])).toEqual([['PENDING', 1500], ['PENDING', 5000]]);
      expect(ln.status).toBe('ACTIVE');
      expect(Number(ln.outstandingBalance)).toBe(6500);
    };
    await check();
    await api.post(c, `/settlements/${s.id}/close-sources`).expect(200);
    await check();
  }, 180_000);

  it('a deduction HR enters (notice not served) is taken first and is not held to the limit', () => {
    const { cap, lines } = applyRecoveryCap(
      [
        { code: 'NOTICE_PAY', label: 'Notice pay', kind: 'EARNING', amount: 10000, explanation: '' },
        { code: 'NOTICE', label: 'Notice not served', kind: 'DEDUCTION', amount: 8000, explanation: '' },
        { code: 'LOAN_A', label: 'Loan', kind: 'DEDUCTION', amount: 4000, explanation: '', source: { type: 'LOAN', id: 'a', owed: 4000 } },
      ],
      { percent: 50, slip: null }
    );
    /* The owner's rule: entered deductions stand in full, then recoveries fit what is left of the share. */
    expect(lines[1].amount).toBe(8000);
    expect(lines[2].amount).toBe(0);
    expect(cap).toMatchObject({ limit: 5000, otherDeductions: 8000, room: 0, owed: 4000 });
  });
});

describe('settlements made before the limit', () => {
  const older = async (c: Ctx, employeeId: string, status: string, loanId: string) =>
    own(c, () =>
      payrollPrisma.finalSettlement.create({
        data: {
          accountId: c.accountId, orgId: c.orgId, employeeId, status, leavingDate: '2026-10-14', dueDate: '2026-10-16', netPayable: -4000, createdByUserId: 'someone-else',
          linesJson: JSON.stringify([{ code: 'LOAN_X', label: 'Loan recovery', kind: 'DEDUCTION', amount: 4000, explanation: '', source: { type: 'LOAN', id: loanId, owed: 4000 } }]),
          ...(status === 'PAID' ? { paidAt: new Date() } : {}),
        },
      })
    );

  it('a draft is not approved recovering more than the limit; saving it applies the limit', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [4000]);
    const row = await older(c, employeeId, 'DRAFT', l.id);
    expect((await api.post(c, `/settlements/${row.id}/approve`).expect(409)).body.code).toBe('RECOVERY_CAP_NOT_APPLIED');
    const s = (await api.put(c, `/settlements/${row.id}`, { lines: withEarnings(JSON.parse(row.linesJson), [{ code: 'NOTICE', label: 'Notice pay', amount: 8000 }]) }).expect(200)).body.settlement;
    expect(s.recoveryCap).toMatchObject({ percent: 50, recovered: 4000 });
    await api.post(c, `/settlements/${row.id}/approve`).expect(200);
  }, 120_000);

  it('an approved one past the limit is not paid; a paid one is left as it was', async () => {
    const c = await makeOwner();
    const employeeId = await leaver(c);
    const l = await loan(c, employeeId, [4000]);
    const row = await older(c, employeeId, 'APPROVED', l.id);
    expect((await api.post(c, `/settlements/${row.id}/paid`, {}).expect(409)).body.code).toBe('RECOVERY_CAP_NOT_APPLIED');
    expect(Number((await own(c, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id: l.id } }))).outstandingBalance)).toBe(4000);

    const other = await leaver(c);
    const l2 = await loan(c, other, [4000]);
    const paid = await older(c, other, 'PAID', l2.id);
    const listed = (await api.get(c, '/settlements').expect(200)).body.settlements.find((x: any) => x.id === paid.id);
    expect(listed).toMatchObject({ status: 'PAID', recoveryCap: null, netPayable: -4000 });
    expect(listed.lines[0].amount).toBe(4000);
  }, 120_000);
});

describe('the setting', () => {
  it('defaults to 50, takes 0 to 50 from the owner, and is audited before and after', async () => {
    const c = await makeOwner();
    expect((await api.get(c, '/settings/fnf-recovery').expect(200)).body).toEqual({ percent: 50, canEdit: true });
    await api.put(c, '/settings/fnf-recovery', { percent: 60 }).expect(400);
    await api.put(c, '/settings/fnf-recovery', { percent: -1 }).expect(400);
    await api.put(c, '/settings/fnf-recovery', { percent: 12.5 }).expect(400);
    expect((await api.put(c, '/settings/fnf-recovery', { percent: 40 }).expect(200)).body.percent).toBe(40);
    await new Promise((r) => setTimeout(r, 150));
    const audit = await platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'payroll.fnfRecovery' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('CHANGED');
    expect(JSON.parse(String(audit[0].metadata))).toMatchObject({ before: { percent: 50 }, after: { percent: 40 } });
  }, 60_000);

  it('a payroll manager sees it but may not change it; another company never sees this one', async () => {
    const c = await makeOwner();
    const pm = await colleague(c, ['PAYROLL::Payroll Settings::VIEW', 'PAYROLL::Payroll Settings::EDIT']);
    expect((await api.get(pm, '/settings/fnf-recovery').expect(200)).body).toEqual({ percent: 50, canEdit: false });
    expect((await api.put(pm, '/settings/fnf-recovery', { percent: 30 }).expect(403)).body.code).toBe('OWNER_OR_ADMIN');
    const viewer = await colleague(c, ['PAYROLL::Payroll Runs::VIEW']);
    await api.put(viewer, '/settings/fnf-recovery', { percent: 30 }).expect(403);

    await api.put(c, '/settings/fnf-recovery', { percent: 25 }).expect(200);
    const d = await makeOwner();
    expect((await api.get(d, '/settings/fnf-recovery').expect(200)).body.percent).toBe(50);
    /* Their token against our company: refused. */
    await request(app).put(`/api/orgs/${c.orgId}/payroll/settings/fnf-recovery`).set({ ...at(d), 'x-org-id': c.orgId }).send({ percent: 0 }).expect((r) => expect([401, 403, 404]).toContain(r.status));
    expect((await api.get(c, '/settings/fnf-recovery').expect(200)).body.percent).toBe(25);
  }, 120_000);
});
