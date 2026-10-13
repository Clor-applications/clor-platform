import { round2 } from './money';

/**
 * Matching a bank statement against the book.
 *
 * What the product had was an *import*: statement rows became new transactions,
 * with a warning if they looked like duplicates and an import anyway. For a
 * book that already records its receipts and payments — which is the whole
 * point of the product — that is the wrong operation. It doubles the money.
 *
 * Reconciliation is the other one: nothing is created, the two sides are
 * matched, and what is left over on each side is the answer. A statement line
 * with no book entry is money that moved and was never recorded. A book entry
 * with no statement line is a cheque that has not cleared. Those two lists,
 * and the difference they explain, are what an accountant signs.
 *
 * The rules, in the order they are applied:
 *
 * 1. **Direction must agree.** ₹5,000 in and ₹5,000 out are not a match at any
 *    tolerance, and treating them as one hides two errors instead of finding
 *    them.
 * 2. **Amount to the paisa.** Bank charges are their own line, not a rounding
 *    allowance on somebody else's.
 * 3. **Date within a window**, default five days. A cheque is written on the
 *    day it is handed over and clears when the bank gets round to it.
 * 4. **Nearest date wins**, then the closest narration. Two identical amounts
 *    in one week is ordinary — a rent payment and its reversal — so the
 *    tie-break has to be deterministic or the same statement reconciles
 *    differently on two machines.
 * 5. **One to one, always.** A book entry that has been matched is out of the
 *    pool. Without this, one payment silently reconciles three statement lines
 *    and the difference still comes to zero.
 */

export const DEFAULT_DATE_WINDOW_DAYS = 5;

const dayNumber = (iso) => {
  const t = Date.parse(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
};

/** Narration as it can be compared: no case, no punctuation, no double spaces. */
export const normalizeNarration = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * How alike two narrations are, 0 to 1, by shared words.
 *
 * Deliberately not an edit distance: a bank writes `NEFT-ACME TRADERS-12345`
 * where the book says `Acme Traders`, and those are far apart character by
 * character and obviously the same payment. Shared words find that; character
 * distance does not.
 */
export const narrationScore = (a, b) => {
  const wa = new Set(normalizeNarration(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(normalizeNarration(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
};

const amountOf = (row) => round2(Math.abs(Number(row?.amount ?? 0)));
const directionOf = (row) => String(row?.direction || '').trim().toUpperCase();

/**
 * @param statement rows read off the bank statement
 * @param book      entries the books already hold for this account
 * @param dateWindowDays how late a cheque may clear and still be the same money
 * @returns { matched, statementOnly, bookOnly }
 */
export function matchStatement({ statement, book, dateWindowDays = DEFAULT_DATE_WINDOW_DAYS } = {}) {
  const stmt = Array.isArray(statement) ? statement : [];
  const bk = Array.isArray(book) ? book : [];
  const window = Number.isFinite(Number(dateWindowDays)) ? Math.max(0, Number(dateWindowDays)) : DEFAULT_DATE_WINDOW_DAYS;

  const takenBook = new Set();
  const matched = [];
  const statementOnly = [];

  /*
   * Statement rows are considered oldest first so that when two book entries
   * could serve one line, the older statement line takes the older entry. The
   * alternative leaves the pairing dependent on the order the file happened to
   * arrive in.
   */
  const ordered = stmt
    .map((row, index) => ({ row, index }))
    .sort((a, b) => String(a.row?.date || '').localeCompare(String(b.row?.date || '')) || a.index - b.index);

  for (const { row } of ordered) {
    const amount = amountOf(row);
    const direction = directionOf(row);
    const day = dayNumber(row?.date);

    let best = null;
    for (const candidate of bk) {
      const key = String(candidate?.id ?? '');
      if (takenBook.has(key)) continue;
      if (directionOf(candidate) !== direction) continue;
      if (amountOf(candidate) !== amount) continue;
      const candidateDay = dayNumber(candidate?.date);
      const gap = day === null || candidateDay === null ? null : Math.abs(candidateDay - day);
      if (gap === null || gap > window) continue;

      const score = narrationScore(row?.narration ?? row?.description, candidate?.narration ?? candidate?.description);
      const better =
        !best ||
        gap < best.gap ||
        (gap === best.gap && score > best.score) ||
        // Last resort so the result cannot depend on array order.
        (gap === best.gap && score === best.score && key < String(best.entry?.id ?? ''));
      if (better) best = { entry: candidate, gap, score };
    }

    if (best) {
      takenBook.add(String(best.entry?.id ?? ''));
      matched.push({
        statement: row,
        book: best.entry,
        dayGap: best.gap,
        narrationScore: round2(best.score),
        /*
         * Same day and a recognisable narration is a match anyone would make
         * without thinking. Anything else is offered, not assumed — an
         * accountant confirms it.
         */
        confident: best.gap === 0 && best.score >= 0.5,
      });
    } else {
      statementOnly.push(row);
    }
  }

  const bookOnly = bk.filter((b) => !takenBook.has(String(b?.id ?? '')));
  return { matched, statementOnly, bookOnly };
}

/**
 * The statement an accountant signs.
 *
 * Balance per the books, plus what the bank has not seen yet, less what the
 * books have not recorded yet, equals the balance per the statement. If it does
 * not, `difference` is what is unexplained — and that number, not a list of
 * ticks, is the reason the exercise exists.
 *
 * Signed by direction, not by which list a row sits in: an uncleared receipt
 * and an uncleared payment move the reconciliation opposite ways.
 */
const signedTotal = (rows) =>
  round2(
    (Array.isArray(rows) ? rows : []).reduce(
      (sum, r) => sum + (directionOf(r) === 'OUT' ? -amountOf(r) : amountOf(r)),
      0
    )
  );

export function reconciliationSummary({ bookBalance, statementBalance, statementOnly, bookOnly } = {}) {
  const book = round2(Number(bookBalance ?? 0));
  const statement = round2(Number(statementBalance ?? 0));

  // In the books, not yet on the statement: cheques issued that have not been
  // presented, deposits not yet credited.
  const unpresented = signedTotal(bookOnly);
  // On the statement, not yet in the books: charges, interest, direct credits.
  const unrecorded = signedTotal(statementOnly);

  const expected = round2(book - unpresented + unrecorded);
  return {
    bookBalance: book,
    statementBalance: statement,
    unpresented,
    unrecorded,
    expected,
    difference: round2(statement - expected),
    reconciled: Math.abs(round2(statement - expected)) < 0.005,
  };
}
