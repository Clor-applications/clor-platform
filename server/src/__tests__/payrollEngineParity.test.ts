import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Payroll on the approval engine (workflow engine 3a, SPEC section 9 and 7.5): parity with the old path.
 *
 * Loans, salary revisions and final settlements, each × each scenario, are run twice in one company, once with the
 * company's switch off (the old path) and once on (the engine), and must give the same people who may approve, the
 * same refusals word for word (maker-checker, your own record, no right), the same Payroll rows after (status, the
 * loan's schedule and its pay periods, the revision's stored impact, the settlement's figures) and the same
 * SELF_APPROVED audit lines. "May approve" is measured, not assumed: every person tries, on a fresh row each time one
 * succeeds. Pay periods run from the 26th to the 25th. With the switch on, each row also has its engine request,
 * decided by the person Payroll says approved it.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { syncPayrollEngine } = await import('../services/people/approvals/payrollSource.js');
const { approveLoan } = await import('../services/payroll/loan.js');
const { runApprovalDues } = await import('../services/people/approvals/engine.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string; name: string };
const signedIn: Array<{ ctx: Ctx; email: string }> = [];
/* Signed in again before each test: the file runs longer than a sign-in lasts when the Mac is busy. */
beforeEach(async () => {
  for (const s of signedIn) s.ctx.token = (await request(app).post('/api/auth/login').send({ email: s.email, password: 'Passw0rd!23' }).expect(200)).body.token;
});
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const pay = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)),
  post: (p: string, body: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(body as any),
  put: (p: string, body: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/payroll${p}`).set(at(c)).send(body as any),
});

async function owner(name = 'Asha Owner'): Promise<Ctx> {
  const email = `pe.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Pe Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: '', accountId: '', name };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  c.userId = me.body.user.id;
  c.accountId = me.body.orgs.find((o: any) => o.orgId === c.orgId).accountId;
  signedIn.push({ ctx: c, email });
  return c;
}
async function colleague(boss: Ctx, name: string, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.split(' ')[0].toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  const ctx: Ctx = { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, userId: user.body.user.id, accountId: boss.accountId, name };
  signedIn.push({ ctx, email });
  return ctx;
}
const setSwitch = (c: Ctx, on: boolean) => request(app).put(`/api/orgs/${c.orgId}/people/company-choices/payroll.onEngine`).set(at(c)).send({ value: on }).expect(200);
async function setMode(c: Ctx, makerChecker: string) {
  const current = (await request(app).get(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).expect(200)).body.policy;
  await request(app).put(`/api/orgs/${c.orgId}/security/policy`).set(at(c)).send({ ...current, makerChecker }).expect(200);
}

/* A Payroll approver of all three (and preparer); a Payroll reader; a People approver with no Payroll right. */
const PAYROLL_APPROVER = [
  'PAYROLL::Payroll Loans::VIEW', 'PAYROLL::Payroll Loans::CREATE', 'PAYROLL::Payroll Loans::EDIT', 'PAYROLL::Payroll Loans::APPROVE',
  'PAYROLL::Salary Revisions::VIEW', 'PAYROLL::Salary Revisions::CREATE', 'PAYROLL::Salary Revisions::EDIT', 'PAYROLL::Salary Revisions::APPROVE',
  'PAYROLL::Payroll Runs::VIEW', 'PAYROLL::Payroll Runs::EDIT', 'PAYROLL::Payroll Runs::APPROVE',
];
const PAYROLL_READER = ['PAYROLL::Payroll Loans::VIEW', 'PAYROLL::Salary Revisions::VIEW', 'PAYROLL::Payroll Runs::VIEW'];
const PEOPLE_APPROVER = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::APPROVE'];

