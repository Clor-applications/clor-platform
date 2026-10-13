import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { accountingFor, type AccountingClient } from './accounting/client.js';
import { round2 } from '../../utils/money.js';

/**
 * Paying people, and clearing what they were owed.
 *
 * Posting a payroll run records a debt: gross became an expense, and net became
 * money owed to four hundred people. This is the other half — the money leaving
 * the bank and the debt going away.
 *
 *   Dr  Salaries payable
 *       Cr  Bank
 *
 * ## Only what actually arrived
 *
 * A bank rejects lines. A wrong IFSC, a closed account, a name mismatch — three
 * people out of four hundred come back, and the entry has to say so. So a
 * payment posts the amount that was *paid*, never the amount that was
 * attempted: a failed line stays owed, stays visible, and gets paid in the next
 * batch. Posting the attempted total would clear a debt that still exists and
 * leave three people unpaid with nothing in the books to say it.
 *
 * ## The order of the two writes
 *
 * Payroll and accounting are separate databases, so a payment posts in two
 * steps and the order is chosen for what a crash between them leaves:
 *
 *   1. write the journal in accounting;
 *   2. record the journal's id on the payment.
 *
 * A crash after (1) leaves a journal with no receipt. The payment still reads
 * as unposted, and the next attempt finds that journal by its source document
 * and adopts it rather than writing a second one. The reverse order would leave
 * a payment claiming a journal that does not exist.
 */

export const PAYMENT_SOURCE_DOC_TYPE = 'PAYROLL_PAYMENT';

export class PayrollPaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'PayrollPaymentError';
    this.code = code;
    this.status = status;
  }
}

const paise = (n: number) => Math.round(n * 100);

/**
 * Who a payslip was for, as the payslip itself recorded it.
 *
 * The staff directory is the better name while somebody is still in it — a
 * married name, a corrected spelling. It is the worse one afterwards: a person
 * who has left and been removed from the directory is still owed the money on
 * their last payslip, and a payment that cannot name who it paid is a payment
 * nobody can reconcile. So the directory answers first and the snapshot, which
 * cannot go missing, answers when it does not.
 */
export const snapshotPerson = (json: string | null | undefined) => {
  try {
    const parsed = JSON.parse(String(json || '{}')) || {};
    return { name: String(parsed.name || ''), code: String(parsed.code || '') };
  } catch {
    return { name: '', code: '' };
  }
};

