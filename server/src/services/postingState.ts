import { Prisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';

/**
 * Has this document actually reached the books?
 *
 * The obvious query is wrong, and quietly so. A reversal copies the original's
 * `sourceDocType` and `sourceDocId`, so
 *
 *   where sourceDocId = X and status = 'POSTED'
 *
 * matches the contra entry as well as the original — and after a cancellation
 * the only row it matches *is* the contra, whose amounts are the negation of
 * the posting it undid. Anything asking "is this document in the books?" that
 * way gets `true` for a document whose effect has already been withdrawn.
 *
 * A reversal is not marked on itself. The only record of one is on the entry it
 * cancelled: `original.status = 'REVERSED'` and `original.reversedById` points
 * at the contra. So the contras are found by collecting every `reversedById` in
 * the document's own set of entries, and a live posting is one that is POSTED
 * and is not one of them.
 *
 * Document status is deliberately not consulted. A Draft invoice posts today
 * (audit P1-1), so `status === 'Draft'` does not mean "not in the books" — the
 * entries do.
 */

type Tx = Prisma.TransactionClient | typeof prisma;

export type LivePosting = {
  id: string;
  entryNo: string;
  date: string;
  branchId: string;
};

/**
 * Every posting for a document that still has an effect on the ledger:
 * posted, and not neutralised by a contra entry.
 */
export async function livePostingsFor(
  tx: Tx,
  opts: { accountId: string; orgId: string; sourceDocType: string; sourceDocId: string }
): Promise<LivePosting[]> {
  const entries = await tx.journalEntry.findMany({
    where: {
      accountId: opts.accountId,
      orgId: opts.orgId,
      sourceDocType: opts.sourceDocType,
      sourceDocId: opts.sourceDocId,
    },
    select: { id: true, entryNo: true, date: true, branchId: true, status: true, reversedById: true },
  });

  // Every contra this document's own entries point at.
  const contras = new Set(entries.map((e) => e.reversedById).filter((id): id is string => Boolean(id)));

  return entries
    .filter((e) => e.status === 'POSTED' && !contras.has(e.id))
    .map(({ id, entryNo, date, branchId }) => ({ id, entryNo, date, branchId }));
}

/** Whether the document currently has any effect on the ledger. */
export async function hasLivePosting(
  tx: Tx,
  opts: { accountId: string; orgId: string; sourceDocType: string; sourceDocId: string }
): Promise<boolean> {
  return (await livePostingsFor(tx, opts)).length > 0;
}
