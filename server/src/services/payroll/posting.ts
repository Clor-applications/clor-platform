import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { accountingFor, type AccountingClient } from './accounting/client.js';
import { round2 } from '../../utils/money.js';

/**
 * Payroll into the books.
 *
 * Payroll keeps its own database, but there is only one set of books. A pay run
 * posts through the same ledger service sales and purchases use, so the journal
 * it produces is an ordinary entry that reports, the trial balance and an
 * auditor all see without knowing payroll exists. `PayrollPosting` is a receipt
 * recording which journal a run produced — it is not a second ledger.
 *
 * ## The entry
 *
 *   Dr  Salary expense              (every earning)
 *   Dr  Employer contribution expense
 *       Cr  Salary payable          (what people take home)
 *       Cr  PF / ESI / TDS payable  (what was withheld, owed to somebody else)
 *       Cr  Employer contribution payable
 *
 * It balances by construction: gross is net plus deductions, and every employer
 * contribution is an expense and a liability of the same amount. Where it does
 * not balance, something is misconfigured and the entry is refused rather than
 * plugged — a rounding account absorbing a payroll difference is how a payroll
 * error becomes invisible.
 *
 * ## Two databases, one write
 *
 * A transaction cannot span payroll and accounting, so posting is two steps and
 * the order is chosen for what a crash between them leaves behind:
 *
 *   1. write the journal in accounting;
 *   2. record the receipt in payroll.
 *
 * A crash after (1) leaves a journal with no receipt. The run still reads as
 * unposted, and the next attempt finds that journal by its source document and
 * adopts it instead of writing a second one. The reverse order would leave a
 * receipt for a journal that does not exist — a run that looks posted and is
 * not, which nothing downstream could detect.
 */

export const PAYROLL_SOURCE_DOC_TYPE = 'PAYROLL_RUN';

export type PostingLine = {
  ledgerAccountId: string;
  ledgerName: string;
  debit: number;
  credit: number;
  description: string;
  costCenterId: string | null;
  displayOrder: number;
};

export type PostingPreview = {
  lines: PostingLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  /** What stops this being posted at all. */
  problems: { code: string; message: string }[];
  alreadyPosted: { postingId: string; journalEntryId: string | null; postedAt: Date | null } | null;
};

export class PayrollPostingError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'PayrollPostingError';
    this.code = code;
    this.status = status;
  }
}

const paise = (n: number) => Math.round(n * 100);

/**
 * Where a payroll line lands, and what to call the bucket it lands in.
 *
 * Grouped by ledger account rather than one journal line per person: a
 * four-hundred-person payroll would otherwise write twelve hundred journal
 * lines nobody reads, and the payslips are already the per-person record.
 */
type Bucket = { ledgerAccountId: string; debit: number; credit: number; description: string; costCenterId: string | null };

const key = (ledgerAccountId: string, costCenterId: string | null) => `${ledgerAccountId}::${costCenterId || ''}`;

/**
 * What this run would write to the books.
 *
 * Read-only, and safe to call at any point — the screen shows it before
 * anybody commits to it, which is the whole point: finance sees the entry
 * before it exists, not after.
 */
