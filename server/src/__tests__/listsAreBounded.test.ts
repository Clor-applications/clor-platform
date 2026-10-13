import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = join(dirname(dirname(fileURLToPath(import.meta.url))), 'routes');

/*
 * A read of something that grows with trading has to have a ceiling.
 *
 * An unbounded `findMany` is fine on the books it was written against and a
 * problem on real ones: the response grows with the customer's business, so the
 * slowest and heaviest request is the one their best month produces. It is also
 * the cheapest denial of service in any product — one GET, and the server
 * builds an arbitrarily large response.
 *
 * Scoped deliberately to the models that grow. A first version of this test
 * demanded a ceiling on every `findMany` in the routes and flagged sixty,
 * nearly all of them reference reads — the roles in an org, the branches on an
 * account, the permission catalogue. A rule that fires on that much is one
 * people learn to wave through, and a waved-through rule protects nothing.
 *
 * These are the tables whose row count is set by how much business the customer
 * does, rather than by how they configured the product.
 */
const GROWS_WITH_TRADING = [
  'invoice',
  'bill',
  'payment',
  'journalEntry',
  'journalLine',
  'itemMaster',
  'party',
  'auditLog',
  'bankBookEntry',
  'estimate',
  'salesOrderDoc',
  'purchaseOrderDoc',
  'deliveryChallan',
  'creditNote',
  'debitNote',
  'expense',
];

/** The body of a findMany call, brace-matched rather than guessed at. */
const growingFindManys = (text: string) => {
  const found: Array<{ body: string; at: number }> = [];
  const re = new RegExp(`prisma\\.(${GROWS_WITH_TRADING.join('|')})\\.findMany\\(\\{`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push({ body: text.slice(m.index, i + 1), at: m.index });
          break;
        }
      }
    }
  }
  return found;
};

/*
 * Bounded by what was asked for rather than by a page size.
 *
 * A read filtered to one record — one document's journal entries, one
 * schedule's runs — can only return what that record has. Tenant columns are
 * deliberately not in this list: `accountId` and `orgId` scope a query without
 * limiting it at all, which is the whole problem.
 *
 * `ledgerAccountId` is not here either, and that one is worth saying out loud:
 * it looks like a record id and behaves like a tenant column. One account's
 * journal lines are every transaction it has ever carried, which is precisely
 * the list that needed a ceiling.
 */
const RECORD_IDS = [
  'id',
  'docId',
  'sourceDocId',
  'invoiceId',
  'paymentId',
  'scheduleId',
  'entryId',
  'partyId',
];

/** The `where` object alone, brace-matched. */
const whereClause = (body: string) => {
  const at = body.indexOf('where:');
  if (at === -1) return '';
  const open = body.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  return '';
};

const boundedByInput = (body: string) => {
  /*
   * The where object alone, not everything after the word `where`.
   *
   * Slicing to the end of the call swept in `orderBy: [{ id: 'asc' }]` and
   * `include: { entry: { select: { id: true } } }` — so an ordering clause
   * exempted the query, and the general ledger passed this test with no
   * ceiling at all.
   */
  const where = whereClause(body);
  if (!where) return false;
  return RECORD_IDS.some((f) => new RegExp(`\\b${f}:\\s*(?!true\\b|false\\b)\\S`).test(where));
};

/*
 * And the exception that has to be argued for at the call site.
 *
 * A revaluation needs every open position or its answer is wrong, so a ceiling
 * there would be a bug. A per-file exemption list would rot — it would quietly
 * cover the next query added to that file — so the reason goes on the line, in
 * front of whoever reviews it.
 *
 *   // bounded: why this one genuinely needs all of them
 */
const hasStatedReason = (text: string, at: number) =>
  // Either comment style: what matters is that a reason is written down.
  /(\/\/|\*)\s*bounded:/.test(text.slice(Math.max(0, at - 600), at));

/*
 * A whole file may be exempt, but only where the file is one operation.
 *
 * `bounded-file:` at the top of dataExport.ts covers the twenty-six reads that
 * make up a company's export — they are one act, no ceiling on any of them
 * would be right, and marking each line would be noise nobody reads.
 *
 * This is the per-file exemption I argued against elsewhere, and the difference
 * is worth stating: the objection to exempting a file is that it quietly covers
 * whatever gets added later. Here, whatever gets added later IS part of the
 * same export. Use it only where that is true — a file that does one thing —
 * and never as a way to silence a file that has several jobs.
 */
const fileIsOneBoundedOperation = (text: string) =>
  /(\/\/|\*)\s*bounded-file:/.test(text.slice(0, 2500));

describe('reads of things that grow with trading', () => {
  it('ask the database for a bounded number of rows', () => {
    const unbounded: string[] = [];
    for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(ROUTES, file), 'utf8');
      if (fileIsOneBoundedOperation(text)) continue;
      for (const { body, at } of growingFindManys(text)) {
        // A spread page (…pageParams) counts: the take is inside it.
        if (/\btake\b/.test(body) || /\.\.\.page\b/.test(body)) continue;
        if (boundedByInput(body)) continue;
        if (hasStatedReason(text, at)) continue;
        unbounded.push(`${file}: ${body.slice(0, 90).replace(/\s+/g, ' ')}…`);
      }
    }
    expect(unbounded).toEqual([]);
  });

  it('finds those reads at all, so an empty pass cannot look like a pass', () => {
    const total = readdirSync(ROUTES)
      .filter((f) => f.endsWith('.ts'))
      .reduce((n, f) => n + growingFindManys(readFileSync(join(ROUTES, f), 'utf8')).length, 0);
    expect(total).toBeGreaterThan(8);
  });
});
