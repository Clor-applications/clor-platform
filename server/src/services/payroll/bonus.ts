import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { snapshotPerson } from './payment.js';
import { fyBounds } from './form16.js';

/**
 * Statutory bonus (Payment of Bonus Act 1965, its rules carried into the
 * Code on Wages 2019): who qualifies for a financial year, and how much.
 *
 * Read from the year's approved payslips, so the figures are what was paid:
 *
 *   Salary or wage is basic + DA (s.2(21)), month by month.
 *   A month counts when that wage is at or under the eligibility ceiling
 *   (s.2(13)); a month above it is left out and the line says so.
 *   Somebody qualifies with at least the minimum days worked in the year
 *   (s.8): the payable days on their payslips, which count paid leave.
 *   The bonus is worked out on the lower of the wage and the calculation
 *   base: the calculation ceiling, or the minimum wage where that is higher
 *   (s.12).
 *   The bonus is that × the rate HR picks, between the minimum (s.10) and the
 *   maximum (s.11) share, and never under the minimum amount (s.10).
 *
 * Every figure the Act sets is a company setting with the Act's number as the
 * default, because the government changes them by notification: the screen
 * asks HR to check the current rule before running.
 */

export type BonusRules = {
  eligibilityCeiling: number;
  calculationCeiling: number;
  minimumWage: number;
  minPercent: number;
  maxPercent: number;
  minimumAmount: number;
  minDays: number;
};

/** The Act's figures as last checked (Nov 2026). Defaults only: HR checks the current rule. */
export const ACT_DEFAULTS: BonusRules = {
  eligibilityCeiling: 21000,
  calculationCeiling: 7000,
  minimumWage: 0,
  minPercent: 8.33,
  maxPercent: 20,
  minimumAmount: 100,
  minDays: 30,
};

/** Where each figure comes from, shown under its field. */
export const RULE_NOTES: Record<keyof BonusRules, string> = {
  eligibilityCeiling: 'Payment of Bonus Act s.2(13): ₹21,000 a month. Check the current rule.',
  calculationCeiling: 'Payment of Bonus Act s.12: ₹7,000 a month, or the minimum wage if higher. Check the current rule.',
  minimumWage: "The monthly minimum wage for your kind of work in your state. Leave 0 if you have not set it. Check your state's current notification.",
  minPercent: 'Payment of Bonus Act s.10: 8.33% of the bonus wages. Check the current rule.',
  maxPercent: 'Payment of Bonus Act s.11: 20% of the bonus wages. Check the current rule.',
  minimumAmount: 'Payment of Bonus Act s.10: at least ₹100 a year. Check the current rule.',
  minDays: 'Payment of Bonus Act s.8: at least 30 working days in the year. Check the current rule.',
};

const SETTLED = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];
const WAGE_CODES = ['BASIC', 'DA'];

export async function bonusRules(orgId: string): Promise<BonusRules> {
  const s = await payrollPrisma.payrollSetting.findUnique({ where: { orgId } });
  if (!s) return { ...ACT_DEFAULTS };
  return {
    eligibilityCeiling: Number(s.bonusEligibilityCeiling),
    calculationCeiling: Number(s.bonusCalculationCeiling),
    minimumWage: Number(s.bonusMinimumWage),
    minPercent: Number(s.bonusMinPercent),
    maxPercent: Number(s.bonusMaxPercent),
    minimumAmount: Number(s.bonusMinimumAmount),
    minDays: Number(s.bonusMinDays),
  };
}

