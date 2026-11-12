import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { balancesFor, leaveYearOf } from '../attendance/leaveBalances.js';
import { clearanceLines, peopleMoneyLines } from './finalSettlementSources.js';
import { noticeFor } from '../people/lifecycle/notice.js';
import { applyRecoveryCap, fnfCapPercent, leavingSlipBasis } from './fnfRecoveryCap.js';

/**
 * Full and final settlement: what is still owed to, or by, somebody who has
 * left. Proposed here from what CLOR already knows; HR reviews every line
 * before it is approved, because the law and each company's policy have the
 * last word on every one of them.
 *
 * - Gratuity: 15/26 of the last drawn wages (components marked "counts for
 *   gratuity", from their last payslip) for each completed year of service, a
 *   final part-year of more than six months counting as a year; owed after
 *   five years. The minimum and the cap are parameters, not facts this code
 *   keeps — check them against the law in force.
 * - Leave encashment: paid leave still available, at a day's wages (÷ 26).
 * - Loans and salary advances still outstanding: recovered, with expense
 *   advances and recoveries waiting in Payroll, up to the company's share of
 *   the final wages (fnfRecoveryCap.ts); the rest stays owed by the person.
 * - Expense advances not settled: recovered; expense claims approved and
 *   unpaid: paid; deductions a payroll carried forward: recovered
 *   (finalSettlementSources.ts). Each line names its record.
 * - Notice: a resignation's shortfall, not waived, is recovered at a day's
 *   pay per day short (noticeLine).
 * - Clearance: money each department's sign-off found, and register assets
 *   not handed back (finalSettlementSources.ts).
 * - The salary for the final month is paid by the pay run for that period
 *   (it prorates to the leaving date), so it is shown here, not added.
 */

export type SettlementLine = {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION' | 'INFO';
  amount: number;
  explanation: string;
  /** The record the line comes from, closed when the settlement is paid (finalSettlementSources.ts). */
  source?: {
    type: 'LOAN' | 'ADVANCE' | 'CLAIM' | 'CARRY';
    id: string;
    ref?: string | null;
    /** What the source owed when the line was worked out: paying is refused if it owes more or less since (staleSources). */
    owed?: number;
    /** A draft Payroll adjustment the line folds in, cancelled when the settlement is paid; paying is refused once it is not a draft. */
    draftId?: string;
    /** The People advance a recovery row belongs to, closed with it. */
    advanceId?: string;
    /** At payment only: the recovery live in Payroll an advance line joins (finalSettlementSources withChainRoots). */
    chainRoot?: string;
  };
  /** A loan or advance recovery held to the share of final wages (fnfRecoveryCap.ts): owed, asked for, held back. */
  recover?: { due: number; wanted: number; capped: number };
};

export const GRATUITY_DEFAULTS = { minimumYears: 5, cap: 2_000_000 };

