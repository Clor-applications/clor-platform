/**
 * The two cash limits Indian law puts on a business, and what they cost.
 *
 * Neither is a soft guideline, and neither was checked anywhere in the product.
 * Both are silent in the sense that matters: nothing goes wrong at the moment
 * of entry, and the consequence arrives at assessment.
 *
 *   Section 40A(3) — paying cash
 *       A cash payment above 10,000 rupees to one person in one day against one
 *       expense is DISALLOWED as a deduction. Not reduced, disallowed: the
 *       whole expense stops being deductible. The ceiling is 35,000 where the
 *       payment is to a transporter for hiring, leasing or plying goods
 *       vehicles. Rule 6DD lists narrow exceptions — payments to banks and to
 *       government among them, and places with no banking facility — which is
 *       why this warns rather than refuses.
 *
 *   Section 269ST — receiving cash
 *       Receiving 2,00,000 rupees or more in cash from one person in one day,
 *       or against one transaction, or against one event, attracts a penalty
 *       under 271DA EQUAL TO THE AMOUNT RECEIVED. The threshold is inclusive:
 *       exactly 2,00,000 is caught, 1,99,999 is not.
 *
 * Both are per person per day, so a single voucher is not the unit — the day's
 * cash with that party is. `alreadyToday` carries what the rest of the day
 * already holds.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(num(v) * 100) / 100;

/** 40A(3): the ordinary ceiling, and the one for goods transporters. */
export const CASH_PAYMENT_LIMIT = 10000;
export const CASH_PAYMENT_LIMIT_TRANSPORTER = 35000;
/** 269ST: at or above this, not merely over it. */
export const CASH_RECEIPT_LIMIT = 200000;

/**
 * @returns {null | { severity: 'warn' | 'block', section: string, message: string }}
 *   `null` when there is nothing to say. `warn` because Rule 6DD exceptions
 *   exist and only the person entering it knows whether one applies.
 */
export const cashPaymentWarning = ({ amount, isTransporter = false, alreadyToday = 0 } = {}) => {
  const total = r2(num(amount) + num(alreadyToday));
  const limit = isTransporter ? CASH_PAYMENT_LIMIT_TRANSPORTER : CASH_PAYMENT_LIMIT;
  if (total <= limit) return null;
  return {
    severity: 'warn',
    section: '40A(3)',
    message:
      `Cash of ${total.toFixed(2)} to this party today is above the ${limit.toLocaleString('en-IN')} limit` +
      `${isTransporter ? ' for transporters' : ''}. The whole expense is disallowed as a deduction unless a Rule 6DD` +
      ' exception applies. Pay by bank to keep the deduction.',
  };
};

/**
 * @returns {null | { severity: 'warn' | 'block', section: string, message: string }}
 *   `block` here, not `warn`: 269ST has no exception a business can rely on at
 *   the counter, and the penalty is the full amount received.
 */
export const cashReceiptWarning = ({ amount, alreadyToday = 0 } = {}) => {
  const total = r2(num(amount) + num(alreadyToday));
  if (total < CASH_RECEIPT_LIMIT) return null;
  return {
    severity: 'block',
    section: '269ST',
    message:
      `Cash of ${total.toFixed(2)} from this party today reaches the ${CASH_RECEIPT_LIMIT.toLocaleString('en-IN')} limit.` +
      ' The penalty under 271DA is the whole amount received. Take this by bank instead.',
  };
};

/**
 * Cash on hand cannot be negative — a cash ledger below zero is not a balance,
 * it is proof of an entry that was never made.
 */
export const negativeCashWarning = ({ balanceAfter } = {}) => {
  if (num(balanceAfter) >= 0) return null;
  return {
    severity: 'block',
    section: 'Cash on hand',
    message: `This would take cash on hand to ${r2(balanceAfter).toFixed(2)}. Cash cannot be negative — something is missing.`,
  };
};

export default cashPaymentWarning;
