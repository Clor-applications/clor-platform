import { prisma } from '../../../utils/prisma.js';
import { ensureLedgerSetup, postEntry } from '../../ledger.js';

/**
 * The one door between Payroll and Accounting.
 *
 * Payroll and Accounting are separate applications that happen, today, to run
 * in one process against databases on one disk. That makes it easy for a
 * payroll service to import the accounting Prisma client and read a ledger
 * directly, and nothing but discipline stops it. This module is where that
 * discipline is made structural: it is the only file in Payroll permitted to
 * import anything Accounting owns, and everything else in Payroll depends on
 * the interface below instead.
 *
 * Two things follow from that, and both are the point.
 *
 * **Payroll can be tested without Accounting.** Every method here is on an
 * interface, so a test supplies its own and never touches an accounting
 * database. A payroll test that needs a ledger should not have to create a
 * chart of accounts.
 *
 * **The seam is already where the network will go.** When Accounting becomes a
 * service of its own, only this file changes: the same calls become HTTP, and
 * nothing that computes a payslip or posts a run knows the difference. That is
 * why the methods are shaped like a remote API — `companyId` in, plain data
 * out, no Prisma types crossing the boundary — rather than like the local
 * queries they currently wrap.
 *
 * What does NOT belong here: anything payroll can decide for itself. The
 * arithmetic of a journal, which component maps to which ledger, whether a run
 * is allowed to post — those are Payroll's. This client answers "what ledgers
 * exist", "record this entry", and nothing else.
 */

/** An accounting ledger, as Payroll needs to see it. Not a Prisma model. */
export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  /** ASSET | LIABILITY | EQUITY | INCOME | EXPENSE */
  accountType: string;
  /** AR, AP, BANK, CASH … the machine identity of a control account. */
  controlKind: string | null;
  isActive: boolean;
};

export type CostCentre = { id: string; name: string };

export type JournalLineInput = {
  ledgerAccountId: string;
  debit: number;
  credit: number;
  description: string;
};

export type JournalEntryInput = {
  companyId: string;
  branchId: string;
  userId: string;
  date: string;
  /** The book it lands in. Payroll uses PAY. */
  journalCode: string;
  narration: string;
  /**
   * What this entry is *for*, in Payroll's terms. Accounting stores it so the
   * same payroll run can never produce a second entry — see `idempotencyKey`.
   */
  sourceDocType: string;
  sourceDocId: string;
  lines: JournalLineInput[];
};

export type JournalEntryRef = {
  id: string;
  /** The number a person quotes. Empty when Accounting does not assign one. */
  number: string;
  status: string;
};

/** An entry as Payroll shows it back — enough to check a receipt against. */
export type JournalEntry = JournalEntryRef & {
  entryNo: string;
  date: string;
  narration: string;
};

export interface AccountingClient {
  /**
   * Ledgers a payroll component can be mapped to — active ones only, because
   * this answers "what may I choose".
   */
  getLedgers(companyId: string): Promise<LedgerAccount[]>;
  /**
   * Specific ledgers by id, whatever state they are in.
   *
   * A different question from the one above: this is resolving a mapping that
   * already exists, and the caller needs to tell "deactivated since you mapped
   * it" from "gone". Filtering to active here collapsed the two into "no
   * longer exists", which is the less useful half of the truth.
   */
  getLedgersByIds(companyId: string, ids: string[]): Promise<LedgerAccount[]>;
  /** Cost centres a payroll cost can be attributed to. */
  getCostCentres(companyId: string): Promise<CostCentre[]>;
  /** One ledger, or null. Used to check a mapping still points at something. */
  getLedger(companyId: string, ledgerId: string): Promise<LedgerAccount | null>;
  /**
   * The entry already recorded for this source document, if there is one.
   *
   * This is what makes posting idempotent across a crash: Payroll writes the
   * journal first and records the reference second, so an attempt that died
   * between the two finds its own entry here rather than writing a twin.
   */
  findEntryBySource(companyId: string, sourceDocType: string, sourceDocId: string): Promise<JournalEntryRef | null>;
  /** One entry by id, so a payroll receipt can be checked against the books. */
  getJournalEntry(companyId: string, entryId: string): Promise<JournalEntry | null>;
  /** Record an entry. Accounting validates and assigns the number. */
  postJournalEntry(input: JournalEntryInput): Promise<JournalEntryRef>;
  /** The control account salaries are owed to until they are paid. */
  getPayablesAccount(companyId: string): Promise<LedgerAccount | null>;
}

/**
 * A stable key for one posting, so a retry is recognisable as the same act.
 *
 * `payroll-run:{id}:accounting-posting`. Today it is carried as the source
 * document on the entry; over HTTP it becomes the idempotency header. Either
 * way it is the same string, derived from the run rather than generated, so
 * two attempts a week apart agree on it.
 */
