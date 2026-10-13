/**
 * One rounding rule, in one place.
 *
 * There were five definitions of `round2` in the browser alone and nine more
 * on the server, in two versions that disagree: `Math.round(n * 100) / 100`
 * makes ₹1.005 into ₹1.00, and the variant with `Number.EPSILON` makes it
 * ₹1.01. Which one an amount met depended on which file computed it — so a
 * figure could be rounded two ways between a form and its ledger entry, and
 * the two could differ by a paisa. A ledger out by a paisa is not a rounding
 * difference; it is an entry that does not balance.
 *
 * The rule is the one a person with a pen uses: half away from zero, at the
 * paisa. `Math.round` cannot express it — it rounds a half toward positive
 * infinity, so −0.5 becomes −0 — and it cannot see through binary
 * representation, where 1.005 * 100 is 100.49999999999999.
 *
 * It is the same rule, written the same way, as server/src/utils/money.ts.
 * Two languages, one arithmetic.
 */

/** Below this, a difference is binary representation rather than money. */
const BINARY_SLOP = 1e-9;

/** Rupees to whole paise, where addition is exact. */
export const toPaise = (rupees) => {
  const x = Number(rupees);
  if (!Number.isFinite(x)) return 0;
  const scaled = x * 100;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + BINARY_SLOP);
};

/** Paise back to rupees, for a field, a total or the API. */
export const fromPaise = (paise) => {
  const p = Number(paise);
  if (!Number.isFinite(p)) return 0;
  return Math.trunc(p) / 100;
};

/** A rupee amount, rounded to the paisa. The only rounding in the app. */
export const round2 = (n) => fromPaise(toPaise(n));

/**
 * A total that does not drift.
 *
 * 0.1 + 0.2 is 0.30000000000000004, and a hundred invoice lines can land a few
 * paise from where they belong. Summed as integers, they cannot.
 */
export const sumMoney = (values) => {
  let paise = 0;
  for (const v of values || []) paise += toPaise(v);
  return fromPaise(paise);
};

/** Exact equality at the paisa, which `===` on floats is not. */
export const moneyEquals = (a, b) => toPaise(a) === toPaise(b);

/**
 * Split an amount by weights so the parts add back to the whole.
 *
 * Rounding each share on its own loses or invents a paisa — ₹10 three ways is
 * ₹3.33 three times, which is ₹9.99. The remainder goes out a paisa at a time,
 * largest fractional part first, so a GST split always foots.
 */
export const allocate = (total, weights) => {
  const totalPaise = toPaise(total);
  const w = (weights || []).map((x) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const weightSum = w.reduce((t, n) => t + n, 0);
  if (!weightSum || !totalPaise) return w.map(() => 0);

  const exact = w.map((n) => (totalPaise * n) / weightSum);
  const out = exact.map((n) => Math.floor(n));
  let remainder = totalPaise - out.reduce((t, n) => t + n, 0);

  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out.map(fromPaise);
};

export const getCurrencyCode = (_company) => {
  return 'INR';
};

export const formatMoney = (amount, company) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const currency = getCurrencyCode(company);

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `₹${safe.toFixed(2)}`;
  }
};

/**
 * Compact money for KPI figures: ₹13.3L, ₹1.34Cr.
 *
 * A dashboard number is read at a glance, and eleven digits at 42px is a
 * number nobody reads — it is a number they measure. Indian units (lakh,
 * crore) rather than M/B, because that is how the figure gets said out loud
 * by the people using this. The exact amount stays available in the tables and
 * in the tooltip, so precision is never lost, only deferred.
 */
export const formatMoneyCompact = (amount, company) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);

  const symbol = (() => {
    try {
      return (
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: getCurrencyCode(company) })
          .formatToParts(0)
          .find((p) => p.type === 'currency')?.value || '₹'
      );
    } catch {
      return '₹';
    }
  })();

  // Trim a trailing ".0" so 13.0L reads as 13L.
  const trim = (n, dp) => String(Number(n.toFixed(dp))).replace(/\.0$/, '');

  if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5, 2)}L`;
  if (abs >= 1000) return `${sign}${symbol}${trim(abs / 1000, 1)}K`;
  return `${sign}${symbol}${trim(abs, 0)}`;
};

/**
 * Indian numbering, because "One Lakh Twenty One Thousand" is what a customer
 * here reads back to check the figure — "One Hundred Twenty One Thousand" is
 * the same number written for somebody else.
 */
const WORD_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const WORD_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const wordsUnder100 = (n) => (n < 20 ? WORD_ONES[n] : `${WORD_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${WORD_ONES[n % 10]}` : ''}`);
const wordsUnder1000 = (n) =>
  `${n > 99 ? `${WORD_ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${wordsUnder100(n % 100)}`;

export const amountInWordsInr = (value) => {
  const total = Number(value);
  if (!Number.isFinite(total)) return '';
  const negative = total < 0;
  // Work in paise from the start. Deriving them by subtracting the rupees
  // loses a half-paisa to floating point — 1.005 came out as "One Only".
  const paiseTotal = Math.round(Math.abs(total) * 100);
  let rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;

  const parts = [];
  [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].forEach(([size, name]) => {
    if (rupees >= size) {
      parts.push(`${wordsUnder1000(Math.floor(rupees / size))} ${name}`);
      rupees %= size;
    }
  });
  if (rupees) parts.push(wordsUnder1000(rupees));

  const body = parts.join(' ').replace(/\s+/g, ' ').trim() || 'Zero';
  const paiseText = paise ? ` and ${wordsUnder100(paise)} Paise` : '';
  return `${negative ? 'Minus ' : ''}Rupees ${body}${paiseText} Only`;
};
