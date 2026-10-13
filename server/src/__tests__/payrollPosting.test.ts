import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Payroll into the books.
 *
 * Payroll is usually the largest entry a company writes each month, and it is
 * the one place where payroll's own database and the accounting database both
 * have to end up right. A transaction cannot span the two, so the tests that
 * matter are about what happens when only half of it succeeds, and about the
 * arithmetic that makes the entry defensible at all:
 *
 *   - it balances, or it is refused rather than plugged;
 *   - posting twice writes one journal, not two;
 *   - a journal written without its receipt is adopted, not duplicated;
 *   - nothing unapproved reaches the books.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { PAYROLL_SOURCE_DOC_TYPE, postPayrollRun, PayrollPostingError } = await import('../services/payroll/posting.js');
const { accountingFor } = await import('../services/payroll/accounting/client.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string };

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `post.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Post Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx: Ctx = {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: '',
  };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: ctx.orgId }, select: { accountId: true } });
  ctx.accountId = org!.accountId;
  /* The chart of accounts is created lazily; a ledger call brings it into being. */
  await request(app).get(`/api/orgs/${ctx.orgId}/ledger/accounts`).set(at(ctx)).expect(200);
  return ctx;
}

const ledger = (c: Ctx, name: string, accountType: string) =>
  request(app).post(`/api/orgs/${c.orgId}/ledger/accounts`).set(at(c)).send({ name, accountType }).expect(201);

/**
 * A company that can actually post: salary expense, PF expense, and the two
 * liabilities the withholdings are owed to.
 */
async function setUpCompany(c: Ctx) {
  const salaryExpense = (await ledger(c, `Salaries ${rnd()}`, 'EXPENSE')).body.account.id;
  const pfExpense = (await ledger(c, `Employer PF ${rnd()}`, 'EXPENSE')).body.account.id;
  const pfPayable = (await ledger(c, `PF Payable ${rnd()}`, 'LIABILITY')).body.account.id;

  const basic = await api
    .post(c, '/components', {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
      includeInPfWage: true, expenseLedgerId: salaryExpense, displayOrder: 1,
    })
    .expect(201);
  const special = await api
    .post(c, '/components', {
      name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
      calculationMethod: 'BALANCING', expenseLedgerId: salaryExpense, displayOrder: 2,
    })
    .expect(201);
  const epf = await api
    .post(c, '/components', {
      name: 'Employee PF', code: 'EPF', type: 'DEDUCTION',
      calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
      includeInGross: false, isTaxable: false, liabilityLedgerId: pfPayable, displayOrder: 10,
    })
    .expect(201);
  const erpf = await api
    .post(c, '/components', {
      name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION',
      calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
      includeInGross: false, includeInNetPay: false, isTaxable: false,
      expenseLedgerId: pfExpense, liabilityLedgerId: pfPayable, displayOrder: 20,
    })
    .expect(201);

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`,
      frequency: 'MONTHLY',
      effectiveFrom: '2026-01-01',
      status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: special.body.component.id, isBalancing: true, displayOrder: 2 },
        { componentId: epf.body.component.id, displayOrder: 10 },
        { componentId: erpf.body.component.id, displayOrder: 20 },
      ],
    })
    .expect(201);

  const period = await api
    .post(c, '/periods', { name: `Sept 2026 ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' })
    .expect(201);

  return {
    structureId: structure.body.structure.id,
    periodId: period.body.period.id,
    componentIds: { basic: basic.body.component.id, epf: epf.body.component.id },
    ledgers: { salaryExpense, pfExpense, pfPayable },
  };
}

async function addPerson(c: Ctx, structureId: string, name: string, ctc: number) {
  const made = await api
    .post(c, '/employees', {
      name,
      code: `E${rnd().toUpperCase()}`,
      dateOfJoining: '2026-01-01',
      status: 'ACTIVE',
      /* Somebody a payroll can actually pay: a profile is where the bank
         account and the PAN live, and a run refuses without one. */
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountNumber: '123412341234', pan: 'ABCDE1234F' },
    })
    .expect(201);
  await api
    .post(c, '/assignments', { employeeId: made.body.employee.id, structureId, effectiveFrom: '2026-01-01', annualCtc: ctc })
    .expect(201);
  return made.body.employee.id;
}

/** A calculated, approved run ready to post. */
async function approvedRun(c: Ctx, setup: Awaited<ReturnType<typeof setUpCompany>>) {
  const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
  const id = run.body.run.id;
  await api.post(c, `/runs/${id}/validate`).expect(200);
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  await api.post(c, `/runs/${id}/submit-review`).expect(200);
  await api.post(c, `/runs/${id}/approve`).expect(200);
  return id;
}

describe('the entry payroll would write', () => {
  let c: Ctx;
  let setup: Awaited<ReturnType<typeof setUpCompany>>;
  let runId = '';

  beforeAll(async () => {
    c = await makeOwner();
    setup = await setUpCompany(c);
    await addPerson(c, setup.structureId, 'Asha Menon', 1_200_000);
    await addPerson(c, setup.structureId, 'Rahul Iyer', 600_000);
    runId = await approvedRun(c, setup);
  });

  it('shows the whole entry before anything is posted', async () => {
    const got = await api.get(c, `/runs/${runId}/posting-preview`).expect(200);
    const p = got.body.preview;
    expect(p.lines.length).toBeGreaterThan(0);
    expect(p.problems).toEqual([]);
    expect(p.alreadyPosted).toBeNull();
  });

  it('balances, to the paisa', async () => {
    const p = (await api.get(c, `/runs/${runId}/posting-preview`).expect(200)).body.preview;
    expect(p.balanced).toBe(true);
    expect(p.totalDebit).toBe(p.totalCredit);
  });

  it('debits the cost and credits what is owed', async () => {
    const p = (await api.get(c, `/runs/${runId}/posting-preview`).expect(200)).body.preview;
    const debits = p.lines.filter((l: any) => l.debit > 0);
    const credits = p.lines.filter((l: any) => l.credit > 0);
    expect(debits.length).toBeGreaterThan(0);
    expect(credits.length).toBeGreaterThan(0);
    /* Salaries payable is the largest credit: what people actually take home. */
    expect(credits.some((l: any) => /payable/i.test(l.ledgerName))).toBe(true);
  });

  it('adds up to the run’s own totals', async () => {
    /* The books and the payslips have to tell the same story. Total debits are
       gross plus the employer's contribution — which is the run's employer
       cost. */
    const run = (await api.get(c, `/runs/${runId}`).expect(200)).body.run;
    const p = (await api.get(c, `/runs/${runId}/posting-preview`).expect(200)).body.preview;
    expect(p.totalDebit).toBe(run.employerCostTotal);
    expect(p.totalCredit).toBe(run.employerCostTotal);
  });

  it('writes nothing while it is only a preview', async () => {
    const before = await prisma.journalEntry.count({ where: { orgId: c.orgId } });
    await api.get(c, `/runs/${runId}/posting-preview`).expect(200);
    expect(await prisma.journalEntry.count({ where: { orgId: c.orgId } })).toBe(before);
  });
});

describe('posting', () => {
  let c: Ctx;
  let setup: Awaited<ReturnType<typeof setUpCompany>>;
  let runId = '';

  beforeAll(async () => {
    c = await makeOwner();
    setup = await setUpCompany(c);
    await addPerson(c, setup.structureId, 'Paid Person', 1_200_000);
    runId = await approvedRun(c, setup);
  });

  it('writes one journal in the accounting database', async () => {
    const done = await api.post(c, `/runs/${runId}/post`).expect(201);
    expect(done.body.replayed).toBe(false);
    expect(done.body.posting.journalEntryId).toBeTruthy();

    const entries = await prisma.journalEntry.findMany({
      where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: runId },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('POSTED');
  });

  it('writes a balanced journal, as the ledger sees it', async () => {
    const entry = await prisma.journalEntry.findFirst({
      where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: runId },
      include: { lines: true },
    });
    const debit = entry!.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    const credit = entry!.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    expect(debit).toBe(credit);
    expect(debit).toBeGreaterThan(0);
  });

  it('marks the run posted and keeps the receipt', async () => {
    const run = (await api.get(c, `/runs/${runId}`).expect(200)).body.run;
    expect(run.status).toBe('POSTED');

    const got = await api.get(c, `/runs/${runId}/posting`).expect(200);
    expect(got.body.posting.status).toBe('POSTED');
    expect(got.body.journalEntry.entryNo).toBeTruthy();
    expect(got.body.posting.lines.length).toBeGreaterThan(0);
  });

  it('posts once however many times the button is pressed', async () => {
    /* The thing that would double a company's salary cost. */
    const again = await api.post(c, `/runs/${runId}/post`).expect(200);
    expect(again.body.replayed).toBe(true);

    const entries = await prisma.journalEntry.count({
      where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: runId },
    });
    expect(entries).toBe(1);
  });

  it('survives two attempts at once with one journal', async () => {
    const c2 = await makeOwner();
    const s2 = await setUpCompany(c2);
    await addPerson(c2, s2.structureId, 'Race Person', 900_000);
    const id = await approvedRun(c2, s2);

    /*
     * Five at once, not two.
     *
     * With two the collision is real but intermittent — the bug this guards
     * reproduced about one run in five, which means a passing run proved
     * nothing. Five attempts make the overlap near certain, so a regression
     * fails the suite instead of waiting to be unlucky in production.
     */
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => api.post(c2, `/runs/${id}/post`))
    );

    /* One of them posts. The rest are either told it was already done, or that
       the posting is under way — never a second journal. */
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses[0]).toBeLessThan(300);
    for (const status of statuses.slice(1)) expect([200, 201, 409]).toContain(status);

    const entries = await prisma.journalEntry.count({
      where: { orgId: c2.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: id },
    });
    expect(entries).toBe(1);
  });
});

describe('a journal written without its receipt', () => {
  it('is adopted rather than written a second time', async () => {
    /*
     * The crash this design exists for: the journal reached accounting, the
     * receipt never reached payroll. Simulated by deleting the receipt, which
     * is exactly the state that failure leaves behind.
     */
    const c = await makeOwner();
    const setup = await setUpCompany(c);
    await addPerson(c, setup.structureId, 'Orphan Person', 1_200_000);
    const runId = await approvedRun(c, setup);

    await api.post(c, `/runs/${runId}/post`).expect(201);
    const first = await prisma.journalEntry.findFirst({
      where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: runId },
      select: { id: true },
    });

    await payrollPrisma.payrollPostingLine.deleteMany({ where: { orgId: c.orgId } });
    await payrollPrisma.payrollPosting.deleteMany({ where: { orgId: c.orgId, runId } });
    await payrollPrisma.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED' } });

    const retry = await api.post(c, `/runs/${runId}/post`).expect(201);

    /* One journal, and the receipt now points at the one that was already
       there — not at a second copy of the company's salary cost. */
    const entries = await prisma.journalEntry.findMany({
      where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: runId },
      select: { id: true },
    });
    expect(entries).toHaveLength(1);
    expect(retry.body.posting.journalEntryId).toBe(first!.id);
  });
});

describe('what will not be posted', () => {
  it('refuses a payroll nobody has approved', async () => {
    const c = await makeOwner();
    const setup = await setUpCompany(c);
    await addPerson(c, setup.structureId, 'Unapproved', 600_000);
    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);

    const refused = await api.post(c, `/runs/${run.body.run.id}/post`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_NOT_APPROVED');
    expect(await prisma.journalEntry.count({ where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE } })).toBe(0);
  });

  it('refuses a component with nowhere to post, and names it', async () => {
    const c = await makeOwner();
    const setup = await setUpCompany(c);

    /* A component mapped to nothing: the entry would silently lose an amount. */
    const stray = await api
      .post(c, '/components', {
        name: 'Site Allowance', code: `SITE${rnd()}`, type: 'EARNING',
        calculationMethod: 'FIXED', amount: 2000, displayOrder: 5,
      })
      .expect(201);
    const structure = await api
      .post(c, '/structures', {
        name: `Unmapped ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
        components: [{ componentId: stray.body.component.id, displayOrder: 1 }],
      })
      .expect(201);
    await addPerson(c, structure.body.structure.id, 'Unmapped Person', 600_000);
    const runId = await approvedRun(c, setup);

    const preview = (await api.get(c, `/runs/${runId}/posting-preview`).expect(200)).body.preview;
    expect(preview.problems.some((p: any) => p.code === 'UNMAPPED_COMPONENT' && /Site Allowance/.test(p.message))).toBe(true);

    const refused = await api.post(c, `/runs/${runId}/post`);
    expect(refused.status).toBe(409);
    expect(await prisma.journalEntry.count({ where: { orgId: c.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE } })).toBe(0);
  });

  it('refuses a ledger account somebody has since deactivated', async () => {
    const c = await makeOwner();
    const setup = await setUpCompany(c);
    await addPerson(c, setup.structureId, 'Dead Ledger', 600_000);
    const runId = await approvedRun(c, setup);

    await prisma.ledgerAccount.update({ where: { id: setup.ledgers.salaryExpense }, data: { isActive: false } });

    const preview = (await api.get(c, `/runs/${runId}/posting-preview`).expect(200)).body.preview;
    expect(preview.problems.some((p: any) => p.code === 'LEDGER_INACTIVE')).toBe(true);
    await api.post(c, `/runs/${runId}/post`).expect(409);
  });
});

