import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Paying a payroll.
 *
 * What this holds is the part that costs real money when it is wrong: that a
 * failed bank line stays owed and stays out of the books, that a batch posts
 * once however many times the button is pressed, and that a payslip is never
 * paid twice by two batches.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
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
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `pay.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Pay Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** A bank account for the money to leave from. */
async function bankLedger(c: Ctx) {
  const { ensureLedgerSetup } = await import('../services/ledger.js');
  await ensureLedgerSetup(c.accountId, c.orgId, 'test');
  const row = await prisma.ledgerAccount.findFirst({
    where: { accountId: c.accountId, orgId: c.orgId, isActive: true, OR: [{ controlKind: 'BANK' }, { controlKind: 'CASH' }] },
    select: { id: true, name: true },
  });
  if (row) return row;
  return prisma.ledgerAccount.create({
    data: {
      accountId: c.accountId,
      orgId: c.orgId,
      code: `BANK${rnd().toUpperCase()}`,
      name: 'Salary Bank',
      accountType: 'ASSET',
      controlKind: 'BANK',
      isActive: true,
      createdByUserId: 'test',
    },
    select: { id: true, name: true },
  });
}

/** A payroll with two people on it, calculated, approved and in the books. */
async function payrollThroughToPosted(c: Ctx) {
  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);

  const { ensureLedgerSetup } = await import('../services/ledger.js');
  await ensureLedgerSetup(c.accountId, c.orgId, 'test');
  const expense = await prisma.ledgerAccount.findFirst({
    where: { accountId: c.accountId, orgId: c.orgId, isActive: true, controlKind: 'EXPENSES' },
    select: { id: true },
  });

  const basic = await mk({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC',
    expenseLedgerId: expense?.id || null, displayOrder: 1,
  });

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [{ componentId: basic.body.component.id, displayOrder: 1 }],
    })
    .expect(201);

  const period = await api
    .post(c, '/periods', { name: `Aug 2026 ${rnd()}`, startDate: '2026-08-01', endDate: '2026-08-31', paymentDate: '2026-08-31' })
    .expect(201);

  const people: string[] = [];
  for (const [i, name] of ['Meghana Kulkarni', 'Devarsh Bhatt'].entries()) {
    const made = await api
      .post(c, '/employees', {
        name,
        code: `E${rnd().toUpperCase()}`,
        dateOfJoining: '2026-01-01',
        status: 'ACTIVE',
        payroll: {
          payrollStatus: 'IN_PAYROLL',
          bankAccountName: name,
          bankAccountNumber: `9876543210${i}`,
          bankIfsc: 'HDFC0001234',
          bankName: 'HDFC Bank',
        },
      })
      .expect(201);
    await api
      .post(c, '/assignments', { employeeId: made.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
      .expect(201);
    people.push(made.body.employee.id);
  }

  const run = await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201);
  const runId = run.body.run.id;
  await api.post(c, `/runs/${runId}/validate`).expect(200);
  await api.post(c, `/runs/${runId}/calculate`).expect(200);
  await api.post(c, `/runs/${runId}/submit-review`).expect(200);
  await api.post(c, `/runs/${runId}/approve`).expect(200);
  await api.post(c, `/runs/${runId}/post`).expect(201);

  return { runId, people };
}

describe('who a payment would pay', () => {
  it('lists everybody on the payroll with a bank account', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);

    const { body } = await api.get(c, `/runs/${runId}/payment-preview`).expect(200);
    expect(body.preview.payable).toHaveLength(2);
    expect(body.preview.totalAmount).toBe(100_000);
    expect(body.preview.missingBankDetails).toBe(0);
    /* Masked, never whole. */
    expect(body.preview.payable[0].bankAccountMasked).toMatch(/^•+\d{4}$/);
    expect(JSON.stringify(body.preview)).not.toContain('98765432100');
  });

  it('will not put the same payslip in two batches', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);

    await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);

    const { body } = await api.get(c, `/runs/${runId}/payment-preview`).expect(200);
    expect(body.preview.payable).toHaveLength(0);
    expect(body.preview.blocked.every((b: any) => b.code === 'ALREADY_IN_PAYMENT')).toBe(true);

    const second = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('NOTHING_TO_PAY');
  });

  it('still names somebody who has left the staff directory', async () => {
    /*
     * The directory is the better name while a person is in it, and the worse
     * one after they leave: the money on their last payslip is still owed, and
     * a payment that cannot say who it paid is one nobody can reconcile. The
     * payslip recorded who they were, so it answers.
     */
    const c = await makeOwner();
    const { runId, people } = await payrollThroughToPosted(c);
    await peoplePrisma.employee.deleteMany({ where: { orgId: c.orgId, id: { in: people } } });

    const { body } = await api.get(c, `/runs/${runId}/payment-preview`).expect(200);
    expect(body.preview.payable.map((r: any) => r.employeeName).sort()).toEqual(['Devarsh Bhatt', 'Meghana Kulkarni']);

    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const detail = await api.get(c, `/payments/${made.body.payment.id}`).expect(200);
    expect(detail.body.payment.lines.every((l: any) => l.employeeName !== 'Unknown employee')).toBe(true);

    const advice = await api.get(c, `/payments/${made.body.payment.id}/advice`).expect(200);
    expect(advice.body.rows.every((r: any) => r.beneficiaryName)).toBe(true);
  });

  it('refuses to pay a payroll nobody has approved', async () => {
    const c = await makeOwner();
    const period = await api.post(c, '/periods', { name: `Sep ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30' }).expect(201);
    const run = await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201);

    const refused = await api.post(c, '/payments', { runId: run.body.run.id, paymentDate: '2026-09-30' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_NOT_APPROVED');
  });
});

