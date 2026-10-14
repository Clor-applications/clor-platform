import type { Prisma } from '@prisma/client';

/**
 * One row of bank-date history, written in the caller's transaction.
 *
 * Every reconcile route calls this with the before and after, so the history
 * and the reconciled state commit together or not at all. A call that changes
 * nothing — same state, same date — writes nothing.
 */

export type BankDateKind = 'PAYMENT' | 'STATEMENT' | 'CONTRA';

const iso = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const v = d instanceof Date ? d.toISOString() : String(d);
  return v.slice(0, 10) || null;
};

export async function recordBankDateChange(
  tx: Prisma.TransactionClient,
  opts: {
    accountId: string;
    orgId: string;
    kind: BankDateKind;
    sourceId: string;
    voucherNo?: string | null;
    ledgerAccountId?: string | null;
    transactionDate: string;
    before: { reconciled: boolean; bankDate: Date | string | null };
    after: { reconciled: boolean; bankDate: Date | string | null; statementRef?: string | null };
    userId: string;
  }
) {
  const prev = iso(opts.before.bankDate);
  const next = iso(opts.after.bankDate);
  if (opts.before.reconciled === opts.after.reconciled && prev === next) return;
  const action = !opts.after.reconciled ? 'UNRECONCILED' : opts.before.reconciled ? 'REDATED' : 'RECONCILED';
  await tx.bankDateAudit.create({
    data: {
      accountId: opts.accountId,
      orgId: opts.orgId,
      kind: opts.kind,
      sourceId: opts.sourceId,
      voucherNo: opts.voucherNo ?? null,
      ledgerAccountId: opts.ledgerAccountId ?? null,
      transactionDate: String(opts.transactionDate || '').slice(0, 10),
      previousBankDate: prev,
      bankDate: next,
      action,
      statementRef: opts.after.statementRef ?? null,
      byUserId: opts.userId,
    },
  });
}
