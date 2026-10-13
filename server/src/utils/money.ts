/**
 * One rounding rule, in one place.
 *
 * There were fifteen definitions of `round2` across this repository, in two
 * versions that disagree:
 *
 *   Math.round(n * 100) / 100                    // ₹1.005 → ₹1.00
 *   Math.round((n + Number.EPSILON) * 100) / 100 // ₹1.005 → ₹1.01
 *
 * Both look obviously correct. Which one a figure met depended on which file
 * computed it, so the same amount could be rounded two ways on its path from a
 * payslip to the ledger, and the two could differ by a paisa. A ledger that is
 * out by a paisa is not a rounding difference, it is an entry that does not
 * balance.
 *
 * The rule here is the one a person doing this by hand uses: **half away from
 * zero, at the paisa**. ₹1.005 is ₹1.01; −₹1.005 is −₹1.01. `Math.round` alone
 * cannot express it — it rounds half toward positive infinity, so −0.5 becomes
 * −0 — and neither can it see through binary representation, where 1.005 * 100
 * is 100.49999999999999 and rounds down.
 *
 * Money is carried as rupees at the edges, because that is what the database
 * column, the API and the user all say. Everything in between is counted in
 * **paise as integers**, where addition is exact and 0.1 + 0.2 is 0.3.
 */

/** Below this, a difference is binary representation rather than money. */
const BINARY_SLOP = 1e-9;

/**
 * Rupees to whole paise.
 *
 * The nudge is proportional to nothing — it is a fixed, tiny amount that
 * absorbs the error in `x * 100` without being large enough to move a figure
 * that was genuinely between two paise.
 */
export function toPaise(rupees: unknown): number {
  const x = Number(rupees);
  if (!Number.isFinite(x)) return 0;
  const scaled = x * 100;
  const magnitude = Math.abs(scaled) + BINARY_SLOP;
  return Math.sign(scaled) * Math.round(magnitude);
}

/** Paise back to rupees, for a column, an API or a screen. */
export function fromPaise(paise: number): number {
  const p = Number(paise);
  if (!Number.isFinite(p)) return 0;
  return Math.trunc(p) / 100;
}

/** A rupee amount, rounded to the paisa. The only rounding in the system. */
export function round2(rupees: unknown): number {
  return fromPaise(toPaise(rupees));
}

/**
 * A total that does not drift.
 *
 * Summing rounded rupees accumulates the error of every term:
 * 0.1 + 0.2 + 0.3 is 0.6000000000000001, and a hundred invoice lines can end
 * a few paise from where they should. Summed as integers, they cannot.
 */
export function sumMoney(values: Array<unknown>): number {
  let paise = 0;
  for (const v of values) paise += toPaise(v);
  return fromPaise(paise);
}

/** Exact equality at the paisa, which `===` on floats is not. */
export function moneyEquals(a: unknown, b: unknown): boolean {
  return toPaise(a) === toPaise(b);
}

/**
 * Split an amount by weights so the parts add back to the whole.
 *
 * Rounding each share independently loses or invents a paisa — three ways of
 * ₹10 is ₹3.33 three times, which is ₹9.99. The remainder is handed out one
 * paisa at a time, largest fractional part first, so the parts always sum to
 * the total exactly. It is the same method a tax authority uses, and the
 * reason a GST split can be trusted to foot.
 *
 * Zero total, zero weights, or negative weights all return zeros rather than
 * guessing, because there is no correct answer to give.
 */
export function allocate(total: unknown, weights: Array<unknown>): number[] {
  const totalPaise = toPaise(total);
  const w = weights.map((x) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const weightSum = w.reduce((t, n) => t + n, 0);

  if (!weightSum || !totalPaise) return w.map(() => 0);

  const exact = w.map((n) => (totalPaise * n) / weightSum);
  const floors = exact.map((n) => Math.floor(n));
  let remainder = totalPaise - floors.reduce((t, n) => t + n, 0);

  /* Largest fractional part first; ties go to the earlier line, so the split
     is the same every time it is computed. */
  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }

  return out.map(fromPaise);
}

/**
 * What a set of lines is out by, in paise.
 *
 * Zero means the entry balances. Anything else is the number to put in front
 * of somebody, rather than a boolean that hides how far off it is.
 */
export function balanceOf(debits: Array<unknown>, credits: Array<unknown>): number {
  return toPaise(sumMoney(debits)) - toPaise(sumMoney(credits));
}
