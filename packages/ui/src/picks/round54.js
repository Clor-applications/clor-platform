/*
 * Round 54 picks (18 Nov 2026), payroll month end. Plain helpers, no server:
 * - bankcutoff A: approving after 3 PM (India time) warns that the bank credits tomorrow.
 * - taxrelief89 B: arrears are taxed in the year paid; a note says the person may claim relief under section 89.
 * - unlockmonth B: a closed month is never reopened; a mistake is fixed in next month's run.
 */

export const BANK_CUTOFF_HOUR = 15;

export const BANK_CUTOFF_NOTE = 'Approved after 3 PM; the bank will credit tomorrow.';

export const RELIEF_89_NOTE =
  'Arrears are taxed in the year they are paid. The person can claim relief under section 89 in their own return (Form 10E).';

export const CLOSED_MONTH_NOTE = "Closed months stay closed. Fix a mistake in next month's run.";

/** Hour of the day in India (UTC+5:30), whatever the computer's own time zone. */
export function indiaHour(now = new Date()) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return Math.floor((minutes % 1440) / 60);
}

/** True from 3 PM to midnight, India time. */
export function afterBankCutoff(now = new Date()) {
  return indiaHour(now) >= BANK_CUTOFF_HOUR;
}

/** True when a line's words say it is an arrear (arrear, arrears, back pay). */
export function mentionsArrears(text) {
  return /\barrears?\b|\bback\s*pay\b/i.test(String(text || ''));
}
