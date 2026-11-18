import { round2 } from '../../utils/money.js';

/**
 * Round 66: the labour codes' plain rules, in one place.
 *
 * "Wages" under the Code on Wages, 2019 (s. 2(y)) are basic pay, dearness
 * allowance and retaining allowance. Whatever is left out of wages and comes to
 * more than half of the whole pay is added back into wages. CLOR reads the
 * components a company marks "counts for gratuity" as its wages (they are
 * basic and DA in every usual structure).
 */
export function wagesCheck(wages: number, total: number) {
  const w = round2(Number(wages) || 0);
  const t = round2(Number(total) || 0);
  if (t <= 0) return null;
  const share = round2((w / t) * 100);
  const half = round2(t / 2);
  const belowHalf = w < half;
  return {
    wages: w,
    total: t,
    share,
    belowHalf,
    /* What the codes count as wages: never less than half the pay. */
    countedWages: belowHalf ? half : w,
    addedBack: belowHalf ? round2(half - w) : 0,
    explanation: belowHalf
      ? `Wages (basic and DA) are ${share}% of pay. The labour codes count at least half of pay as wages, so ₹${round2(half - w).toLocaleString('en-IN')} more is treated as wages for PF and gratuity.`
      : `Wages (basic and DA) are ${share}% of pay, at least half as the labour codes ask.`,
  };
}

/**
 * Payment of Wages Act, s. 5: wages are paid before the 7th day after the wage
 * period ends (the 10th where 1,000 or more people work). A pay day later than
 * that is a breach the company may not notice until an inspection.
 */
export function payDayCheck(paymentDay: number | null | undefined, headcount = 0) {
  const day = Number(paymentDay);
  if (!Number.isFinite(day) || day <= 0) return null;
  const limit = headcount >= 1000 ? 10 : 7;
  if (day <= limit) return null;
  return {
    limit,
    day,
    message: `Pay day is the ${ordinal(day)}. The law asks for salary by the ${ordinal(limit)} of the next month${limit === 10 ? ' for a company of 1,000 or more' : ''}.`,
  };
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
