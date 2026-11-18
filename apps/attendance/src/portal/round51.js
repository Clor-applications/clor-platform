/**
 * Round 51 style picks (18 Nov 2026) for bills in the employee app.
 * claimcutoff B: a bill older than 60 days is refused. The form stops it
 * before it is sent; the server does not check this yet.
 * foreigncur B: a card bill in another currency is typed as the rupee
 * amount on the card statement, so the form says so.
 */
export const CLAIM_CUTOFF_DAYS = 60;

export const RUPEE_HINT = 'Paid in another currency? Type the rupee amount from your card statement.';

/** The oldest bill day still accepted, as YYYY-MM-DD, counted back from today (YYYY-MM-DD). */
export function oldestBillDay(today) {
  const [y, m, d] = String(today).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - CLAIM_CUTOFF_DAYS);
  return t.toISOString().slice(0, 10);
}

/** True when the bill day is past the cutoff. */
export function billTooOld(spentOn, today) {
  const s = String(spentOn || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < oldestBillDay(today);
}

export const tooOldText = () => `Bills older than ${CLAIM_CUTOFF_DAYS} days can't be claimed.`;
