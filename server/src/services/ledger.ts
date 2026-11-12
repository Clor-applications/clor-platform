import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import type { DbClient } from '../utils/dbClient.js';

// ---------------------------------------------------------------------------
// Double-entry posting.
//
// Rules this module enforces, and which nothing else may bypass:
//   1. An entry posts only if debits equal credits, to the paisa.
//   2. Control accounts are resolved by controlKind, never by name.
//   3. A POSTED entry is immutable. Corrections are contra entries.
//   4. Posting refuses to write into a locked period.
// ---------------------------------------------------------------------------

export type ControlKind =
  | 'AR'
  | 'AP'
  | 'STOCK'
  | 'SALES'
  | 'PURCHASES'
  | 'EXPENSES'
  | 'CGST_OUT'
  | 'SGST_OUT'
  | 'IGST_OUT'
  | 'CGST_IN'
  | 'SGST_IN'
  | 'IGST_IN'
  | 'CASH'
  | 'BANK'
  | 'ROUNDING'
  | 'OPENING_DIFF'
  | 'SUSPENSE'
  | 'FX_GAIN_LOSS'
  /* Deductions a customer makes from a payment: tax withheld against our PAN,
     and what the bank takes on the way through. Both settle the invoice even
     though neither reaches the bank account. */
  | 'TDS_RECEIVABLE'
  /* The other side of the same idea, and the one that was missing: tax WE
     withhold when paying a vendor. It is ours only until the challan is paid,
     so it is a liability from the moment it is deducted, and it is what a 26Q
     return is reconciled against. Without it the deduction had nowhere to land
     and was silently dropped from the ledger. */
  | 'TDS_PAYABLE'
  | 'BANK_CHARGES';

export type PostingLine = {
  controlKind?: ControlKind;
  ledgerAccountId?: string;
  debit?: number;
  credit?: number;
  partyType?: 'CUSTOMER' | 'VENDOR' | null;
  partyId?: string | null;
  itemId?: string | null;
  warehouseId?: string | null;
  taxCode?: string | null;
  hsnSac?: string | null;
  description?: string | null;
};

export type PostingRequest = {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  date: string;
  journalCode: string;
  narration?: string | null;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  /** On a contra posted by reverseEntry: the entry it reverses. */
  reversesId?: string | null;
  lines: PostingLine[];
};

export class PostingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PostingError';
    this.status = status;
  }
}

// Money is handled in integer paise internally so that a sum of rounded
// two-decimal amounts can be compared for exact equality.
const toPaise = (v: number | undefined | null) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};
const fromPaise = (p: number) => p / 100;

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export const DEFAULT_ACCOUNTS: Array<{
  code: string;
  name: string;
  accountType: string;
  controlKind: ControlKind;
}> = [
  { code: '1100', name: 'Accounts Receivable', accountType: 'ASSET', controlKind: 'AR' },
  { code: '1200', name: 'Cash-in-Hand', accountType: 'ASSET', controlKind: 'CASH' },
  { code: '1300', name: 'Bank Accounts', accountType: 'ASSET', controlKind: 'BANK' },
  { code: '1400', name: 'Stock-in-Hand', accountType: 'ASSET', controlKind: 'STOCK' },
  { code: '1450', name: 'TDS Receivable', accountType: 'ASSET', controlKind: 'TDS_RECEIVABLE' },
  { code: '1500', name: 'Input CGST', accountType: 'ASSET', controlKind: 'CGST_IN' },
  { code: '1510', name: 'Input SGST', accountType: 'ASSET', controlKind: 'SGST_IN' },
  { code: '1520', name: 'Input IGST', accountType: 'ASSET', controlKind: 'IGST_IN' },
  { code: '2000', name: 'Accounts Payable', accountType: 'LIABILITY', controlKind: 'AP' },
  { code: '2050', name: 'TDS Payable', accountType: 'LIABILITY', controlKind: 'TDS_PAYABLE' },
  { code: '2100', name: 'Output CGST', accountType: 'LIABILITY', controlKind: 'CGST_OUT' },
  { code: '2110', name: 'Output SGST', accountType: 'LIABILITY', controlKind: 'SGST_OUT' },
  { code: '2120', name: 'Output IGST', accountType: 'LIABILITY', controlKind: 'IGST_OUT' },
  { code: '3000', name: 'Opening Balance Difference', accountType: 'EQUITY', controlKind: 'OPENING_DIFF' },
  { code: '4000', name: 'Sales Accounts', accountType: 'INCOME', controlKind: 'SALES' },
  { code: '5000', name: 'Purchase Accounts', accountType: 'EXPENSE', controlKind: 'PURCHASES' },
  { code: '5100', name: 'Indirect Expenses', accountType: 'EXPENSE', controlKind: 'EXPENSES' },
  { code: '5200', name: 'Bank Charges', accountType: 'EXPENSE', controlKind: 'BANK_CHARGES' },
  { code: '9997', name: 'Exchange Gain / Loss', accountType: 'EXPENSE', controlKind: 'FX_GAIN_LOSS' },
  { code: '9998', name: 'Rounding Difference', accountType: 'EXPENSE', controlKind: 'ROUNDING' },
  { code: '9999', name: 'Suspense / Uncategorised', accountType: 'ASSET', controlKind: 'SUSPENSE' },
];

/**
 * The cash and bank accounts ledger setup creates on its own.
 *
 * These exist so postings always have a control account to resolve, not
 * because anyone chose them. They are deliberately NOT offered as payment
 * modes: "Received into" lists the accounts the business actually opened.
 * Setup identifies its own rows by code, so code is what identifies them here.
 */