export type BonusMonth = { month: string; days: number; wage: number; counted: boolean; bonusWage: number };
export type BonusPerson = {
  employeeId: string;
  name: string;
  code: string;
  designation: string;
  daysWorked: number;
  wages: number;
  bonusWages: number;
  amount: number;
  eligible: boolean;
  reason: string | null;
  months: BonusMonth[];
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** One person's year, worked out under the rules at the rate. Pure, for the tests. */
export function personBonus(months: Array<{ month: string; days: number; wage: number }>, rules: BonusRules, ratePercent: number) {
  const base = Math.max(rules.calculationCeiling, rules.minimumWage || 0);
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const out: BonusMonth[] = sorted.map((m) => {
    const counted = m.wage > 0 && m.wage <= rules.eligibilityCeiling;
    return { month: m.month, days: round2(m.days), wage: round2(m.wage), counted, bonusWage: counted ? round2(Math.min(m.wage, base)) : 0 };
  });
  const daysWorked = round2(out.reduce((t, m) => t + m.days, 0));
  const wages = round2(out.reduce((t, m) => t + m.wage, 0));
  const bonusWages = round2(out.reduce((t, m) => t + m.bonusWage, 0));
  const above = out.filter((m) => m.wage > rules.eligibilityCeiling).length;

  let reason: string | null = null;
  let eligible = true;
  if (wages <= 0) {
    eligible = false;
    reason = 'No basic or DA on this year’s payslips.';
  } else if (daysWorked < rules.minDays) {
    eligible = false;
    reason = `Worked ${daysWorked} days in the year; at least ${rules.minDays} are needed.`;
  } else if (bonusWages <= 0) {
    eligible = false;
    reason = `Basic + DA was above ${inr(rules.eligibilityCeiling)} a month all year.`;
  } else if (above) {
    reason = `${above} ${above === 1 ? 'month' : 'months'} above ${inr(rules.eligibilityCeiling)} a month left out.`;
  }

  let amount = 0;
  if (eligible) {
    amount = round2((bonusWages * ratePercent) / 100);
    if (amount < rules.minimumAmount) {
      amount = round2(rules.minimumAmount);
      reason = [reason, `Raised to the minimum of ${inr(rules.minimumAmount)}.`].filter(Boolean).join(' ');
    }
  }
  return { daysWorked, wages, bonusWages, amount, eligible, reason, months: out };
}

/**
 * Everybody paid in the year, from approved payslips: each person's months
 * (by the pay period's last day, as Form 16 reads the year), payable days and
 * basic + DA.
 */
export async function bonusYear(orgId: string, fy: string, rules: BonusRules, ratePercent: number): Promise<BonusPerson[]> {
  const { from, to } = fyBounds(fy);
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, endDate: { gte: from, lte: to } }, select: { id: true, endDate: true } });
  if (!periods.length) return [];
  const monthOf = new Map(periods.map((p) => [p.id, p.endDate.slice(0, 7)]));
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: SETTLED }, periodId: { in: periods.map((p) => p.id) } }, select: { id: true } });
  if (!runs.length) return [];
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId: { in: runs.map((r) => r.id) }, status: { not: 'CANCELLED' } },
    select: { employeeId: true, periodId: true, inputSnapshotJson: true, employeeSnapshotJson: true, lines: { select: { componentCode: true, type: true, amount: true } } },
  });

  type Acc = { name: string; code: string; months: Map<string, { month: string; days: number; wage: number }> };
  const acc = new Map<string, Acc>();
  for (const s of slips) {
    const month = monthOf.get(s.periodId);
    if (!month) continue;
    const snap = snapshotPerson(s.employeeSnapshotJson);
    const a = acc.get(s.employeeId) || { name: snap.name, code: snap.code, months: new Map() };
    let days = 0;
    try {
      days = Number(JSON.parse(s.inputSnapshotJson || '{}').payableDays) || 0;
    } catch {
      days = 0;
    }
    const wage = s.lines.filter((l) => l.type === 'EARNING' && WAGE_CODES.includes(String(l.componentCode).toUpperCase())).reduce((t, l) => t + (Number(l.amount) || 0), 0);
    const m = a.months.get(month) || { month, days: 0, wage: 0 };
    /* A second payroll in the same month (arrears, a correction) adds its wages; its days are the same month's, so the larger count stands. */
    m.days = Math.max(m.days, days);
    m.wage = round2(m.wage + wage);
    a.months.set(month, m);
    acc.set(s.employeeId, a);
  }

  const people = new Map(
    (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...acc.keys()] } }, select: { id: true, name: true, code: true, designation: true } })).map((e) => [e.id, e])
  );
  const out: BonusPerson[] = [];
  for (const [employeeId, a] of acc) {
    const p = people.get(employeeId);
    const r = personBonus([...a.months.values()], rules, ratePercent);
    out.push({ employeeId, name: p?.name || a.name || 'Unknown employee', code: p?.code || a.code || '', designation: p?.designation || '', ...r });
  }
  /* Who is paid first, then by name: the list HR checks. */
  return out.sort((x, y) => Number(y.eligible) - Number(x.eligible) || x.name.localeCompare(y.name));
}

export const BONUS_COMPONENT_CODE = 'STAT_BONUS';

/** The earning a bonus is paid under: the company's own STAT_BONUS, made the first time it is needed. */
export async function bonusComponent(tx: any, accountId: string, orgId: string, userId: string) {
  const have = await tx.salaryComponent.findFirst({ where: { orgId, code: BONUS_COMPONENT_CODE } });
  if (have) {
    if (have.type !== 'EARNING') throw Object.assign(new Error(`The salary component ${BONUS_COMPONENT_CODE} is not an earning. Rename it so the bonus can use this code.`), { status: 409 });
    if (!have.isActive) return tx.salaryComponent.update({ where: { id: have.id }, data: { isActive: true } });
    return have;
  }
  return tx.salaryComponent.create({
    data: {
      accountId,
      orgId,
      name: 'Statutory bonus',
      code: BONUS_COMPONENT_CODE,
      type: 'EARNING',
      description: 'The yearly bonus under the Payment of Bonus Act, paid from a bonus run.',
      calculationMethod: 'FIXED',
      prorate: false,
      isVariable: true,
      createdByUserId: userId,
    },
  });
}