/* One company's payroll: components, a structure, and pay periods from the 26th to the 25th. */
type Books = { structureId: string; recoveryId: string; periods: Array<{ id: string; start: string; end: string }> };
async function books(c: Ctx): Promise<Books> {
  const basic = (await pay(c).post('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', includeInGratuityWage: true, displayOrder: 1 }).expect(201)).body.component.id;
  const recoveryId = (await pay(c).post('/components', { name: 'Loan Recovery', code: 'LOANREC', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 80 }).expect(201)).body.component.id;
  const structureId = (await pay(c).post('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2020-01-01', status: 'ACTIVE', components: [{ componentId: basic, displayOrder: 1 }, { componentId: recoveryId, displayOrder: 80 }] }).expect(201)).body.structure.id;
  const periods: Books['periods'] = [];
  for (const [name, start, end] of [['Oct–Nov', '2026-10-26', '2026-11-25'], ['Nov–Dec', '2026-11-26', '2026-12-25'], ['Dec–Jan', '2026-12-26', '2027-01-25'], ['Jan–Feb', '2027-01-26', '2027-02-25']] as const) {
    periods.push({ id: (await pay(c).post('/periods', { name: `${name} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201)).body.period.id, start, end });
  }
  return { structureId, recoveryId, periods };
}
/** Somebody on payroll; leaving on `leaving` (inside the 26 Oct – 25 Nov period) when they are to be settled. */
async function person(c: Ctx, b: Books, name: string, o: { leaving?: string; userId?: string } = {}) {
  const e = (await pay(c).post('/employees', { name, code: `E${rnd()}`, dateOfJoining: '2020-03-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } }).expect(201)).body.employee;
  await pay(c).post('/assignments', { employeeId: e.id, structureId: b.structureId, effectiveFrom: '2020-03-01', annualCtc: 360_000 }).expect(201);
  if (o.leaving) await pay(c).put(`/employees/${e.id}`, { name, dateOfJoining: '2020-03-01', dateOfLeaving: o.leaving, status: 'LEFT' }).expect(200);
  if (o.userId) await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { userId: o.userId } }));
  return e.id as string;
}

type Kind = 'loan' | 'revision' | 'settlement';
const SOURCE: Record<Kind, string> = { loan: 'LOAN', revision: 'SALARY_REVISION', settlement: 'FINAL_SETTLEMENT' };
/** A fresh row waiting for approval, prepared by `maker`, about `employeeId`; anything of theirs still open is closed first. */
async function fresh(kind: Kind, maker: Ctx, b: Books, employeeId: string): Promise<string> {
  const orgId = maker.orgId;
  if (kind === 'loan') {
    return (await pay(maker).post('/loans', { employeeId, principal: 30_000, interestRate: 0, startDate: '2026-11-03', recoveryStartPeriodId: b.periods[0].id, installmentCount: 3, recoveryComponentId: b.recoveryId }).expect(201)).body.loan.id;
  }
  if (kind === 'revision') {
    await runInTenant(orgId, () => payrollPrisma.salaryRevision.updateMany({ where: { orgId, employeeId, status: { in: ['DRAFT', 'REVIEWED', 'APPROVED'] } }, data: { status: 'REJECTED' } }));
    const id = (await pay(maker).post('/revisions', { employeeId, proposedStructureId: b.structureId, proposedAnnualCtc: 420_000, effectiveFrom: '2026-11-10', reason: 'Annual' }).expect(201)).body.revision.id;
    await pay(maker).post(`/revisions/${id}/submit-review`).expect(200);
    return id;
  }
  await runInTenant(orgId, () => payrollPrisma.finalSettlement.updateMany({ where: { orgId, employeeId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } }));
  return (await pay(maker).post('/settlements', { employeeId }).expect(201)).body.settlement.id;
}
const approve = (kind: Kind, c: Ctx, id: string) => pay(c).post(`/${kind === 'loan' ? 'loans' : kind === 'revision' ? 'revisions' : 'settlements'}/${id}/approve`);
const engineOf = (orgId: string, kind: Kind, id: string) => runInTenant(orgId, () => peoplePrisma.approvalRequest.findFirst({ where: { orgId, sourceKind: SOURCE[kind], sourceId: id }, include: { steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } } }));
const selfApproved = (orgId: string, id: string) => platformPrisma.auditLog.count({ where: { orgId, entityId: id, action: 'SELF_APPROVED' } });

/** The Payroll row as it stands, without ids or times: what parity compares. */
async function rowOf(kind: Kind, orgId: string, id: string, b: Books) {
  const period = (pid: string | null) => b.periods.findIndex((p) => p.id === pid);
  if (kind === 'loan') {
    const l = await runInTenant(orgId, () => payrollPrisma.payrollLoan.findUniqueOrThrow({ where: { id }, include: { installments: { orderBy: { sequence: 'asc' } } } }));
    return { status: l.status, outstanding: Number(l.outstandingBalance), installments: l.installments.map((i) => ({ seq: i.sequence, due: Number(i.dueAmount), period: period(i.periodId) })) };
  }
  if (kind === 'revision') {
    const r = await runInTenant(orgId, () => payrollPrisma.salaryRevision.findUniqueOrThrow({ where: { id } }));
    return { status: r.status, impactStored: Boolean(r.impactJson), ctc: JSON.parse(r.impactJson || '{}').ctc ?? null };
  }
  const s = await runInTenant(orgId, () => payrollPrisma.finalSettlement.findUniqueOrThrow({ where: { id } }));
  return { status: s.status, net: Number(s.netPayable), cap: s.recoveryCap ? (s.recoveryCap as any).percent : null };
}

/**
 * Everyone tries to approve, in order. A refusal keeps the same row for the next person; a success gives the next
 * person a fresh one. Answers each person's outcome, each approved row as Payroll keeps it, and the self-approval
 * audit lines; with the switch on, each row's engine request too.
 */
async function measure(kind: Kind, maker: Ctx, b: Books, employeeId: string, everyone: Ctx[]) {
  const outcome: Record<string, string> = {};
  const rows: unknown[] = [];
  const engine: unknown[] = [];
  let id = await fresh(kind, maker, b, employeeId);
  for (const who of everyone) {
    const r = await approve(kind, who, id);
    outcome[who.name] = r.status === 200 ? 'APPROVED' : `${r.status} ${r.body.code || ''} ${r.body.error || ''}`.trim();
    if (r.status !== 200) continue;
    rows.push({ ...(await rowOf(kind, maker.orgId, id, b)), selfApproved: await selfApproved(maker.orgId, id) });
    const e = await engineOf(maker.orgId, kind, id);
    engine.push(e ? { status: e.status, decidedBy: e.steps.filter((s) => s.status === 'APPROVED').map((s) => s.decidedByUserId) } : null);
    id = await fresh(kind, maker, b, employeeId);
  }
  return { outcome, rows, engine, last: id };
}

let asha: Ctx; // the owner, an administrator
let ravi: Ctx; // Payroll approver
let meena: Ctx; // reads Payroll only
let kiran: Ctx; // approves People requests, no Payroll right
let b: Books;
let staff: string; // nobody with a sign-in
let ravisOwn: string; // Ravi's own record (leaving, so his own settlement can be drafted too)
let leaverStaff: string;
let everyone: Ctx[];

beforeAll(async () => {
  asha = await owner();
  ravi = await colleague(asha, 'Ravi Kumar', PAYROLL_APPROVER);
  meena = await colleague(asha, 'Meena Iyer', PAYROLL_READER);
  kiran = await colleague(asha, 'Kiran Rao', PEOPLE_APPROVER);
  everyone = [asha, ravi, meena, kiran];
  b = await books(asha);
  staff = await person(asha, b, 'Tanmay Deshpande');
  ravisOwn = await person(asha, b, 'Ravi Kumar', { leaving: '2026-11-03', userId: ravi.userId });
  leaverStaff = await person(asha, b, 'Neha Joshi', { leaving: '2026-11-03' });
}, 180_000);

const KINDS: Kind[] = ['loan', 'revision', 'settlement'];
type Scenario = { name: string; maker: () => Ctx; subject: (k: Kind) => string; mode?: string };
const SCENARIOS: Scenario[] = [
  { name: 'the owner prepares it for someone without a sign-in', maker: () => asha, subject: (k) => (k === 'settlement' ? leaverStaff : staff) },
  { name: 'a Payroll approver prepares it', maker: () => ravi, subject: (k) => (k === 'settlement' ? leaverStaff : staff) },
  { name: 'it is about a Payroll approver', maker: () => asha, subject: () => ravisOwn },
  { name: 'maker-checker: always a second person (STRICT)', maker: () => asha, subject: (k) => (k === 'settlement' ? leaverStaff : staff), mode: 'STRICT' },
  { name: 'maker-checker: one person may do both (ALLOW)', maker: () => asha, subject: (k) => (k === 'settlement' ? leaverStaff : staff), mode: 'ALLOW' },
];

describe('payroll on the approval engine: parity with the old path', () => {
  for (const kind of KINDS) {
    for (const sc of SCENARIOS) {
      it(`${kind} / ${sc.name}`, async () => {
        if (sc.mode) await setMode(asha, sc.mode);
        try {
          await setSwitch(asha, false);
          const off = await measure(kind, sc.maker(), b, sc.subject(kind), everyone);
          await setSwitch(asha, true);
          const on = await measure(kind, sc.maker(), b, sc.subject(kind), everyone);
          expect(on.outcome).toEqual(off.outcome);
          expect(on.rows).toEqual(off.rows);
          /* Off writes nothing to the engine; on, every approved row's request is approved by whoever approved the row. */
          expect(off.engine.every((e) => e === null)).toBe(true);
          const approvers = Object.entries(on.outcome).filter(([, v]) => v === 'APPROVED').map(([n]) => everyone.find((c) => c.name === n)!.userId);
          expect(on.engine).toEqual(approvers.map((u) => ({ status: 'APPROVED', decidedBy: [u] })));
          /* The row nobody could approve is still waiting on the engine, for whoever Payroll lets approve it. */
          const left = await engineOf(asha.orgId, kind, on.last);
          expect(left?.status).toBe('WAITING');
          await setSwitch(asha, false);
        } finally {
          if (sc.mode) await setMode(asha, 'AUTO');
        }
      }, 180_000);
    }
  }

  it('the expected outcomes, written down once (so parity is not two wrongs agreeing)', async () => {
    await setSwitch(asha, true);
    const loan = await measure('loan', asha, b, staff, everyone);
    /* Loans follow maker-checker (owner's decision, 4 Nov 2026): the owner prepared it and Ravi can approve, so Ravi does. */
    expect(loan.outcome).toMatchObject({ 'Asha Owner': expect.stringMatching(/^403 MAKER_CHECKER You prepared this loan/), 'Ravi Kumar': 'APPROVED', 'Meena Iyer': expect.stringMatching(/^403/), 'Kiran Rao': expect.stringMatching(/^403/) });
    const revision = await measure('revision', asha, b, staff, everyone);
    expect(revision.outcome['Asha Owner']).toMatch(/^403 MAKER_CHECKER You prepared this salary revision/);
    expect(revision.outcome['Ravi Kumar']).toBe('APPROVED');
    const own = await measure('settlement', asha, b, ravisOwn, everyone);
    expect(own.outcome['Ravi Kumar']).toMatch(/^403 OWN_RECORD This is your own full and final settlement/);
    /* Ravi's own loan and revision: never his (owner's decision, 4 Nov 2026); the owner, who prepared them, may, since the only other approver is the person it is about. */
    const ownLoan = await measure('loan', asha, b, ravisOwn, [ravi, asha]);
    expect(ownLoan.outcome).toEqual({ 'Ravi Kumar': '403 OWN_RECORD This is your own loan; somebody else has to approve it.', 'Asha Owner': 'APPROVED' });
    const ownRevision = await measure('revision', asha, b, ravisOwn, [ravi, asha]);
    expect(ownRevision.outcome).toEqual({ 'Ravi Kumar': '403 OWN_RECORD This is your own salary revision; somebody else has to approve it.', 'Asha Owner': 'APPROVED' });
    await setSwitch(asha, false);
  }, 180_000);
});

describe('payroll on the approval engine: switch, old rows, changes, races', () => {
  it('switch off: nothing is written to the engine; a row prepared before the switch went on finishes on the old path', async () => {
    await setSwitch(asha, false);
    const before = await fresh('settlement', asha, b, leaverStaff);
    const loanBefore = await fresh('loan', asha, b, staff);
    expect(await engineOf(asha.orgId, 'settlement', before)).toBeNull();
    await setSwitch(asha, true);
    await approve('settlement', ravi, before).expect(200);
    await approve('loan', ravi, loanBefore).expect(200);
    expect(await engineOf(asha.orgId, 'settlement', before)).toBeNull();
    expect(await engineOf(asha.orgId, 'loan', loanBefore)).toBeNull();
    await setSwitch(asha, false);
  }, 120_000);

  it('a revision: edited back to draft withdraws its request, sent again opens it again; rejected by the owner, never by the person it is about', async () => {
    await setSwitch(asha, true);
    const id = await fresh('revision', asha, b, ravisOwn);
    expect((await engineOf(asha.orgId, 'revision', id))?.status).toBe('WAITING');
    await pay(asha).put(`/revisions/${id}`, { employeeId: ravisOwn, proposedStructureId: b.structureId, proposedAnnualCtc: 430_000, effectiveFrom: '2026-11-10' }).expect(200);
    expect((await engineOf(asha.orgId, 'revision', id))?.status).toBe('WITHDRAWN');
    await pay(asha).post(`/revisions/${id}/submit-review`).expect(200);
    expect((await engineOf(asha.orgId, 'revision', id))?.status).toBe('WAITING');
    /* Ravi may not reject his own revision (owner's decision, 4 Nov 2026); it keeps waiting, and the owner may. */
    expect((await pay(ravi).post(`/revisions/${id}/reject`).expect(403)).body).toMatchObject({ code: 'OWN_RECORD', error: 'This is your own salary revision; somebody else has to reject it.' });
    expect((await engineOf(asha.orgId, 'revision', id))?.status).toBe('WAITING');
    await pay(asha).post(`/revisions/${id}/reject`).expect(200);
    expect((await engineOf(asha.orgId, 'revision', id))?.status).toBe('REJECTED');

    const other = await fresh('revision', ravi, b, staff);
    await pay(asha).post(`/revisions/${other}/reject`).expect(200);
    const rejected = await engineOf(asha.orgId, 'revision', other);
    expect(rejected).toMatchObject({ status: 'REJECTED' });
    expect(rejected!.steps.find((s) => s.status === 'REJECTED')).toMatchObject({ decidedByUserId: asha.userId });
    await setSwitch(asha, false);
  }, 120_000);

  it('cancelled loans and settlements withdraw their requests', async () => {
    await setSwitch(asha, true);
    const loan = await fresh('loan', asha, b, staff);
    await pay(asha).post(`/loans/${loan}/cancel`).expect(200);
    expect((await engineOf(asha.orgId, 'loan', loan))?.status).toBe('WITHDRAWN');
    const s = await fresh('settlement', asha, b, leaverStaff);
    await pay(asha).post(`/settlements/${s}/cancel`).expect(200);
    expect((await engineOf(asha.orgId, 'settlement', s))?.status).toBe('WITHDRAWN');
    await setSwitch(asha, false);
  }, 120_000);

  it('two approvers at once, on either path: one approval in Payroll, one loan schedule, and on the engine one decided step', async () => {
    await setSwitch(asha, false);
    for (let i = 0; i < 3; i += 1) {
      const id = await fresh('loan', asha, b, staff);
      await Promise.all([approve('loan', ravi, id), approve('loan', ravi, id), approve('loan', asha, id), approve('loan', asha, id)]);
      expect(((await rowOf('loan', asha.orgId, id, b)) as any).installments.length).toBe(3);
    }
    await setSwitch(asha, true);
    for (const kind of KINDS) {
      const id = await fresh(kind, asha, b, kind === 'settlement' ? leaverStaff : staff);
      /* The owner prepared it, so under AUTO only Ravi may approve a revision or settlement; for a loan both may. Two of Ravi, and the owner. */
      const results = await Promise.all([approve(kind, ravi, id), approve(kind, ravi, id), approve(kind, asha, id)]);
      const ok = results.filter((r) => r.status === 200);
      expect(ok.length, kind).toBeGreaterThanOrEqual(1);
      if (kind !== 'loan') expect(ok.length, kind).toBe(1);
      const row = await rowOf(kind, asha.orgId, id, b);
      expect(row.status, kind).toBe(kind === 'loan' ? 'ACTIVE' : 'APPROVED');
      if (kind === 'loan') expect((row as any).installments.length, kind).toBe(3);
      const e = await engineOf(asha.orgId, kind, id);
      expect(e?.status, kind).toBe('APPROVED');
      expect(e!.steps.filter((s) => s.status === 'APPROVED').length, kind).toBe(1);
    }
    await setSwitch(asha, false);
  }, 180_000);

  it('a rollback, or a step not recorded: the row approved in Payroll alone is brought in line on the next approve or reject, as Payroll’s approver', async () => {
    await setSwitch(asha, true);
    const id = await fresh('settlement', asha, b, leaverStaff);
    await runInTenant(asha.orgId, () => payrollPrisma.finalSettlement.update({ where: { id }, data: { status: 'APPROVED', approvedByUserId: ravi.userId, approvedAt: new Date() } }));
    expect((await engineOf(asha.orgId, 'settlement', id))?.status).toBe('WAITING');
    /* Approving it again: refused by Payroll's own state, as before, and the request is caught up from the row. */
    expect((await approve('settlement', ravi, id).expect(409)).body.code).toBe('NOT_DRAFT');
    const e = await engineOf(asha.orgId, 'settlement', id);
    expect(e?.status).toBe('APPROVED');
    expect(e!.steps.find((s) => s.status === 'APPROVED')).toMatchObject({ decidedByUserId: ravi.userId, comment: 'Approved in Payroll' });
    /* A loan approved in Payroll, its step not recorded (the process stopped between the two): the next approve catches it up. */
    const loan = await fresh('loan', asha, b, staff);
    await runInTenant(asha.orgId, () => approveLoan({ accountId: asha.accountId, orgId: asha.orgId, userId: ravi.userId, loanId: loan }));
    await approve('loan', ravi, loan).expect(200);
    expect((await engineOf(asha.orgId, 'loan', loan))?.status).toBe('APPROVED');
    /* A revision approved in Payroll alone: a later reject catches it up first, then reverses it. */
    const rev = await fresh('revision', asha, b, staff);
    await runInTenant(asha.orgId, () => payrollPrisma.salaryRevision.update({ where: { id: rev }, data: { status: 'APPROVED', approvedByUserId: ravi.userId, approvedAt: new Date() } }));
    expect((await approve('revision', ravi, rev).expect(409)).body.code).toBe('REVISION_WRONG_STATE');
    expect((await engineOf(asha.orgId, 'revision', rev))?.status).toBe('APPROVED');
    await setSwitch(asha, false);
  }, 120_000);

  it('the dues job: a Payroll step past its due time whose row was approved elsewhere is caught up; one still waiting is left alone, with no reminder', async () => {
    await setSwitch(asha, true);
    const done = await fresh('loan', asha, b, staff);
    await runInTenant(asha.orgId, () => approveLoan({ accountId: asha.accountId, orgId: asha.orgId, userId: ravi.userId, loanId: done }));
    const waiting = await fresh('loan', asha, b, staff);
    const before = await platformPrisma.notification.count({ where: { orgId: asha.orgId } });
    await runApprovalDues(new Date(Date.now() + 10 * 86_400_000));
    const e = await engineOf(asha.orgId, 'loan', done);
    expect(e?.status).toBe('APPROVED');
    expect(e!.steps.find((s) => s.status === 'APPROVED')).toMatchObject({ decidedByUserId: ravi.userId, comment: 'Approved in Payroll' });
    const w = await engineOf(asha.orgId, 'loan', waiting);
    expect(w?.status).toBe('WAITING');
    expect(w!.steps.every((s) => !s.remindedAt)).toBe(true);
    expect(await platformPrisma.notification.count({ where: { orgId: asha.orgId } })).toBe(before);
    await setSwitch(asha, false);
  }, 120_000);

  it('reversed after approval: a revision rejected once approved, a loan and a settlement cancelled once approved; the request says so', async () => {
    await setSwitch(asha, true);
    const rev = await fresh('revision', asha, b, staff);
    await approve('revision', ravi, rev).expect(200);
    await pay(asha).post(`/revisions/${rev}/reject`).expect(200);
    const er = await engineOf(asha.orgId, 'revision', rev);
    expect(er?.status).toBe('REJECTED');
    expect(er!.steps.at(-1)).toMatchObject({ status: 'REJECTED', decidedByUserId: asha.userId, comment: 'Rejected in Payroll after approval' });
    const loan = await fresh('loan', asha, b, staff);
    await approve('loan', ravi, loan).expect(200);
    await pay(asha).post(`/loans/${loan}/cancel`).expect(200);
    const el = await engineOf(asha.orgId, 'loan', loan);
    expect(el?.status).toBe('WITHDRAWN');
    expect(el!.steps.at(-1)).toMatchObject({ status: 'WITHDRAWN', decidedByUserId: asha.userId, comment: 'Cancelled in Payroll after approval' });
    const s = await fresh('settlement', asha, b, leaverStaff);
    await approve('settlement', ravi, s).expect(200);
    await pay(asha).post(`/settlements/${s}/cancel`).expect(200);
    expect((await engineOf(asha.orgId, 'settlement', s))?.status).toBe('WITHDRAWN');
    /* An older API reversed it (no engine code): the next look brings the request in line too. */
    const s2 = await fresh('settlement', asha, b, leaverStaff);
    await approve('settlement', ravi, s2).expect(200);
    await runInTenant(asha.orgId, () => payrollPrisma.finalSettlement.update({ where: { id: s2 }, data: { status: 'CANCELLED' } }));
    await runInTenant(asha.orgId, () => syncPayrollEngine(asha.accountId, asha.orgId, 'FINAL_SETTLEMENT', s2));
    expect((await engineOf(asha.orgId, 'settlement', s2))?.status).toBe('WITHDRAWN');
    await setSwitch(asha, false);
  }, 120_000);

  it('a draft loan moved to another person: its request starts again about them, so nobody approves their own and nothing is written as "about them" falsely', async () => {
    await setSwitch(asha, true);
    const body = (emp: string) => ({ employeeId: emp, principal: 30_000, interestRate: 0, startDate: '2026-11-03', recoveryStartPeriodId: b.periods[0].id, installmentCount: 3, recoveryComponentId: b.recoveryId });
    const a = (await pay(asha).post('/loans', body(staff)).expect(201)).body.loan.id;
    await pay(asha).put(`/loans/${a}`, body(ravisOwn)).expect(200);
    const ea = await engineOf(asha.orgId, 'loan', a);
    expect(ea).toMatchObject({ status: 'WAITING', subjectEmployeeId: ravisOwn, requesterUserId: ravi.userId, title: expect.stringContaining('Ravi Kumar') });
    expect((await approve('loan', ravi, a).expect(403)).body.code).toBe('OWN_RECORD');
    await approve('loan', asha, a).expect(200);
    const c = (await pay(asha).post('/loans', body(ravisOwn)).expect(201)).body.loan.id;
    await pay(asha).put(`/loans/${c}`, body(staff)).expect(200);
    await approve('loan', ravi, c).expect(200);
    const ec = await engineOf(asha.orgId, 'loan', c);
    expect(ec).toMatchObject({ status: 'APPROVED', subjectEmployeeId: staff });
    expect(ec!.steps.filter((x) => x.status === 'APPROVED')).toEqual([expect.objectContaining({ decidedByUserId: ravi.userId, resolvedHow: 'PAYROLL' })]);
    await setSwitch(asha, false);
  }, 120_000);

  it('another company: its rows are not found, its requests are its own, and the preset rules are per company', async () => {
    await setSwitch(asha, true);
    const id = await fresh('loan', asha, b, staff);
    const other = await owner('Other Owner');
    await setSwitch(other, true);
    expect((await approve('loan', other, id)).status).toBe(404);
    expect((await engineOf(asha.orgId, 'loan', id))?.status).toBe('WAITING');
    const theirs = await runInTenant(other.orgId, () => peoplePrisma.approvalRequest.count({ where: { sourceKind: 'LOAN' } }));
    expect(theirs).toBe(0);
    const rules = await runInTenant(asha.orgId, () => peoplePrisma.approvalRule.findMany({ where: { orgId: asha.orgId, requestType: { in: ['LOAN', 'SALARY_REVISION', 'FINAL_SETTLEMENT'] } } }));
    expect(new Set(rules.map((r) => `${r.requestType}|${r.variantKey}|${r.active}`)).size).toBe(rules.length);
    expect(rules.every((r) => r.variantKey === 'preset:PAYROLL')).toBe(true);
    /* The People approvals list never shows them; they are decided in Payroll. */
    const list = (await request(app).get(`/api/orgs/${asha.orgId}/people/requests?box=waiting`).set(at(asha)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(id);
    await setSwitch(asha, false);
  }, 120_000);
});

describe('payroll on the approval engine: a one-person company', () => {
  it('the owner alone approves what they prepared for an employee (SELF_APPROVED, as today); their own settlement is refused as today, their own loan and revision follow maker-checker; none waits on the engine for nobody', async () => {
    const solo = await owner('Owner Alone');
    const sb = await books(solo);
    const emp = await person(solo, sb, 'Shop Hand');
    const leaver = await person(solo, sb, 'Shop Hand (left)', { leaving: '2026-11-03' });
    const me = await person(solo, sb, 'Owner Alone', { leaving: '2026-11-03', userId: solo.userId });
    const results: Record<string, unknown> = {};
    for (const on of [false, true]) {
      await setSwitch(solo, on);
      for (const kind of KINDS) {
        const forEmp = await measure(kind, solo, sb, kind === 'settlement' ? leaver : emp, [solo]);
        const mine = kind === 'settlement' ? { outcome: { 'Owner Alone': `${(await pay(solo).post('/settlements', { employeeId: me })).body.code}` }, rows: [] as unknown[] } : await measure(kind, solo, sb, me, [solo]);
        results[`${on}|${kind}`] = { forEmp: forEmp.outcome, rows: forEmp.rows, mine: mine.outcome, mineRows: mine.rows };
        if (on) {
          /* What the owner approved is on the engine, decided by them; nothing of theirs waits on the engine for nobody. */
          const approved = await runInTenant(solo.orgId, () => peoplePrisma.approvalRequest.findMany({ where: { orgId: solo.orgId, sourceKind: SOURCE[kind], status: 'APPROVED' }, include: { steps: true } }));
          expect(approved.length, kind).toBeGreaterThan(0);
          expect(approved.every((r) => r.steps.some((s) => s.status === 'APPROVED' && s.decidedByUserId === solo.userId)), kind).toBe(true);
        }
      }
    }
    for (const kind of KINDS) expect(results[`true|${kind}`], kind).toEqual(results[`false|${kind}`]);
    expect(results['true|loan']).toMatchObject({ forEmp: { 'Owner Alone': 'APPROVED' }, mine: { 'Owner Alone': 'APPROVED' } });
    /* The owner alone and their own revision: nobody else can approve it, so the maker-checker setting decides (AUTO: allowed, audited), never a dead end. */
    expect(results['true|revision']).toMatchObject({ forEmp: { 'Owner Alone': 'APPROVED' }, mine: { 'Owner Alone': 'APPROVED' } });
    expect(results['true|settlement']).toMatchObject({ forEmp: { 'Owner Alone': 'APPROVED' }, mine: { 'Owner Alone': 'OWN_RECORD' } });
    expect((results['true|revision'] as any).rows[0].selfApproved).toBe(1);
    /* The owner's own revision is not left waiting on the engine for someone who does not exist: it is on the old path. */
    const ownRevision = await runInTenant(solo.orgId, () => payrollPrisma.salaryRevision.findFirstOrThrow({ where: { orgId: solo.orgId, employeeId: me, status: 'REVIEWED' }, orderBy: { createdAt: 'desc' } }));
    expect(await engineOf(solo.orgId, 'revision', ownRevision.id)).toBeNull();
  }, 240_000);
});

describe('payroll on the approval engine: the switch', () => {
  it('is off by default, changed by the owner (audited), refused to anyone else', async () => {
    const c = await owner('Switch Owner');
    const list = (await request(app).get(`/api/orgs/${c.orgId}/people/company-choices`).set(at(c)).expect(200)).body.choices;
    expect(list.find((x: any) => x.key === 'payroll.onEngine')).toMatchObject({ value: false, default: false, canChange: true });
    const hr = await colleague(c, 'Hema HR', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT', 'PEOPLE::Approvals::VIEW', 'PEOPLE::Approvals::EDIT']);
    expect((await request(app).put(`/api/orgs/${c.orgId}/people/company-choices/payroll.onEngine`).set(at(hr)).send({ value: true })).status).toBe(403);
    await setSwitch(c, true);
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'COMPANY_SETTING', entityId: 'payroll.onEngine' } });
    expect(audit?.message).toBe('Loans, salary revisions and final settlements decided by the approval rules: Off → On');
  }, 60_000);
});

describe('your own loan and salary revision (owner decision, 4 Nov 2026): never yours, on either path; the owner alone follows maker-checker', () => {
  for (const on of [false, true]) {
    it(`switch ${on ? 'on' : 'off'}: Ravi cannot approve his own loan, nor approve or reject his own revision; the owner can`, async () => {
      await setSwitch(asha, on);
      const loan = await fresh('loan', asha, b, ravisOwn);
      expect((await approve('loan', ravi, loan).expect(403)).body).toEqual({ code: 'OWN_RECORD', error: 'This is your own loan; somebody else has to approve it.' });
      expect(((await rowOf('loan', asha.orgId, loan, b)) as any).status).toBe('DRAFT');
      await approve('loan', asha, loan).expect(200);
      const rev = await fresh('revision', asha, b, ravisOwn);
      expect((await approve('revision', ravi, rev).expect(403)).body.code).toBe('OWN_RECORD');
      expect((await pay(ravi).post(`/revisions/${rev}/reject`).expect(403)).body.code).toBe('OWN_RECORD');
      expect(((await rowOf('revision', asha.orgId, rev, b)) as any).status).toBe('REVIEWED');
      await approve('revision', asha, rev).expect(200);
      expect((await pay(ravi).post(`/revisions/${rev}/apply`).expect(403)).body.code).toBe('OWN_RECORD');
      await setSwitch(asha, false);
    }, 120_000);
  }

  it('the owner alone and their own loan and revision: AUTO and ALLOW approve it with a SELF_APPROVED line by name; STRICT refuses in plain words; on both paths', async () => {
    const solo = await owner('Lone Owner');
    const sb = await books(solo);
    const me = await person(solo, sb, 'Lone Owner', { userId: solo.userId });
    for (const on of [false, true]) {
      await setSwitch(solo, on);
      for (const mode of ['AUTO', 'ALLOW', 'STRICT']) {
        await setMode(solo, mode);
        const loan = await fresh('loan', solo, sb, me);
        const rev = await fresh('revision', solo, sb, me);
        if (mode === 'STRICT') {
          expect((await approve('loan', solo, loan).expect(403)).body.error, `${on} ${mode}`).toBe('This is your own loan, and nobody else in the company can approve it. Give someone else the right to approve loans, or change the approval setting.');
          expect((await approve('revision', solo, rev).expect(403)).body.code, `${on} ${mode}`).toBe('OWN_RECORD');
          continue;
        }
        await approve('loan', solo, loan).expect(200);
        await approve('revision', solo, rev).expect(200);
        /* Put into effect once: a second salary starting on the same day is refused for its own reason. */
        if (!on && mode === 'AUTO') await pay(solo).post(`/revisions/${rev}/apply`).expect(200);
        const lines = await platformPrisma.auditLog.findMany({ where: { orgId: solo.orgId, entityId: { in: [loan, rev] }, action: 'SELF_APPROVED' } });
        const own = lines.filter((l) => JSON.parse(l.metadata || '{}').ownRecord);
        expect(own.length, `${on} ${mode}`).toBeGreaterThanOrEqual(2);
        expect(own[0].message, `${on} ${mode}`).toContain(mode === 'ALLOW' ? 'the company allows one person to do both' : 'nobody else in the company can approve it');
      }
      await setMode(solo, 'AUTO');
    }
    /* Reject your own, alone: the same rule. */
    const rev = await fresh('revision', solo, sb, me);
    await pay(solo).post(`/revisions/${rev}/reject`).expect(200);
  }, 240_000);
});