/** Held whole so an advice can be regenerated; never shown whole. */
export const maskAccount = (n?: string | null) => {
  const s = String(n || '').replace(/\s/g, '');
  if (!s) return '';
  return s.length <= 4 ? s : `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
};

/**
 * Who this batch would pay, and who it cannot.
 *
 * Read-only. The screen shows this before a batch exists, so the missing bank
 * accounts are found while somebody can still fix them rather than at the
 * moment the file is due at the bank.
 */
export async function previewPayment(accountId: string, orgId: string, runId: string) {
  const run = await payrollPrisma.payrollRun.findFirst({ where: { accountId, orgId, id: runId } });
  if (!run) throw new PayrollPaymentError('NO_RUN', 'No such payroll run.', 404);

  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId, status: { not: 'CANCELLED' } },
    select: { id: true, number: true, employeeId: true, netPay: true, paymentStatus: true, employeeSnapshotJson: true },
    orderBy: { number: 'asc' },
  });

  /* A slip already sitting in a live batch is not owed twice. A cancelled
     batch releases its slips, which is the point of cancelling one. */
  const claimedRows = await payrollPrisma.payrollPaymentLine.findMany({
    where: {
      orgId,
      slipId: { in: slips.map((s) => s.id) },
      payment: { status: { not: 'CANCELLED' } },
      status: { not: 'FAILED' },
    },
    select: { slipId: true, payment: { select: { number: true } } },
  });
  const claimed = new Map(claimedRows.map((r) => [r.slipId, r.payment.number]));

  const employeeIds = [...new Set(slips.map((s) => s.employeeId))];
  const [people, profiles] = await Promise.all([
    employeeIds.length
      ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, name: true, code: true } })
      : Promise.resolve([]),
    employeeIds.length
      ? payrollPrisma.employeePayrollProfile.findMany({
          where: { orgId, employeeId: { in: employeeIds } },
          select: { employeeId: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true, bankName: true },
        })
      : Promise.resolve([]),
  ]);
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const byProfile = new Map(profiles.map((p) => [p.employeeId, p]));

  const payable: any[] = [];
  const blocked: any[] = [];

  for (const slip of slips) {
    const amount = round2(Number(slip.netPay) || 0);
    const person = byPerson.get(slip.employeeId);
    const profile = byProfile.get(slip.employeeId);
    const snapshot = snapshotPerson(slip.employeeSnapshotJson);
    const row = {
      slipId: slip.id,
      slipNumber: slip.number,
      employeeId: slip.employeeId,
      employeeName: person?.name || snapshot.name || 'Unknown employee',
      employeeCode: person?.code || snapshot.code || '',
      amount,
      bankName: profile?.bankName || '',
      bankAccountName: profile?.bankAccountName || '',
      bankAccountMasked: maskAccount(profile?.bankAccountNumber),
      bankIfsc: profile?.bankIfsc || '',
    };

    const already = claimed.get(slip.id);
    if (already) {
      blocked.push({ ...row, reason: `Already in payment ${already}.`, code: 'ALREADY_IN_PAYMENT' });
      continue;
    }
    /* Nothing to pay is not a problem to report — a person on unpaid leave for
       a whole month nets to nil and simply is not in the batch. */
    if (amount <= 0) continue;
    payable.push(row);
  }

  return {
    run: { id: run.id, number: run.number, status: run.status, payrollDate: run.payrollDate },
    payable,
    blocked,
    totalAmount: round2(payable.reduce((t, r) => t + r.amount, 0)),
    /* A missing bank account does not stop the batch — a line can be paid by
       cheque or cash and marked so. It stops the *file*, which is why it is
       reported separately rather than mixed in with the refusals. */
    missingBankDetails: payable.filter((r) => !r.bankAccountMasked || !r.bankIfsc).length,
  };
}

/**
 * Start a batch.
 *
 * The bank details are copied onto each line as they are now, not as they were
 * when payroll ran: somebody who changed banks last week is paid at the new
 * one. Copying rather than reading through means an advice regenerated in March
 * still reproduces the file that actually went to the bank in January.
 */
export async function createPayment(opts: {
  accountId: string;
  orgId: string;
  branchId: string | null;
  userId: string;
  runId: string;
  paymentDate: string;
  method?: string;
  ledgerAccountId?: string | null;
  reference?: string | null;
  /** Leave empty to pay everyone the preview says is payable. */
  slipIds?: string[];
  accounting?: AccountingClient;
}) {
  const { accountId, orgId, runId, userId } = opts;
  const accounting = opts.accounting ?? accountingFor(accountId);

  const run = await payrollPrisma.payrollRun.findFirst({ where: { accountId, orgId, id: runId } });
  if (!run) throw new PayrollPaymentError('NO_RUN', 'No such payroll run.', 404);

  /*
   * Only an approved payroll is paid. Paying a draft would move real money
   * against numbers nobody has agreed to, and no later correction gets it back
   * from four hundred bank accounts.
   */
  if (!['APPROVED', 'LOCKED', 'POSTED', 'PAID'].includes(run.status)) {
    throw new PayrollPaymentError('RUN_NOT_APPROVED', 'Only an approved payroll can be paid. Approve it first.');
  }

  if (opts.ledgerAccountId) {
    const ledger = await accounting.getLedger(orgId, opts.ledgerAccountId);
    if (!ledger) throw new PayrollPaymentError('NO_LEDGER', 'No such cash or bank account.', 404);
    if (!ledger.isActive) throw new PayrollPaymentError('LEDGER_INACTIVE', `${ledger.name} is no longer active.`);
  }

  const preview = await previewPayment(accountId, orgId, runId);
  const wanted = opts.slipIds?.length ? new Set(opts.slipIds) : null;
  const chosen = wanted ? preview.payable.filter((r) => wanted.has(r.slipId)) : preview.payable;

  if (!chosen.length) {
    const why = preview.blocked.length
      ? 'Everybody on this payroll is already in a payment.'
      : 'This payroll has nothing left to pay.';
    throw new PayrollPaymentError('NOTHING_TO_PAY', why);
  }

  /* Whole account numbers, for the file. The preview only ever carries masked
     ones, so they are read again here. */
  const profiles = await payrollPrisma.employeePayrollProfile.findMany({
    where: { orgId, employeeId: { in: chosen.map((r) => r.employeeId) } },
    select: { employeeId: true, bankAccountNumber: true, bankIfsc: true },
  });
  const bank = new Map(profiles.map((p) => [p.employeeId, p]));

  const count = await payrollPrisma.payrollPayment.count({ where: { orgId } });
  const number = `PAY-${opts.paymentDate.slice(0, 7).replace('-', '')}-${String(count + 1).padStart(3, '0')}`;
  const totalAmount = round2(chosen.reduce((t, r) => t + r.amount, 0));

  return payrollPrisma.payrollPayment.create({
    data: {
      accountId,
      orgId,
      branchId: opts.branchId,
      number,
      runId,
      paymentDate: opts.paymentDate,
      method: opts.method || 'BANK_TRANSFER',
      ledgerAccountId: opts.ledgerAccountId || null,
      reference: opts.reference?.trim() || null,
      totalAmount,
      status: 'DRAFT',
      createdByUserId: userId,
      lines: {
        create: chosen.map((r) => ({
          accountId,
          orgId,
          slipId: r.slipId,
          employeeId: r.employeeId,
          amount: r.amount,
          status: 'PENDING',
          bankAccountNumber: bank.get(r.employeeId)?.bankAccountNumber || null,
          bankIfsc: bank.get(r.employeeId)?.bankIfsc || null,
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * The file that goes to the bank.
 *
 * Deliberately plain: a name, an account, an IFSC, an amount, a reference. Bank
 * portals all want a slightly different column order, and a company will paste
 * this into whatever theirs wants — a format invented here would be wrong for
 * everybody.
 */
export async function bankAdvice(accountId: string, orgId: string, paymentId: string) {
  const payment = await payrollPrisma.payrollPayment.findFirst({
    where: { accountId, orgId, id: paymentId },
    include: { lines: { orderBy: { createdAt: 'asc' } } },
  });
  if (!payment) throw new PayrollPaymentError('NO_PAYMENT', 'No such payment.', 404);

  const ids = [...new Set(payment.lines.map((l) => l.employeeId))];
  const [people, profiles, slips] = await Promise.all([
    ids.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
    ids.length
      ? payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: ids } }, select: { employeeId: true, bankAccountName: true, bankName: true } })
      : Promise.resolve([]),
    payrollPrisma.salarySlip.findMany({
      where: { orgId, id: { in: payment.lines.map((l) => l.slipId) } },
      select: { id: true, employeeSnapshotJson: true },
    }),
  ]);
  const byPerson = new Map(people.map((p) => [p.id, p]));
  const byProfile = new Map(profiles.map((p) => [p.employeeId, p]));
  const bySlip = new Map(slips.map((s) => [s.id, snapshotPerson(s.employeeSnapshotJson)]));

  const rows = payment.lines
    /* A line already known to have failed is not sent again in the same file.
       It is paid in the next batch, once somebody has fixed the account. */
    .filter((l) => l.status !== 'FAILED')
    .map((l) => ({
      employeeCode: byPerson.get(l.employeeId)?.code || bySlip.get(l.slipId)?.code || '',
      beneficiaryName:
        byProfile.get(l.employeeId)?.bankAccountName || byPerson.get(l.employeeId)?.name || bySlip.get(l.slipId)?.name || '',
      accountNumber: l.bankAccountNumber || '',
      ifsc: l.bankIfsc || '',
      bankName: byProfile.get(l.employeeId)?.bankName || '',
      amount: round2(Number(l.amount) || 0),
      reference: payment.number,
    }));

  return { payment: { id: payment.id, number: payment.number, paymentDate: payment.paymentDate }, rows };
}

const CSV_CELL = (v: unknown) => {
  const s = String(v ?? '');
  /* A leading =, +, - or @ makes a spreadsheet treat a cell as a formula. A
     beneficiary name is never a formula. */
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function adviceCsv(rows: Awaited<ReturnType<typeof bankAdvice>>['rows']) {
  const head = ['Employee Code', 'Beneficiary Name', 'Account Number', 'IFSC', 'Bank', 'Amount', 'Reference'];
  const body = rows.map((r) =>
    [r.employeeCode, r.beneficiaryName, r.accountNumber, r.ifsc, r.bankName, r.amount.toFixed(2), r.reference].map(CSV_CELL).join(',')
  );
  return [head.join(','), ...body].join('\n');
}

/**
 * Record what the bank did.
 *
 * Called with whatever came back — all of it at once from a reconciliation
 * file, or one line at a time by hand. The payment's status is derived from its
 * lines afterwards rather than set by the caller, so it can never disagree with
 * them.
 */
export async function settleLines(opts: {
  accountId: string;
  orgId: string;
  paymentId: string;
  results: { lineId: string; status: 'PAID' | 'FAILED' | 'PENDING'; reference?: string | null; failureReason?: string | null }[];
}) {
  const { accountId, orgId, paymentId } = opts;

  const payment = await payrollPrisma.payrollPayment.findFirst({
    where: { accountId, orgId, id: paymentId },
    include: { lines: true },
  });
  if (!payment) throw new PayrollPaymentError('NO_PAYMENT', 'No such payment.', 404);
  if (payment.status === 'CANCELLED') {
    throw new PayrollPaymentError('PAYMENT_CANCELLED', 'This payment was cancelled.');
  }
  /*
   * Once posted, the lines are what the journal was built from. Changing one
   * would leave the books saying an amount that no longer matches the payment
   * that produced it, with nothing to say which is right.
   */
  if (payment.postingStatus === 'POSTED') {
    throw new PayrollPaymentError(
      'PAYMENT_POSTED',
      'This payment is already in the books. Record a fresh payment for anything that changed afterwards.'
    );
  }

  const byId = new Map(payment.lines.map((l) => [l.id, l]));
  for (const r of opts.results) {
    if (!byId.has(r.lineId)) throw new PayrollPaymentError('NO_LINE', 'That payment line is not in this payment.', 404);
  }

  await payrollPrisma.$transaction(async (tx) => {
    for (const r of opts.results) {
      await tx.payrollPaymentLine.update({
        where: { id: r.lineId },
        data: {
          status: r.status,
          reference: r.reference?.trim() || null,
          failureReason: r.status === 'FAILED' ? r.failureReason?.trim() || 'The bank did not say why.' : null,
          paidAt: r.status === 'PAID' ? new Date() : null,
        },
      });
    }

    const lines = await tx.payrollPaymentLine.findMany({ where: { paymentId } });
    const paid = lines.filter((l) => l.status === 'PAID');
    const failed = lines.filter((l) => l.status === 'FAILED');
    const pending = lines.filter((l) => l.status === 'PENDING');

    const status = pending.length
      ? paid.length || failed.length
        ? 'PROCESSING'
        : 'DRAFT'
      : failed.length
        ? paid.length
          ? 'PARTIAL'
          : 'FAILED'
        : 'COMPLETED';

    await tx.payrollPayment.update({
      where: { id: paymentId },
      data: {
        paidAmount: round2(paid.reduce((t, l) => t + Number(l.amount), 0)),
        paidCount: paid.length,
        failedCount: failed.length,
        status,
      },
    });

    /* The payslip carries the answer too, because that is where somebody
       looking at one person goes. */
    for (const line of lines) {
      await tx.salarySlip.update({
        where: { id: line.slipId },
        data: { paymentStatus: line.status === 'PAID' ? 'PAID' : line.status === 'FAILED' ? 'FAILED' : 'UNPAID' },
      });
    }
  });

  return payrollPrisma.payrollPayment.findFirst({ where: { id: paymentId }, include: { lines: true } });
}

export type PaymentPostingPreview = {
  lines: { ledgerAccountId: string; ledgerName: string; debit: number; credit: number; description: string }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  problems: { code: string; message: string }[];
  alreadyPosted: { journalEntryId: string | null; postedAt: Date | null } | null;
};

/** What clearing this payment would write to the books. */
export async function previewPaymentPosting(
  accountId: string,
  orgId: string,
  paymentId: string,
  accounting: AccountingClient = accountingFor(accountId)
): Promise<PaymentPostingPreview> {
  const problems: PaymentPostingPreview['problems'] = [];

  const payment = await payrollPrisma.payrollPayment.findFirst({
    where: { accountId, orgId, id: paymentId },
    include: { lines: true },
  });
  if (!payment) throw new PayrollPaymentError('NO_PAYMENT', 'No such payment.', 404);

  const paidAmount = round2(payment.lines.filter((l) => l.status === 'PAID').reduce((t, l) => t + Number(l.amount), 0));

  if (payment.status === 'CANCELLED') problems.push({ code: 'PAYMENT_CANCELLED', message: 'This payment was cancelled.' });
  if (paidAmount <= 0) {
    problems.push({ code: 'NOTHING_PAID', message: 'No line on this payment has been marked paid, so no money has left the bank.' });
  }
  if (payment.lines.some((l) => l.status === 'PENDING')) {
    problems.push({
      code: 'LINES_PENDING',
      message: 'Some lines have no answer from the bank yet. Record what happened to them before clearing this into the books.',
    });
  }

  /* The run's journal is what created the debt this clears. Without it there
     is no salaries payable to take away. */
  const posted = await payrollPrisma.payrollPosting.findFirst({ where: { orgId, runId: payment.runId, status: 'POSTED' } });
  if (!posted) {
    problems.push({
      code: 'RUN_NOT_POSTED',
      message: 'This payroll is not in the books yet, so there is nothing owed for this payment to clear. Post the payroll first.',
    });
  }

  const [payable, cash] = await Promise.all([
    accounting.getPayablesAccount(orgId),
    payment.ledgerAccountId ? accounting.getLedger(orgId, payment.ledgerAccountId) : Promise.resolve(null),
  ]);

  if (!payable) problems.push({ code: 'NO_PAYABLE_ACCOUNT', message: 'This company has no payables account for salaries to be owed to.' });
  if (!payment.ledgerAccountId) {
    problems.push({ code: 'NO_SOURCE_ACCOUNT', message: 'Say which cash or bank account this money left.' });
  } else if (!cash) {
    problems.push({ code: 'LEDGER_MISSING', message: 'The account this money left no longer exists.' });
  } else if (!cash.isActive) {
    problems.push({ code: 'LEDGER_INACTIVE', message: `${cash.name} is no longer active.` });
  }

  const lines =
    payable && cash && paidAmount > 0
      ? [
          { ledgerAccountId: payable.id, ledgerName: payable.name, debit: paidAmount, credit: 0, description: `Salaries paid — ${payment.number}` },
          { ledgerAccountId: cash.id, ledgerName: cash.name, debit: 0, credit: paidAmount, description: `Salaries paid — ${payment.number}` },
        ]
      : [];

  const totalDebit = round2(lines.reduce((t, l) => t + l.debit, 0));
  const totalCredit = round2(lines.reduce((t, l) => t + l.credit, 0));

  return {
    lines,
    totalDebit,
    totalCredit,
    balanced: paise(totalDebit) === paise(totalCredit),
    problems,
    alreadyPosted: payment.postingStatus === 'POSTED' ? { journalEntryId: payment.journalEntryId, postedAt: payment.postedAt } : null,
  };
}

/**
 * Clear the payment into the books, once.
 *
 * The claim is a conditional update: only the attempt that moves the payment
 * from UNPOSTED to POSTING proceeds. Two people pressing the button at the same
 * moment would otherwise both find no journal and both write one, taking the
 * money out of the bank twice.
 */
export async function postPayment(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  paymentId: string;
  accounting?: AccountingClient;
}) {
  const { accountId, orgId, branchId, userId, paymentId } = opts;
  const accounting = opts.accounting ?? accountingFor(accountId);

  const payment = await payrollPrisma.payrollPayment.findFirst({ where: { accountId, orgId, id: paymentId } });
  if (!payment) throw new PayrollPaymentError('NO_PAYMENT', 'No such payment.', 404);
  if (payment.postingStatus === 'POSTED') return { payment, replayed: true as const };

  const preview = await previewPaymentPosting(accountId, orgId, paymentId, accounting);
  if (preview.problems.length) throw new PayrollPaymentError('POSTING_BLOCKED', preview.problems[0].message);
  if (!preview.lines.length) throw new PayrollPaymentError('NOTHING_TO_POST', 'This payment has nothing to post.');

  /*
   * A journal already carrying this payment as its source was written by an
   * attempt that died before it could record the id. Adopt it — writing a
   * second would take the money out of the bank twice.
   */
  const orphan = await accounting.findEntryBySource(orgId, PAYMENT_SOURCE_DOC_TYPE, paymentId);

  if (payment.postingStatus === 'POSTING' && !orphan) {
    throw new PayrollPaymentError('POSTING_IN_PROGRESS', 'This payment is already being posted. Refresh in a moment to see the entry.');
  }

  if (!orphan) {
    const claimed = await payrollPrisma.payrollPayment.updateMany({
      where: { id: paymentId, postingStatus: 'UNPOSTED' },
      data: { postingStatus: 'POSTING' },
    });
    if (claimed.count !== 1) {
      const now = await payrollPrisma.payrollPayment.findFirst({ where: { id: paymentId } });
      if (now?.postingStatus === 'POSTED') return { payment: now, replayed: true as const };
      throw new PayrollPaymentError('POSTING_IN_PROGRESS', 'This payment is already being posted. Refresh in a moment to see the entry.');
    }
  }

  let journalEntryId = orphan?.id || null;
  if (!journalEntryId) {
    const entry = await accounting.postJournalEntry({
      companyId: orgId,
      branchId,
      userId,
      date: payment.paymentDate,
      journalCode: 'PAY',
      narration: `Salary payment ${payment.number}`,
      sourceDocType: PAYMENT_SOURCE_DOC_TYPE,
      sourceDocId: paymentId,
      lines: preview.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    });
    journalEntryId = entry.id;
  }

  const row = await payrollPrisma.payrollPayment.update({
    where: { id: paymentId },
    data: { journalEntryId, postingStatus: 'POSTED', postedAt: new Date(), postedByUserId: userId },
  });

  /*
   * A run everybody was paid on is PAID. One with a failed line is not — it
   * still owes somebody money, and saying otherwise would hide that.
   */
  const outstanding = await payrollPrisma.salarySlip.count({
    where: { orgId, runId: payment.runId, status: { not: 'CANCELLED' }, paymentStatus: { not: 'PAID' }, netPay: { gt: 0 } },
  });
  if (!outstanding) {
    await payrollPrisma.payrollRun.update({ where: { id: payment.runId }, data: { status: 'PAID' } });
  }

  return { payment: row, replayed: false as const };
}

/**
 * Call the batch off.
 *
 * Only before it reaches the books, and only while nothing has been paid — once
 * money has left the bank, the record of it leaving is not something to delete.
 * Cancelling releases the slips, so they appear in the next batch.
 */
export async function cancelPayment(accountId: string, orgId: string, paymentId: string) {
  const payment = await payrollPrisma.payrollPayment.findFirst({
    where: { accountId, orgId, id: paymentId },
    include: { lines: true },
  });
  if (!payment) throw new PayrollPaymentError('NO_PAYMENT', 'No such payment.', 404);
  if (payment.postingStatus !== 'UNPOSTED') {
    throw new PayrollPaymentError('PAYMENT_POSTED', 'This payment is in the books and cannot be cancelled.');
  }
  if (payment.lines.some((l) => l.status === 'PAID')) {
    throw new PayrollPaymentError(
      'PAYMENT_HAS_PAID_LINES',
      'Some of this money has already been paid. A payment that has left the bank is a record, not a draft.'
    );
  }

  return payrollPrisma.$transaction(async (tx) => {
    const row = await tx.payrollPayment.update({ where: { id: paymentId }, data: { status: 'CANCELLED' } });
    await tx.salarySlip.updateMany({
      where: { orgId, id: { in: payment.lines.map((l) => l.slipId) }, paymentStatus: { not: 'PAID' } },
      data: { paymentStatus: 'UNPAID' },
    });
    return row;
  });
}
