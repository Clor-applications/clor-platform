/**
 * Round 66 (labour codes and statutory pay rules), the screen side.
 * The server works the same rules out (server/src/services/payroll/labourCodes.ts);
 * these say them on screens before anything is saved.
 */

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Payment of Wages Act, s. 5: salary by the 7th of the next month (the 10th with 1,000 or more people). */
export function payDayWarning(day, headcount = 0) {
  const d = Number(day);
  if (!Number.isFinite(d) || d <= 0) return '';
  const limit = headcount >= 1000 ? 10 : 7;
  if (d <= limit) return '';
  return `Pay day is the ${ordinal(d)}. The law asks for salary by the ${ordinal(limit)} of the next month${limit === 10 ? ' for a company of 1,000 or more' : ''}.`;
}

/** The legal last day to pay a period's salary: the 7th of the month after the period ends. */
export function payByDate(periodEnd) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(periodEnd || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, '0')}-07`;
}

/** A payroll paid after the legal date: words for a note on the run, or ''. */
export function latePayNote(run) {
  const by = payByDate(run?.period?.endDate);
  const on = String(run?.payrollDate || '').slice(0, 10);
  if (!by || !on || on <= by) return '';
  const [y, m, d] = by.split('-').map(Number);
  const when = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `This payroll is paid after ${when}. The law asks for salary by the 7th of the next month.`;
}

/** Held salaries on this payroll, and the ones that could still be held. */
export function holdable(slips = []) {
  const live = slips.filter((s) => s.status !== 'CANCELLED');
  return {
    held: live.filter((s) => s.heldAt && s.paymentStatus !== 'PAID'),
    open: live.filter((s) => !s.heldAt && s.paymentStatus !== 'PAID' && Number(s.netPay) > 0),
  };
}

/** Wages under half of pay (labour codes): the structure preview's check, in a sentence. */
export function wagesHalfWords(check) {
  if (!check || !check.belowHalf) return '';
  return check.explanation || `Wages are ${check.share}% of pay. The labour codes count at least half of pay as wages for PF and gratuity.`;
}
