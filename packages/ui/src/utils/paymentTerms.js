/**
 * Due date from a party's payment terms.
 *
 * Mirrors the server's `dueDateFor` in server/src/routes/parties.ts, which is
 * the authority — the server recomputes the due date when an invoice is
 * created so the browser cannot quietly extend credit. This copy exists so the
 * form can show the operator the same date before they save, rather than a
 * fixed +30 days that the server then silently changes.
 */

/** Used when a party has no terms of its own. */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

/** Reads terms off a local party record, tolerating a missing or junk value. */
export const termDaysFor = (party, fallback = DEFAULT_PAYMENT_TERM_DAYS) => {
  const raw = party?.paymentTermDays;
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(365, Math.trunc(n));
};

/**
 * `dateIso` + `days`, as YYYY-MM-DD.
 *
 * Built in UTC on purpose: constructing from the local timezone shifts the
 * result by a day for anyone east or west of UTC around midnight.
 */
export const addDays = (dateIso, days) => {
  const base = new Date(`${String(dateIso || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + Math.max(0, Number(days) || 0));
  return base.toISOString().slice(0, 10);
};

/** Convenience: due date for a document dated `dateIso` billed to `party`. */
export const dueDateFor = (dateIso, party, fallback = DEFAULT_PAYMENT_TERM_DAYS) =>
  addDays(dateIso, termDaysFor(party, fallback));

/** "Net 30" / "Due on receipt", for showing why a date was chosen. */
export const termsLabel = (party, fallback = DEFAULT_PAYMENT_TERM_DAYS) => {
  const named = String(party?.paymentTermName || '').trim();
  if (named) return named;
  const days = termDaysFor(party, fallback);
  return days === 0 ? 'Due on receipt' : `Net ${days}`;
};
