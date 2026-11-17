import { Prisma } from '@prisma/client';

import { prisma } from '../../utils/prisma.js';

/**
 * Documents whose amount sits in the ledger more often than it should, left
 * by the reversal-of-a-reversal fault fixed on 17 Nov 2026 (PR #292).
 *
 * Until then, editing, cancelling or deleting a bill, expense, credit note,
 * debit note or invoice looked up "the posted entries of this document" and
 * reversed them all. A reversal is itself a posted entry of the document, so
 * the second such change reversed the first reversal, which put the first
 * amount back. Nothing in the ledger looks wrong entry by entry: every entry
 * balances and the chain of hashes holds. The fault only shows per document.
 *
 * How it is found. Every posting of a document that is not itself a reversal
 * is a "root". Count the reversals stacked on it: none, it stands; one, it is
 * cancelled out; two, it stands again; and so on. A root reversed an even
 * number of times, two or more, is an amount that came back. It is extra
 * unless it is all the document has: an invoice cancelled, put back, cancelled
 * and put back again is live with exactly that one posting standing.
 *
 * Read only. What to post to put a company's books right depends on closed
 * periods and filed returns, so a person decides; this says where to look.
 *
 * The caller sets the company scope: inside a request for one company it sees
 * that company; in a job, a script or `outsideTenant`, every company.
 */

/** The documents the faulty lookups served, and the table each lives in. */
const TABLE = { BILL: 'bill', EXPENSE: 'expense', CREDIT_NOTE: 'creditNote', DEBIT_NOTE: 'debitNote', INVOICE: 'invoice' } as const;
export type DoubledKind = keyof typeof TABLE;
const KINDS = Object.keys(TABLE) as DoubledKind[];

export type DoubledDocument = {
  accountId: string;
  orgId: string;
  kind: DoubledKind;
  docId: string;
  /** Postings standing in the ledger that should not be. */
  extra: number;
  /** The document is still there and not cancelled. */
  live: boolean;
  /** Date of the earliest posting that came back (YYYY-MM-DD). */
  date: string;
};

/**
 * How many of a document's postings are extra.
 * `depths`: for each root posting, the number of reversals stacked on it.
 */
export function extraPostings(depths: number[], live: boolean): number {
  const back = depths.filter((d) => d >= 2 && d % 2 === 0).length;
  if (!back) return 0;
  const untouched = depths.filter((d) => d === 0).length;
  /* Live, and the postings that came back are all it has: they stand in for the one it should have. */
  if (live && !untouched) return Math.max(0, back - 1);
  return back;
}

export async function doubledDocuments(opts: { orgId?: string } = {}): Promise<DoubledDocument[]> {
  /* Only a document with a reversal of a reversal can be affected: found in the database, so a clean ledger costs one query. */
  const touched = await prisma.$queryRaw<Array<{ orgId: string; sourceDocType: string; sourceDocId: string }>>(Prisma.sql`
    SELECT DISTINCT e."orgId", e."sourceDocType", e."sourceDocId"
    FROM "JournalEntry" e
    JOIN "JournalEntry" c ON c."id" = e."reversesId"
    WHERE c."reversesId" IS NOT NULL
      AND e."sourceDocId" IS NOT NULL
      AND e."sourceDocType" IN (${Prisma.join(KINDS)})
      ${opts.orgId ? Prisma.sql`AND e."orgId" = ${opts.orgId}` : Prisma.empty}
  `);
  if (!touched.length) return [];

  const key = (orgId: string, kind: string, docId: string) => `${orgId}|${kind}|${docId}`;
  const wanted = new Set(touched.map((t) => key(t.orgId, t.sourceDocType, t.sourceDocId)));
  const entries = (
    await prisma.journalEntry.findMany({
      where: { orgId: { in: [...new Set(touched.map((t) => t.orgId))] }, sourceDocType: { in: KINDS }, sourceDocId: { in: [...new Set(touched.map((t) => t.sourceDocId))] } },
      select: { id: true, accountId: true, orgId: true, date: true, reversesId: true, sourceDocType: true, sourceDocId: true },
    })
  ).filter((e) => wanted.has(key(e.orgId, e.sourceDocType!, e.sourceDocId!)));

  /* reverser.get(x): the entry that reverses x. `reversesId` is unique, so there is at most one. */
  const reverser = new Map(entries.filter((e) => e.reversesId).map((e) => [e.reversesId!, e.id]));
  const depthOf = (id: string) => {
    let depth = 0;
    for (let at = reverser.get(id); at && depth <= entries.length; at = reverser.get(at)) depth += 1;
    return depth;
  };

  type Doc = { accountId: string; orgId: string; kind: DoubledKind; docId: string; roots: Array<{ depth: number; date: string }> };
  const docs = new Map<string, Doc>();
  for (const e of entries) {
    if (e.reversesId) continue;
    const k = key(e.orgId, e.sourceDocType!, e.sourceDocId!);
    const doc = docs.get(k) || { accountId: e.accountId, orgId: e.orgId, kind: e.sourceDocType as DoubledKind, docId: e.sourceDocId!, roots: [] };
    doc.roots.push({ depth: depthOf(e.id), date: e.date });
    docs.set(k, doc);
  }

  /* Which of those documents are still there and not cancelled. */
  const live = new Set<string>();
  for (const kind of KINDS) {
    const of = [...docs.values()].filter((d) => d.kind === kind);
    if (!of.length) continue;
    const rows: Array<{ id: string; orgId: string; status: string | null }> = await (prisma as any)[TABLE[kind]].findMany({
      where: { id: { in: of.map((d) => d.docId) } },
      select: { id: true, orgId: true, status: true },
    });
    for (const r of rows) if (String(r.status || '').toLowerCase() !== 'cancelled') live.add(key(r.orgId, kind, r.id));
  }

  const out: DoubledDocument[] = [];
  for (const [k, d] of docs) {
    const isLive = live.has(k);
    const extra = extraPostings(d.roots.map((r) => r.depth), isLive);
    if (!extra) continue;
    const back = d.roots.filter((r) => r.depth >= 2 && r.depth % 2 === 0).map((r) => r.date).sort();
    out.push({ accountId: d.accountId, orgId: d.orgId, kind: d.kind, docId: d.docId, extra, live: isLive, date: back[0] });
  }
  return out.sort((a, b) => a.orgId.localeCompare(b.orgId) || a.date.localeCompare(b.date));
}
