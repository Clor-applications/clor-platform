/**
 * Closing the books, and what that stops.
 *
 * A closed period is a promise: the numbers somebody reported for August will
 * still be those numbers in December. Keeping that promise means nothing dated
 * inside the closed stretch can be written, edited or removed — an invoice
 * backdated into a filed month changes a return that has already gone out.
 *
 * One date does the work. Everything on or before `closedUpto` is shut, which
 * covers both things people mean: closing last month on the fifth, and closing
 * a whole financial year at its end.
 *
 * It is a lock, not a wall — it can be lifted. The point is that reopening is
 * a decision somebody takes deliberately, rather than a backdated document
 * quietly rewriting a filed period.
 */

const asDate = (v) => String(v || '').slice(0, 10);

/** The company's close date, or '' when the books are open. */
export const closedUpto = (db, companyId) => {
  const lock = (db?.fyLocks || []).find((l) => Number(l?.companyId) === Number(companyId));
  return lock ? asDate(lock.upTo) : '';
};

/** Whether a document dated `date` falls inside the closed period. */
export const isDateLocked = (db, companyId, date) => {
  const upTo = closedUpto(db, companyId);
  const d = asDate(date);
  if (!upTo || !d) return false;
  return d <= upTo;
};

/**
 * The sentence to show when a save is refused.
 *
 * Named so every screen says the same thing: which date is shut, and what to
 * do about it. "Operation not permitted" tells nobody anything.
 */
export const lockedMessage = (db, companyId, date, what = 'This document') => {
  const upTo = closedUpto(db, companyId);
  return `${what} is dated ${asDate(date)}, inside books closed up to ${upTo}. Reopen the period under Settings → Financial Year to change it.`;
};

/**
 * Refuse the save, or allow it.
 *
 * Returns an error string when the date is inside a closed period and null
 * when it is not, so a caller reads as:
 *   const err = blockIfClosed(db, companyId, date, 'This invoice');
 *   if (err) { notify.error(err); return; }
 */
export const blockIfClosed = (db, companyId, date, what) =>
  isDateLocked(db, companyId, date) ? lockedMessage(db, companyId, date, what) : null;

/**
 * The financial years the books actually contain.
 *
 * Only years with something in them are offered: a picker listing every year
 * since the company was imagined is a list of empty reports. Derived from the
 * dates on the documents themselves rather than from a stored range, so it
 * cannot fall out of step with the books.
 *
 * `startMonth` is the month the year begins in (4 = April, the Indian default).
 */
export const fyLabel = (startYear, startMonth = 4) =>
  startMonth === 1 ? `FY ${startYear}` : `FY ${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;

export const fyOf = (date, startMonth = 4) => {
  const d = asDate(date);
  if (!d) return null;
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return month >= startMonth ? year : year - 1;
};

export const fyBounds = (startYear, startMonth = 4) => {
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${startYear}-${pad(startMonth)}-01`;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate();
  return { from, to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}` };
};

const DATED_COLLECTIONS = [
  'invoices',
  'bills',
  'expenses',
  'creditNotes',
  'debitNotes',
  'journalEntries',
  'payments',
  'receipts',
  'purchaseOrders',
  'salesOrders',
  'estimates',
  'stockAdjustments',
  'stockTransfers',
];

/** Financial years that have at least one document, newest first. */
export const fyOptions = (db, companyId, startMonth = 4) => {
  const years = new Set();
  for (const key of DATED_COLLECTIONS) {
    for (const row of Array.isArray(db?.[key]) ? db[key] : []) {
      if (Number(row?.companyId) !== Number(companyId)) continue;
      const y = fyOf(row?.date, startMonth);
      if (y !== null) years.add(y);
    }
  }
  // The year in progress belongs on the list even before anything is raised
  // in it, because that is the year somebody is about to work in.
  const today = new Date();
  const currentFy = fyOf(today.toISOString().slice(0, 10), startMonth);
  if (currentFy !== null) years.add(currentFy);

  return [...years]
    .sort((a, b) => b - a)
    .map((y) => ({ year: y, label: fyLabel(y, startMonth), ...fyBounds(y, startMonth) }));
};

/** The month a company's financial year starts in, from its own settings. */
export const fyStartMonth = (company) => {
  const raw = String(company?.fiscalYearStart || '').trim();
  const mm = raw.includes('-') ? Number(raw.split('-')[0]) : NaN;
  return Number.isFinite(mm) && mm >= 1 && mm <= 12 ? mm : 4;
};
