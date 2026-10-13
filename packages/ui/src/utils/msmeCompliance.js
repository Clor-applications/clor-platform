import { round2 } from '@ui/utils/money';

export const MSME_BANK_RATE = 5.5;
export const MSME_STATUTORY_RATE = MSME_BANK_RATE * 3;

const DAY_MS = 86400000;

const utcDate = (value) => {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const addDays = (value, days) => {
  const date = utcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};

export const daysAfter = (dueDate, endDate) => {
  const due = utcDate(dueDate);
  const end = utcDate(endDate);
  if (!due || !end) return 0;
  return Math.max(0, Math.floor((end.getTime() - due.getTime()) / DAY_MS));
};

/**
 * Section 15 permits a written credit period up to 45 days. If the bill has
 * no written due date, the appointed day follows the 15-day acceptance period.
 * The application uses the recorded bill date as the acceptance date because
 * that is the acceptance evidence currently stored on a purchase bill.
 */
export const msmeDueDate = (bill) => {
  const accepted = String(bill?.acceptanceDate || bill?.date || '').slice(0, 10);
  if (!utcDate(accepted)) return { date: '', basis: 'Missing bill date' };
  const maximum = addDays(accepted, 45);
  const agreed = String(bill?.dueDate || '').slice(0, 10);
  if (utcDate(agreed)) {
    return {
      date: agreed > maximum ? maximum : agreed,
      basis: agreed > maximum ? 'Written term capped at 45 days' : 'Written payment term',
    };
  }
  return { date: addDays(accepted, 15), basis: 'Appointed day (15 days)' };
};

/** Section 16: compound interest with monthly rests at 3x RBI Bank Rate. */
export const estimateMsmeInterest = (principal, overdueDays, bankRate = MSME_BANK_RATE) => {
  const amount = Math.max(0, Number(principal) || 0);
  const days = Math.max(0, Number(overdueDays) || 0);
  if (!amount || !days) return 0;
  const monthlyRate = (Math.max(0, Number(bankRate) || 0) * 3) / 1200;
  return round2(amount * (Math.pow(1 + monthlyRate, days / (365 / 12)) - 1));
};

/**
 * Recalculate an obligation across effective-dated RBI Bank Rates. Entries
 * before a later rate retain their original rate; a new row affects only days
 * on and after its applicable date.
 */
export const estimateMsmeInterestWithRates = ({ principal, dueDate, endDate, rates = [] }) => {
  const amount = Math.max(0, Number(principal) || 0);
  const totalDays = daysAfter(dueDate, endDate);
  if (!amount || !totalDays) return 0;

  const ordered = (Array.isArray(rates) ? rates : [])
    .map((row) => ({ effectiveFrom: String(row?.effectiveFrom || '').slice(0, 10), bankRate: Number(row?.bankRate) }))
    .filter((row) => utcDate(row.effectiveFrom) && Number.isFinite(row.bankRate) && row.bankRate >= 0)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  let currentRate = MSME_BANK_RATE;
  for (const row of ordered) {
    if (row.effectiveFrom <= dueDate) currentRate = row.bankRate;
  }

  let cursor = dueDate;
  let compounded = amount;
  const changes = ordered.filter((row) => row.effectiveFrom > dueDate && row.effectiveFrom < endDate);
  for (const change of [...changes, { effectiveFrom: endDate, bankRate: null }]) {
    const days = daysAfter(cursor, change.effectiveFrom);
    const monthlyRate = (currentRate * 3) / 1200;
    compounded *= Math.pow(1 + monthlyRate, days / (365 / 12));
    cursor = change.effectiveFrom;
    if (change.bankRate !== null) currentRate = change.bankRate;
  }
  return round2(compounded - amount);
};

export const allocatedPaymentDate = (payments, bill) => {
  const billId = String(bill?.id ?? '');
  const billNumber = String(bill?.number || '').trim().toLowerCase();
  const dates = (Array.isArray(payments) ? payments : [])
    .filter((payment) => Number(payment?.companyId) === Number(bill?.companyId))
    .filter((payment) => (payment?.allocations || []).some((line) => {
      if (String(line?.voucherType || '').toLowerCase() !== 'bill') return false;
      return String(line?.voucherId ?? '') === billId || (billNumber && String(line?.documentNumber || '').trim().toLowerCase() === billNumber);
    }))
    .map((payment) => String(payment?.date || '').slice(0, 10))
    .filter((date) => utcDate(date))
    .sort();
  return dates.at(-1) || '';
};
