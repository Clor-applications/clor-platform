import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';
import { fyBounds, taxYear } from './form16.js';

/**
 * Salary TDS deposits, a row per month (round 27 pick).
 *
 * The tax deducted in a month comes from approved payslips, by the day salary
 * was paid (the 24Q's reading, form16.ts `taxYear(..., 'PAYMENT')`). Each
 * month lists the challans recorded against it, what is still to deposit, and
 * the due date: the 7th of the next month, March's by 30 April (Rule 30).
 */

export const BSR = /^\d{7}$/;
export const SERIAL = /^\d{1,5}$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-\d{2}$/;

/** The twelve months of a financial year, April first. */
export const monthsOf = (fy: string) => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
};

/** The day a month's salary TDS has to be deposited by. */
export const depositDue = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
};

/** Whether a month belongs to a financial year. */
export const inYear = (fy: string, month: string) => monthsOf(fy).includes(month);

export type ChallanRow = { id: string; month: string; bsrCode: string; challanSerial: string; depositDate: string; amount: number; note: string | null };

export async function challansFor(orgId: string, fy: string): Promise<ChallanRow[]> {
  const rows = await payrollPrisma.payrollTdsChallan.findMany({ where: { orgId, financialYear: fy, deletedAt: null }, orderBy: [{ month: 'asc' }, { depositDate: 'asc' }] });
  return rows.map((r) => ({ id: r.id, month: r.month, bsrCode: r.bsrCode, challanSerial: r.challanSerial, depositDate: r.depositDate, amount: round2(Number(r.amount)), note: r.note }));
}

export async function tdsMonths(orgId: string, fy: string, today: string) {
  const { from, to } = fyBounds(fy);
  const [people, challans] = await Promise.all([taxYear(orgId, fy, undefined, 'PAYMENT'), challansFor(orgId, fy)]);
  const deducted = new Map<string, number>();
  for (const p of people) {
    for (const m of p.months) {
      const day = String(m.paymentDate || '');
      if (!(m.tds > 0) || day < from || day > to) continue;
      const k = day.slice(0, 7);
      deducted.set(k, round2((deducted.get(k) || 0) + m.tds));
    }
  }
  const months = monthsOf(fy).map((month) => {
    const mine = challans.filter((c) => c.month === month);
    const tds = deducted.get(month) || 0;
    const deposited = round2(mine.reduce((t, c) => t + c.amount, 0));
    const left = round2(tds - deposited);
    const due = depositDue(month);
    /* Late: a balance still open after the due date, or a challan paid after it. */
    const late = (left > 0 && today > due) || mine.some((c) => c.depositDate > due);
    return { month, tds, deposited, left, due, late, challans: mine };
  });
  return {
    months,
    totals: {
      tds: round2(months.reduce((t, m) => t + m.tds, 0)),
      deposited: round2(months.reduce((t, m) => t + m.deposited, 0)),
      left: round2(months.reduce((t, m) => t + Math.max(0, m.left), 0)),
    },
  };
}