export const SETUP_CASH_BANK_CODES = DEFAULT_ACCOUNTS.filter(
  (a) => a.controlKind === 'CASH' || a.controlKind === 'BANK'
).map((a) => a.code);

const DEFAULT_JOURNALS: Array<{ code: string; name: string; type: string }> = [
  { code: 'SAL', name: 'Sales', type: 'SALE' },
  { code: 'PUR', name: 'Purchase', type: 'PURCHASE' },
  { code: 'BNK', name: 'Bank', type: 'BANK' },
  { code: 'CSH', name: 'Cash', type: 'CASH' },
  { code: 'JV', name: 'Journal', type: 'GENERAL' },
  { code: 'OPN', name: 'Opening', type: 'OPENING' },
  /* Payroll writes the largest entry most companies make each month, and a
     book of its own is how an accountant expects to find it — the same reason
     sales and purchases have theirs. Seeded like the rest, so an organisation
     that predates payroll gains it the next time the ledger is set up. */
  { code: 'PAY', name: 'Payroll', type: 'GENERAL' },
];

// India: 1 April to 31 March.
export function fiscalYearFor(dateIso: string) {
  const d = new Date(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new PostingError(`Invalid date: ${dateIso}`);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 3 ? y : y - 1;
  return {
    name: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    startDate: `${startYear}-04-01`,
    endDate: `${startYear + 1}-03-31`,
  };
}

/**
 * Idempotently create the default chart of accounts and journals for an org.
 *
 * One read and one insert for each, not one of each per account: done row by
 * row it was some 90 round trips, every one through the tenant wrapper, and
 * setting up a company took seconds (seen at 7 s on staging).
 */
export async function ensureLedgerSetup(accountId: string, orgId: string, userId: string) {
  const haveAccounts = new Set(
    (await prisma.ledgerAccount.findMany({ where: { orgId, branchId: null, code: { in: DEFAULT_ACCOUNTS.map((a) => a.code) } }, select: { code: true } })).map((a) => a.code),
  );
  const accounts = DEFAULT_ACCOUNTS.filter((a) => !haveAccounts.has(a.code));
  if (accounts.length) {
    await prisma.ledgerAccount.createMany({
      data: accounts.map((a) => ({
        accountId,
        orgId,
        branchId: null,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        controlKind: a.controlKind,
        createdByUserId: userId,
      })),
    });
  }

  const haveJournals = new Set(
    (await prisma.journal.findMany({ where: { orgId, branchId: null, code: { in: DEFAULT_JOURNALS.map((j) => j.code) } }, select: { code: true } })).map((j) => j.code),
  );
  const journals = DEFAULT_JOURNALS.filter((j) => !haveJournals.has(j.code));
  if (journals.length) {
    await prisma.journal.createMany({
      data: journals.map((j) => ({ accountId, orgId, branchId: null, code: j.code, name: j.name, type: j.type, createdByUserId: userId })),
    });
  }
}

async function resolveControlAccountId(
  tx: Prisma.TransactionClient,
  orgId: string,
  branchId: string,
  controlKind: ControlKind
) {
  // Branch-specific override first, then the org-wide account.
  const row =
    (await tx.ledgerAccount.findFirst({
      where: { orgId, branchId, controlKind, isActive: true },
      select: { id: true },
    })) ||
    (await tx.ledgerAccount.findFirst({
      where: { orgId, branchId: null, controlKind, isActive: true },
      select: { id: true },
    }));

  if (row) return row.id;

  /*
   * Create it rather than refuse.
   *
   * A control kind added after an org was set up has no account, and the org
   * has no way to make one — ledger setup only runs once. Refusing meant every
   * book opened before the feature shipped could not use it. The seed table is
   * the definition of what the account should be, so this is that definition
   * being applied late rather than a new account being invented.
   */
  const seed = DEFAULT_ACCOUNTS.find((a) => a.controlKind === controlKind);
  if (!seed) {
    throw new PostingError(
      `No ledger account configured for control kind ${controlKind}. Run ledger setup for this org.`,
      500
    );
  }

  const existingCode = await tx.ledgerAccount.findFirst({
    where: { orgId, branchId: null, code: seed.code },
    select: { id: true },
  });
  if (existingCode) return existingCode.id;

  // Ownership is copied from an account the org already has rather than passed
  // down through every caller: this runs inside a posting, and the tenant is
  // already settled by the time it does.
  const sibling = await tx.ledgerAccount.findFirst({
    where: { orgId },
    select: { accountId: true, createdByUserId: true },
  });
  if (!sibling) {
    throw new PostingError(
      `No ledger account configured for control kind ${controlKind}. Run ledger setup for this org.`,
      500
    );
  }

  const created = await tx.ledgerAccount.create({
    data: {
      accountId: sibling.accountId,
      orgId,
      branchId: null,
      code: seed.code,
      name: seed.name,
      accountType: seed.accountType,
      controlKind: seed.controlKind,
      createdByUserId: sibling.createdByUserId,
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureFiscalYear(
  tx: Prisma.TransactionClient,
  accountId: string,
  orgId: string,
  userId: string,
  date: string
) {
  const fy = fiscalYearFor(date);
  const existing = await tx.fiscalYear.findFirst({ where: { orgId, name: fy.name } });
  if (existing) return existing;
  /*
   * Insert-or-take, in one statement on the (orgId, name) key. A read then a
   * create let two invoices saved at once, the first two of a year, both try
   * to create it: one failed, and inside a transaction a caught error cannot
   * be retried. Seen under load on staging.
   */
  return tx.fiscalYear.upsert({
    where: { orgId_name: { orgId, name: fy.name } },
    update: {},
    create: {
      accountId,
      orgId,
      name: fy.name,
      startDate: fy.startDate,
      endDate: fy.endDate,
      createdByUserId: userId,
    },
  });
}

async function nextEntryNo(tx: Prisma.TransactionClient, orgId: string, branchId: string, journalCode: string) {
  // Gap-free per (org, branch, journal). Runs inside the posting transaction.
  const last = await tx.journalEntry.findFirst({
    where: { orgId, branchId, entryNo: { startsWith: `${journalCode}-` } },
    orderBy: { entryNo: 'desc' },
    select: { entryNo: true },
  });
  const lastSeq = last ? Number(String(last.entryNo).split('-').pop()) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${journalCode}-${String(next).padStart(6, '0')}`;
}

function canonicalPayload(entry: {
  entryNo: string;
  date: string;
  branchId: string;
  lines: Array<{ ledgerAccountId: string; debit: number; credit: number }>;
}) {
  return JSON.stringify({
    entryNo: entry.entryNo,
    date: entry.date,
    branchId: entry.branchId,
    lines: entry.lines
      .map((l) => `${l.ledgerAccountId}:${l.debit}:${l.credit}`)
      .sort(),
  });
}

/**
 * Post a balanced journal entry. Throws PostingError unless debits === credits.
 * The whole entry (numbering, lines, hash chain) commits atomically.
 */
/**
 * Post a journal entry.
 *
 * `tx` is how this composes. Called without one it opens its own transaction,
 * exactly as it always has, and every existing caller is unchanged. Called with
 * one it joins that transaction and opens nothing — so a sale, the receipt that
 * settles it and the settlement derived from both either all land or none of
 * them do.
 *
 * It matters that the second form does NOT open a nested transaction: Prisma
 * would not join it to the caller's, and the entry would commit independently
 * of the operation it belongs to — which is the failure this parameter exists
 * to prevent. `DbClient` has no `$transaction`, so the mistake will not compile.
 */
export async function postEntry(req: PostingRequest, tx?: DbClient) {
  const { accountId, orgId, branchId, userId, date } = req;

  if (!req.lines?.length) throw new PostingError('A journal entry needs at least two lines');
  if (req.lines.length < 2) throw new PostingError('A journal entry needs at least two lines');

  let debitPaise = 0;
  let creditPaise = 0;
  for (const l of req.lines) {
    const d = toPaise(l.debit);
    const c = toPaise(l.credit);
    if (d < 0 || c < 0) throw new PostingError('Journal amounts cannot be negative');
    if (d > 0 && c > 0) throw new PostingError('A line may carry either a debit or a credit, not both');
    if (d === 0 && c === 0) throw new PostingError('A line must carry a non-zero debit or credit');
    debitPaise += d;
    creditPaise += c;
  }

  if (debitPaise !== creditPaise) {
    throw new PostingError(
      `Entry does not balance: debits ${fromPaise(debitPaise).toFixed(2)} vs credits ${fromPaise(creditPaise).toFixed(2)}`
    );
  }

  /* Validation above touches no database and stays outside the transaction;
     a malformed entry is rejected before a transaction is opened at all. */
  const write = async (db: DbClient) => {
    const tx = db as Prisma.TransactionClient;
    /*
     * One posting at a time per company and branch, until this transaction
     * ends. The entry number is the last one plus one and the hash chains to
     * the last entry; two postings at once both read the same "last", so one
     * died on the (orgId, branchId, entryNo) key and the hash chain could
     * fork. Seen with concurrent invoices on staging. Same lock idiom as
     * stockLedger.ts.
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ledger:${orgId}:${branchId ?? ''}`}, 0))`;
    const fy = await ensureFiscalYear(tx, accountId, orgId, userId, date);

    if (fy.status === 'CLOSED') {
      throw new PostingError(`Fiscal year ${fy.name} is closed`, 409);
    }
    if (fy.lockedThrough && String(date) <= String(fy.lockedThrough)) {
      throw new PostingError(`Books are locked through ${fy.lockedThrough}`, 409);
    }
    /*
     * A lock means "nothing on or before this date", whichever year holds it.
     *
     * Only the posting date's own year was consulted, and the books screen
     * writes the lock onto the year that contains the close date. So closing
     * through a date in 2026-27 left all of 2025-26 open on the server —
     * shut on the screen, open to any posting that reached the API.
     */
    const later = await tx.fiscalYear.findFirst({
      where: { accountId, orgId, lockedThrough: { gte: String(date) } },
      orderBy: { lockedThrough: 'desc' },
      select: { lockedThrough: true },
    });
    if (later?.lockedThrough) {
      throw new PostingError(`Books are locked through ${later.lockedThrough}`, 409);
    }

    const journal =
      (await tx.journal.findFirst({ where: { orgId, branchId, code: req.journalCode } })) ||
      (await tx.journal.findFirst({ where: { orgId, branchId: null, code: req.journalCode } }));
    if (!journal) throw new PostingError(`Unknown journal ${req.journalCode}`, 500);

    const resolved: Array<PostingLine & { ledgerAccountId: string }> = [];
    for (const l of req.lines) {
      let ledgerAccountId = l.ledgerAccountId;
      if (!ledgerAccountId) {
        if (!l.controlKind) throw new PostingError('Each line needs a ledgerAccountId or a controlKind');
        ledgerAccountId = await resolveControlAccountId(tx, orgId, branchId, l.controlKind);
      } else {
        const owned = await tx.ledgerAccount.findFirst({
          where: { id: ledgerAccountId, orgId },
          select: { id: true },
        });
        if (!owned) throw new PostingError('Ledger account does not belong to this org', 403);
      }
      resolved.push({ ...l, ledgerAccountId });
    }

    const entryNo = await nextEntryNo(tx, orgId, branchId, journal.code);

    /* REVERSED as well as POSTED: a reversed entry is still a link in the
       chain. Looking at POSTED alone made the next entry skip back past every
       entry reversed since, so the chain branched at each reversal. */
    const prev = await tx.journalEntry.findFirst({
      where: { orgId, branchId, status: { in: ['POSTED', 'REVERSED'] }, hash: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? null;

    const payload = canonicalPayload({
      entryNo,
      date,
      branchId,
      lines: resolved.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        debit: toPaise(l.debit),
        credit: toPaise(l.credit),
      })),
    });
    const hash = createHash('sha256').update(`${prevHash ?? ''}${payload}`).digest('hex');

    const entry = await tx.journalEntry.create({
      data: {
        accountId,
        orgId,
        branchId,
        journalId: journal.id,
        fiscalYearId: fy.id,
        entryNo,
        date,
        narration: req.narration ?? null,
        status: 'POSTED',
        postedAt: new Date(),
        postedByUserId: userId,
        sourceDocType: req.sourceDocType ?? null,
        sourceDocId: req.sourceDocId ?? null,
        reversesId: req.reversesId ?? null,
        prevHash,
        hash,
        createdByUserId: userId,
        lines: {
          create: resolved.map((l) => ({
            accountId,
            orgId,
            branchId,
            ledgerAccountId: l.ledgerAccountId,
            partyType: l.partyType ?? null,
            partyId: l.partyId ?? null,
            itemId: l.itemId ?? null,
            warehouseId: l.warehouseId ?? null,
            debit: new Prisma.Decimal(fromPaise(toPaise(l.debit)).toFixed(2)),
            credit: new Prisma.Decimal(fromPaise(toPaise(l.credit)).toFixed(2)),
            taxCode: l.taxCode ?? null,
            hsnSac: l.hsnSac ?? null,
            description: l.description ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    return entry;
  };

  return tx ? write(tx) : prisma.$transaction((t) => write(t));
}

/**
 * Reverse a posted entry with a contra entry. Posted rows are never mutated,
 * beyond linking the original to its reversal.
 *
 * Always one transaction. Without one the contra could commit and the original
 * never be marked: both then counted, and a retry posted a second contra. So
 * `tx`, when given, is joined — the reversal then rolls back with the larger
 * operation it belongs to — and otherwise one is opened here.
 *
 * Idempotent. The original is locked before it is read, so two reversals of
 * the same entry run one after the other, and the second finds the first's
 * contra and hands it back instead of posting another. The contra's
 * `reversesId` is unique in the database, which holds that rule even for a
 * writer that skips this function.
 */
export async function reverseEntry(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  entryId: string;
  date?: string;
  narration?: string;
}, tx?: DbClient) {
  const run = async (db: DbClient) => {
    const t = db as Prisma.TransactionClient;
    const where = { id: opts.entryId, accountId: opts.accountId, orgId: opts.orgId };

    const located = await t.journalEntry.findFirst({ where, select: { branchId: true } });
    if (!located) throw new PostingError('Journal entry not found', 404);
    /* The posting lock first, then the row: the order postEntry takes them
       in, so a reversal and a posting on the same branch cannot deadlock. */
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ledger:${opts.orgId}:${located.branchId ?? ''}`}, 0))`;
    await t.$queryRaw`SELECT "id" FROM "JournalEntry" WHERE "id" = ${opts.entryId} FOR UPDATE`;

    const original = await t.journalEntry.findFirst({ where, include: { lines: true, journal: true } });
    if (!original) throw new PostingError('Journal entry not found', 404);

    /* Already reversed: the contra that did it, not a second one. Found by
       the contra's own link first, then by the original's, which is all an
       entry reversed before `reversesId` existed has. */
    const done =
      (await t.journalEntry.findFirst({ where: { reversesId: original.id, orgId: opts.orgId }, include: { lines: true } })) ||
      (original.reversedById
        ? await t.journalEntry.findFirst({ where: { id: original.reversedById, orgId: opts.orgId }, include: { lines: true } })
        : null);
    if (done) return done;
    if (original.reversedById) throw new PostingError('Entry is already reversed', 409);
    if (original.status !== 'POSTED') throw new PostingError('Only a posted entry can be reversed', 409);

    const reversal = await postEntry({
      accountId: opts.accountId,
      orgId: opts.orgId,
      branchId: original.branchId,
      userId: opts.userId,
      date: opts.date || original.date,
      journalCode: original.journal.code,
      narration: opts.narration || `Reversal of ${original.entryNo}`,
      sourceDocType: original.sourceDocType,
      sourceDocId: original.sourceDocId,
      reversesId: original.id,
      lines: original.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        partyType: (l.partyType as any) ?? null,
        partyId: l.partyId,
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        description: `Reversal: ${l.description ?? ''}`.trim(),
      })),
    }, t);

    const marked = await t.journalEntry.updateMany({
      where: { id: original.id, status: 'POSTED', reversedById: null },
      data: { status: 'REVERSED', reversedById: reversal.id },
    });
    // Unreachable while the row lock holds; if it ever is, the contra goes too.
    if (marked.count !== 1) throw new PostingError('Entry is already reversed', 409);

    return reversal;
  };

  return tx ? run(tx) : prisma.$transaction((t) => run(t));
}

/** Journal lines for a sales invoice: AR debit, revenue + tax credits. */
export function invoicePostingLines(invoice: {
  customerId?: string | null;
  customerName?: string | null;
  subtotal?: number | null;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  total?: number | null;
}): PostingLine[] {
  const subtotal = Number(invoice.subtotal ?? 0);
  const cgst = Number(invoice.cgstTotal ?? 0);
  const sgst = Number(invoice.sgstTotal ?? 0);
  const igst = Number(invoice.igstTotal ?? 0);
  const declaredTotal = Number(invoice.total ?? 0);

  const computed = Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  const total = declaredTotal || computed;
  // Any difference between the document total and the sum of its parts is
  // posted explicitly rather than silently absorbed.
  const rounding = Math.round((total - computed) * 100) / 100;

  const lines: PostingLine[] = [
    {
      controlKind: 'AR',
      debit: total,
      partyType: 'CUSTOMER',
      partyId: invoice.customerId || null,
      description: `Invoice to ${invoice.customerName || 'customer'}`,
    },
  ];

  if (subtotal) lines.push({ controlKind: 'SALES', credit: subtotal, description: 'Sales' });
  if (cgst) lines.push({ controlKind: 'CGST_OUT', credit: cgst, taxCode: 'CGST', description: 'Output CGST' });
  if (sgst) lines.push({ controlKind: 'SGST_OUT', credit: sgst, taxCode: 'SGST', description: 'Output SGST' });
  if (igst) lines.push({ controlKind: 'IGST_OUT', credit: igst, taxCode: 'IGST', description: 'Output IGST' });

  if (rounding > 0) lines.push({ controlKind: 'ROUNDING', credit: rounding, description: 'Rounding difference' });
  if (rounding < 0) lines.push({ controlKind: 'ROUNDING', debit: Math.abs(rounding), description: 'Rounding difference' });

  return lines;
}

/**
 * Posting lines for a purchase bill — the mirror of an invoice.
 *
 * Purchases and input GST are debited and the vendor credited: the business
 * owes money and has acquired cost, where a sale earns revenue and creates a
 * receivable.
 */
export function billPostingLines(bill: {
  partyId?: string | null;
  partyName?: string | null;
  subtotal?: number | null;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  total?: number | null;
  tdsAmount?: number | null;
}): PostingLine[] {
  const subtotal = Number(bill.subtotal ?? 0);
  const cgst = Number(bill.cgstTotal ?? 0);
  const sgst = Number(bill.sgstTotal ?? 0);
  const igst = Number(bill.igstTotal ?? 0);
  const computed = Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  const total = Number(bill.total ?? 0) || computed;
  const rounding = Math.round((total - computed) * 100) / 100;
  /* TDS deducted at the bill: credit or payment, whichever is earlier — this
     is the earlier. Never more than what the vendor is owed. */
  const tds = Math.min(Math.max(0, Number(bill.tdsAmount ?? 0)), total);

  const lines: PostingLine[] = [];
  if (subtotal) lines.push({ controlKind: 'PURCHASES', debit: subtotal, description: 'Purchases' });
  if (cgst) lines.push({ controlKind: 'CGST_IN', debit: cgst, taxCode: 'CGST', description: 'Input CGST' });
  if (sgst) lines.push({ controlKind: 'SGST_IN', debit: sgst, taxCode: 'SGST', description: 'Input SGST' });
  if (igst) lines.push({ controlKind: 'IGST_IN', debit: igst, taxCode: 'IGST', description: 'Input IGST' });

  if (rounding > 0) lines.push({ controlKind: 'ROUNDING', debit: rounding, description: 'Rounding difference' });
  if (rounding < 0) lines.push({ controlKind: 'ROUNDING', credit: Math.abs(rounding), description: 'Rounding difference' });

  /* The deduction is owed to the department, not the vendor — so it lands in
     TDS Payable and the vendor's payable is smaller by exactly that much.
     One entry, still balanced: debits unchanged, the credit side split. */
  if (tds) {
    lines.push({ controlKind: 'TDS_PAYABLE', credit: tds, description: 'TDS deducted at source' });
  }

  lines.push({
    controlKind: 'AP',
    credit: Math.round((total - tds) * 100) / 100,
    partyType: 'VENDOR',
    partyId: bill.partyId || null,
    description: `Bill from ${bill.partyName || 'vendor'}`,
  });

  return lines;
}

/**
 * Posting lines for an expense voucher.
 *
 * Same shape as a bill with one difference of account: the cost lands in
 * Indirect Expenses rather than Purchases, so trading and operating spend
 * stay separable on the P&L. The credit still goes to Accounts Payable —
 * an unpaid expense is owed to a party exactly like an unpaid bill, and
 * settlement flows through the same payments machinery.
 */
export function expensePostingLines(expense: {
  partyId?: string | null;
  partyName?: string | null;
  subtotal?: number | null;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  total?: number | null;
  tdsAmount?: number | null;
}): PostingLine[] {
  const subtotal = Number(expense.subtotal ?? 0);
  const cgst = Number(expense.cgstTotal ?? 0);
  const sgst = Number(expense.sgstTotal ?? 0);
  const igst = Number(expense.igstTotal ?? 0);
  const computed = Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  const total = Number(expense.total ?? 0) || computed;
  const rounding = Math.round((total - computed) * 100) / 100;
  const tds = Math.min(Math.max(0, Number(expense.tdsAmount ?? 0)), total);

  const lines: PostingLine[] = [];
  if (subtotal) lines.push({ controlKind: 'EXPENSES', debit: subtotal, description: 'Expense' });
  if (cgst) lines.push({ controlKind: 'CGST_IN', debit: cgst, taxCode: 'CGST', description: 'Input CGST' });
  if (sgst) lines.push({ controlKind: 'SGST_IN', debit: sgst, taxCode: 'SGST', description: 'Input SGST' });
  if (igst) lines.push({ controlKind: 'IGST_IN', debit: igst, taxCode: 'IGST', description: 'Input IGST' });

  if (rounding > 0) lines.push({ controlKind: 'ROUNDING', debit: rounding, description: 'Rounding difference' });
  if (rounding < 0) lines.push({ controlKind: 'ROUNDING', credit: Math.abs(rounding), description: 'Rounding difference' });

  /* Same split as the bill: the deduction to TDS Payable, the vendor
     credited net. */
  if (tds) {
    lines.push({ controlKind: 'TDS_PAYABLE', credit: tds, description: 'TDS deducted at source' });
  }

  lines.push({
    controlKind: 'AP',
    credit: Math.round((total - tds) * 100) / 100,
    partyType: 'VENDOR',
    partyId: expense.partyId || null,
    description: `Expense payable to ${expense.partyName || 'party'}`,
  });

  return lines;
}

/**
 * Posting lines for a credit note — a sales return.
 *
 * Exactly the reverse of the invoice: revenue and output GST come back down,
 * and the customer's balance is reduced. Posted as its own entry rather than by
 * editing the original, so both documents remain in the audit trail.
 */
export function creditNotePostingLines(note: {
  partyId?: string | null;
  partyName?: string | null;
  subtotal?: number | null;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  total?: number | null;
}): PostingLine[] {
  const subtotal = Number(note.subtotal ?? 0);
  const cgst = Number(note.cgstTotal ?? 0);
  const sgst = Number(note.sgstTotal ?? 0);
  const igst = Number(note.igstTotal ?? 0);
  const computed = Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  const total = Number(note.total ?? 0) || computed;
  const rounding = Math.round((total - computed) * 100) / 100;

  const lines: PostingLine[] = [];
  if (subtotal) lines.push({ controlKind: 'SALES', debit: subtotal, description: 'Sales return' });
  if (cgst) lines.push({ controlKind: 'CGST_OUT', debit: cgst, taxCode: 'CGST', description: 'Output CGST reversed' });
  if (sgst) lines.push({ controlKind: 'SGST_OUT', debit: sgst, taxCode: 'SGST', description: 'Output SGST reversed' });
  if (igst) lines.push({ controlKind: 'IGST_OUT', debit: igst, taxCode: 'IGST', description: 'Output IGST reversed' });

  if (rounding > 0) lines.push({ controlKind: 'ROUNDING', debit: rounding, description: 'Rounding difference' });
  if (rounding < 0) lines.push({ controlKind: 'ROUNDING', credit: Math.abs(rounding), description: 'Rounding difference' });

  lines.push({
    controlKind: 'AR',
    credit: total,
    partyType: 'CUSTOMER',
    partyId: note.partyId || null,
    description: `Credit note to ${note.partyName || 'customer'}`,
  });

  return lines;
}

/** Posting lines for a debit note — a purchase return, the mirror of the above. */
export function debitNotePostingLines(note: {
  partyId?: string | null;
  partyName?: string | null;
  subtotal?: number | null;
  cgstTotal?: number | null;
  sgstTotal?: number | null;
  igstTotal?: number | null;
  total?: number | null;
}): PostingLine[] {
  const subtotal = Number(note.subtotal ?? 0);
  const cgst = Number(note.cgstTotal ?? 0);
  const sgst = Number(note.sgstTotal ?? 0);
  const igst = Number(note.igstTotal ?? 0);
  const computed = Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  const total = Number(note.total ?? 0) || computed;
  const rounding = Math.round((total - computed) * 100) / 100;

  const lines: PostingLine[] = [
    {
      controlKind: 'AP',
      debit: total,
      partyType: 'VENDOR',
      partyId: note.partyId || null,
      description: `Debit note to ${note.partyName || 'vendor'}`,
    },
  ];

  if (subtotal) lines.push({ controlKind: 'PURCHASES', credit: subtotal, description: 'Purchase return' });
  if (cgst) lines.push({ controlKind: 'CGST_IN', credit: cgst, taxCode: 'CGST', description: 'Input CGST reversed' });
  if (sgst) lines.push({ controlKind: 'SGST_IN', credit: sgst, taxCode: 'SGST', description: 'Input SGST reversed' });
  if (igst) lines.push({ controlKind: 'IGST_IN', credit: igst, taxCode: 'IGST', description: 'Input IGST reversed' });

  if (rounding > 0) lines.push({ controlKind: 'ROUNDING', credit: rounding, description: 'Rounding difference' });
  if (rounding < 0) lines.push({ controlKind: 'ROUNDING', debit: Math.abs(rounding), description: 'Rounding difference' });

  return lines;
}

/** Trial balance from POSTED lines only. */
export async function trialBalance(opts: {
  accountId: string;
  orgId: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const where: Prisma.JournalLineWhereInput = {
    accountId: opts.accountId,
    orgId: opts.orgId,
    ...(opts.branchId ? { branchId: opts.branchId } : {}),
    entry: {
      // POSTED *and* REVERSED, both of which are real postings.
      //
      // reverseEntry writes a contra entry and marks the original REVERSED.
      // Counting only POSTED therefore removed the original from the books
      // while still applying its contra, so every reversal moved the trial
      // balance by twice the amount: deleting a 1,000 invoice took 2,000 off
      // sales. The original and its contra both belong in the books, where
      // they cancel to zero; REVERSED is an audit label, not an exclusion.
      status: { in: ['POSTED', 'REVERSED'] },
      ...(opts.fromDate || opts.toDate
        ? {
            date: {
              ...(opts.fromDate ? { gte: opts.fromDate } : {}),
              ...(opts.toDate ? { lte: opts.toDate } : {}),
            },
          }
        : {}),
    },
  };

  const lines = await prisma.journalLine.findMany({
    where,
    select: {
      debit: true,
      credit: true,
      ledgerAccount: { select: { id: true, code: true, name: true, accountType: true, controlKind: true, sourceKey: true } },
    },
  });

  const byAccount = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      accountType: string;
      controlKind: string | null;
      sourceKey: string | null;
      debitPaise: number;
      creditPaise: number;
    }
  >();

  for (const l of lines) {
    const a = l.ledgerAccount;
    const row =
      byAccount.get(a.id) ||
      {
        id: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        controlKind: a.controlKind,
        sourceKey: a.sourceKey,
        debitPaise: 0,
        creditPaise: 0,
      };
    row.debitPaise += Math.round(Number(l.debit) * 100);
    row.creditPaise += Math.round(Number(l.credit) * 100);
    byAccount.set(a.id, row);
  }

  const rows = Array.from(byAccount.values())
    .map((r) => {
      const netPaise = r.debitPaise - r.creditPaise;
      return {
        accountId: r.id,
        code: r.code,
        name: r.name,
        accountType: r.accountType,
        controlKind: r.controlKind,
        // The browser's own chart row, for an account it created (routes/ledger.ts).
        sourceKey: r.sourceKey,
        debit: fromPaise(r.debitPaise),
        credit: fromPaise(r.creditPaise),
        closingDebit: netPaise > 0 ? fromPaise(netPaise) : 0,
        closingCredit: netPaise < 0 ? fromPaise(-netPaise) : 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebitPaise = rows.reduce((s, r) => s + Math.round(r.debit * 100), 0);
  const totalCreditPaise = rows.reduce((s, r) => s + Math.round(r.credit * 100), 0);

  return {
    rows,
    totals: {
      debit: fromPaise(totalDebitPaise),
      credit: fromPaise(totalCreditPaise),
      difference: fromPaise(totalDebitPaise - totalCreditPaise),
      balanced: totalDebitPaise === totalCreditPaise,
    },
  };
}

// ---------------------------------------------------------------------------
// Financial statements
//
// Built from the trial balance itself, not from a second query over the same
// lines: the statements and the trial balance are then the same numbers
// arranged differently, and cannot disagree. Each account's balance is shown
// the way its side of the statement reads it — assets and expenses debit
// positive, liabilities, equity and income credit positive — so a negative
// figure means the account is on the wrong side (an overdrawn bank, a sales
// return larger than the sales).
// ---------------------------------------------------------------------------

type StatementRow = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  controlKind: string | null;
  sourceKey: string | null;
  balance: number;
};

type TrialBalanceRow = Awaited<ReturnType<typeof trialBalance>>['rows'][number];

const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE']);

const statementRow = (r: TrialBalanceRow): StatementRow => {
  const netPaise = Math.round(r.debit * 100) - Math.round(r.credit * 100);
  return {
    accountId: r.accountId,
    code: r.code,
    name: r.name,
    accountType: r.accountType,
    controlKind: r.controlKind,
    sourceKey: r.sourceKey,
    balance: fromPaise(DEBIT_NORMAL.has(r.accountType) ? netPaise : -netPaise),
  };
};

const sumPaise = (rows: StatementRow[]) => rows.reduce((s, r) => s + Math.round(r.balance * 100), 0);

/** Profit and loss for a period: income and expense accounts from posted lines. */
export async function profitAndLoss(opts: {
  accountId: string;
  orgId: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const tb = await trialBalance(opts);
  const rows = tb.rows.map(statementRow);
  const income = rows.filter((r) => r.accountType === 'INCOME');
  const expenses = rows.filter((r) => r.accountType === 'EXPENSE');
  const incomePaise = sumPaise(income);
  const expensePaise = sumPaise(expenses);
  return {
    from: opts.fromDate ?? null,
    to: opts.toDate ?? null,
    income,
    expenses,
    totals: {
      income: fromPaise(incomePaise),
      expenses: fromPaise(expensePaise),
      netProfit: fromPaise(incomePaise - expensePaise),
    },
    trialBalance: tb.totals,
  };
}

/**
 * The balance sheet as of a date: every posted line up to it.
 *
 * Profit not yet closed to capital is shown as the current year's result on
 * the equity side, which is what makes the two sides agree before the closing
 * journal is posted. `balanced` is the trial balance's own check restated:
 * assets equal liabilities, equity and that result exactly when debits equal
 * credits.
 */
export async function balanceSheet(opts: { accountId: string; orgId: string; branchId?: string; asOf?: string }) {
  const tb = await trialBalance({ accountId: opts.accountId, orgId: opts.orgId, branchId: opts.branchId, toDate: opts.asOf });
  const rows = tb.rows.map(statementRow);
  const assets = rows.filter((r) => r.accountType === 'ASSET');
  const liabilities = rows.filter((r) => r.accountType === 'LIABILITY');
  const equity = rows.filter((r) => r.accountType === 'EQUITY');
  const profitPaise =
    sumPaise(rows.filter((r) => r.accountType === 'INCOME')) - sumPaise(rows.filter((r) => r.accountType === 'EXPENSE'));
  const assetPaise = sumPaise(assets);
  const liabilityPaise = sumPaise(liabilities);
  const equityPaise = sumPaise(equity);
  const otherSidePaise = liabilityPaise + equityPaise + profitPaise;
  return {
    asOf: opts.asOf ?? null,
    assets,
    liabilities,
    equity,
    totals: {
      assets: fromPaise(assetPaise),
      liabilities: fromPaise(liabilityPaise),
      equity: fromPaise(equityPaise),
      currentYearProfit: fromPaise(profitPaise),
      liabilitiesAndEquity: fromPaise(otherSidePaise),
      difference: fromPaise(assetPaise - otherSidePaise),
      balanced: assetPaise === otherSidePaise,
    },
    trialBalance: tb.totals,
  };
}

// ---------------------------------------------------------------------------
// Hash chain verification
//
// Each entry's hash is sha256(prevHash + its canonical payload), so an entry
// whose amounts, accounts, number, date or branch were changed after posting
// no longer matches its own hash, and an entry deleted from the middle leaves
// the next one pointing at a hash nobody has.
//
// The links are checked as a set rather than in creation order. Entries were
// chained to "the latest POSTED entry by createdAt", which skipped reversed
// entries and could disagree with commit order, so older chains branch. A
// branch is reported as a warning: it is how the chain was written, not
// evidence of tampering. A missing or mismatched hash is.
// ---------------------------------------------------------------------------

export type ChainProblem = {
  entryId: string;
  entryNo: string;
  branchId: string;
  kind: 'MISSING_HASH' | 'HASH_MISMATCH' | 'MISSING_PREVIOUS' | 'EXTRA_START';
  detail: string;
};

const CHAIN_PAGE = 500;
const CHAIN_REPORT_LIMIT = 100;

export async function verifyHashChain(opts: { accountId: string; orgId: string; branchId?: string }) {
  type Seen = { entryId: string; entryNo: string; prevHash: string | null };
  const byBranch = new Map<string, Map<string, Seen>>();
  const problems: ChainProblem[] = [];
  const report = (p: ChainProblem) => {
    if (problems.length < CHAIN_REPORT_LIMIT) problems.push(p);
  };
  let problemCount = 0;
  let checked = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.journalEntry.findMany({
      where: {
        accountId: opts.accountId,
        orgId: opts.orgId,
        ...(opts.branchId ? { branchId: opts.branchId } : {}),
        status: { in: ['POSTED', 'REVERSED'] },
      },
      orderBy: { id: 'asc' },
      take: CHAIN_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        entryNo: true,
        date: true,
        branchId: true,
        prevHash: true,
        hash: true,
        lines: { select: { ledgerAccountId: true, debit: true, credit: true } },
      },
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;

    for (const e of page) {
      checked += 1;
      if (!e.hash) {
        problemCount += 1;
        report({ entryId: e.id, entryNo: e.entryNo, branchId: e.branchId, kind: 'MISSING_HASH', detail: 'Posted without a hash' });
        continue;
      }
      const payload = canonicalPayload({
        entryNo: e.entryNo,
        date: e.date,
        branchId: e.branchId,
        lines: e.lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          debit: Math.round(Number(l.debit) * 100),
          credit: Math.round(Number(l.credit) * 100),
        })),
      });
      const expected = createHash('sha256').update(`${e.prevHash ?? ''}${payload}`).digest('hex');
      if (expected !== e.hash) {
        problemCount += 1;
        report({
          entryId: e.id,
          entryNo: e.entryNo,
          branchId: e.branchId,
          kind: 'HASH_MISMATCH',
          detail: 'Its lines, number, date or branch differ from what was posted',
        });
      }
      const chain = byBranch.get(e.branchId) || new Map<string, Seen>();
      chain.set(e.hash, { entryId: e.id, entryNo: e.entryNo, prevHash: e.prevHash });
      byBranch.set(e.branchId, chain);
    }
    if (page.length < CHAIN_PAGE) break;
  }

  let forks = 0;
  for (const [branchId, chain] of byBranch) {
    const children = new Map<string, number>();
    let starts = 0;
    for (const seen of chain.values()) {
      if (!seen.prevHash) {
        starts += 1;
        if (starts > 1) {
          problemCount += 1;
          report({ entryId: seen.entryId, entryNo: seen.entryNo, branchId, kind: 'EXTRA_START', detail: 'A second entry claims to be the first in its chain' });
        }
        continue;
      }
      if (!chain.has(seen.prevHash)) {
        problemCount += 1;
        report({
          entryId: seen.entryId,
          entryNo: seen.entryNo,
          branchId,
          kind: 'MISSING_PREVIOUS',
          detail: 'The entry it was chained to is no longer in the books',
        });
      }
      children.set(seen.prevHash, (children.get(seen.prevHash) || 0) + 1);
    }
    for (const n of children.values()) if (n > 1) forks += n - 1;
  }

  return {
    ok: problemCount === 0,
    checked,
    branches: byBranch.size,
    problemCount,
    problems,
    truncated: problemCount > problems.length,
    forks,
  };
}