describe('the file for the bank', () => {
  it('carries the whole account number, and nothing that a spreadsheet would run', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const payment = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);

    const advice = await api.get(c, `/payments/${payment.body.payment.id}/advice`).expect(200);
    expect(advice.body.rows).toHaveLength(2);
    expect(advice.body.rows[0].accountNumber).toMatch(/^\d{11}$/);
    expect(advice.body.rows[0].ifsc).toBe('HDFC0001234');

    const csv = await api.get(c, `/payments/${payment.body.payment.id}/advice?format=csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const [head, ...rows] = csv.text.split('\n');
    expect(head).toBe('Employee Code,Beneficiary Name,Account Number,IFSC,Bank,Amount,Reference');
    expect(rows).toHaveLength(2);
    expect(rows[0].split(',')[5]).toBe('50000.00');
  });
});

describe('what the bank did', () => {
  it('posts only what was actually paid, and leaves the rest owed', async () => {
    /*
     * The property that matters most here. Three lines come back rejected out
     * of four hundred: the entry has to clear what arrived and leave the rest
     * owed, or the books say people were paid who were not.
     */
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;

    const detail = await api.get(c, `/payments/${paymentId}`).expect(200);
    const [first, second] = detail.body.payment.lines;

    const settled = await api
      .post(c, `/payments/${paymentId}/settle`, {
        results: [
          { lineId: first.id, status: 'PAID', reference: 'UTR123456' },
          { lineId: second.id, status: 'FAILED', failureReason: 'Account closed' },
        ],
      })
      .expect(200);

    expect(settled.body.payment.status).toBe('PARTIAL');
    expect(settled.body.payment.paidAmount).toBe(50_000);
    expect(settled.body.payment.failedCount).toBe(1);

    const preview = await api.get(c, `/payments/${paymentId}/posting-preview`).expect(200);
    expect(preview.body.preview.problems).toEqual([]);
    expect(preview.body.preview.totalDebit).toBe(50_000);
    expect(preview.body.preview.balanced).toBe(true);

    await api.post(c, `/payments/${paymentId}/post`).expect(200);

    const entry = await prisma.journalEntry.findFirst({
      where: { orgId: c.orgId, sourceDocType: 'PAYROLL_PAYMENT', sourceDocId: paymentId },
      include: { lines: true },
    });
    expect(entry).toBeTruthy();
    expect(Number(entry!.lines.find((l) => Number(l.credit) > 0)!.credit)).toBe(50_000);

    /* The run is not PAID — it still owes somebody money. */
    const run = await payrollPrisma.payrollRun.findFirst({ where: { id: runId } });
    expect(run!.status).not.toBe('PAID');
  });

  it('will not clear a payment the bank has not answered on', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);

    const refused = await api.post(c, `/payments/${made.body.payment.id}/post`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('POSTING_BLOCKED');

    const preview = await api.get(c, `/payments/${made.body.payment.id}/posting-preview`).expect(200);
    expect(preview.body.preview.problems.map((p: any) => p.code)).toContain('LINES_PENDING');
  });

  it('marks the run paid once everybody has been', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const detail = await api.get(c, `/payments/${made.body.payment.id}`).expect(200);

    await api
      .post(c, `/payments/${made.body.payment.id}/settle`, {
        results: detail.body.payment.lines.map((l: any) => ({ lineId: l.id, status: 'PAID', reference: `UTR${rnd()}` })),
      })
      .expect(200);
    await api.post(c, `/payments/${made.body.payment.id}/post`).expect(200);

    const run = await payrollPrisma.payrollRun.findFirst({ where: { id: runId } });
    expect(run!.status).toBe('PAID');
  });
});

describe('clearing a payment into the books', () => {
  const settleAllPaid = async (c: Ctx, paymentId: string) => {
    const detail = await api.get(c, `/payments/${paymentId}`).expect(200);
    await api
      .post(c, `/payments/${paymentId}/settle`, {
        results: detail.body.payment.lines.map((l: any) => ({ lineId: l.id, status: 'PAID' })),
      })
      .expect(200);
  };

  it('writes one journal however many times it is pressed', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;
    await settleAllPaid(c, paymentId);

    const first = await api.post(c, `/payments/${paymentId}/post`).expect(200);
    expect(first.body.replayed).toBe(false);
    const second = await api.post(c, `/payments/${paymentId}/post`).expect(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.payment.journalEntryId).toBe(first.body.payment.journalEntryId);

    const entries = await prisma.journalEntry.count({
      where: { orgId: c.orgId, sourceDocType: 'PAYROLL_PAYMENT', sourceDocId: paymentId, status: 'POSTED' },
    });
    expect(entries).toBe(1);
  });

  it('writes one journal when two people press at the same moment', async () => {
    /*
     * The failure this guards against is not theoretical: two presses that
     * both find no journal both write one, and the money leaves the bank
     * twice in the books.
     */
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;
    await settleAllPaid(c, paymentId);

    const answers = await Promise.all([
      api.post(c, `/payments/${paymentId}/post`),
      api.post(c, `/payments/${paymentId}/post`),
      api.post(c, `/payments/${paymentId}/post`),
    ]);
    /* Whichever won, none of them may have written a second entry, and none
       may report a failure that is not "already under way". */
    for (const a of answers) {
      if (a.status !== 200) expect(a.body.code).toBe('POSTING_IN_PROGRESS');
    }
    expect(answers.some((a) => a.status === 200)).toBe(true);

    const entries = await prisma.journalEntry.count({
      where: { orgId: c.orgId, sourceDocType: 'PAYROLL_PAYMENT', sourceDocId: paymentId, status: 'POSTED' },
    });
    expect(entries).toBe(1);
  });

  it('adopts a journal a crash left behind rather than writing a second', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;
    await settleAllPaid(c, paymentId);
    await api.post(c, `/payments/${paymentId}/post`).expect(200);

    /* A crash between writing the journal and recording its id: the journal
       is there, the payment still reads as unposted. */
    await payrollPrisma.payrollPayment.update({
      where: { id: paymentId },
      data: { journalEntryId: null, postingStatus: 'POSTING', postedAt: null },
    });

    const again = await api.post(c, `/payments/${paymentId}/post`).expect(200);
    expect(again.body.payment.journalEntryId).toBeTruthy();

    const entries = await prisma.journalEntry.count({
      where: { orgId: c.orgId, sourceDocType: 'PAYROLL_PAYMENT', sourceDocId: paymentId, status: 'POSTED' },
    });
    expect(entries).toBe(1);
  });

  it('refuses to clear a payment against a payroll that is not in the books', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    await settleAllPaid(c, made.body.payment.id);

    /* Pretend the payroll was never posted. Nothing is owed, so there is
       nothing for the payment to clear. */
    await payrollPrisma.payrollPosting.updateMany({ where: { orgId: c.orgId, runId }, data: { status: 'DRAFT' } });

    const preview = await api.get(c, `/payments/${made.body.payment.id}/posting-preview`).expect(200);
    expect(preview.body.preview.problems.map((p: any) => p.code)).toContain('RUN_NOT_POSTED');
  });

  it('will not let a settled line change once the payment is in the books', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;
    await settleAllPaid(c, paymentId);
    await api.post(c, `/payments/${paymentId}/post`).expect(200);

    const detail = await api.get(c, `/payments/${paymentId}`).expect(200);
    const refused = await api.post(c, `/payments/${paymentId}/settle`, {
      results: [{ lineId: detail.body.payment.lines[0].id, status: 'FAILED', failureReason: 'Changed my mind' }],
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAYMENT_POSTED');
  });
});

describe('calling a batch off', () => {
  it('releases the payslips so the next batch picks them up', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);

    await api.post(c, `/payments/${made.body.payment.id}/cancel`).expect(200);

    const { body } = await api.get(c, `/runs/${runId}/payment-preview`).expect(200);
    expect(body.preview.payable).toHaveLength(2);
  });

  it('refuses once money has left the bank', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const detail = await api.get(c, `/payments/${made.body.payment.id}`).expect(200);
    await api
      .post(c, `/payments/${made.body.payment.id}/settle`, { results: [{ lineId: detail.body.payment.lines[0].id, status: 'PAID' }] })
      .expect(200);

    const refused = await api.post(c, `/payments/${made.body.payment.id}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAYMENT_HAS_PAID_LINES');
  });
});

describe('a failed line', () => {
  it('is owed again in the next batch, and is not in the file for this one', async () => {
    const c = await makeOwner();
    const { runId } = await payrollThroughToPosted(c);
    const bank = await bankLedger(c);
    const made = await api.post(c, '/payments', { runId, paymentDate: '2026-08-31', ledgerAccountId: bank.id }).expect(201);
    const paymentId = made.body.payment.id;
    const detail = await api.get(c, `/payments/${paymentId}`).expect(200);
    const [first, second] = detail.body.payment.lines;

    await api
      .post(c, `/payments/${paymentId}/settle`, {
        results: [
          { lineId: first.id, status: 'PAID' },
          { lineId: second.id, status: 'FAILED', failureReason: 'Wrong IFSC' },
        ],
      })
      .expect(200);

    const advice = await api.get(c, `/payments/${paymentId}/advice`).expect(200);
    expect(advice.body.rows).toHaveLength(1);

    /* The person the bank rejected is payable again; the one who was paid is
       not. */
    const preview = await api.get(c, `/runs/${runId}/payment-preview`).expect(200);
    expect(preview.body.preview.payable).toHaveLength(1);
    expect(preview.body.preview.payable[0].employeeId).toBe(second.employeeId);
  });
});