export async function previewPosting(
  accountId: string,
  orgId: string,
  runId: string,
  /* Injected so a test can preview a posting without an accounting database,
     and so this reads as a call to another application rather than a query. */
  accounting: AccountingClient = accountingFor(accountId)
): Promise<PostingPreview> {
  const problems: PostingPreview['problems'] = [];

  const run = await payrollPrisma.payrollRun.findFirst({ where: { accountId, orgId, id: runId } });
  if (!run) throw new PayrollPostingError('NO_RUN', 'No such payroll run.', 404);

  const existing = await payrollPrisma.payrollPosting.findFirst({ where: { orgId, runId } });

  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId },
    include: { lines: true },
  });

  if (!slips.length) {
    problems.push({ code: 'NOT_CALCULATED', message: 'This payroll has no payslips to post.' });
  }

  /*
   * Where each component posts today, for lines that were calculated before
   * anybody mapped them.
   *
   * The payslip captures the mapping it was calculated with, which is right —
   * it is part of what was decided. But a mapping is configuration, not
   * economics: it changes nothing about what anybody is paid. Without this
   * fallback, mapping the ledgers after a run was calculated left that run
   * permanently unpostable, because a locked run cannot be recalculated. The
   * snapshot still wins wherever it has an answer.
   */
  const componentIds = [...new Set(slips.flatMap((s) => s.lines.map((l) => l.componentId)))];
  const components = componentIds.length
    ? await payrollPrisma.salaryComponent.findMany({
        where: { orgId, id: { in: componentIds } },
        select: { id: true, expenseLedgerId: true, liabilityLedgerId: true },
      })
    : [];
  const currentMapping = new Map(components.map((c) => [c.id, c]));
  const expenseOf = (line: { componentId: string; expenseLedgerId: string | null }) =>
    line.expenseLedgerId || currentMapping.get(line.componentId)?.expenseLedgerId || null;
  const liabilityOf = (line: { componentId: string; liabilityLedgerId: string | null }) =>
    line.liabilityLedgerId || currentMapping.get(line.componentId)?.liabilityLedgerId || null;

  /* Ledger accounts are looked up once and checked: an account that has been
     deleted or deactivated since somebody mapped it would otherwise post to
     nothing. */
  const ledgerIds = new Set<string>();
  for (const slip of slips) {
    for (const line of slip.lines) {
      const e = expenseOf(line);
      const l = liabilityOf(line);
      if (e) ledgerIds.add(e);
      if (l) ledgerIds.add(l);
    }
  }
  /* By id, not from the pick-list: a mapping pointing at a ledger somebody
     deactivated must say so, rather than read as one that never existed. */
  const ledgers = await accounting.getLedgersByIds(orgId, [...ledgerIds]);
  const byLedger = new Map(ledgers.map((l) => [l.id, l]));

  const buckets = new Map<string, Bucket>();
  const add = (
    ledgerAccountId: string | null,
    side: 'debit' | 'credit',
    amount: number,
    description: string,
    costCenterId: string | null,
    unmapped: string
  ) => {
    if (amount <= 0) return;
    if (!ledgerAccountId) {
      problems.push({ code: 'UNMAPPED_COMPONENT', message: unmapped });
      return;
    }
    const ledger = byLedger.get(ledgerAccountId);
    if (!ledger) {
      problems.push({ code: 'LEDGER_MISSING', message: `${description} points at a ledger account that no longer exists.` });
      return;
    }
    if (!ledger.isActive) {
      problems.push({ code: 'LEDGER_INACTIVE', message: `${description} posts to ${ledger.name}, which is no longer active.` });
      return;
    }
    const k = key(ledgerAccountId, costCenterId);
    const bucket = buckets.get(k) || { ledgerAccountId, debit: 0, credit: 0, description: ledger.name, costCenterId };
    bucket[side] = round2(bucket[side] + amount);
    buckets.set(k, bucket);
  };

  /* The account net pay is owed to. Nothing is withheld here — this is the
     employee's own money, waiting to be transferred. */
  const payable = await accounting.getPayablesAccount(orgId);
  if (!payable) {
    problems.push({ code: 'NO_PAYABLE_ACCOUNT', message: 'This company has no payables account for salaries to be owed to.' });
  }

  let netTotal = 0;

  for (const slip of slips) {
    netTotal = round2(netTotal + Number(slip.netPay));
    for (const line of slip.lines) {
      const amount = Number(line.amount) || 0;
      if (amount <= 0) continue;
      const cc = line.costCenterId || null;

      if (line.type === 'EARNING') {
        add(expenseOf(line), 'debit', amount, line.componentName, cc, `${line.componentName} has no expense account to post to.`);
      } else if (line.type === 'DEDUCTION') {
        /* Withheld from pay and owed to somebody else — a fund, or the tax
           department. It is a liability, never income. */
        add(liabilityOf(line), 'credit', amount, line.componentName, cc, `${line.componentName} has no liability account to post to.`);
      } else {
        /* An employer contribution is a cost and a debt in one movement. */
        add(expenseOf(line), 'debit', amount, `${line.componentName} (employer)`, cc, `${line.componentName} has no expense account to post to.`);
        add(liabilityOf(line), 'credit', amount, `${line.componentName} payable`, cc, `${line.componentName} has no liability account to post to.`);
      }
    }
  }

  if (payable && netTotal > 0) {
    const k = key(payable.id, null);
    const bucket = buckets.get(k) || { ledgerAccountId: payable.id, debit: 0, credit: 0, description: 'Salaries payable', costCenterId: null };
    bucket.credit = round2(bucket.credit + netTotal);
    bucket.description = 'Salaries payable';
    buckets.set(k, bucket);
  }

  const lines: PostingLine[] = [...buckets.values()]
    .map((b, i) => ({
      ledgerAccountId: b.ledgerAccountId,
      ledgerName: b.description,
      /* A bucket that took both sides nets off; a ledger appearing as both a
         debit and a credit on one entry reads as a mistake even when it is
         arithmetically fine. */
      debit: round2(Math.max(0, b.debit - b.credit)),
      credit: round2(Math.max(0, b.credit - b.debit)),
      description: b.description,
      costCenterId: b.costCenterId,
      displayOrder: i,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0)
    .sort((a, b) => b.debit - a.debit || a.ledgerName.localeCompare(b.ledgerName))
    .map((l, i) => ({ ...l, displayOrder: i }));

  const totalDebit = round2(lines.reduce((t, l) => t + l.debit, 0));
  const totalCredit = round2(lines.reduce((t, l) => t + l.credit, 0));
  const balanced = paise(totalDebit) === paise(totalCredit);

  if (lines.length && !balanced) {
    /* Never plugged. A rounding account absorbing a payroll difference is how
       a payroll error becomes invisible. */
    problems.push({
      code: 'UNBALANCED',
      message: `This entry does not balance: ${totalDebit.toFixed(2)} against ${totalCredit.toFixed(2)}.`,
    });
  }

  /* One problem per cause. The same unmapped component on four hundred
     payslips is one thing to fix, not four hundred. */
  const seen = new Set<string>();
  const distinct = problems.filter((p) => {
    const k = `${p.code}::${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    lines,
    totalDebit,
    totalCredit,
    balanced,
    problems: distinct,
    alreadyPosted: existing
      ? { postingId: existing.id, journalEntryId: existing.journalEntryId, postedAt: existing.postedAt }
      : null,
  };
}

/**
 * Write the payroll journal, once.
 *
 * Idempotent in both directions. If a receipt already exists, the run is
 * already posted and the same answer comes back. If a journal exists in
 * accounting for this run but no receipt does — a crash between the two steps
 * — that journal is adopted rather than a second one written.
 */
export async function postPayrollRun(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  runId: string;
  postingDate?: string;
  accounting?: AccountingClient;
}) {
  const { accountId, orgId, branchId, userId, runId } = opts;
  const accounting = opts.accounting ?? accountingFor(accountId);

  const run = await payrollPrisma.payrollRun.findFirst({ where: { accountId, orgId, id: runId } });
  if (!run) throw new PayrollPostingError('NO_RUN', 'No such payroll run.', 404);

  /*
   * Asked before the status check, deliberately. A run that has been posted IS
   * 'POSTED', which is not in the list below — so checking the status first
   * would refuse the second press of the button instead of replaying it, and
   * the caller could not tell "already done" from "not allowed".
   */
  const existing = await payrollPrisma.payrollPosting.findFirst({ where: { orgId, runId } });
  if (existing && existing.status === 'POSTED') {
    return { posting: existing, replayed: true as const };
  }

  /*
   * Only an approved payroll reaches the books. Posting is the point at which
   * payroll becomes a company's published numbers, and a draft in the trial
   * balance is worse than no payroll at all.
   */
  if (!['APPROVED', 'LOCKED', 'PAID'].includes(run.status)) {
    throw new PayrollPostingError(
      'RUN_NOT_APPROVED',
      'Only an approved payroll can be posted. Approve it first.'
    );
  }

  const preview = await previewPosting(accountId, orgId, runId, accounting);
  if (preview.problems.length) {
    throw new PayrollPostingError('POSTING_BLOCKED', preview.problems[0].message);
  }
  if (!preview.lines.length) {
    throw new PayrollPostingError('NOTHING_TO_POST', 'This payroll has nothing to post.');
  }

  const postingDate = opts.postingDate || run.payrollDate;

  /*
   * Claim the run before writing anything.
   *
   * Two people pressing Post at the same moment both found no receipt, both
   * found no journal, and both wrote one — doubling the company's salary cost.
   * The claim closes that: `PayrollPosting` is unique on the run, so the
   * database decides which attempt proceeds and the other is told the posting
   * is already under way.
   *
   * The claim is DRAFT, not POSTED. It asserts the right to post, never that a
   * journal exists — so a crash between the claim and the journal leaves a
   * receipt that says "unfinished", which the next attempt completes.
   */
  /*
   * Take the claim, rather than merely find one.
   *
   * The unique index on (orgId, runId) decides who may create the receipt, and
   * that half worked. The hole was the other half: an attempt that *found* a
   * DRAFT receipt someone else had just created treated it as its own and
   * carried on, so two attempts posted two journals and doubled the company's
   * salary cost. On SQLite the writes were serial enough to hide it; on
   * PostgreSQL it reproduced about one run in five.
   *
   * So the right to post is taken with a conditional update. Exactly one
   * attempt can move a receipt out of DRAFT, and whoever loses is told the
   * posting is under way.
   *
   * IN_PROGRESS is not a terminal state: an attempt that dies between the
   * claim and the journal leaves the receipt held, and the reclaim below
   * releases it once it is plainly stale. Combined with the orphan adoption
   * further down, a crashed attempt finishes rather than duplicates.
   */
  const CLAIM_STALE_AFTER_MS = 2 * 60 * 1000;

  /**
   * Whether this call, and not some other one, holds the right to post.
   *
   * Two ways to hold it: you inserted the receipt — the unique index on
   * (orgId, runId) means only one call can — or you moved an existing one out
   * of DRAFT, which `updateMany` reports as a row count and so is equally
   * exclusive.
   *
   * What it must NOT depend on is who is signed in. An earlier version treated
   * a receipt already marked POSTING by the same user as its own, which is
   * precisely the case the test exercises: one person pressing the button
   * twice. Both calls continued, both wrote a journal, and the company's
   * salary cost appeared twice in its own books.
   */
  let mine = false;
  let claim = existing;

  if (!claim) {
    try {
      claim = await payrollPrisma.payrollPosting.create({
        data: {
          accountId,
          orgId,
          branchId,
          runId,
          postingDate,
          totalDebit: preview.totalDebit,
          totalCredit: preview.totalCredit,
          status: 'POSTING',
          createdByUserId: userId,
        },
      });
      mine = true;
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      /* Somebody inserted it between our look and our write. */
      claim = await payrollPrisma.payrollPosting.findFirst({ where: { orgId, runId } });
      if (!claim) throw e;
    }
  }

  if (!mine) {
    if (claim.status === 'POSTED') return { posting: claim, replayed: true as const };

    /*
     * Take it, or be told it is taken. A receipt still marked POSTING long
     * after it was touched belonged to an attempt that died; releasing it is
     * what lets a crash be finished rather than block the run forever.
     */
    const stale = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
    const taken = await payrollPrisma.payrollPosting.updateMany({
      where: {
        id: claim.id,
        OR: [{ status: 'DRAFT' }, { status: 'POSTING', updatedAt: { lt: stale } }],
      },
      data: { status: 'POSTING', createdByUserId: userId },
    });

    if (taken.count !== 1) {
      const now = await payrollPrisma.payrollPosting.findFirst({ where: { id: claim.id } });
      if (now?.status === 'POSTED') return { posting: now, replayed: true as const };
      throw new PayrollPostingError(
        'POSTING_IN_PROGRESS',
        'This payroll is already being posted. Refresh in a moment to see the entry.'
      );
    }

    mine = true;
    claim = await payrollPrisma.payrollPosting.findFirst({ where: { id: claim.id } });
  }

  /*
   * A journal already carrying this run as its source is one a previous
   * attempt wrote before it could finish. Adopt it; writing a second would
   * double the company's salary cost.
   */
  const orphan = await accounting.findEntryBySource(orgId, PAYROLL_SOURCE_DOC_TYPE, runId);

  let journalEntryId = orphan?.id || null;

  if (!journalEntryId) {
    /*
     * Payroll hands Accounting a payload and Accounting decides what to make
     * of it. The idempotency key is derived from the run, so the same run
     * asking twice is recognisably the same act however far apart the two
     * attempts are.
     */
    const entry = await accounting.postJournalEntry({
      companyId: orgId,
      branchId,
      userId,
      date: postingDate,
      journalCode: 'PAY',
      narration: `Payroll ${run.number}`,
      sourceDocType: PAYROLL_SOURCE_DOC_TYPE,
      sourceDocId: runId,
      lines: preview.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    });
    journalEntryId = entry.id;
  }

  /* Step two. A failure here leaves a journal with no receipt, which the
     adoption above recovers on the next attempt. */
  const posting = await payrollPrisma.$transaction(async (tx) => {
    const row = await tx.payrollPosting.update({
      where: { id: claim!.id },
      data: {
        journalEntryId,
        postingDate,
        totalDebit: preview.totalDebit,
        totalCredit: preview.totalCredit,
        status: 'POSTED',
        postedByUserId: userId,
        postedAt: new Date(),
      },
    });

    await tx.payrollPostingLine.deleteMany({ where: { postingId: row.id } });
    await tx.payrollPostingLine.createMany({
      data: preview.lines.map((l) => ({
        accountId,
        orgId,
        postingId: row.id,
        ledgerAccountId: l.ledgerAccountId,
        ledgerName: l.ledgerName,
        debit: l.debit,
        credit: l.credit,
        costCenterId: l.costCenterId,
        description: l.description,
        displayOrder: l.displayOrder,
      })),
    });

    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'POSTED' } });
    return row;
  });

  return { posting, replayed: false as const };
}
