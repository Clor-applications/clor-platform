import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';

/**
 * The share of wages a payslip may deduct (Code on Wages 2019 s.18(3), excess
 * carried under s.18(4); Payment of Wages Act 1936 s.7(3) (repealed 21 Nov
 * 2025) before it): the total of the deductions the law authorises from a
 * wage period's wages may not pass half of them.
 *
 * What CLOR counts, and why:
 *
 * - **Wages** are the payslip's earnings for the period, less expense
 *   reimbursements (money returned for the company's spending is not wages).
 *   The same base People's "most that can come off" uses (payrollBridge.ts
 *   payCap): the payslip's gross.
 * - **Counted toward the share:** every deduction on the payslip, statutory
 *   ones included (PF, ESI, professional tax, income tax are heads the law
 *   lists), unless the company's setting leaves statutory ones out — read
 *   differently in practice, so it is a setting with a caption.
 * - **Late-mark penalties** count: a late-mark cut on days worked is a
 *   deduction (s.18(2)). It is a setting with a caption, counted by default,
 *   because the owner has not decided yet. A cut may only match the time
 *   actually missed (s.20); a bigger one is a fine (s.19).
 * - **Not counted:** the corrections for days paid ahead of a cut-off
 *   (provisionalDays.ts). Days not worked are not paid, so they are never a
 *   deduction from wages earned.
 * - **What gives way:** only loan and salary-advance instalments and the
 *   recovery of an expense advance. Statutory and other deductions are taken
 *   as they are. Whatever cannot be taken is carried to the next run, in full,
 *   and the payslip says so. Nothing is dropped.
 */

export const DEFAULT_CAP = { percent: 50, countsStatutory: true, countsPenalties: true };

export async function capSetting(orgId: string) {
  const row = await payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { deductionCapPercent: true, deductionCapCountsStatutory: true, deductionCapCountsPenalties: true } });
  return {
    percent: row?.deductionCapPercent ?? DEFAULT_CAP.percent,
    countsStatutory: row?.deductionCapCountsStatutory ?? DEFAULT_CAP.countsStatutory,
    countsPenalties: row?.deductionCapCountsPenalties ?? DEFAULT_CAP.countsPenalties,
  };
}

export type CapItem = { key: string; due: number };
export type CapResult = { limit: number; room: number; taken: Map<string, number>; carried: number };

/**
 * How much of each deferrable deduction this payslip takes, in the order
 * given: the least of what is due, what the limit leaves, and what net pay
 * leaves (nobody pays the company to work).
 */
export function capDeductions(opts: { percent: number; wages: number; counted: number; netPay: number; items: CapItem[] }): CapResult {
  const limit = round2(Math.max(0, opts.wages) * (opts.percent / 100));
  let room = Math.max(0, round2(limit - opts.counted));
  let net = Math.max(0, round2(opts.netPay));
  const taken = new Map<string, number>();
  let carried = 0;
  for (const item of opts.items) {
    const due = Math.max(0, round2(item.due));
    const take = round2(Math.max(0, Math.min(due, room, net)));
    taken.set(item.key, take);
    room = round2(room - take);
    net = round2(net - take);
    carried = round2(carried + due - take);
  }
  return { limit, room, taken, carried };
}

/** The payslip's line words for a deduction it took only part of: "Loan recovery (₹4,000 of ₹10,000; ₹6,000 next month)". */
export const partWords = (name: string, taken: number, due: number) =>
  `${name} (${inr(taken)} of ${inr(due)}; ${inr(round2(due - taken))} next month)`.slice(0, 120);

export const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The run screen's sentence: "Deductions held to 50% of wages for 2 people: ₹8,000 carried to next month." */
export function capMessage(c: { percent: number; people: number; carried: number }) {
  if (!c?.people || !(c.carried > 0)) return null;
  return `Deductions held to ${c.percent}% of wages for ${c.people} ${c.people === 1 ? 'person' : 'people'}: ${inr(c.carried)} carried to next month.`;
}
