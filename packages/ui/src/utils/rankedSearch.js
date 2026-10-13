/**
 * One ranking rule for every searchable list in the product.
 *
 * Every picker used to do the same thing: lowercase a haystack, call
 * `.includes`, and hand back whatever order the array happened to be in. That
 * is fine with nine customers and useless with nine hundred — typing "ram"
 * put "Sundaram Traders" above "Ram Kumar" because S sorts before R, and the
 * operator's hand went back to the mouse.
 *
 * The order below is the order a person expects, and it is the order the
 * review sheet asked for:
 *
 *   1. the exact thing they typed
 *   2. something that starts with it
 *   3. a word inside it that starts with it   ("kumar" finds "Ram Kumar")
 *   4. a code or SKU that starts with it       (codes are typed, not read)
 *   5. anything that merely contains it
 *   6. a fuzzy subsequence                     ("rmkr" finds "Ram Kumar")
 *
 * Fuzzy is last and deliberately strict — it only fires when nothing better
 * matched, because a subsequence match on a short query matches almost
 * everything and turning it loose makes the list feel random.
 *
 * Ties inside a tier keep the caller's own order, so an alphabetical list
 * stays alphabetical and a recency-sorted one stays recent-first.
 */

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Tier numbers. Lower is better; MISS means the row is dropped. */
const EXACT = 0;
const PREFIX = 1;
const WORD_PREFIX = 2;
const CODE_PREFIX = 3;
const CONTAINS = 4;
const FUZZY = 5;
const MISS = 99;

/**
 * Every character of `q` appears in `text`, in order.
 *
 * Deliberately not scored by gap size: the only thing a subsequence match
 * earns here is a place at the bottom of the list, so a cleverer score would
 * change nothing a user could see.
 */
const isSubsequence = (q, text) => {
  if (!q) return true;
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j += 1) {
    if (text[j] === q[i]) i += 1;
  }
  return i === q.length;
};

/** Where the query lands against one string. */
const tierFor = (query, text) => {
  if (!text) return MISS;
  if (text === query) return EXACT;
  if (text.startsWith(query)) return PREFIX;
  // Word boundaries, so a surname or the second half of a company name is
  // reachable without typing the first half.
  if (text.split(/[\s\-/.,()]+/).some((w) => w && w.startsWith(query))) return WORD_PREFIX;
  if (text.includes(query)) return CONTAINS;
  return MISS;
};

/**
 * Rank and filter `rows` against `query`.
 *
 * `fields(row)` returns the strings to match on, most identifying first — a
 * name before an email. `codes(row)` returns the identifiers a person types
 * rather than reads: an item SKU, an account code, a GSTIN. They rank above a
 * loose substring because somebody typing "FG-100" means that SKU and nothing
 * else.
 *
 * An empty query returns the rows untouched, in their original order.
 */
export function rankedSearch(rows, query, { fields, codes = null, limit = 0 } = {}) {
  const q = norm(query);
  const list = Array.isArray(rows) ? rows : [];
  if (!q) return limit > 0 ? list.slice(0, limit) : list;

  const scored = [];

  list.forEach((row, index) => {
    const texts = (fields ? fields(row) : []).map(norm).filter(Boolean);
    const codeTexts = (codes ? codes(row) : []).map(norm).filter(Boolean);

    let best = MISS;

    // The first field is the identifying one, so a hit there beats the same
    // kind of hit on an email three fields down. Later fields are demoted by
    // a hair — enough to break a tie, not enough to cross a tier.
    texts.forEach((text, fieldIndex) => {
      const tier = tierFor(q, text);
      if (tier === MISS) return;
      const score = tier + Math.min(fieldIndex, 3) * 0.1;
      if (score < best) best = score;
    });

    codeTexts.forEach((code) => {
      if (code === q) { if (EXACT < best) best = EXACT; return; }
      if (code.startsWith(q) && CODE_PREFIX < best) best = CODE_PREFIX;
      else if (code.includes(q) && CONTAINS < best) best = CONTAINS;
    });

    // Only worth trying when nothing literal matched at all.
    if (best === MISS && q.length >= 2) {
      const hit = texts.some((t) => isSubsequence(q, t)) || codeTexts.some((t) => isSubsequence(q, t));
      if (hit) best = FUZZY;
    }

    if (best !== MISS) scored.push({ row, score: best, index });
  });

  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
  const out = scored.map((s) => s.row);
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * True when the query names exactly one row well enough to choose it without
 * being asked — an exact hit, or the only match there is.
 *
 * Used for the "smart auto-selection" the sheet describes: typing a full code
 * and pressing Tab should not stop to make you confirm the one thing it found.
 */
export function soleConfidentMatch(rows, query, opts = {}) {
  const q = norm(query);
  if (!q) return null;
  const ranked = rankedSearch(rows, q, opts);
  if (!ranked.length) return null;

  const fields = opts.fields || (() => []);
  const codes = opts.codes || (() => []);
  const exact = ranked.filter(
    (r) => fields(r).some((f) => norm(f) === q) || codes(r).some((c) => norm(c) === q)
  );
  if (exact.length === 1) return exact[0];
  if (ranked.length === 1) return ranked[0];
  return null;
}

export default rankedSearch;