/** Two working days after leaving (Sundays skipped; a company's holidays are for HR to allow for). */
export function settlementDueDate(leaving: string) {
  const d = new Date(`${leaving}T00:00:00Z`);
  let left = 2;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Completed years of service, a final part-year of more than six months counting as a whole one. */
export function serviceYears(joined: string, left: string) {
  const a = new Date(`${joined}T00:00:00Z`);
  const b = new Date(`${left}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  return { years: months % 12 > 6 ? years + 1 : years, months };
}

export function gratuityFor(lastWage: number, joined: string, left: string, opts = GRATUITY_DEFAULTS) {
  const { years, months } = serviceYears(joined, left);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const served = `${plural(Math.floor(months / 12), 'year')} ${plural(months % 12, 'month')}`;
  if (Math.floor(months / 12) < opts.minimumYears && years < opts.minimumYears) {
    return { amount: 0, explanation: `Served ${served}; gratuity is owed after ${opts.minimumYears} years.` };
  }
  const raw = round2((lastWage * 15 * years) / 26);
  const amount = Math.min(raw, opts.cap);
  return {
    amount,
    explanation: `15/26 × last drawn wages ₹${lastWage.toLocaleString('en-IN')} × ${plural(years, 'year')} (served ${served})${amount < raw ? `, capped at ₹${opts.cap.toLocaleString('en-IN')}` : ''}.`,
  };
}

/** The monthly wages gratuity and encashment are worked on: last payslip's components marked for gratuity. */
async function lastDrawnWages(orgId: string, employeeId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({
    where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } },
    select: { id: true, payrollDate: true },
    orderBy: { payrollDate: 'desc' },
  });
  if (!runs.length) return { wage: 0, gross: 0, from: null as string | null };
  const slip = await payrollPrisma.salarySlip.findFirst({
    where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, runId: true },
  });
  if (!slip) return { wage: 0, gross: 0, from: null };
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId: slip.id, type: 'EARNING' }, select: { componentId: true, amount: true, fullAmount: true } });
  const counted = new Set(
    (await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: lines.map((l) => l.componentId) }, includeInGratuityWage: true }, select: { id: true } })).map((c) => c.id)
  );
  /* The full month, not a month cut short by leave: "last drawn wages" are the rate, not what one month paid. */
  const wage = round2(lines.filter((l) => counted.has(l.componentId)).reduce((t, l) => t + Number(l.fullAmount ?? l.amount), 0));
  /* Every earning at its full-month rate: a day's pay for notice is gross ÷ 30, notice days being calendar days. */
  const gross = round2(lines.reduce((t, l) => t + Number(l.fullAmount ?? l.amount), 0));
  return { wage, gross, from: slip.number };
}

export async function proposeSettlement(accountId: string, orgId: string, employeeId: string) {
  const person = await peoplePrisma.employee.findFirst({ where: { orgId, id: employeeId }, select: { name: true, dateOfJoining: true, dateOfLeaving: true, status: true, leavingType: true, resignedOn: true, noticeWaived: true, employeeTypeId: true } });
  if (!person) throw Object.assign(new Error('No such employee.'), { status: 404 });
  if (!person.dateOfLeaving) throw Object.assign(new Error('Set their date of leaving first.'), { status: 400, code: 'NO_LEAVING_DATE' });
  const leaving = person.dateOfLeaving;
  const lines: SettlementLine[] = [];

  lines.push({
    code: 'FINAL_SALARY',
    label: 'Salary up to the leaving date',
    kind: 'INFO',
    amount: 0,
    explanation: 'Paid in the pay run for the leaving month, which prorates to the leaving date. Once that payroll is approved, it counts toward the final wages loans and advances are recovered from.',
  });

  const { wage, gross, from } = await lastDrawnWages(orgId, employeeId);
  const wageNote = `from payslip ${from}`;

  if (person.dateOfJoining) {
    const g = gratuityFor(wage, person.dateOfJoining, leaving);
    const explanation = from || (!g.amount && /owed after/.test(g.explanation))
      ? `${g.explanation}${from ? ` Wages ${wageNote}.` : ''}`
      : `${serviceYears(person.dateOfJoining, leaving).years === 1 ? '1 year' : `${serviceYears(person.dateOfJoining, leaving).years} years`} counted; no approved payslip yet, so enter 15/26 × monthly wages × years.`;
    lines.push({ code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: g.amount, explanation });
  } else {
    lines.push({ code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: 0, explanation: 'No date of joining on file, so service cannot be worked out.' });
  }

  const year = await leaveYearOf(orgId, leaving);
  const { types, balances } = await balancesFor(accountId, orgId, [employeeId], year);
  const mine = balances.get(employeeId);
  const daily = round2(wage / 26);
  /*
   * Only the types the company's policy pays out (Leave Policy → "Paid out at
   * year end / on leaving"), up to the type's cap. Casual and sick leave are
   * not money on leaving unless the policy says so (HR-view audit, 27 Oct 2026:
   * every paid type was proposed, and HR had to spot and delete the lines).
   */
  for (const t of types.filter((x) => x.isPaid && x.isActive && x.encashable)) {
    const balance = Number(mine?.get(t.id)?.available) || 0;
    if (balance <= 0) continue;
    const cap = t.maxEncashDays != null ? Number(t.maxEncashDays) : null;
    const left = cap != null ? Math.min(balance, cap) : balance;
    const capped = cap != null && balance > cap ? ` (${balance} left; the policy pays up to ${cap})` : '';
    lines.push({
      code: `LEAVE_${(t.code || t.name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.slice(0, 40),
      label: `${t.name} encashment`,
      kind: 'EARNING',
      amount: round2(left * daily),
      explanation: !from ? `${left} days${capped}; no approved payslip yet, so enter days × a day's wages.` : `${left} days${capped} × a day's wages ₹${daily.toLocaleString('en-IN')} (₹${wage.toLocaleString('en-IN')} ÷ 26).`,
    });
  }

  const loans = await payrollPrisma.payrollLoan.findMany({ where: { orgId, employeeId, status: 'ACTIVE' }, select: { id: true, number: true, type: true, principal: true, outstandingBalance: true }, orderBy: { createdAt: 'asc' } });
  for (const l of loans) {
    const owed = round2(Number(l.outstandingBalance));
    if (owed > 0) {
      lines.push({
        code: `LOAN_${l.number}`.replace(/[^A-Z0-9_-]+/gi, '_').slice(0, 40),
        label: `${l.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} ${l.number} recovery`,
        kind: 'DEDUCTION',
        amount: owed,
        explanation: `${l.type === 'SALARY_ADVANCE' ? 'Salary advance' : 'Loan'} of ₹${Number(l.principal).toLocaleString('en-IN')}; ₹${owed.toLocaleString('en-IN')} still to recover, including any instalment a payroll carried forward.`,
        source: { type: 'LOAN', id: l.id, ref: l.number, owed },
      });
    }
  }

  /* Expense advances and claims from People, and deductions a payroll carried forward. */
  lines.push(...(await peopleMoneyLines(orgId, employeeId)));

  lines.push(await noticeLine(orgId, person, leaving, gross, from));

  /* Money the clearance sign-off found, and register assets not handed back (finalSettlementSources.ts). */
  lines.push(...(await clearanceLines(orgId, employeeId, leaving)));

  /* Loans and advances come off the final pay only up to the company's share of the final wages; the rest stays owed (fnfRecoveryCap.ts). */
  const capped = applyRecoveryCap(lines, { percent: await fnfCapPercent(orgId), slip: await leavingSlipBasis(orgId, employeeId, leaving) });
  return { leavingDate: leaving, dueDate: settlementDueDate(leaving), lines: capped.lines, cap: capped.cap };
}

const dmy = (iso: string) => iso.split('-').reverse().join('/');

/**
 * The notice line (People plan step 5): from the resignation date People keeps and the employment type's
 * notice days. A shortfall not waived is recovered at a day's pay (gross ÷ 30) per day short; HR can change
 * or remove it, since a company may agree to let someone go early.
 */
export async function noticeLine(
  orgId: string,
  person: { leavingType: string | null; resignedOn: string | null; noticeWaived: boolean; employeeTypeId: string | null },
  leaving: string,
  gross: number,
  from: string | null
): Promise<SettlementLine> {
  const manual: SettlementLine = { code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 0, explanation: 'Owed to them, or enter it as a deduction if they did not serve their notice.' };
  if (person.leavingType !== 'RESIGNED') return manual;
  if (!person.resignedOn) return { ...manual, explanation: 'No resignation date on their leaving, so notice served is not known. Add it in People, or enter the notice pay here.' };
  const n = await noticeFor(orgId, { employeeTypeId: person.employeeTypeId, lastDay: leaving, resignedOn: person.resignedOn, noticeWaived: person.noticeWaived });
  const days = (d: number) => `${d} day${d === 1 ? '' : 's'}`;
  const head = `Resigned on ${dmy(n.resignedOn!)}, last day ${dmy(leaving)}: ${days(n.servedDays ?? 0)} served`;
  if (n.noticeDays == null) return { ...manual, explanation: `${head}. Their employment type sets no notice period, so enter any notice pay here.` };
  if (n.noticeWaived) return { ...manual, explanation: `${head} of ${days(n.noticeDays)}' notice. The company waived the rest, so nothing is recovered.` };
  const short = n.shortfallDays ?? 0;
  if (short <= 0) return { ...manual, explanation: `${head} of ${days(n.noticeDays)}' notice: served in full, nothing to recover.` };
  const daily = round2(gross / 30);
  return {
    code: 'NOTICE',
    label: 'Notice not served',
    kind: 'DEDUCTION',
    amount: from ? round2(short * daily) : 0,
    explanation: from
      ? `${head} of ${days(n.noticeDays)}' notice, ${days(short)} short × a day's pay ₹${daily.toLocaleString('en-IN')} (gross ₹${gross.toLocaleString('en-IN')} from payslip ${from} ÷ 30). Remove it if the company lets them go early.`
      : `${head} of ${days(n.noticeDays)}' notice, ${days(short)} short. No approved payslip yet, so enter ${days(short)} × a day's pay.`,
  };
}

export const netOf = (lines: SettlementLine[]) =>
  round2(lines.reduce((t, l) => t + (l.kind === 'EARNING' ? l.amount : l.kind === 'DEDUCTION' ? -l.amount : 0), 0));
