import { prisma } from '../utils/prisma.js';
import type { DbClient } from '../utils/dbClient.js';
import { SETUP_CASH_BANK_CODES } from './ledger.js';

/**
 * Which ledger accounts a branch may actually receive money into.
 *
 * This was one `findMany` inside `/payment-modes`. POS now needs the same
 * answer to validate where a tender posts, and two copies of a rule about where
 * money may land would drift — one of them would be corrected and the other
 * would keep letting something through. So the rule lives here and both callers
 * read it.
 *
 * The rule, unchanged from the one `/payment-modes` has always applied:
 *
 *   - the account belongs to this organisation
 *   - it is a cash or bank account
 *   - it is active
 *   - it is not one of the setup control accounts. Setup creates Cash-in-Hand
 *     and Bank Accounts for every org so postings resolve; offering them here
 *     would invite a business to receive money into an account it never opened.
 *     They stay in the chart and keep taking control postings — they are just
 *     not choices.
 *   - it belongs to this branch, or to no branch at all
 *
 * That last clause carries the weight. Every ledger account in production today
 * is `branchId: null` — shared — so a rule demanding an exact branch match would
 * reject every account in the system. Shared stays eligible; an account a branch
 * has claimed as its own stays private to it.
 */

/** The tenders a point of sale can take, and what each may post into. */
export const POS_TENDERS = ['CASH', 'UPI', 'CARD'] as const;
export type PosTender = (typeof POS_TENDERS)[number];

/**
 * Cash belongs in a cash account; UPI and card arrive in a bank.
 *
 * Card is treated as received immediately, into a bank account, for this
 * version. Real card settlement lands a day or more later net of the
 * processor's fee, which wants a clearing account and a settlement document —
 * both recorded as future work rather than approximated here.
 */
export const TENDER_CONTROL_KIND: Record<PosTender, 'CASH' | 'BANK'> = {
  CASH: 'CASH',
  UPI: 'BANK',
  CARD: 'BANK',
};

export const isPosTender = (v: unknown): v is PosTender =>
  typeof v === 'string' && (POS_TENDERS as readonly string[]).includes(v);

export type ReceiptAccount = {
  id: string;
  code: string;
  name: string;
  controlKind: string | null;
  branchId: string | null;
};

/** Every account this branch may receive money into, in code order. */
export async function receiptAccountsFor(
  db: DbClient,
  opts: { orgId: string; branchId: string; controlKind?: 'CASH' | 'BANK' }
): Promise<ReceiptAccount[]> {
  return db.ledgerAccount.findMany({
    where: {
      orgId: opts.orgId,
      isActive: true,
      controlKind: opts.controlKind ? { equals: opts.controlKind } : { in: ['CASH', 'BANK'] },
      code: { notIn: SETUP_CASH_BANK_CODES },
      OR: [{ branchId: null }, { branchId: opts.branchId }],
    },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, controlKind: true, branchId: true },
  });
}

export class IneligibleAccount extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'IneligibleAccount';
  }
}

/**
 * Check one account against the rule, for a given tender, and say precisely
 * what is wrong when it fails.
 *
 * Deliberately a lookup rather than a filter over `receiptAccountsFor`: the
 * caller is validating a choice somebody already made, and "that account is not
 * in the list" is not something you can act on. Which clause it failed is.
 */
export async function assertAccountUsableForTender(
  db: DbClient,
  opts: { orgId: string; branchId: string; tender: PosTender; ledgerAccountId: string }
): Promise<ReceiptAccount> {
  const account = await db.ledgerAccount.findFirst({
    where: { id: opts.ledgerAccountId, orgId: opts.orgId },
    select: { id: true, code: true, name: true, controlKind: true, branchId: true, isActive: true },
  });

  // Same message whether it belongs to another organisation or does not exist:
  // which one it is, is not this caller's business to learn.
  if (!account) throw new IneligibleAccount('That account does not belong to this organisation.');
  if (!account.isActive) throw new IneligibleAccount(`${account.name} is no longer active.`);

  if (account.branchId && account.branchId !== opts.branchId) {
    throw new IneligibleAccount(`${account.name} belongs to another branch.`);
  }
  if (SETUP_CASH_BANK_CODES.includes(account.code)) {
    throw new IneligibleAccount(
      `${account.name} is a control account rather than one of your own. Open a cash or bank account to receive into.`
    );
  }

  const wanted = TENDER_CONTROL_KIND[opts.tender];
  if (account.controlKind !== wanted) {
    throw new IneligibleAccount(
      opts.tender === 'CASH'
        ? `Cash has to be received into a cash account; ${account.name} is not one.`
        : `${opts.tender} has to be received into a bank account; ${account.name} is not one.`
    );
  }

  const { isActive, ...usable } = account;
  return usable;
}

/** `/payment-modes` and anything else wanting the plain list. */
export const listReceiptAccounts = (opts: { orgId: string; branchId: string }) =>
  receiptAccountsFor(prisma, opts);