export const postingIdempotencyKey = (kind: 'run' | 'payment', id: string) =>
  `payroll-${kind}:${id}:accounting-posting`;

const shapeLedger = (row: any): LedgerAccount => ({
  id: row.id,
  code: row.code,
  name: row.name,
  accountType: row.accountType,
  controlKind: row.controlKind ?? null,
  isActive: row.isActive !== false,
});

/**
 * The in-process implementation.
 *
 * Talks to the accounting database directly because both apps still share one.
 * Everything above the interface is written as though it did not — when this is
 * replaced by an HTTP client, no caller changes.
 */
export class LocalAccountingClient implements AccountingClient {
  constructor(private readonly accountId: string) {}

  async getLedgers(companyId: string): Promise<LedgerAccount[]> {
    const rows = await prisma.ledgerAccount.findMany({
      where: { accountId: this.accountId, orgId: companyId, isActive: true },
      orderBy: [{ accountType: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, accountType: true, controlKind: true, isActive: true },
    });
    return rows.map(shapeLedger);
  }

  async getLedgersByIds(companyId: string, ids: string[]): Promise<LedgerAccount[]> {
    if (!ids.length) return [];
    const rows = await prisma.ledgerAccount.findMany({
      where: { accountId: this.accountId, orgId: companyId, id: { in: ids } },
      select: { id: true, code: true, name: true, accountType: true, controlKind: true, isActive: true },
    });
    return rows.map(shapeLedger);
  }

  async getLedger(companyId: string, ledgerId: string): Promise<LedgerAccount | null> {
    if (!ledgerId) return null;
    const row = await prisma.ledgerAccount.findFirst({
      where: { accountId: this.accountId, orgId: companyId, id: ledgerId },
      select: { id: true, code: true, name: true, accountType: true, controlKind: true, isActive: true },
    });
    return row ? shapeLedger(row) : null;
  }

  async getCostCentres(companyId: string): Promise<CostCentre[]> {
    /* Cost centres are `OrgMaster` rows of kind COST_CENTER. Payroll holds
       their ids and has no list of its own. */
    const rows = await prisma.orgMaster.findMany({
      where: { accountId: this.accountId, orgId: companyId, kind: 'COST_CENTER', isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async getPayablesAccount(companyId: string): Promise<LedgerAccount | null> {
    const row = await prisma.ledgerAccount.findFirst({
      where: { accountId: this.accountId, orgId: companyId, controlKind: 'AP', isActive: true },
      select: { id: true, code: true, name: true, accountType: true, controlKind: true, isActive: true },
    });
    return row ? shapeLedger(row) : null;
  }

  async findEntryBySource(companyId: string, sourceDocType: string, sourceDocId: string): Promise<JournalEntryRef | null> {
    const row = await prisma.journalEntry.findFirst({
      where: { accountId: this.accountId, orgId: companyId, sourceDocType, sourceDocId, status: 'POSTED' },
      select: { id: true, entryNo: true, status: true },
    });
    /* Accounting calls it entryNo; Payroll only ever quotes it, so the
       contract names it `number` and this is the one place they meet. */
    return row ? { id: row.id, number: row.entryNo || '', status: row.status } : null;
  }

  async getJournalEntry(companyId: string, entryId: string): Promise<JournalEntry | null> {
    if (!entryId) return null;
    const row = await prisma.journalEntry.findFirst({
      where: { accountId: this.accountId, orgId: companyId, id: entryId },
      select: { id: true, entryNo: true, date: true, status: true, narration: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      number: row.entryNo || '',
      entryNo: row.entryNo || '',
      date: row.date,
      status: row.status,
      narration: row.narration || '',
    };
  }

  async postJournalEntry(input: JournalEntryInput): Promise<JournalEntryRef> {
    /* The payroll book and the control accounts, for a company that has never
       posted payroll. Idempotent, so it costs a lookup. */
    await ensureLedgerSetup(this.accountId, input.companyId, input.userId);

    const entry = await postEntry({
      accountId: this.accountId,
      orgId: input.companyId,
      branchId: input.branchId,
      userId: input.userId,
      date: input.date,
      journalCode: input.journalCode,
      narration: input.narration,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
      lines: input.lines,
    });

    return { id: entry.id, number: (entry as any).entryNo || '', status: (entry as any).status || 'POSTED' };
  }
}

/**
 * How Payroll gets its client.
 *
 * A function rather than a singleton so the tenant is explicit at every call
 * site, and so a test can hand in its own implementation without a module
 * mock.
 */
export const accountingFor = (accountId: string): AccountingClient => new LocalAccountingClient(accountId);
