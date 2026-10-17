import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { round2 } from '../../utils/money.js';
import { balancesFor } from '../../routes/leave.js';

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
 * - Loans and advances still outstanding: recovered.
 * - The salary for the final month is paid by the pay run for that period
 *   (it prorates to the leaving date), so it is shown here, not added.
 */

export type SettlementLine = { code: string; label: string; kind: 'EARNING' | 'DEDUCTION' | 'INFO'; amount: number; explanation: string };

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
  const served = `${Math.floor(months / 12)} years ${months % 12} months`;
  if (Math.floor(months / 12) < opts.minimumYears && years < opts.minimumYears) {
    return { amount: 0, explanation: `Served ${served}; gratuity is owed after ${opts.minimumYears} years.` };
  }
  const raw = round2((lastWage * 15 * years) / 26);
  const amount = Math.min(raw, opts.cap);
  return {
    amount,
    explanation: `15/26 × last drawn wages ₹${lastWage.toLocaleString('en-IN')} × ${years} years (served ${served})${amount < raw ? `, capped at ₹${opts.cap.toLocaleString('en-IN')}` : ''}.`,
  };
}

/** The monthly wages gratuity and encashment are worked on: last payslip's components marked for gratuity. */
async function lastDrawnWages(orgId: string, employeeId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({
    where: { orgId, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } },
    select: { id: true, payrollDate: true },
    orderBy: { payrollDate: 'desc' },
  });
  if (!runs.length) return { wage: 0, from: null as string | null };
  const slip = await payrollPrisma.salarySlip.findFirst({
    where: { orgId, employeeId, runId: { in: runs.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, runId: true },
  });
  if (!slip) return { wage: 0, from: null };
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId: slip.id, type: 'EARNING' }, select: { componentId: true, amount: true, fullAmount: true } });
  const counted = new Set(
    (await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: lines.map((l) => l.componentId) }, includeInGratuityWage: true }, select: { id: true } })).map((c) => c.id)
  );
  /* The full month, not a month cut short by leave: "last drawn wages" are the rate, not what one month paid. */
  const wage = round2(lines.filter((l) => counted.has(l.componentId)).reduce((t, l) => t + Number(l.fullAmount ?? l.amount), 0));
  return { wage, from: slip.number };
}

export async function proposeSettlement(accountId: string, orgId: string, employeeId: string) {
  const person = await peoplePrisma.employee.findFirst({ where: { orgId, id: employeeId }, select: { name: true, dateOfJoining: true, dateOfLeaving: true, status: true } });
  if (!person) throw Object.assign(new Error('No such employee.'), { status: 404 });
  if (!person.dateOfLeaving) throw Object.assign(new Error('Set their date of leaving first.'), { status: 400, code: 'NO_LEAVING_DATE' });
  const leaving = person.dateOfLeaving;
  const lines: SettlementLine[] = [];

  lines.push({
    code: 'FINAL_SALARY',
    label: 'Salary up to the leaving date',
    kind: 'INFO',
    amount: 0,
    explanation: 'Paid in the pay run for the leaving month, which prorates to the leaving date.',
  });

  const { wage, from } = await lastDrawnWages(orgId, employeeId);
  const wageNote = `from payslip ${from}`;

  if (person.dateOfJoining) {
    const g = gratuityFor(wage, person.dateOfJoining, leaving);
    const explanation = from || (!g.amount && /owed after/.test(g.explanation))
      ? `${g.explanation}${from ? ` Wages ${wageNote}.` : ''}`
      : `${serviceYears(person.dateOfJoining, leaving).years} years counted; no approved payslip yet, so enter 15/26 × monthly wages × years.`;
    lines.push({ code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: g.amount, explanation });
  } else {
    lines.push({ code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: 0, explanation: 'No date of joining on file, so service cannot be worked out.' });
  }

  const year = Number(leaving.slice(0, 4));
  const { types, balances } = await balancesFor(accountId, orgId, [employeeId], year);
  const mine = balances.get(employeeId);
  const daily = round2(wage / 26);
  for (const t of types.filter((x) => x.isPaid && x.isActive)) {
    const left = Number(mine?.get(t.id)?.available) || 0;
    if (left <= 0) continue;
    lines.push({
      code: `LEAVE_${(t.code || t.name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.slice(0, 40),
      label: `${t.name} encashment`,
      kind: 'EARNING',
      amount: round2(left * daily),
      explanation: !from ? `${left} days left; no approved payslip yet, so enter days × a day's wages. Remove it if this leave is not encashable under your policy.` : `${left} days left × a day's wages ₹${daily.toLocaleString('en-IN')} (₹${wage.toLocaleString('en-IN')} ÷ 26). Remove it if this leave is not encashable under your policy.`,
    });
  }

  const loans = await payrollPrisma.payrollLoan.findMany({ where: { orgId, employeeId, status: 'ACTIVE' }, select: { type: true, outstandingBalance: true } });
  for (const l of loans) {
    const owed = round2(Number(l.outstandingBalance));
    if (owed > 0) lines.push({ code: 'LOAN_RECOVERY', label: l.type === 'SALARY_ADVANCE' ? 'Advance recovery' : 'Loan recovery', kind: 'DEDUCTION', amount: owed, explanation: 'Still outstanding.' });
  }

  lines.push({ code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 0, explanation: 'Owed to them, or enter it as a deduction if they did not serve their notice.' });

  return { leavingDate: leaving, dueDate: settlementDueDate(leaving), lines };
}

export const netOf = (lines: SettlementLine[]) =>
  round2(lines.reduce((t, l) => t + (l.kind === 'EARNING' ? l.amount : l.kind === 'DEDUCTION' ? -l.amount : 0), 0));
