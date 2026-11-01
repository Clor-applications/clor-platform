
/**
 * Recurring invoices, materialised as drafts.
 *
 * A template is a snapshot of an invoice marked "repeat monthly". On sign-in
 * this raises a DRAFT for every period that has come due since the last run —
 * drafts, deliberately: nothing posts to the ledger until a person reviews
 * and saves each one, so a forgotten template cannot quietly bill a customer
 * for months.
 *
 * Catch-up is bounded (12 periods) so a template dormant for years cannot
 * flood the invoice list.
 */

const addMonths = (iso, n) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, lastDay)); // Jan 31 + 1mo = Feb 28, not Mar 3
  return date.toISOString().slice(0, 10);
};

/**
 * Next run for a template's frequency.
 *
 * `interval` is how many of those periods to skip — every second month, every
 * third week. One is the default and the common case; the argument exists
 * because "quarterly" and "every 3 months" are the same thing to a calendar
 * but not to the person setting it up, and a schedule that bills every 45 days
 * has no frequency name at all.
 */
export const advanceRunDate = (iso, frequency, interval = 1) => {
  const n = Math.max(1, Math.floor(Number(interval) || 1));
  switch (String(frequency || 'MONTHLY')) {
    case 'WEEKLY': {
      const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7 * n);
      return d.toISOString().slice(0, 10);
    }
    case 'QUARTERLY':
      return addMonths(iso, 3 * n);
    case 'YEARLY':
      return addMonths(iso, 12 * n);
    default:
      return addMonths(iso, 1 * n);
  }
};