describe('the boundary still holds', () => {
  it('leaves payroll with no ledger of its own', async () => {
    await expect(payrollPrisma.$queryRawUnsafe('SELECT 1 FROM "JournalEntry" LIMIT 1')).rejects.toThrow();
  });

  it('keeps the payroll journal an ordinary entry the books can see', async () => {
    /* Payroll posts through the same service sales does, so an auditor reading
       the ledger sees payroll without knowing the module exists. */
    const entry = await prisma.journalEntry.findFirst({
      where: { sourceDocType: PAYROLL_SOURCE_DOC_TYPE },
      include: { lines: true, journal: true },
    });
    expect(entry).toBeTruthy();
    /* Its own book, the way sales and purchases have theirs. */
    expect(entry!.journal.code).toBe('PAY');
    expect(entry!.lines.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The same overlap, made certain rather than likely.
   *
   * The test above fires five requests and hopes they collide; they usually do
   * not, because one Node process interleaves them only where they await. This
   * one holds the first attempt open at the exact moment that matters — after
   * it has claimed the run, before it has written the journal — and starts the
   * second one there. That is the interleaving that doubled a company's salary
   * cost, and it now fails the suite every time rather than one run in five.
   */
  it('refuses a second attempt that starts while the first is mid-journal', async () => {
    const c3 = await makeOwner();
    const s3 = await setUpCompany(c3);
    await addPerson(c3, s3.structureId, 'Held Person', 900_000);
    const id = await approvedRun(c3, s3);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedJournal: () => void = () => {};
    const atJournal = new Promise<void>((resolve) => {
      reachedJournal = resolve;
    });

    const real = accountingFor(c3.accountId);
    /*
     * A proxy, not a spread. The adapter is a class instance, so spreading it
     * copies its fields and drops every method on the prototype — the first
     * attempt then failed on `getLedgersByIds is not a function` long before
     * it reached the moment this test is about. Reflect with the target as the
     * receiver keeps `this` pointing at the real adapter.
     */
    const held = new Proxy(real, {
      get(target, key) {
        if (key === 'postJournalEntry') {
          return async (payload: any) => {
            reachedJournal();
            await gate;
            return target.postJournalEntry(payload);
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const first = postPayrollRun({
      accountId: c3.accountId,
      orgId: c3.orgId,
      branchId: c3.branchId,
      userId: (await platformPrisma.user.findFirstOrThrow({ where: { accountId: c3.accountId } })).id,
      runId: id,
      accounting: held,
    });

    await atJournal;

    /* The claim is taken and no journal exists yet — the worst moment. */
    await expect(
      postPayrollRun({
        accountId: c3.accountId,
        orgId: c3.orgId,
        branchId: c3.branchId,
        userId: (await platformPrisma.user.findFirstOrThrow({ where: { accountId: c3.accountId } })).id,
        runId: id,
      })
    ).rejects.toThrow(PayrollPostingError);

    release();
    await first;

    const entries = await prisma.journalEntry.count({
      where: { orgId: c3.orgId, sourceDocType: PAYROLL_SOURCE_DOC_TYPE, sourceDocId: id },
    });
    expect(entries).toBe(1);
  });
});
