import { randomUUID } from 'node:crypto';

import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { Prisma } from '../../generated/payroll/index.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { calculateStructure, ENGINE_VERSION, type EngineComponent } from './engine/calculator.js';
import { loadRules, applyStatutory } from './statutory/resolve.js';
import { ageBandFor, ruleInForce } from './statutory/engine.js';
import { isEmployerNps, taxablePayOf } from './taxablePay.js';
import { recoveriesDue, type DueRecovery } from './loan.js';
import { capDeductions, capSetting, partWords } from './deductionCap.js';
import { financialYearOf, deductionsFor, previousEmployerOf, yearRegimes } from './taxDeclaration.js';
import { firstPayrollYearOf, openingFor, type Opening } from './openingYtd.js';
import { round2 } from '../../utils/money.js';
import { componentApplies, monthsOfService, type EligibilityFacts } from './eligibility.js';
import { isCorrection, isLatePenalty } from './provisionalDays.js';
import { daysBetween } from '../../utils/istDate.js';
import { canonicalState, stateLabel } from '../../constants/stateLevies.js';
import { checksSentence, parseConfig, ruleNeedsCheck, stateRulesThatCount } from './statutory/resolve.js';

/**
 * A payroll run: turning a population and a period into payslips.
 *
 * ## Everything is read once
 *
 * A run of six hundred people that asks the database per person is six hundred
 * round trips before it has calculated anything. So every employee, assignment,
 * structure, component and adjustment the run touches is fetched in a handful
 * of queries and resolved in memory. The calculator itself is pure, so once the
 * data is loaded the arithmetic is CPU and nothing else.
 *
 * ## Validation runs before calculation, and separately
 *
 * A run stops at the first thing that would produce a wrong payslip, not the
 * first thing that throws. Someone with no salary assignment, a structure whose
 * dates do not cover the period, a negative net — these are reported against
 * the employee, all of them at once, so payroll is fixed in one pass rather
 * than discovered one error per attempt.
 *
 * ## What a payslip remembers
 *
 * Calculating writes a snapshot of everything that produced each figure: the
 * employee, the assignment, the structure and its components, the days, the
 * adjustments, and the engine version. A payslip reopened next year reads its
 * own snapshot, never today's configuration — so editing a structure tomorrow
 * cannot change what March paid. That is the property the whole module rests
 * on, and it is why calculation stores so much.
 */

export type RunIssue = {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  employeeId?: string;
  /** A statutory rule the issue is about (RULE_NEEDS_CHECK). */
  ruleId?: string;
};

const PERIODS_PER_YEAR: Record<string, number> = { MONTHLY: 12, FORTNIGHTLY: 26, WEEKLY: 52 };

/** Whole days between two ISO dates, inclusive — the length of a period. */
export { daysBetween };

/**
 * Who this run is for.
 *
 * Eligibility is deliberately narrow: in payroll, in this population, employed
 * during the period, and holding a salary that covers it. Somebody who joined
 * mid-period is included — that is what proration is for — and somebody who
 * left before it started is not.
 */
export async function eligibleEmployees(
  orgId: string,
  opts: { periodStart: string; periodEnd: string; payGroupId?: string | null; branchId?: string | null; department?: string | null }
) {
  const employees = await peoplePrisma.employee.findMany({
    where: {
      orgId,
      status: { in: ['ACTIVE', 'ON_NOTICE', 'LEFT'] },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.department ? { department: opts.department } : {}),
      /* Employed at some point during the period: joined on or before it ends,
         and either still here or left on or after it starts. */
      OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: opts.periodEnd } }],
    },
    orderBy: { name: 'asc' },
  });

  const stillHere = employees.filter(
    (e) => !e.dateOfLeaving || e.dateOfLeaving >= opts.periodStart
  );

  const profiles = await payrollPrisma.employeePayrollProfile.findMany({
    where: { orgId, employeeId: { in: stillHere.map((e) => e.id) } },
  });
  const byEmployee = new Map(profiles.map((p) => [p.employeeId, p]));

  return stillHere
    .filter((e) => {
      const p = byEmployee.get(e.id);
      /* No profile means nobody has said how this person is paid, which is not
         the same as excluding them — they are eligible and will fail
         validation with a reason. */
      if (!p) return true;
      if (p.payrollStatus !== 'IN_PAYROLL') return false;
      if (opts.payGroupId && p.payGroupId && p.payGroupId !== opts.payGroupId) return false;
      return true;
    })
    .map((e) => ({ employee: e, profile: byEmployee.get(e.id) || null }));
}

type LoadedRun = Awaited<ReturnType<typeof loadRunContext>>;

/** 1 April of the Indian financial year a date falls in. */
export const financialYearStart = (isoDate: string) => {
  const y = Number(isoDate.slice(0, 4));
  return Number(isoDate.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
};

/** Months left in the financial year, this one included: April 12 … March 1. */
export const monthsLeftInFinancialYear = (isoDate: string) => {
  const month = Number(isoDate.slice(5, 7)) || 4;
  return month >= 4 ? 16 - month : 4 - month;
};

/**
 * Months TDS spreads over for one person: to March, or to the month they
 * leave when that is earlier in the year (review of #146, 9). Leaving on 31
 * December, October's payroll spreads over October, November and December,
 * so the year's tax is deducted by the last payslip rather than a share of it
 * left for months nobody is paid.
 */
export function monthsLeftFor(periodEnd: string, dateOfLeaving?: string | null) {
  const toMarch = monthsLeftInFinancialYear(periodEnd);
  const left = dateOfLeaving ? String(dateOfLeaving).slice(0, 10) : '';
  const yearEnd = `${Number(financialYearStart(periodEnd).slice(0, 4)) + 1}-03-31`;
  /* Gone before this period (paid arrears or a settlement after leaving): this payslip is the last, one month. */
  if (left && left.slice(0, 7) < periodEnd.slice(0, 7)) return 1;
  if (!left || left > yearEnd) return toMarch;
  const index = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  return Math.max(1, Math.min(toMarch, index(left) - index(periodEnd) + 1));
}

/**
 * The first month of this financial year CLOR ran payroll for, when that is
 * after April and income tax is on: everyone employed before it was paid
 * somewhere else first and needs opening figures (#2). Null when nothing is
 * missing: payroll ran here from April, tax is off, or the owner said this
 * is the company's first year of paying salaries.
 */
export function openingNeededFor(
  period: { startDate: string; endDate: string },
  person: { dateOfJoining?: string | null; earlierSlips: number; hasOpening: boolean },
  company: { taxYear: string; firstPayrollYear: { financialYear: string } | null }
) {
  /*
   * Per person (review of #146, 2): employed before this period starts, in a
   * tax year that began before it, with no CLOR payslip earlier in that year
   * and nothing entered. A second pay group moved onto CLOR in October needs
   * them; the group paid here since April does not. Never when the owner said
   * this is the company's first year of paying salaries.
   */
  const fyStart = financialYearStart(period.endDate);
  if (period.startDate <= fyStart) return false;
  if (company.firstPayrollYear?.financialYear === company.taxYear) return false;
  if (person.hasOpening || person.earlierSlips > 0) return false;
  const joined = person.dateOfJoining ? String(person.dateOfJoining).slice(0, 10) : '';
  if (joined && joined >= period.startDate) return false;
  /*
   * Joined inside the period just before this one (re-review of #146, S2):
   * joins 27 September after September's cut-off, first paid in October with
   * arrears. Likely nothing was paid anywhere, so a warning, not a block.
   */
  if (joined && joined >= monthBefore(period.startDate)) return 'WARNING';
  return 'ERROR';
}

/** The same day a month earlier (the start of the period before, for monthly periods). */
function monthBefore(iso: string) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}${iso.slice(7, 10)}`;
}

/** The TDS rule is on for this payroll; without it there is no tax to bring figures in for. */
export const tdsInForce = (ctx: { period: { endDate: string }; statutoryRules: Map<any, any[]> }) => Boolean(ruleInForce(ctx.statutoryRules.get('TDS') || [], ctx.period.endDate, null));

const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (iso: string) => `${MONTH_WORDS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Earlier payslips this year plus the opening figures from before CLOR. */
export function withOpening(sofar: TaxSoFar | undefined, opening: Opening | undefined): TaxSoFar {
  const base = sofar || { gross: 0, tds: 0, taxable: 0, employerNps: 0, basicDa: 0, slips: 0 };
  if (!opening) return base;
  return {
    ...base,
    gross: round2(base.gross + opening.grossPay),
    taxable: round2(base.taxable + opening.taxablePay),
    tds: round2(base.tds + opening.tds),
    /* Employer NPS (80CCD(2), already inside taxable) and Basic and DA (its limit), as CLOR's own payslips give them (review of #146, 4). */
    employerNps: round2(base.employerNps + (opening.employerNps || 0)),
    basicDa: round2((base.basicDa || 0) + (opening.basicDa || 0)),
  };
}

/** Taxable one-off earnings a person's adjustments add this period (a bonus, arrears), as the payslip will carry them. */
export function oneOffTaxableOf(ctx: { components: Map<string, any> }, adjustments: any[]) {
  let total = 0;
  for (const adj of adjustments) {
    const component = ctx.components.get(adj.componentId);
    const isDeduction = adj.type === 'DEDUCTION' || component?.type === 'DEDUCTION';
    if (isDeduction) continue;
    if (!(component?.isTaxable ?? true)) continue;
    total += Number(adj.amount) || 0;
  }
  return round2(total);
}

/**
 * What each person has already been paid and had deducted as TDS this
 * financial year, from earlier runs that went past review. Tax is projected
 * on pay so far plus this month for the months left, and only what is still
 * owed is spread over them — not the full year's tax over the months left,
 * which deducted more every month and the whole year's tax in March.
 */
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
/** A PAN in the PAN format: five letters, four digits, a letter. Anything else is no PAN for section 206AA. */
const hasValidPan = (pan: string | null | undefined) => PAN.test(String(pan || '').trim().toUpperCase());

export type TaxSoFar = { gross: number; tds: number; taxable: number; employerNps: number; basicDa: number; slips: number };

/*
 * Keyed on the pay period, not the day it was paid (audit 7 Nov 2026, #1).
 * March's salary paid on 1 April is March's pay: it belongs to the year that
 * ends that March, it is the last of that year's months, and April's payroll
 * starts the new year from nothing. Payment dates used to decide this, so a
 * March payroll paid in April was taxed as April (twelve months left) with the
 * year's earlier pay forgotten, and April's payroll counted March's in its year.
 */
export async function taxPaidSoFar(orgId: string, run: { id: string; payrollDate: string }, period: { startDate: string; endDate: string }, employeeIds: string[]) {
  /* `taxable` is what income tax reads (taxablePay.ts): taxable earnings and employer NPS, not gross. */
  const out = new Map<string, TaxSoFar>();
  if (!employeeIds.length) return out;
  /* By the period's last day (review of #146, 3): a 26 March to 25 April period is April's, the new year's. */
  const periods = await payrollPrisma.payrollPeriod.findMany({
    where: { orgId, endDate: { gte: financialYearStart(period.endDate), lte: period.endDate } },
    select: { id: true, endDate: true },
  });
  if (!periods.length) return out;
  const endOf = new Map(periods.map((p) => [p.id, p.endDate]));
  const candidates = await payrollPrisma.payrollRun.findMany({
    where: { orgId, id: { not: run.id }, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] }, periodId: { in: periods.map((p) => p.id) } },
    select: { id: true, periodId: true, payrollDate: true },
  });
  /* An earlier month of the year; or, for the same month, another run (a bonus run) paid before this one. */
  const earlier = candidates.filter((r) => String(endOf.get(r.periodId)) < period.endDate || r.payrollDate < run.payrollDate);
  if (!earlier.length) return out;
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId: { in: earlier.map((r) => r.id) }, employeeId: { in: employeeIds }, status: { not: 'CANCELLED' } },
    select: { id: true, employeeId: true, grossEarnings: true },
  });
  const lines = slips.length
    ? await payrollPrisma.salarySlipLine.findMany({
        where: { orgId, slipId: { in: slips.map((x) => x.id) } },
        select: { slipId: true, componentId: true, componentCode: true, type: true, amount: true, isTaxable: true },
      })
    : [];
  const components = new Map(
    (
      await payrollPrisma.salaryComponent.findMany({
        where: { orgId, id: { in: [...new Set(lines.map((l) => l.componentId))] } },
        select: { id: true, code: true, statutoryScheme: true, taxSection: true },
      })
    ).map((c) => [c.id, c])
  );
  const linesBySlip = new Map<string, typeof lines>();
  for (const l of lines) linesBySlip.set(l.slipId, [...(linesBySlip.get(l.slipId) || []), l]);
  for (const x of slips) {
    const own = linesBySlip.get(x.id) || [];
    const tds = own.filter((l) => l.type === 'DEDUCTION' && components.get(l.componentId)?.statutoryScheme === 'TDS').reduce((t, l) => t + Number(l.amount), 0);
    const pay = taxablePayOf(own.map((l) => ({ type: l.type, amount: l.amount, isTaxable: l.isTaxable, code: l.componentCode, employerNps: isEmployerNps(components.get(l.componentId)) })));
    const cur = out.get(x.employeeId) || { gross: 0, tds: 0, taxable: 0, employerNps: 0, basicDa: 0, slips: 0 };
    cur.slips += 1;
    cur.gross = round2(cur.gross + Number(x.grossEarnings));
    cur.tds = round2(cur.tds + tds);
    cur.taxable = round2(cur.taxable + pay.taxable);
    cur.employerNps = round2(cur.employerNps + pay.employerNps);
    cur.basicDa = round2(cur.basicDa + pay.basicDa);
    out.set(x.employeeId, cur);
  }
  return out;
}

/**
 * Runs whose payslips count as professional tax taken: approved or further
 * along, never this one. A calculated draft can still change or be thrown
 * away, so it uses up neither the month nor the year.
 */
export const PT_COUNTED_RUNS = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];

export type PtSoFar = { yearToDate: number; thisMonth: number; byState: Map<string, { amount: number; months: number; gross: number }> };

/**
 * Professional tax already on payslips this financial year, by the month the
 * pay is FOR (the pay period), not the day it was paid.
 *
 * Every other approved run counts — the monthly one, an off-cycle bonus run,
 * a second run in the same month — so the ₹2,500 a year holds, the balance
 * month (March) takes what is left in that state, and nobody is taxed twice
 * for one month. The amounts are the PT lines actually deducted.
 *
 * The state is the one the payslip recorded or, on a payslip from before
 * payslips recorded it, the person's state now. A month counts as a month in
 * the state whenever there is a payslip there, whatever PT it took — a month
 * in the nil band is still a month of the year — and its gross pay counts
 * toward the year's pay that sets the balance month's band.
 */
export async function ptPaidSoFar(orgId: string, run: { id: string }, period: { startDate: string }, employeeIds: string[], stateNow: Map<string, string> = new Map()) {
  const out = new Map<string, PtSoFar>();
  if (!employeeIds.length) return out;
  const fyStart = financialYearStart(period.startDate);
  const month = period.startDate.slice(0, 7);
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { gte: fyStart, lte: `${month}-31` } }, select: { id: true, startDate: true } });
  if (!periods.length) return out;
  const startOf = new Map(periods.map((p) => [p.id, p.startDate]));
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { not: run.id }, periodId: { in: periods.map((p) => p.id) }, status: { in: PT_COUNTED_RUNS } }, select: { id: true } });
  if (!runs.length) return out;
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, runId: { in: runs.map((r) => r.id) }, employeeId: { in: employeeIds }, status: { not: 'CANCELLED' } },
    select: { id: true, employeeId: true, periodId: true, grossEarnings: true, statutorySnapshotJson: true },
  });
  const ptComponents = await payrollPrisma.salaryComponent.findMany({ where: { orgId, statutoryScheme: 'PT', type: 'DEDUCTION' }, select: { id: true } });
  const lines = slips.length && ptComponents.length
    ? await payrollPrisma.salarySlipLine.findMany({ where: { orgId, slipId: { in: slips.map((x) => x.id) }, componentId: { in: ptComponents.map((c) => c.id) } }, select: { slipId: true, amount: true } })
    : [];
  const ptBySlip = new Map<string, number>();
  for (const l of lines) ptBySlip.set(l.slipId, (ptBySlip.get(l.slipId) || 0) + Number(l.amount));
  const monthsSeen = new Map<string, Set<string>>();
  for (const x of slips) {
    const amount = ptBySlip.get(x.id) || 0;
    let state = '';
    try {
      const snap = JSON.parse(x.statutorySnapshotJson || '{}');
      state = canonicalState((snap.results || []).find((r: any) => r.scheme === 'PT')?.jurisdiction);
    } catch {
      /* an old payslip without a snapshot */
    }
    state ||= stateNow.get(x.employeeId) || '';
    const cur = out.get(x.employeeId) || { yearToDate: 0, thisMonth: 0, byState: new Map() };
    cur.yearToDate = round2(cur.yearToDate + amount);
    const slipMonth = String(startOf.get(x.periodId) || '').slice(0, 7);
    if (slipMonth === month) cur.thisMonth = round2(cur.thisMonth + amount);
    else if (state) {
      const st = cur.byState.get(state) || { amount: 0, months: 0, gross: 0 };
      st.amount = round2(st.amount + amount);
      st.gross = round2(st.gross + Number(x.grossEarnings || 0));
      const seen = monthsSeen.get(`${x.employeeId}|${state}`) || new Set<string>();
      if (!seen.has(slipMonth)) {
        seen.add(slipMonth);
        st.months += 1;
      }
      monthsSeen.set(`${x.employeeId}|${state}`, seen);
      cur.byState.set(state, st);
    }
    out.set(x.employeeId, cur);
  }
  return out;
}

/**
 * The first month of this financial year the company ran payroll in CLOR
 * (an approved run), or this month when there is none before it. Months
 * before it were paid somewhere else, and CLOR cannot see what PT they took,
 * so the balance month does not charge for them.
 */
export async function firstPayrollMonthInYear(orgId: string, run: { id: string }, period: { startDate: string }) {
  const fyStart = financialYearStart(period.startDate);
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { not: run.id }, status: { in: PT_COUNTED_RUNS } }, select: { periodId: true } });
  if (!runs.length) return period.startDate;
  const earliest = await payrollPrisma.payrollPeriod.findFirst({
    where: { orgId, id: { in: runs.map((r) => r.periodId) }, startDate: { gte: fyStart, lte: period.startDate } },
    orderBy: { startDate: 'asc' },
    select: { startDate: true },
  });
  return earliest?.startDate && earliest.startDate < period.startDate ? earliest.startDate : period.startDate;
}

/**
 * Months of the financial year someone is employed, from joining and leaving
 * dates that fall inside it; 12 when neither does. Only these prorate the
 * year's professional tax — a month in the nil band is not a month away.
 */
export function monthsEmployedInYear(periodStart: string, joined: string | null | undefined, left: string | null | undefined) {
  const fy = financialYearStart(periodStart);
  const index = (iso: string) => (Number(iso.slice(0, 4)) - Number(fy.slice(0, 4))) * 12 + Number(iso.slice(5, 7)) - 4;
  const first = joined && joined > fy ? Math.min(11, Math.max(0, index(joined))) : 0;
  const last = left && left >= fy && index(left) < 12 ? Math.max(0, index(left)) : 11;
  return Math.max(1, last - first + 1);
}

/**
 * Before a run is approved: a payslip that took no professional tax because
 * another run had already taken it this month (ALREADY_THIS_MONTH) is only
 * right while that run still stands. If it was cancelled or sent back since,
 * this run would go out with nil PT for the month — so it must be calculated
 * again first. Returns the people affected.
 */
export async function ptAlreadyTakenElsewhere(orgId: string, run: { id: string; periodId: string }) {
  /*
   * Two runs in one month calculated before either is approved each see no
   * approved PT, so both deduct it. Whichever is approved second is refused
   * for every person whose PT another approved run already took that month;
   * calculating it again then gives nil, because the approved run counts.
   */
  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId }, select: { startDate: true } });
  if (!period) return [];
  const ptComponents = await payrollPrisma.salaryComponent.findMany({ where: { orgId, statutoryScheme: 'PT', type: 'DEDUCTION' }, select: { id: true } });
  if (!ptComponents.length) return [];
  const slips = await payrollPrisma.salarySlip.findMany({ where: { orgId, runId: run.id, status: { not: 'CANCELLED' } }, select: { id: true, employeeId: true } });
  if (!slips.length) return [];
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { orgId, slipId: { in: slips.map((s) => s.id) }, componentId: { in: ptComponents.map((c) => c.id) } }, select: { slipId: true, amount: true } });
  const taking = new Set(lines.filter((l) => Number(l.amount) > 0).map((l) => slips.find((s) => s.id === l.slipId)!.employeeId));
  if (!taking.size) return [];
  const approved = await ptPaidSoFar(orgId, run, period, [...taking]);
  const ids = [...taking].filter((id) => (approved.get(id)?.thisMonth || 0) > 0);
  if (!ids.length) return [];
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = `${MONTHS[Number(period.startDate.slice(5, 7)) - 1]} ${period.startDate.slice(0, 4)}`;
  return ids.map((id) => ({ employeeId: id, name: nameOf.get(id) || 'Unknown employee', month }));
}

export async function ptTakenElsewhereGone(orgId: string, run: { id: string; periodId: string }) {
  const slips = await payrollPrisma.salarySlip.findMany({ where: { orgId, runId: run.id, status: { not: 'CANCELLED' } }, select: { employeeId: true, statutorySnapshotJson: true } });
  const relied = slips
    .filter((x) => {
      try {
        return (JSON.parse(x.statutorySnapshotJson || '{}').results || []).some((r: any) => r.scheme === 'PT' && r.exemptReason === 'ALREADY_THIS_MONTH');
      } catch {
        return false;
      }
    })
    .map((x) => x.employeeId);
  if (!relied.length) return [];
  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId }, select: { startDate: true } });
  if (!period) return [];
  const now = await ptPaidSoFar(orgId, run, period, relied);
  return relied.filter((id) => !((now.get(id)?.thisMonth || 0) > 0));
}

const designationList = (json: string | null | undefined) => {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map((d) => String(d).trim().toLowerCase()).filter(Boolean) : [];
  } catch {
    /* a setting that does not parse leaves nobody out */
    return [];
  }
};

/**
 * What LWF needs to know about the company: how many people payroll has in
 * each state (for a state's size threshold), whether the company says it is
 * covered anyway, and which designations it counts as managers (always left
 * out where the Act leaves managers out) and as supervisors (left out only
 * above the state's pay limit).
 */
export async function lwfSettingsFor(orgId: string) {
  const [setting, profiles] = await Promise.all([
    payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { lwfCoverage: true, lwfManagerDesignations: true, lwfSupervisorDesignations: true } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, payrollStatus: 'IN_PAYROLL' }, select: { professionalTaxState: true } }),
  ]);
  const headcountByState = new Map<string, number>();
  for (const p of profiles) {
    const state = canonicalState(p.professionalTaxState);
    if (state) headcountByState.set(state, (headcountByState.get(state) || 0) + 1);
  }
  const managers = new Set(designationList(setting?.lwfManagerDesignations));
  const supervisors = new Set(designationList(setting?.lwfSupervisorDesignations));
  return {
    coverage: (setting?.lwfCoverage === 'ALWAYS' ? 'ALWAYS' : 'BY_HEADCOUNT') as 'ALWAYS' | 'BY_HEADCOUNT',
    headcountByState,
    roleOf: (designation: string | null | undefined): 'MANAGER' | 'SUPERVISOR' | null => {
      const d = String(designation || '').trim().toLowerCase();
      if (!d) return null;
      return managers.has(d) ? 'MANAGER' : supervisors.has(d) ? 'SUPERVISOR' : null;
    },
  };
}

/**
 * Everything the run needs, in a handful of queries.
 *
 * Read once and passed around, because the alternative is the same rows
 * fetched per employee — which is the difference between a run that takes a
 * second and one that takes a minute.
 */
async function loadRunContext(orgId: string, runId: string) {
  const run = await payrollPrisma.payrollRun.findFirst({ where: { orgId, id: runId } });
  if (!run) throw new Error('No such payroll run.');

  const period = await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId } });
  if (!period) throw new Error('This run has no payroll period.');

  const members = await payrollPrisma.payrollRunEmployee.findMany({
    where: { orgId, runId, inclusion: 'INCLUDED' },
  });
  const employeeIds = members.map((m) => m.employeeId);

  /* This run's own payslips, from a calculation before: what they took is still this run's to take. */
  const ownSlipIds = (await payrollPrisma.salarySlip.findMany({ where: { orgId, runId }, select: { id: true } })).map((s) => s.id);
  /* Earlier periods, for deductions an earlier run carried on (deductionCap.ts). */
  const earlierPeriods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { lt: period.startDate } }, select: { id: true, name: true, startDate: true } });

  const [employees, profiles, inputs, ownAdjustments, carriedAdjustments, assignments] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } } }),
    payrollPrisma.employeePayrollProfile.findMany({ where: { orgId, employeeId: { in: employeeIds } } }),
    payrollPrisma.payrollInput.findMany({ where: { orgId, runId } }),
    payrollPrisma.payrollAdjustment.findMany({
      /* Approved, or taken by this run before: never one another run or a full and final (`settlement:<id>`) has taken. */
      where: { orgId, periodId: run.periodId, employeeId: { in: employeeIds }, OR: [{ status: 'APPROVED' }, { status: 'CONSUMED', consumedByRunId: runId }] },
    }),
    /* Carried by an earlier run (the rest of a deduction it could not take), not yet taken by another. */
    earlierPeriods.length
      ? payrollPrisma.payrollAdjustment.findMany({
          where: {
            orgId,
            employeeId: { in: employeeIds },
            periodId: { in: earlierPeriods.map((p) => p.id) },
            carriedByRunId: { not: runId },
            OR: [{ status: 'APPROVED' }, { status: 'CONSUMED', consumedByRunId: runId }],
          },
        })
      : Promise.resolve([]),
    /* Every assignment for these people that could cover the period end; the
       right one per person is picked in memory. */
    payrollPrisma.salaryAssignment.findMany({
      where: {
        orgId,
        employeeId: { in: employeeIds },
        status: { not: 'CANCELLED' },
        effectiveFrom: { lte: period.endDate },
      },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);

  const structureIds = [...new Set(assignments.map((a) => a.structureId))];
  const structures = await payrollPrisma.salaryStructure.findMany({
    where: { orgId, id: { in: structureIds } },
    include: { components: true },
  });
  /* Four rules for four hundred people: read once, applied per employee. */
  const statutoryRules = await loadRules(orgId);

  /* Loan instalments falling due this period, and those carried from earlier
     runs, read in one query for the same reason. */
  const loanDue = await recoveriesDue(orgId, run.periodId, employeeIds, { runId, periodStart: period.startDate, ownSlipIds });

  /*
   * What this run carried itself, from a calculation before, is undone here
   * in memory: the rest goes back on what it came from, so recalculating sees
   * the deduction whole again. The rows go when the payslips are written.
   */
  const [ownCarriedInstallments, ownCarriedAdjustments] = await Promise.all([
    payrollPrisma.payrollLoanInstallment.findMany({ where: { orgId, carriedByRunId: runId } }),
    payrollPrisma.payrollAdjustment.findMany({ where: { orgId, carriedByRunId: runId } }),
  ]);
  const backOnInstallment = new Map<string, number>();
  const backPrincipal = new Map<string, number>();
  for (const c of ownCarriedInstallments) {
    if (!c.carriedFromId) continue;
    backOnInstallment.set(c.carriedFromId, round2((backOnInstallment.get(c.carriedFromId) || 0) + Number(c.dueAmount)));
    backPrincipal.set(c.carriedFromId, round2((backPrincipal.get(c.carriedFromId) || 0) + Number(c.principalAmount)));
  }
  const backOnAdjustment = new Map<string, number>();
  for (const c of ownCarriedAdjustments) if (c.carriedFromId) backOnAdjustment.set(c.carriedFromId, round2((backOnAdjustment.get(c.carriedFromId) || 0) + Number(c.amount)));
  const recoveries = loanDue.map((r) => {
    const back = backOnInstallment.get(r.installmentId) || 0;
    if (!back) return r;
    const due = round2(r.dueAmount + back);
    /* Principal and interest put back as they were carried: a ₹0 take left no split on the row itself to go by. */
    const principal = round2(Math.min(due, r.principalAmount + (backPrincipal.get(r.installmentId) || 0)));
    return { ...r, dueAmount: due, principalAmount: principal, interestAmount: round2(due - principal) };
  });
  const adjustments = [...ownAdjustments, ...carriedAdjustments]
    /* Holders of what this run carried sit in its own period: not deductions of their own. */
    .filter((a) => a.carriedByRunId !== runId)
    .map((a) => (backOnAdjustment.has(a.id) ? { ...a, amount: new Prisma.Decimal(round2(Number(a.amount) + backOnAdjustment.get(a.id)!)) } : a));
  const periodName = new Map([...earlierPeriods.map((p) => [p.id, p.name] as const), [period.id, period.name] as const]);
  const periodStart = new Map(earlierPeriods.map((p) => [p.id, p.startDate]));

  /*
   * Components a payslip can name.
   *
   * The structure's own, plus every component an adjustment or a loan recovery
   * points at. Those are almost never in a structure — a structure locks its
   * components the moment anybody is assigned to it, so a bonus or a loan
   * deduction added afterwards lives outside every structure in the company.
   *
   * Reading only the structure's left those lines named "Adjustment" and "Loan
   * recovery" on the payslip, with no ledger mapping: the person could not see
   * what they had been paid for, two different bonuses collapsed into one
   * column on the register, and posting fell back to looking the mapping up
   * again. The names are the component's; this is where they come from.
   */
  const componentIds = [
    ...new Set([
      ...structures.flatMap((s) => s.components.map((c) => c.componentId)),
      ...adjustments.map((a) => a.componentId),
      ...recoveries.map((r) => r.componentId),
    ]),
  ];

  /*
   * And the components that reach people without a structure.
   *
   * A component can say it applies to everybody, or to everybody matching a
   * set of conditions — see services/payroll/eligibility.ts. Those are not on
   * anybody's structure by definition, so reading only the structures' would
   * leave them out of the run entirely and the rule would do nothing at all.
   *
   * Read for the whole org rather than per employee: it is one query for a
   * handful of rows, and whether each one applies is decided per person
   * afterwards, in memory.
   */
  const components = await payrollPrisma.salaryComponent.findMany({
    where: {
      orgId,
      OR: [
        /* Named by a structure, an adjustment or a recovery — wanted whatever
           its state, because a payslip that already carries the line still has
           to be able to name it. */
        { id: { in: componentIds } },
        /* Reaching people on its own, which only a live component may do. */
        { isActive: true, appliesTo: { in: ['ALL_EMPLOYEES', 'CONDITIONS'] } },
      ],
    },
    include: { conditions: { orderBy: { displayOrder: 'asc' } }, employeeTargets: true },
  });

  const taxSoFar = await taxPaidSoFar(orgId, run, period, employeeIds);
  /* The year this payroll's tax belongs to: the pay period's, never the payment date's (#1). */
  const taxYear = financialYearOf(period.endDate);
  const openingYtd = await openingFor(orgId, taxYear, employeeIds);
  const firstPayrollYear = await firstPayrollYearOf(orgId);
  const lwfSettings = await lwfSettingsFor(orgId);
  const ptFirstMonth = await firstPayrollMonthInYear(orgId, run, period);
  const ptSoFar = await ptPaidSoFar(orgId, run, period, employeeIds, new Map(profiles.map((p) => [p.employeeId, canonicalState(p.professionalTaxState)])));
  const taxDeclarations = new Map(
    (
      await payrollPrisma.taxDeclaration.findMany({ where: { orgId, financialYear: taxYear, employeeId: { in: employeeIds } } })
    ).map((d) => [d.employeeId, d])
  );
  /* With no declaration, the regime this year's first payslip went out on, never next year's choice on the profile (re-review of #146, S1). */
  const yearRegime = await yearRegimes(orgId, employeeIds, taxYear, runId);

  return {
    ownSlipIds,
    periodName,
    periodStart,
    capRule: await capSetting(orgId),
    statutoryRules,
    taxDeclarations,
    yearRegime,
    taxSoFar,
    taxYear,
    openingYtd,
    firstPayrollYear,
    lwfSettings,
    ptSoFar,
    ptFirstMonth,
    recoveriesByEmployee: recoveries.reduce((m, r) => {
      const list = m.get(r.employeeId) || [];
      list.push(r);
      m.set(r.employeeId, list);
      return m;
    }, new Map<string, DueRecovery[]>()),
    run,
    period,
    members,
    employees: new Map(employees.map((e) => [e.id, e])),
    profiles: new Map(profiles.map((p) => [p.employeeId, p])),
    inputs: new Map(inputs.map((i) => [i.employeeId, i])),
    adjustmentsByEmployee: adjustments.reduce((m, a) => {
      const list = m.get(a.employeeId) || [];
      list.push(a);
      m.set(a.employeeId, list);
      return m;
    }, new Map<string, typeof adjustments>()),
    assignments,
    structures: new Map(structures.map((s) => [s.id, s])),
    components: new Map(components.map((c) => [c.id, c])),
  };
}

/** The salary in force on a day — the same rule the effective endpoint uses. */
function assignmentOn(ctx: LoadedRun, employeeId: string, onDate: string) {
  return (
    ctx.assignments.find(
      (a) =>
        a.employeeId === employeeId &&
        a.effectiveFrom <= onDate &&
        (!a.effectiveTo || a.effectiveTo >= onDate)
    ) || null
  );
}

/**
 * What the engine is asked to calculate for one person.
 *
 * Two sources, and they meet here. The salary structure they are assigned to
 * is the spine — basic, HRA, PF — and is the same for everyone on it. Beside
 * it are the components that reach people on their own terms: applying to
 * everybody, or to everybody matching a set of conditions, or to one person
 * who has been named. See services/payroll/eligibility.ts for why those exist
 * at all; the short version is that the alternative was forking a structure
 * per exception, and forked structures drift.
 *
 * A structure line is still checked, because a component on a structure can
 * also carry an exclusion — "this allowance, but not for Priya" — and the
 * exclusion has to win there too, or the only way to honour it would be a
 * second structure, which is the thing being avoided.
 */
function engineComponentsFor(
  ctx: LoadedRun,
  structureId: string,
  facts: EligibilityFacts
): { components: EngineComponent[]; skipped: Array<{ code: string; name: string; reason: string }> } {
  const structure = ctx.structures.get(structureId);
  const out: EngineComponent[] = [];
  const skipped: Array<{ code: string; name: string; reason: string }> = [];
  const seen = new Set<string>();
  const period = { periodStart: ctx.period.startDate, periodEnd: ctx.period.endDate };

  const asEngine = (
    c: NonNullable<ReturnType<LoadedRun['components']['get']>>,
    line?: { calculationMethod: string | null; amount: unknown; percentage: unknown; formula: string | null; calculationBase: string | null; isBalancing: boolean; displayOrder: number }
  ): EngineComponent => ({
    componentId: c.id,
    code: c.code,
    name: c.name,
    type: c.type as EngineComponent['type'],
    calculationMethod: (line?.calculationMethod || c.calculationMethod) as EngineComponent['calculationMethod'],
    amount: Number(line?.amount ?? c.amount ?? 0),
    percentage: Number(line?.percentage ?? c.percentage ?? 0),
    formula: line?.formula ?? c.formula ?? null,
    calculationBase: line?.calculationBase ?? c.calculationBase ?? null,
    rounding: c.rounding as EngineComponent['rounding'],
    statutoryScheme: c.statutoryScheme,
    isTaxable: c.isTaxable,
    prorate: c.prorate,
    includeInPfWage: c.includeInPfWage,
    includeInEsiWage: c.includeInEsiWage,
    includeInGratuityWage: c.includeInGratuityWage,
    includeInGross: c.includeInGross,
    includeInNetPay: c.includeInNetPay,
    isVariable: c.isVariable,
    isBalancing: line?.isBalancing ?? false,
    thresholdBase: c.thresholdBase,
    thresholdOperator: c.thresholdOperator,
    thresholdAmount: Number(c.thresholdAmount ?? 0),
    thresholdRangeEnd: Number(c.thresholdRangeEnd ?? 0),
    hasMaxLimit: c.hasMaxLimit,
    maximumAmount: Number(c.maximumAmount ?? 0),
    exceedBehaviour: c.exceedBehaviour,
    displayOrder: line?.displayOrder ?? c.displayOrder,
    expenseLedgerId: c.expenseLedgerId,
    liabilityLedgerId: c.liabilityLedgerId,
  });

  const targeting = (c: { appliesTo: string | null; oneTimeDate: string | null; conditions?: unknown; employeeTargets?: unknown }) => ({
    appliesTo: c.appliesTo,
    oneTimeDate: c.oneTimeDate,
    conditions: (c.conditions as Array<{ field: string; operator: string; value: string | null }>) || [],
    employeeTargets: (c.employeeTargets as Array<{ employeeId: string; mode: string }>) || [],
  });

  for (const line of structure?.components || []) {
    const c = ctx.components.get(line.componentId);
    if (!c) continue;
    const verdict = componentApplies(targeting(c), facts, { onStructure: true, ...period });
    seen.add(c.id);
    if (!verdict.applies) {
      skipped.push({ code: c.code, name: c.name, reason: verdict.reason });
      continue;
    }
    out.push(asEngine(c, line));
  }

  /* The ones that reach this person without going through a structure. */
  for (const c of ctx.components.values()) {
    if (seen.has(c.id)) continue;
    const appliesTo = String(c.appliesTo || 'STRUCTURE').toUpperCase();
    if (appliesTo !== 'ALL_EMPLOYEES' && appliesTo !== 'CONDITIONS') continue;
    const verdict = componentApplies(targeting(c), facts, { onStructure: false, ...period });
    if (!verdict.applies) continue;
    out.push(asEngine(c));
  }

  return { components: out, skipped };
}

/** One person, as the eligibility rules are allowed to see them. */
function factsFor(ctx: LoadedRun, employeeId: string, onDate: string): EligibilityFacts {
  const employee = ctx.employees.get(employeeId);
  const profile = ctx.profiles.get(employeeId);
  const assignment = assignmentOn(ctx, employeeId, onDate);
  const annualCtc = assignment ? Number(assignment.annualCtc || 0) : null;
  return {
    employeeId,
    department: employee?.department ?? null,
    designation: employee?.designation ?? null,
    status: employee?.status ?? null,
    branchId: employee?.branchId ?? null,
    dateOfJoining: employee?.dateOfJoining ?? null,
    payrollStatus: profile?.payrollStatus ?? null,
    payGroupId: profile?.payGroupId ?? null,
    costCenterId: profile?.costCenterId ?? null,
    taxRegime: profile?.taxRegime ?? null,
    professionalTaxState: profile?.professionalTaxState ?? null,
    pfApplicable: profile?.pfApplicable ?? null,
    esiApplicable: profile?.esiApplicable ?? null,
    ptApplicable: profile?.ptApplicable ?? null,
    annualCtc,
    monthlyCtc: assignment ? Number(assignment.monthlyCtc || 0) : null,
    structureId: assignment?.structureId ?? null,
    monthsOfService: monthsOfService(employee?.dateOfJoining ?? null, onDate),
  };
}

/**
 * What a person is paid, worked out in two passes.
 *
 * The statutory schemes need the wages before they can compute — PF is a share
 * of PF wages, ESI applies only under a threshold on ESI wages — and those
 * wages are themselves an output of the structure. So the structure is
 * calculated once with the statutory lines at nil to learn the wages, the
 * schemes are computed on those wages, and the structure is calculated again
 * with the real amounts supplied.
 *
 * Repeated until the wages stop moving. Usually the second pass is final, but
 * not when a balancing component absorbs the company's own contributions: the
 * employer's PF and ESI come out of CTC, the balancing allowance shrinks, and
 * the ESI wages, gross (PT) and taxable pay shrink with it. Computing ESI on
 * the first pass's wages charged it on money nobody was paid. Each round moves
 * by a fraction of the last, so a few rounds settle it.
 */
function calculateWithStatutory(
  ctx: LoadedRun,
  engine: EngineComponent[],
  input: ReturnType<typeof inputFor>,
  assignment: any,
  profile: any,
  periodsPerYear: number,
  /** Taxable one-off adjustment earnings this period (a bonus), counted in the year once, not for every month left (#15). */
  oneOffTaxable = 0
) {
  const engineInput = {
    annualCtc: Number(assignment.annualCtc),
    periodsPerYear,
    workingDays: input.workingDays,
    payableDays: input.payableDays,
    lwpDays: input.lwpDays,
    variableAmounts: { VARIABLE_PAY: input.variablePay, OVERTIME: input.overtimeAmount, OVERTIME_HOURS: input.overtimeHours },
  };

  const firstPass = calculateStructure(engine, engineInput);

  if (!ctx.statutoryRules.size) {
    return { result: firstPass, statutory: { amounts: {}, results: [], versions: {} } };
  }

  /* Months left in the Indian financial year, this one included, which is what TDS spreads over. */
  const monthsRemaining = monthsLeftFor(ctx.period.endDate, ctx.employees.get(assignment.employeeId)?.dateOfLeaving);
  /* CLOR's own earlier payslips this year, plus what was paid before CLOR (opening figures, #2). */
  const soFar = withOpening(ctx.taxSoFar.get(assignment.employeeId), ctx.openingYtd.get(assignment.employeeId));
  const openingPt = ctx.openingYtd.get(assignment.employeeId)?.professionalTax || 0;
  const declaration = ctx.taxDeclarations.get(assignment.employeeId) || null;
  const person = ctx.employees.get(assignment.employeeId);
  const employee = {
    pfApplicable: !!profile?.pfApplicable,
    esiApplicable: !!profile?.esiApplicable,
    ptApplicable: !!profile?.ptApplicable,
    professionalTaxState: profile?.professionalTaxState ?? null,
    /* Maharashtra's women's bands read gender from the People record. */
    gender: person?.gender ?? null,
    /* LWF leaves out the company's managers, and its supervisors above a state's pay limit. */
    lwfRole: ctx.lwfSettings.roleOf(person?.designation),
    /* The year's declaration, where there is one, says which regime they chose. */
    taxRegime: ((declaration?.regime || ctx.yearRegime.get(assignment.employeeId) || profile?.taxRegime) as 'OLD' | 'NEW') || 'NEW',
    /* The old regime's senior and very senior slabs, from the date of birth on the People record. */
    ageBand: ageBandFor(person?.dateOfBirth, ctx.period.endDate),
    /* Without a valid PAN, section 206AA's 20%. */
    hasPan: hasValidPan(profile?.pan),
  };
  const previous = previousEmployerOf(declaration);
  const ptSoFar = ctx.ptSoFar.get(assignment.employeeId) || { yearToDate: 0, thisMonth: 0, byState: new Map() };
  /* The year from this period: what earlier payslips had, plus this period's for the periods left. Other frequencies keep the simple annualisation. */
  const forYear = (sofar: number, now: number, once = 0) => round2(periodsPerYear === 12 ? sofar + now * monthsRemaining + once : (now + once) * periodsPerYear);
  const taxablePay = (pass: ReturnType<typeof calculateStructure>) =>
    taxablePayOf(
      pass.lines.map((l) => ({ type: l.type, amount: l.amount, isTaxable: l.isTaxable, code: l.code, employerNps: isEmployerNps(ctx.components.get(l.componentId)) }))
    );
  /*
   * Variable pay and overtime this month happened once (#15): projecting them
   * for every month left taxed a ₹1 lakh March-quarter bonus in October as six
   * lakh. They count in the year once, with this period's one-off adjustments;
   * only the rest of this month's pay is what the months left will repeat.
   */
  const oneOffInPass = (pass: ReturnType<typeof calculateStructure>) =>
    taxablePayOf(
      pass.lines
        .filter((l) => {
          const c = ctx.components.get(l.componentId);
          /* Entered each month (VARIABLE) only: a FIXED component flagged isVariable is standing pay, and repeats (review of #146, 8). */
          return c?.calculationMethod === 'VARIABLE';
        })
        .map((l) => ({ type: l.type, amount: l.amount, isTaxable: l.isTaxable, code: l.code, employerNps: isEmployerNps(ctx.components.get(l.componentId)) }))
    ).taxable;
  const annualTaxable = (pass: ReturnType<typeof calculateStructure>) => {
    const once = oneOffInPass(pass);
    return forYear(soFar.taxable, taxablePay(pass).taxable - once, once + oneOffTaxable);
  };
  /* Basic and DA (or PF wages, where a structure names them otherwise) and HRA, for the HRA exemption. */
  const byCode = (pass: ReturnType<typeof calculateStructure>, codes: string[]) =>
    pass.lines.filter((l) => l.type === 'EARNING' && codes.includes(l.code.toUpperCase())).reduce((t, l) => t + l.amount, 0);
  const statutoryOn = (pass: ReturnType<typeof calculateStructure>) =>
    applyStatutory({
      rules: ctx.statutoryRules,
      onDate: ctx.run.payrollDate,
      /* PT and LWF: the month the pay is for. */
      levyDate: ctx.period.startDate,
      /* Income tax: the year the pay is for, so March paid in April takes March's rule (#1). */
      taxDate: ctx.period.endDate,
      wages: {
        pfWage: pass.pfWage,
        esiWage: pass.esiWage,
        gross: pass.grossEarnings,
        /* Taxable earnings and employer NPS, never plain gross: a reimbursement is paid but not taxed. */
        annualTaxable: annualTaxable(pass),
        employerNps: forYear(soFar.employerNps, taxablePay(pass).employerNps),
        /* Basic and DA (PF wages where a structure names them otherwise), for the NPS limit. */
        npsWage: forYear(soFar.basicDa || 0, taxablePay(pass).basicDa || pass.pfWage),
        previousEmployer: previous ? { income: previous.income, tds: previous.tds } : null,
      },
      employee,
      components: engine.map((c) => ({ code: c.code, statutoryScheme: c.statutoryScheme, type: c.type })),
      monthsRemaining: Math.max(1, monthsRemaining),
      taxAlreadyDeducted: periodsPerYear === 12 ? soFar.tds : 0,
      ptSoFar,
      /* The year's professional tax: what payslips took, this period's for the periods left, and a previous employer's (engine caps it at ₹2,500). */
      professionalTaxFor: (ptNow) => round2(forYear(ptSoFar.yearToDate, ptNow) + (previous?.professionalTax || 0) + openingPt),
      /* From joining (or the company's first month on CLOR this year, if later) to leaving or March. */
      ptMonthsEmployed: monthsEmployedInYear(
        ctx.period.startDate,
        [person?.dateOfJoining || '', ctx.ptFirstMonth].sort().pop() || null,
        person?.dateOfLeaving
      ),
      lwf: { headcountByState: ctx.lwfSettings.headcountByState, coverage: ctx.lwfSettings.coverage },
      taxDeductionsFor: declaration
        ? (employeePf) => {
            const d = deductionsFor(declaration, {
              basic: (byCode(pass, ['BASIC', 'DA']) || pass.pfWage) * periodsPerYear,
              hra: byCode(pass, ['HRA']) * periodsPerYear,
              employeePf: employeePf * periodsPerYear,
            });
            return { total: d.total, note: d.basis === 'VERIFIED' ? 'verified deductions' : 'declared deductions' };
          }
        : undefined,
    });

  let result = firstPass;
  let statutory = statutoryOn(firstPass);
  let settled = !Object.keys(statutory.amounts).length;
  for (let round = 0; round < 6 && !settled; round += 1) {
    result = calculateStructure(engine, { ...engineInput, statutoryAmounts: statutory.amounts });
    /* Worked out again on the wages this pass actually pays. */
    const again = statutoryOn(result);
    settled = JSON.stringify(again.amounts) === JSON.stringify(statutory.amounts);
    statutory = again;
  }
  if (!settled) result = calculateStructure(engine, { ...engineInput, statutoryAmounts: statutory.amounts });
  return { result, statutory };
}

/** Days in the period, and the input a run was given for one person. */
function inputFor(ctx: LoadedRun, employeeId: string) {
  const stored = ctx.inputs.get(employeeId);
  const periodDays = daysBetween(ctx.period.startDate, ctx.period.endDate);
  const employee = ctx.employees.get(employeeId);

  /*
   * Joining or leaving mid-period reduces payable days by default, because
   * that is what actually happened — somebody who joined on the 16th is not
   * owed a full month, and expecting payroll staff to work the fraction out by
   * hand is how a month's salary gets paid to a person who worked a week.
   */
  let payable = periodDays;
  if (employee?.dateOfJoining && employee.dateOfJoining > ctx.period.startDate) {
    payable -= daysBetween(ctx.period.startDate, employee.dateOfJoining) - 1;
  }
  if (employee?.dateOfLeaving && employee.dateOfLeaving < ctx.period.endDate) {
    payable -= daysBetween(employee.dateOfLeaving, ctx.period.endDate) - 1;
  }
  payable = Math.max(0, payable);

  return {
    workingDays: stored ? Number(stored.workingDays) || periodDays : periodDays,
    payableDays: stored ? Number(stored.payableDays) : payable,
    lwpDays: stored ? Number(stored.lwpDays) || 0 : 0,
    variablePay: stored ? Number(stored.variablePay) || 0 : 0,
    overtimeAmount: stored ? Number(stored.overtimeAmount) || 0 : 0,
    overtimeHours: stored ? Number(stored.overtimeHours) || 0 : 0,
    source: stored?.source || 'DERIVED',
    derived: !stored,
  };
}

/**
 * What would stop this run producing a payslip somebody could defend.
 *
 * Errors block; warnings do not. The distinction is whether the payslip would
 * be wrong or merely surprising — no salary assignment is wrong, a net pay that
 * has moved 40% is surprising and often correct.
 */
export async function validateRun(orgId: string, runId: string): Promise<{ issues: RunIssue[]; byEmployee: Map<string, RunIssue[]> }> {
  const ctx = await loadRunContext(orgId, runId);
  const issues: RunIssue[] = [];
  const byEmployee = new Map<string, RunIssue[]>();
  /* Bank details approved in the last 30 days (not the first ones on file), and changes still waiting. */
  const recentBank = await payrollPrisma.bankDetailChange.findMany({
    where: { orgId, employeeId: { in: ctx.members.map((m) => m.employeeId) }, OR: [{ status: 'PENDING' }, { status: 'APPROVED', decidedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, oldAccountNumber: { not: null } }] },
    select: { employeeId: true, status: true, decidedAt: true },
  });
  const bankChanges = new Map(recentBank.filter((c) => c.status === 'APPROVED' && c.decidedAt).map((c) => [c.employeeId, c.decidedAt!]));
  const pendingBank = new Set(recentBank.filter((c) => c.status === 'PENDING').map((c) => c.employeeId));

  const add = (issue: RunIssue) => {
    issues.push(issue);
    if (issue.employeeId) {
      const list = byEmployee.get(issue.employeeId) || [];
      list.push(issue);
      byEmployee.set(issue.employeeId, list);
    }
  };

  if (ctx.period.isLocked) {
    add({ severity: 'ERROR', code: 'PERIOD_LOCKED', message: `${ctx.period.name} is closed, so no payroll can be run for it.` });
  }
  if (!ctx.members.length) {
    add({ severity: 'ERROR', code: 'NO_EMPLOYEES', message: 'Nobody is included in this run.' });
  }

  /* A second run over the same people and period would pay them twice. */
  const siblings = await payrollPrisma.payrollRun.findMany({
    where: {
      orgId,
      periodId: ctx.run.periodId,
      id: { not: runId },
      status: { in: ['CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED', 'PAID', 'POSTED'] },
    },
    select: { id: true, number: true },
  });
  if (siblings.length) {
    const otherSlips = await payrollPrisma.salarySlip.findMany({
      where: { orgId, runId: { in: siblings.map((s) => s.id) }, employeeId: { in: ctx.members.map((m) => m.employeeId) } },
      select: { employeeId: true, number: true },
    });
    for (const slip of otherSlips) {
      add({
        severity: 'ERROR',
        code: 'ALREADY_PAID_THIS_PERIOD',
        employeeId: slip.employeeId,
        message: `Already has a payslip for ${ctx.period.name} (${slip.number}).`,
      });
    }
  }

  /* The statutory rules the trial calculations used, for the check-before-use warning. */
  const rulesUsed = new Set<string>();
  const openingChecked = tdsInForce(ctx);
  for (const member of ctx.members) {
    const employee = ctx.employees.get(member.employeeId);
    if (!employee) {
      add({ severity: 'ERROR', code: 'NO_EMPLOYEE', employeeId: member.employeeId, message: 'This person no longer exists.' });
      continue;
    }
    const who = employee.name;
    const profile = ctx.profiles.get(employee.id);

    /*
     * Earlier months of the year paid before CLOR (#2). Without them the tax
     * for the rest of the year is worked out on part of a year's pay, so too
     * little comes off every month and the year ends short. Per person
     * (openingNeededFor): employed before this period, no CLOR payslip
     * earlier in the year, nothing entered.
     */
    const openingNeed = openingChecked
      ? openingNeededFor(
          ctx.period,
          { dateOfJoining: employee.dateOfJoining, earlierSlips: ctx.taxSoFar.get(employee.id)?.slips || 0, hasOpening: ctx.openingYtd.has(employee.id) },
          { taxYear: ctx.taxYear, firstPayrollYear: ctx.firstPayrollYear }
        )
      : false;
    if (openingNeed === 'ERROR') {
      add({
        severity: 'ERROR',
        code: 'NO_OPENING_YTD',
        employeeId: employee.id,
        message: `${who} was employed here before ${monthWords(ctx.period.startDate)} but has no earlier payslip in CLOR this year, and income tax for the rest of the year needs what this company paid them from April (or from joining) and the tax taken from it. Enter it in Payroll › Tax declarations › Earlier this year, even if it was nil; or, if ${ctx.taxYear} is the company's first year of paying salaries, say so there.`,
      });
    } else if (openingNeed === 'WARNING') {
      add({
        severity: 'WARNING',
        code: 'NO_OPENING_YTD',
        employeeId: employee.id,
        message: `${who} joined on ${String(employee.dateOfJoining).slice(0, 10)}, just before this period, and has no earlier payslip in CLOR this year. If anything was paid to them before this payroll, enter it in Payroll › Tax declarations › Earlier this year so the year's tax is right.`,
      });
    }

    /*
     * Being in the staff directory is not being in payroll.
     *
     * A payroll profile is where somebody's bank account, PAN and UAN live,
     * and which statutory schemes apply to them. Without one there is nowhere
     * to pay the money, no number to deduct tax against, and nothing to file.
     *
     * The rule was described in the eligibility filter above — "they are
     * eligible and will fail validation with a reason" — and the reason was
     * never written. So a run happily paid people with no profile while
     * payroll's own setup screen, which counts profiles, said nobody was in
     * payroll. Seven payslips and a screen saying there was no one: both
     * correct, because they were counting different things.
     */
    if (!profile) {
      add({
        severity: 'ERROR',
        code: 'NO_PAYROLL_PROFILE',
        employeeId: employee.id,
        message: `${who} is on the staff list but not in payroll — no bank account, PAN or statutory details. Add their payroll details, or take them out of this run.`,
      });
      continue;
    }

    if (profile.payrollStatus !== 'IN_PAYROLL') {
      /* Held after they were included: somebody put them on hold between the
         run being started and being checked. */
      add({
        severity: 'ERROR',
        code: 'NOT_IN_PAYROLL',
        employeeId: employee.id,
        message: `${who} is ${String(profile.payrollStatus || 'not in payroll').toLowerCase().replace(/_/g, ' ')}, so this payroll cannot pay them.`,
      });
      continue;
    }

    const assignment = assignmentOn(ctx, employee.id, ctx.period.endDate) || assignmentOn(ctx, employee.id, ctx.period.startDate);

    if (!assignment) {
      add({
        severity: 'ERROR',
        code: 'NO_ASSIGNMENT',
        employeeId: employee.id,
        message: `${who} has no salary covering ${ctx.period.name}.`,
      });
      continue;
    }

    const structure = ctx.structures.get(assignment.structureId);
    if (!structure) {
      add({ severity: 'ERROR', code: 'NO_STRUCTURE', employeeId: employee.id, message: `${who}'s salary structure no longer exists.` });
      continue;
    }
    if (structure.effectiveFrom > ctx.period.endDate) {
      add({
        severity: 'ERROR',
        code: 'STRUCTURE_NOT_EFFECTIVE',
        employeeId: employee.id,
        message: `${who} is on ${structure.name}, which only takes effect on ${structure.effectiveFrom}.`,
      });
    }
    if (Number(assignment.annualCtc) <= 0) {
      add({ severity: 'ERROR', code: 'NO_CTC', employeeId: employee.id, message: `${who} has no salary figure.` });
    }

    /*
     * Opening figures that look like a previous employer's (review of #146, 5):
     * somebody who joined after 1 April, with a Form 12B on their declaration,
     * whose "earlier this year" taxable pay is more than this company could
     * have paid them between joining and this period. Counted twice, the
     * previous employer's pay is taxed twice.
     */
    const opening = ctx.openingYtd.get(employee.id);
    const fyStart = financialYearStart(ctx.period.endDate);
    const joined = employee.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : '';
    if (opening && joined > fyStart && previousEmployerOf(ctx.taxDeclarations.get(employee.id) || null) && Number(assignment.annualCtc) > 0) {
      const index = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
      const monthsHere = Math.max(0, index(ctx.period.startDate) - index(joined));
      const possible = round2((Number(assignment.annualCtc) / 12) * monthsHere);
      if (opening.taxablePay > possible + 1) {
        add({
          severity: 'WARNING',
          code: 'OPENING_LOOKS_LIKE_PREVIOUS_EMPLOYER',
          employeeId: employee.id,
          message: `${who}'s pay earlier this year here (₹${opening.taxablePay.toLocaleString('en-IN')} taxable) is more than this company could have paid between joining on ${joined} and now (about ₹${possible.toLocaleString('en-IN')}). A previous employer's pay goes in Form 12B only; entered in both, it is taxed twice.`,
        });
      }
    }

    const input = inputFor(ctx, employee.id);
    if (input.payableDays <= 0) {
      add({
        severity: 'WARNING',
        code: 'ZERO_PAYABLE_DAYS',
        employeeId: employee.id,
        message: `${who} has no payable days, so this payslip would be nil.`,
      });
    }
    if (input.payableDays > input.workingDays) {
      add({
        severity: 'WARNING',
        code: 'PAYABLE_EXCEEDS_WORKING',
        employeeId: employee.id,
        message: `${who} has more payable days than working days.`,
      });
    }

    /* The engine is the authority on whether the numbers work, so it is asked
       rather than guessed at — a circular structure or a negative net is found
       here, before anybody presses Calculate. */
    const { components: engine, skipped } = engineComponentsFor(
      ctx,
      assignment.structureId,
      factsFor(ctx, employee.id, ctx.period.endDate)
    );

    /*
     * A component the rules kept off this payslip, said out loud.
     *
     * Silence here is the failure mode of every rule engine: an allowance
     * stops arriving, the payslip simply does not mention it, and the first
     * anybody knows is the employee asking. A notice at validation time is
     * where that question gets answered before the run.
     */
    for (const s of skipped) {
      add({
        severity: 'INFO',
        code: 'COMPONENT_SKIPPED',
        employeeId: employee.id,
        message: `${who}: ${s.name} does not apply — ${s.reason}.`,
      });
    }

    if (!engine.length) {
      add({
        severity: 'ERROR',
        code: 'EMPTY_STRUCTURE',
        employeeId: employee.id,
        message: `${who} is on ${structure.name}, which has no components.`,
      });
    } else {
      const { result: trial, statutory: trialStatutory } = calculateWithStatutory(
        ctx,
        engine,
        input,
        assignment,
        profile,
        PERIODS_PER_YEAR[structure.frequency] ?? 12,
        oneOffTaxableOf(ctx, ctx.adjustmentsByEmployee.get(employee.id) || [])
      );
      for (const id of stateRulesThatCount(trialStatutory)) rulesUsed.add(id);
      for (const e of trial.errors) {
        add({ severity: 'ERROR', code: e.code, employeeId: employee.id, message: `${who}: ${e.message}` });
      }
      for (const w of trial.warnings) {
        add({ severity: 'WARNING', code: w.code, employeeId: employee.id, message: `${who}: ${w.message}` });
      }
    }

    /* Professional tax and LWF follow the state on the payroll profile; without one, neither is deducted. */
    const ptOn = ctx.statutoryRules.has('PT') && profile.ptApplicable;
    if ((ptOn || ctx.statutoryRules.has('LWF')) && !canonicalState(profile.professionalTaxState)) {
      add({
        severity: 'WARNING',
        code: 'NO_PT_STATE',
        employeeId: employee.id,
        message: `${who} has no state on their payroll details, so no ${ptOn ? 'professional tax or ' : ''}Labour Welfare Fund is deducted. Add the state they work in.`,
      });
    } else if (ptOn && !employee.gender) {
      /* A state with women's bands needs to know; elsewhere gender changes nothing. */
      const row = ruleInForce(ctx.statutoryRules.get('PT') || [], ctx.period.startDate, profile.professionalTaxState);
      const slabs = row ? parseConfig(row.configJson).slabs : null;
      if (Array.isArray(slabs) && slabs.some((s: any) => s.gender === 'FEMALE')) {
        add({
          severity: 'INFO',
          code: 'PT_NO_GENDER',
          employeeId: employee.id,
          message: `${who} has no gender on their People record, so ${stateLabel(String(row!.jurisdiction))} professional tax uses the bands for men. That state has lower bands for women: add their gender if that applies.`,
        });
      }
    }
    /*
     * A state that has a rule, just not one for this month: re-running a month
     * before CLOR's earliest figures (Odisha before April 2026, Madhya
     * Pradesh LWF before 30 January 2026) would deduct nothing without saying.
     */
    const state = canonicalState(profile.professionalTaxState);
    for (const scheme of state ? (['PT', 'LWF'] as const) : []) {
      if (scheme === 'PT' ? !ptOn : !ctx.statutoryRules.has('LWF')) continue;
      const rows = (ctx.statutoryRules.get(scheme) || []).filter((r: any) => canonicalState(r.jurisdiction) === state);
      if (!rows.length || ruleInForce(rows, ctx.period.startDate, state)) continue;
      const first = rows.reduce((a: any, b: any) => (a.effectiveFrom <= b.effectiveFrom ? a : b));
      add({
        severity: 'WARNING',
        code: 'NO_RULE_FOR_MONTH',
        employeeId: employee.id,
        message: `${who}: there is no ${stateLabel(state)} ${scheme === 'PT' ? 'professional tax' : 'Labour Welfare Fund'} rate for ${ctx.period.name}; the first one starts on ${first.effectiveFrom}, so nothing is deducted. Add the rate that applied then in Payroll › Compliance.`,
      });
    }

    /* Not blocking: payroll can be calculated and reviewed without them, and
       only paying needs them. Saying so now saves a scramble on payment day. */
    if (!profile?.bankAccountNumber) {
      add({ severity: 'WARNING', code: 'NO_BANK_ACCOUNT', employeeId: employee.id, message: `${who} has no bank account on file.` });
    }
    /* Changed accounts are where diverted pay goes: worth a second look before paying. */
    const changed = bankChanges.get(employee.id);
    if (changed) {
      add({
        severity: 'WARNING',
        code: 'BANK_CHANGED_RECENTLY',
        employeeId: employee.id,
        message: `${who}'s bank account was changed on ${changed.toISOString().slice(0, 10)}. Confirm it with them before paying.`,
      });
    }
    if (pendingBank.has(employee.id)) {
      add({ severity: 'INFO', code: 'BANK_CHANGE_PENDING', employeeId: employee.id, message: `${who} has a bank change waiting for approval; pay goes to the account on file until then.` });
    }
    /* Not blocking — tax is still withheld — but at 20% (section 206AA), which is money out of their pay. */
    if (!hasValidPan(profile?.pan)) {
      add({
        severity: 'WARNING',
        code: 'NO_PAN',
        employeeId: employee.id,
        message: `${who} has ${profile?.pan ? 'a PAN that is not in the PAN format' : 'no PAN on file'}, so income tax is withheld at 20% (section 206AA) once their income is above the taxable limit. Add their PAN before this run is approved.`,
      });
    }
    if (input.derived) {
      add({
        severity: 'INFO',
        code: 'DAYS_DERIVED',
        employeeId: employee.id,
        message: `${who}'s days were worked out from the period and their dates; nobody has entered them.`,
      });
    }
  }

  /*
   * A state rule CLOR could not confirm from an official notice, used by this
   * run and not yet checked by anybody. Not blocking — the figures are CLOR's
   * best reading — but said once per rule, by state, until HR confirms or
   * corrects it on the Compliance screen.
   */
  const unchecked = [...ctx.statutoryRules.entries()].flatMap(([scheme, rows]) =>
    rows.filter((row: any) => rulesUsed.has(row.id) && ruleNeedsCheck(row)).map((row: any) => ({ ruleId: row.id, scheme, state: stateLabel(String(row.jurisdiction || '')) }))
  );
  if (unchecked.length) {
    /* The same words as the run's "Not ready to approve" notice. */
    add({
      severity: 'WARNING',
      code: 'RULE_NEEDS_CHECK',
      message: `Not ready to approve. This payroll uses figures CLOR could not confirm from an official notice: ${checksSentence(unchecked)}. Check each against the state’s notice, then confirm it, or correct it and calculate again.`,
      ruleId: unchecked[0].ruleId,
    });
  }

  return { issues, byEmployee };
}

/** A deduction that gives way to the share of wages the law allows: a loan instalment, or an advance recovery. */
type Deferrable = {
  key: string;
  kind: 'INSTALLMENT' | 'ADJUSTMENT';
  id: string;
  due: number;
  componentId: string;
  name: string;
  code: string;
  /** Sort key: the period it was carried from, oldest first; this period's own last. */
  order: string;
  component: any;
  recovery?: DueRecovery;
  adjustment?: any;
};
type Carry = { employeeId: string; kind: 'INSTALLMENT' | 'ADJUSTMENT'; id: string; take: number; rest: number; recovery?: DueRecovery; adjustment?: any };

/** Advance recoveries from People (payrollBridge.ts `advance-recover:`), and anything already carried: these give way to the limit. */
export const isDeferrableAdjustment = (a: { id: string; carriedByRunId?: string | null }) => String(a.id).startsWith('advance-recover:') || Boolean(a.carriedByRunId);

export class CarryTakenError extends Error {
  status = 409;
  code = 'CARRY_TAKEN';
}

/**
 * What a run carried on is undone when its payslips go (recalculated or
 * cancelled): the rest goes back on the deduction it came from, and the
 * carried row is removed. Refused when a later run has already taken it, as
 * that run's payslip stands on it.
 */
export async function carriesTakenElsewhere(orgId: string, runId: string) {
  const [inst, adj] = await Promise.all([
    payrollPrisma.payrollLoanInstallment.count({ where: { orgId, carriedByRunId: runId, status: { not: 'PENDING' } } }),
    payrollPrisma.payrollAdjustment.count({ where: { orgId, carriedByRunId: runId, status: { notIn: ['APPROVED', 'DRAFT'] } } }),
  ]);
  return inst + adj;
}

export async function undoCarries(tx: Prisma.TransactionClient, orgId: string, runId: string) {
  const inst = await tx.payrollLoanInstallment.findMany({ where: { orgId, carriedByRunId: runId } });
  const taken = () => new CarryTakenError('A later payroll or a full and final has already taken a deduction this one carried forward. Cancel or recalculate that first.');
  for (const c of inst) {
    /* Removed only while nothing has taken it: checked and removed in one statement, so a settlement paid a moment ago is seen. */
    const gone = await tx.payrollLoanInstallment.deleteMany({ where: { id: c.id, status: 'PENDING' } });
    if (!gone.count) throw taken();
    if (c.carriedFromId) {
      const from = await tx.payrollLoanInstallment.findFirst({ where: { orgId, id: c.carriedFromId } });
      if (from) {
        await tx.payrollLoanInstallment.update({
          where: { id: from.id },
          data: {
            dueAmount: round2(Number(from.dueAmount) + Number(c.dueAmount)),
            principalAmount: round2(Number(from.principalAmount) + Number(c.principalAmount)),
            interestAmount: round2(Number(from.interestAmount) + Number(c.interestAmount)),
          },
        });
      }
    }
  }
  const adj = await tx.payrollAdjustment.findMany({ where: { orgId, carriedByRunId: runId } });
  for (const c of adj) {
    const gone = await tx.payrollAdjustment.deleteMany({ where: { id: c.id, status: { in: ['APPROVED', 'DRAFT'] } } });
    if (!gone.count) throw taken();
    if (c.carriedFromId) {
      const from = await tx.payrollAdjustment.findFirst({ where: { orgId, id: c.carriedFromId } });
      if (from) await tx.payrollAdjustment.update({ where: { id: from.id }, data: { amount: round2(Number(from.amount) + Number(c.amount)) } });
    }
  }
  return { installments: inst.length, adjustments: adj.length, loanIds: [...new Set(inst.map((i) => i.loanId))] };
}

/**
 * What changed since a run was calculated, in words, or null (QA of #82, F4):
 * an adjustment for somebody in it, the days or inputs, a salary, a payroll
 * profile, who is in it, or the payroll settings. The calculation stamps
 * calculatedAt after its own writes, so anything newer was changed by somebody.
 * Sending for review or approving waits until it is calculated again.
 */
export async function runStale(orgId: string, run: { id: string; periodId: string; status: string; calculatedAt: Date | null }): Promise<string | null> {
  if (!run.calculatedAt || !['CALCULATED', 'REVIEW'].includes(run.status)) return null;
  const at = run.calculatedAt;
  const [members, slips] = await Promise.all([
    payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: run.id, inclusion: 'INCLUDED' }, select: { employeeId: true } }),
    payrollPrisma.salarySlip.findMany({ where: { orgId, runId: run.id }, select: { employeeId: true } }),
  ]);
  const ids = members.map((m) => m.employeeId);
  /* Somebody put in or taken out since: the payslips are not for the people in it. */
  const slipFor = new Set(slips.map((x) => x.employeeId));
  const peopleChanged = ids.length !== slipFor.size || ids.some((id) => !slipFor.has(id));
  const structureIds = (await payrollPrisma.salaryAssignment.findMany({ where: { orgId, employeeId: { in: ids }, status: { not: 'CANCELLED' } }, select: { structureId: true } })).map((a) => a.structureId);
  const componentIds = (await payrollPrisma.salaryStructureComponent.findMany({ where: { structureId: { in: structureIds } }, select: { componentId: true } })).map((x) => x.componentId);
  const since = { updatedAt: { gt: at } };
  const [adjustments, inputs, assignments, profiles, settings, loans, instalments, declarations, statutory, structures] = await Promise.all([
    /* A draft is not taken by a calculation, so changing one changes nothing here. */
    payrollPrisma.payrollAdjustment.count({ where: { orgId, employeeId: { in: ids }, status: { not: 'DRAFT' }, ...since, OR: [{ periodId: run.periodId }, { carriedByRunId: { not: null } }] } }),
    payrollPrisma.payrollInput.count({ where: { orgId, runId: run.id, ...since } }),
    payrollPrisma.salaryAssignment.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
    payrollPrisma.employeePayrollProfile.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
    payrollPrisma.payrollSetting.count({ where: { orgId, ...since } }),
    payrollPrisma.payrollLoan.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
    payrollPrisma.payrollLoanInstallment.count({ where: { orgId, loan: { employeeId: { in: ids } }, ...since } }),
    /* A declaration, or pay from before CLOR this year (opening figures, #2): both move the tax. */
    Promise.all([
      payrollPrisma.taxDeclaration.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
      payrollPrisma.payrollOpeningYtd.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
    ]).then((n) => n[0] + n[1]),
    Promise.all([
      payrollPrisma.statutoryScheme.count({ where: { orgId, ...since } }),
      payrollPrisma.statutoryRule.count({ where: { orgId, ...since } }),
      payrollPrisma.employeeStatutoryConfig.count({ where: { orgId, employeeId: { in: ids }, ...since } }),
    ]).then((n) => n.reduce((t, x) => t + x, 0)),
    Promise.all([
      payrollPrisma.salaryStructure.count({ where: { orgId, id: { in: structureIds }, ...since } }),
      payrollPrisma.salaryStructureComponent.count({ where: { structureId: { in: structureIds }, ...since } }),
      payrollPrisma.salaryComponent.count({ where: { orgId, id: { in: componentIds }, ...since } }),
    ]).then((n) => n.reduce((t, x) => t + x, 0)),
  ]);
  const what = [
    adjustments ? 'adjustments' : '',
    inputs ? 'days or inputs' : '',
    peopleChanged ? 'who is in it' : '',
    assignments ? 'salaries' : '',
    profiles ? 'payroll details' : '',
    settings ? 'payroll settings' : '',
    loans || instalments ? 'loans' : '',
    declarations ? 'tax declarations' : '',
    statutory ? 'PF, ESI, tax or PT rules' : '',
    structures ? 'salary structure or components' : '',
  ].filter(Boolean);
  return what.length ? `Changed since it was calculated: ${what.join(', ')}. Calculate again before sending it on.` : null;
}

/** Each loan's outstanding is its schedule's, re-derived rather than decremented. */
export async function rederiveLoans(tx: Prisma.TransactionClient, orgId: string, loanIds: string[]) {
  for (const loanId of [...new Set(loanIds)]) {
    const installments = await tx.payrollLoanInstallment.findMany({ where: { orgId, loanId } });
    const left = installments.filter((i) => i.status === 'PENDING');
    const outstanding = round2(left.reduce((t, i) => t + Number(i.dueAmount), 0));
    const loan = await tx.payrollLoan.findFirst({ where: { orgId, id: loanId }, select: { status: true } });
    if (!loan || !['ACTIVE', 'COMPLETED'].includes(loan.status)) continue;
    await tx.payrollLoan.update({ where: { id: loanId }, data: { outstandingBalance: outstanding, status: left.length ? 'ACTIVE' : 'COMPLETED' } });
  }
}

export type CalculatedSlip = {
  employeeId: string;
  grossEarnings: number;
  totalDeductions: number;
  employerContributions: number;
  netPay: number;
  employerCost: number;
  previousNetPay: number | null;
  variancePercent: number | null;
};

/**
 * Work out every payslip in the run and store them, with their reasoning.
 *
 * Replaces whatever the run held before — recalculating is an ordinary thing to
 * do while a run is still open, and a half-replaced set of payslips is worse
 * than either version.
 */
export class RunBusyError extends Error {
  status = 409;
  code = 'RUN_BUSY';
}

/** What a calculation read was taken by something else before it wrote (a full and final paid meanwhile): worked out again. */
export class RunSourcesMovedError extends Error {
  status = 409;
  code = 'RUN_SOURCES_MOVED';
}

/** Changed while it was being worked out (cancelled, approved): the calculation is not written. */
export class RunNotEditableError extends Error {
  status = 409;
  code = 'RUN_NOT_EDITABLE';
}

/** The statuses a calculation may write over (payrollRuns.ts EDITABLE). */
const CALCULABLE = ['DRAFT', 'CALCULATED', 'REVIEW'];

/** Long enough for the largest calculation; a lease left by a crashed instance frees itself after this. */
export const CALC_LEASE_MS = 10 * 60_000;

/** A run nobody is calculating, or whose calculation has gone quiet past its lease. */
export const leaseFree = () => ({ OR: [{ calcLeaseToken: null }, { calcLeaseUntil: { lt: new Date() } }] });

/**
 * One calculation of a run at a time: two at once read the same carried rows
 * and wrote over each other's payslips (intermittent failures in review).
 *
 * The lock is a lease on the run's own row, taken and let go with one
 * statement each, so it holds no database connection while the calculation
 * runs. (It used to be an advisory lock inside a transaction kept open for the
 * whole calculation; production's payroll pool is one connection, so the
 * calculation waited on itself and timed out. Re-review of PR #82.) A second
 * click waits for the first, then works it out again. The write checks the
 * lease is still this calculation's, so one that outlived its lease writes
 * nothing.
 *
 * Something the calculation read and a full and final settled meanwhile
 * stops the write (RunSourcesMovedError); the calculation is then worked out
 * again from what is left, so nothing is taken twice.
 */
export async function calculateRun(orgId: string, runId: string, userId: string): Promise<{ slips: CalculatedSlip[]; issues: RunIssue[] }> {
  const token = `${process.pid}:${randomUUID()}`;
  const started = Date.now();
  for (;;) {
    const got = await payrollPrisma.payrollRun.updateMany({
      where: { orgId, id: runId, ...leaseFree() },
      data: { calcLeaseToken: token, calcLeaseUntil: new Date(Date.now() + CALC_LEASE_MS) },
    });
    if (got.count) break;
    if (!(await payrollPrisma.payrollRun.count({ where: { orgId, id: runId } }))) throw new Error('No such payroll run.');
    if (Date.now() - started > 180_000) throw new RunBusyError('This payroll is being calculated by somebody else. Try again in a minute.');
    await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 200)));
  }
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await calculateRunLocked(orgId, runId, userId, token);
      } catch (e) {
        if (!(e instanceof RunSourcesMovedError) || attempt >= 3) throw e;
      }
    }
  } finally {
    await payrollPrisma.payrollRun.updateMany({ where: { orgId, id: runId, calcLeaseToken: token }, data: { calcLeaseToken: null, calcLeaseUntil: null } });
  }
}

async function calculateRunLocked(orgId: string, runId: string, userId: string, token: string): Promise<{ slips: CalculatedSlip[]; issues: RunIssue[] }> {
  const { issues } = await validateRun(orgId, runId);
  const blocking = issues.filter((i) => i.severity === 'ERROR');
  if (blocking.length) {
    return { slips: [], issues };
  }

  /* A later run already took what this one carried: its payslip stands on this one's. */
  if (await carriesTakenElsewhere(orgId, runId)) {
    throw new CarryTakenError('A later payroll has already taken a deduction this one carried forward. Cancel or recalculate that payroll first.');
  }

  const ctx = await loadRunContext(orgId, runId);
  const periodsPerYear = (structureId: string) =>
    PERIODS_PER_YEAR[ctx.structures.get(structureId)?.frequency || 'MONTHLY'] ?? 12;

  /* What each person took home last time, for variance. One query. */
  const previousSlips = await payrollPrisma.salarySlip.findMany({
    where: {
      orgId,
      employeeId: { in: ctx.members.map((m) => m.employeeId) },
      periodId: { not: ctx.run.periodId },
      status: { in: ['CALCULATED', 'APPROVED', 'LOCKED', 'PAID'] },
    },
    orderBy: { payrollDate: 'desc' },
    select: { employeeId: true, netPay: true, payrollDate: true },
  });
  const previousByEmployee = new Map<string, number>();
  for (const s of previousSlips) if (!previousByEmployee.has(s.employeeId)) previousByEmployee.set(s.employeeId, Number(s.netPay));

  const results: CalculatedSlip[] = [];
  const writes: { slip: any; lines: any[]; traces: any[] }[] = [];
  /* Which one-off adjustments this calculation actually used, so each can be
     marked spent and traced back to the payroll that spent it. */
  const consumedAdjustmentIds: string[] = [];
  /* Loan instalments this calculation took in full, marked once the payslips
     are written rather than while they are being worked out — the instalment
     records the payslip that recovered it, so it needs the slip to exist. */
  const recoveredInstallments: { employeeId: string; installmentId: string; take: number; due: number; recovery: DueRecovery }[] = [];
  /* What a payslip could not take, carried to the next run (deductionCap.ts). */
  const carries: Carry[] = [];
  /* Payslips that held deductions back, for the run's sentence. */
  const capped: { employeeId: string; carried: number }[] = [];
  /* People whose entered deductions pass the share of wages on their own. */
  const overLimit: { employeeId: string; name: string; counted: number; limit: number; percent: number }[] = [];
  /* Every loan this run touched, whether it recovered from it or not — a loan
     whose instalment was skipped still needs its outstanding re-derived. */
  const loanIdsTouched: string[] = [];

  for (const member of ctx.members) {
    const employee = ctx.employees.get(member.employeeId)!;
    const profile = ctx.profiles.get(employee.id) || null;
    const assignment = assignmentOn(ctx, employee.id, ctx.period.endDate) || assignmentOn(ctx, employee.id, ctx.period.startDate)!;
    const structure = ctx.structures.get(assignment.structureId)!;
    const input = inputFor(ctx, employee.id);
    const adjustments = ctx.adjustmentsByEmployee.get(employee.id) || [];

    const { components: engine } = engineComponentsFor(
      ctx,
      assignment.structureId,
      factsFor(ctx, employee.id, ctx.period.endDate)
    );
    const { result, statutory } = calculateWithStatutory(
      ctx,
      engine,
      input,
      assignment,
      profile,
      periodsPerYear(assignment.structureId),
      oneOffTaxableOf(ctx, adjustments)
    );

    /*
     * Adjustments are added after the structure, not inside it. A bonus is not
     * part of what somebody is on — it happened once, in this period — and
     * folding it into the structure would make the same structure pay
     * different amounts to different people.
     */
    let adjustmentEarnings = 0;
    let adjustmentDeductions = 0;
    /* Loss of pay booked as a deduction (a cut-off correction, a late-mark penalty caught up): not a deduction from wages earned. */
    let lossOfPayDeductions = 0;
    /* Late-mark penalties: count toward the share of wages unless the company's setting says otherwise. */
    let latePenaltyDeductions = 0;
    let reimbursements = 0;
    const adjustmentLines: any[] = [];
    /* Instalments and advance recoveries: taken last, within the share of wages the law allows (deductionCap.ts). */
    const deferrable: Deferrable[] = [];
    for (const adj of adjustments) {
      const component = ctx.components.get(adj.componentId);
      const amount = Number(adj.amount) || 0;
      const isDeduction = adj.type === 'DEDUCTION' || component?.type === 'DEDUCTION';
      if (isDeduction && isDeferrableAdjustment(adj)) {
        const fromPeriod = adj.carriedByRunId ? adj.periodId : null;
        deferrable.push({
          key: `adj:${adj.id}`,
          kind: 'ADJUSTMENT',
          id: adj.id,
          due: amount,
          componentId: adj.componentId,
          name: fromPeriod ? `${component?.name || 'Advance recovery'} (carried from ${ctx.periodName.get(fromPeriod) || 'an earlier month'})` : component?.name || 'Advance recovery',
          code: component?.code || 'ADJUSTMENT',
          order: fromPeriod ? ctx.periodStart.get(fromPeriod) || '0000' : '9999',
          component,
          adjustment: adj,
        });
        continue;
      }
      consumedAdjustmentIds.push(adj.id);
      if (isDeduction) adjustmentDeductions += amount;
      else adjustmentEarnings += amount;
      if (isDeduction && isCorrection(adj)) lossOfPayDeductions += amount;
      if (isDeduction && isLatePenalty(adj)) latePenaltyDeductions += amount;
      if (!isDeduction && String(adj.id).startsWith('expense-claim:')) reimbursements += amount;
      adjustmentLines.push({
        componentId: adj.componentId,
        componentCode: component?.code || 'ADJUSTMENT',
        /* A correction for days an earlier run counted as present says what it corrects: "Correction for 26–30 Sep: 2 days absent". */
        componentName: (isCorrection(adj) || isLatePenalty(adj)) && adj.reason ? adj.reason : component?.name || 'Adjustment',
        type: isDeduction ? 'DEDUCTION' : 'EARNING',
        amount,
        isTaxable: component?.isTaxable ?? true,
        displayOrder: 900,
        expenseLedgerId: component?.expenseLedgerId ?? null,
        liabilityLedgerId: component?.liabilityLedgerId ?? null,
      });
    }

    const grossEarnings = round2(result.grossEarnings + adjustmentEarnings);
    let totalDeductions = round2(result.totalDeductions + adjustmentDeductions);
    let netPay = round2(result.netPay + adjustmentEarnings - adjustmentDeductions);
    const employerCost = round2(result.employerCost + adjustmentEarnings);

    for (const recovery of ctx.recoveriesByEmployee.get(employee.id) || []) {
      loanIdsTouched.push(recovery.loanId);
      const component = ctx.components.get(recovery.componentId);
      const name = component?.name || 'Loan recovery';
      deferrable.push({
        key: `inst:${recovery.installmentId}`,
        kind: 'INSTALLMENT',
        id: recovery.installmentId,
        due: recovery.dueAmount,
        componentId: recovery.componentId,
        name: recovery.carriedFromPeriodId ? `${name} (carried from ${ctx.periodName.get(recovery.carriedFromPeriodId) || 'an earlier month'})` : name,
        code: component?.code || 'LOAN',
        order: recovery.carriedFromPeriodId ? recovery.carriedFromStart || '0000' : '9999',
        component,
        recovery,
      });
    }

    /*
     * Loan instalments and advance recoveries come last, against what is
     * actually left and within the share of wages the law allows: the least
     * of what is due, what the limit leaves and what net pay leaves. What is
     * not taken is not written off: it is carried to the next run, and the
     * payslip says so. Oldest first.
     */
    deferrable.sort((a, b) => a.order.localeCompare(b.order));
    const statutoryDeductions = result.lines
      .filter((l) => l.type === 'DEDUCTION' && engine.find((c) => c.componentId === l.componentId)?.statutoryScheme)
      .reduce((t, l) => t + l.amount, 0);
    const wages = round2(grossEarnings - reimbursements);
    const statutoryCounted = ctx.capRule.countsStatutory ? round2(statutoryDeductions) : 0;
    const counted = round2(totalDeductions - lossOfPayDeductions - (ctx.capRule.countsPenalties ? 0 : latePenaltyDeductions) - (ctx.capRule.countsStatutory ? 0 : statutoryDeductions));
    const cap = capDeductions({ percent: ctx.capRule.percent, wages, counted, netPay, items: deferrable.map((d) => ({ key: d.key, due: d.due })) });
    const carriedHere: { label: string; amount: number }[] = [];
    /* What each recovery actually took, for the payslip's record. */
    const takenOf = new Map<string, number>();
    for (const d of deferrable) {
      const take = cap.taken.get(d.key) || 0;
      if (d.kind === 'ADJUSTMENT') takenOf.set(d.id, take);
      const rest = round2(d.due - take);
      if (d.kind === 'ADJUSTMENT') consumedAdjustmentIds.push(d.id);
      if (take > 0) {
        totalDeductions = round2(totalDeductions + take);
        netPay = round2(netPay - take);
        adjustmentLines.push({
          componentId: d.componentId,
          componentCode: d.code,
          componentName: rest > 0 ? partWords(d.name, take, d.due, Boolean(employee.dateOfLeaving && String(employee.dateOfLeaving).slice(0, 10) <= ctx.period.endDate)) : d.name,
          type: 'DEDUCTION',
          amount: take,
          isTaxable: false,
          displayOrder: d.kind === 'INSTALLMENT' ? 950 : 940,
          expenseLedgerId: d.component?.expenseLedgerId ?? null,
          liabilityLedgerId: d.component?.liabilityLedgerId ?? null,
        });
      }
      if (rest > 0) {
        carriedHere.push({ label: d.name.replace(/ \(carried from [^)]*\)$/, ''), amount: rest });
        carries.push({ employeeId: employee.id, kind: d.kind, id: d.id, take, rest, recovery: d.recovery, adjustment: d.adjustment });
      }
      if (d.kind === 'INSTALLMENT') recoveredInstallments.push({ employeeId: employee.id, installmentId: d.id, take, due: d.due, recovery: d.recovery! });
    }
    const deductionNote = carriedHere.length
      ? {
          percent: ctx.capRule.percent,
          wages,
          limit: cap.limit,
          counted,
          carried: carriedHere,
          total: round2(carriedHere.reduce((t, c) => t + c.amount, 0)),
          /* Why: the limit was reached, or the payslip had nothing left to take from. */
          reason: cap.room <= 0 ? 'LIMIT' : 'NET_PAY',
        }
      : null;
    if (deductionNote) capped.push({ employeeId: employee.id, carried: deductionNote.total });
    /*
     * Only instalments give way; nothing entered is altered here. Statutory
     * deductions alone past the limit are the law's own and only warn; no
     * instalment is taken on top of them (the limit leaves no room). Whatever
     * somebody entered (a fine, a damage recovery, a late-mark penalty) is
     * still taken, so it passes the limit and is gated either way: saved on
     * the run, and sending for review or approving waits until it is reduced
     * or somebody records why it stands (payrollRuns.ts over-limit-reason).
     */
    const limitWords = `${ctx.capRule.percent}% of wages (₹${cap.limit.toLocaleString('en-IN')})`;
    const statutoryAlone = statutoryCounted > cap.limit + 0.005;
    const entered = round2(counted - statutoryCounted);
    if (statutoryAlone) {
      issues.push({
        severity: 'WARNING',
        code: 'STATUTORY_OVER_LIMIT',
        employeeId: employee.id,
        message: `${employee.name}: PF, ESI, professional tax and income tax alone pass ${limitWords}. No loan or advance instalment was taken on top.${entered > 0.005 ? ` ₹${entered.toLocaleString('en-IN')} of other deductions was still taken.` : ''}`,
      });
    }
    if (counted > cap.limit + 0.005 && (!statutoryAlone || entered > 0.005)) {
      overLimit.push({ employeeId: employee.id, name: employee.name, counted, limit: cap.limit, percent: ctx.capRule.percent });
      issues.push({
        severity: 'WARNING',
        code: 'DEDUCTIONS_OVER_LIMIT',
        employeeId: employee.id,
        message: statutoryAlone
          ? `${employee.name}: ₹${entered.toLocaleString('en-IN')} of deductions entered on top of PF, ESI, professional tax and income tax, which already pass ${limitWords}. Reduce them, or record why they stand before sending for review.`
          : `${employee.name}: deductions of ₹${counted.toLocaleString('en-IN')} pass ${limitWords} before any instalment. Reduce them, or record why they stand before sending for review.`,
      });
    }

    const previousNetPay = previousByEmployee.has(employee.id) ? previousByEmployee.get(employee.id)! : null;
    const variancePercent =
      previousNetPay && previousNetPay !== 0 ? round2(((netPay - previousNetPay) / previousNetPay) * 100) : null;

    writes.push({
      slip: {
        accountId: ctx.run.accountId,
        orgId,
        branchId: assignment.branchId || employee.branchId || ctx.run.branchId || null,
        runId,
        employeeId: employee.id,
        periodId: ctx.run.periodId,
        payrollDate: ctx.run.payrollDate,
        grossEarnings,
        totalDeductions,
        employerContributions: result.employerContributions,
        netPay,
        employerCost,
        previousNetPay,
        variancePercent,
        status: 'CALCULATED',
        engineVersion: ENGINE_VERSION,
        /* The snapshots. A payslip reopened next year reads these, never
           today's configuration. */
        employeeSnapshotJson: JSON.stringify({
          employeeId: employee.id,
          name: employee.name,
          code: employee.code,
          designation: employee.designation,
          department: employee.department,
          dateOfJoining: employee.dateOfJoining,
          dateOfLeaving: employee.dateOfLeaving,
          payrollStatus: profile?.payrollStatus ?? null,
          /* The regime the tax was worked out on: what yearRegimes reads back for the rest of the year. */
          taxRegime: ctx.taxDeclarations.get(employee.id)?.regime || ctx.yearRegime.get(employee.id) || profile?.taxRegime || null,
        }),
        assignmentSnapshotJson: JSON.stringify({
          assignmentId: assignment.id,
          structureId: assignment.structureId,
          effectiveFrom: assignment.effectiveFrom,
          annualCtc: Number(assignment.annualCtc),
          monthlyCtc: Number(assignment.monthlyCtc),
          costCenterId: assignment.costCenterId,
        }),
        structureSnapshotJson: JSON.stringify({
          structureId: structure.id,
          name: structure.name,
          frequency: structure.frequency,
          effectiveFrom: structure.effectiveFrom,
          components: engine,
        }),
        inputSnapshotJson: JSON.stringify({
          ...input,
          periodDays: daysBetween(ctx.period.startDate, ctx.period.endDate),
          /* The wages and what counted toward their share, for a leaver's full and final in the same period (fnfRecoveryCap.ts). */
          capBasis: { wages, deducted: round2(counted + [...cap.taken.values()].reduce((t, v) => t + v, 0)) },
        }),
        adjustmentSnapshotJson: JSON.stringify(
          adjustments.map((a) => ({ id: a.id, componentId: a.componentId, amount: takenOf.has(a.id) ? takenOf.get(a.id)! : Number(a.amount), type: a.type, reason: a.reason }))
        ),
        /* Which rule version produced each statutory figure. A rate published
           in October must not change what this payslip says. */
        statutorySnapshotJson: JSON.stringify({
          versions: statutory.versions,
          results: statutory.results.map((r) => ({
            scheme: r.scheme,
            employee: r.employee,
            employer: r.employer,
            employerSplit: r.employerSplit ?? null,
            wageApplied: r.wageApplied,
            rateApplied: r.rateApplied,
            ceilingApplied: r.ceilingApplied,
            explanation: r.explanation,
            exemptReason: r.exemptReason ?? null,
            ruleVersion: r.ruleVersion,
            /* The state whose return a PT or LWF figure belongs on, as it was when paid. */
            jurisdiction: r.jurisdiction ?? null,
            /* LWF in a state with two funds: each fund's share, for its own return. */
            ...(r.funds && r.funds.length > 1 ? { funds: r.funds } : {}),
          })),
        }),
        /* Deductions held to the legal share of wages, and what was carried (deductionCap.ts). */
        deductionNote: deductionNote ?? Prisma.DbNull,
        createdByUserId: userId,
      },
      lines: [
        ...result.lines.map((l) => ({
          accountId: ctx.run.accountId,
          orgId,
          componentId: l.componentId,
          componentCode: l.code,
          componentName: l.name,
          type: l.type,
          amount: l.amount,
          fullAmount: l.fullAmount,
          isTaxable: l.isTaxable,
          displayOrder: l.displayOrder,
          expenseLedgerId: l.expenseLedgerId,
          liabilityLedgerId: l.liabilityLedgerId,
          costCenterId: assignment.costCenterId || profile?.costCenterId || null,
        })),
        ...adjustmentLines.map((l) => ({
          accountId: ctx.run.accountId,
          orgId,
          ...l,
          fullAmount: l.amount,
          costCenterId: assignment.costCenterId || profile?.costCenterId || null,
        })),
      ],
      traces: result.trace.map((t, i) => {
        /* A statutory line's rule text is the scheme's own explanation — the
           ceiling that bound it, or the threshold that exempted it — rather
           than the bare words "PF rule". */
        const component = engine.find((c) => c.code.toUpperCase() === t.code);
        const scheme = component?.statutoryScheme
          ? statutory.results.find((r) => r.scheme === component.statutoryScheme)
          : null;
        return {
        accountId: ctx.run.accountId,
        orgId,
        componentId: t.componentId,
        componentCode: t.code,
        baseLabel: scheme ? 'Statutory wages' : t.baseLabel,
        baseAmount: scheme ? scheme.wageApplied : t.baseAmount,
        ruleText: scheme ? scheme.explanation : t.ruleText,
        formula: t.formula,
        computedAmount: t.computedAmount,
        prorationFactor: t.prorationFactor,
        roundingApplied: t.roundingApplied,
        statutoryRuleId: scheme?.ruleId ?? null,
        statutoryRuleVersion: scheme?.ruleVersion ?? null,
        detailJson: scheme?.employerSplit ? JSON.stringify(scheme.employerSplit) : '{}',
        displayOrder: i,
        };
      }),
    });

    results.push({
      employeeId: employee.id,
      grossEarnings,
      totalDeductions,
      employerContributions: result.employerContributions,
      netPay,
      employerCost,
      previousNetPay,
      variancePercent,
    });
  }

  const totals = results.reduce(
    (t, r) => ({
      gross: t.gross + r.grossEarnings,
      deductions: t.deductions + r.totalDeductions,
      employer: t.employer + r.employerContributions,
      net: t.net + r.netPay,
      cost: t.cost + r.employerCost,
    }),
    { gross: 0, deductions: 0, employer: 0, net: 0, cost: 0 }
  );

  const cappedTotal = round2(capped.reduce((t, c) => t + c.carried, 0));
  /* Rows this calculation read as still owed: approved, or taken by this run before. Never one a full and final has taken since. */
  const live = { OR: [{ status: 'APPROVED' }, { status: 'CONSUMED', consumedByRunId: runId }] };
  await payrollPrisma.$transaction(async (tx) => {
    /*
     * Still this calculation's, and still open: the lease is renewed and the
     * run's row stays locked until this commits, so a cancel, an approval or
     * a calculation that took over a lapsed lease waits or finds it moved.
     */
    const fence = await tx.payrollRun.updateMany({
      where: { orgId, id: runId, calcLeaseToken: token, status: { in: CALCULABLE } },
      data: { calcLeaseUntil: new Date(Date.now() + CALC_LEASE_MS) },
    });
    if (!fence.count) {
      const now = await tx.payrollRun.findFirst({ where: { orgId, id: runId }, select: { status: true, calcLeaseToken: true } });
      if (now && now.calcLeaseToken !== token) throw new RunBusyError('This payroll was being calculated by somebody else at the same time. Try again in a minute.');
      throw new RunNotEditableError(`This payroll is ${String(now?.status || 'gone').toLowerCase()} now and was not calculated. Reload it.`);
    }

    /* What a calculation before carried goes back on what it came from, then is carried again below as this one decides. */
    const undone = await undoCarries(tx, orgId, runId);
    loanIdsTouched.push(...undone.loanIds);

    /* Replaced wholesale: recalculating is ordinary while a run is open, and a
       half-replaced set of payslips is worse than either version. */
    const old = await tx.salarySlip.findMany({ where: { orgId, runId }, select: { id: true } });
    const oldIds = old.map((s) => s.id);
    if (oldIds.length) {
      await tx.payrollCalculationTrace.deleteMany({ where: { slipId: { in: oldIds } } });
      await tx.salarySlipLine.deleteMany({ where: { slipId: { in: oldIds } } });
      await tx.salarySlip.deleteMany({ where: { id: { in: oldIds } } });
    }

    let n = 0;
    for (const w of writes) {
      n += 1;
      const slip = await tx.salarySlip.create({
        data: { ...w.slip, number: `${ctx.run.number}-${String(n).padStart(4, '0')}` },
      });
      if (w.lines.length) await tx.salarySlipLine.createMany({ data: w.lines.map((l) => ({ ...l, slipId: slip.id })) });
      if (w.traces.length) {
        await tx.payrollCalculationTrace.createMany({ data: w.traces.map((t) => ({ ...t, slipId: slip.id })) });
      }

      /* The instalment records which payslip took it, which is what lets
         somebody asked about a recovery answer from the loan. */
      const taken = recoveredInstallments.filter((r) => r.employeeId === w.slip.employeeId && r.take >= r.due).map((r) => r.installmentId);
      if (taken.length) {
        /* Only while still owed (or this run's own from before): one a full and final settled meanwhile is not taken again. */
        const n = await tx.payrollLoanInstallment.updateMany({
          where: { orgId, id: { in: taken }, OR: [{ status: 'PENDING' }, { status: 'RECOVERED', slipId: { in: oldIds } }] },
          data: { status: 'RECOVERED', slipId: slip.id, recoveredAt: new Date() },
        });
        if (n.count !== taken.length) throw new RunSourcesMovedError('A loan instalment this payroll takes was settled meanwhile.');
      }

      /*
       * Part taken (or none): the instalment becomes what this payslip took,
       * and the rest a new instalment carried to the next run. The schedule
       * still adds up to what was lent, and "which month was short" is a row.
       */
      for (const c of carries.filter((x) => x.employeeId === w.slip.employeeId)) {
        if (c.kind === 'INSTALLMENT' && c.recovery) {
          const r = c.recovery;
          const share = r.dueAmount > 0 ? Math.min(1, Math.max(0, r.principalAmount / r.dueAmount)) : 1;
          const takePrincipal = round2(c.take * share);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-loan-schedule:${r.loanId}`}))`;
          const n = await tx.payrollLoanInstallment.updateMany({
            where: { orgId, id: r.installmentId, OR: [{ status: 'PENDING' }, { status: 'RECOVERED', slipId: { in: oldIds } }] },
            data: { dueAmount: c.take, principalAmount: takePrincipal, interestAmount: round2(c.take - takePrincipal), status: 'RECOVERED', slipId: slip.id, recoveredAt: new Date() },
          });
          if (!n.count) throw new RunSourcesMovedError('A loan instalment this payroll takes was settled meanwhile.');
          const last = await tx.payrollLoanInstallment.findFirst({ where: { loanId: r.loanId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
          const restPrincipal = round2(r.principalAmount - takePrincipal);
          await tx.payrollLoanInstallment.create({
            data: {
              accountId: ctx.run.accountId,
              orgId,
              loanId: r.loanId,
              periodId: null,
              sequence: (last?.sequence || 0) + 1,
              dueAmount: c.rest,
              principalAmount: restPrincipal,
              interestAmount: round2(c.rest - restPrincipal),
              status: 'PENDING',
              carriedFromId: r.installmentId,
              carriedByRunId: runId,
              carriedFromPeriodId: ctx.run.periodId,
            },
          });
          loanIdsTouched.push(r.loanId);
        } else if (c.kind === 'ADJUSTMENT' && c.adjustment) {
          const a = c.adjustment;
          const n = await tx.payrollAdjustment.updateMany({ where: { orgId, id: a.id, ...live }, data: { amount: c.take } });
          if (!n.count) throw new RunSourcesMovedError('A deduction this payroll takes was taken by a full and final meanwhile.');
          await tx.payrollAdjustment.create({
            data: {
              accountId: a.accountId,
              orgId,
              branchId: a.branchId,
              employeeId: a.employeeId,
              componentId: a.componentId,
              /* Held in this run's period; the next run for the person takes it (loadRunContext). */
              periodId: ctx.run.periodId,
              type: 'DEDUCTION',
              amount: c.rest,
              reason: `Carried from ${ctx.period.name}: ${String(a.reason || 'advance recovery').replace(/^Carried from [^:]*: /, '')}`.slice(0, 240),
              reference: a.reference,
              status: 'APPROVED',
              approvedAt: new Date(),
              approvedByUserId: a.approvedByUserId,
              carriedFromId: a.id,
              carriedByRunId: runId,
              createdByUserId: userId,
            },
          });
        }
      }
    }


    /*
     * A one-off is spent once.
     *
     * Marked here rather than when it is approved, because approving says it
     * *should* be paid and only a calculation says it *was* — and recording
     * the run that paid it is what lets somebody asked "where did that bonus
     * go" answer from the adjustment rather than by searching payslips.
     *
     * Recalculating is ordinary while a run is open, and it re-consumes the
     * same set: a rerun replaces the payslips wholesale, so the adjustments
     * belong to whichever calculation currently stands.
     */
    const toConsume = [...new Set(consumedAdjustmentIds)];
    const consumed = await tx.payrollAdjustment.updateMany({
      /* Only what is still owed: a row a full and final took meanwhile keeps its settlement, and the whole calculation is worked out again. */
      where: { orgId, id: { in: toConsume }, ...live },
      data: { status: 'CONSUMED', consumedByRunId: runId },
    });
    if (consumed.count !== toConsume.length) throw new RunSourcesMovedError('An adjustment this payroll takes was taken by a full and final meanwhile.');
    /* An adjustment this run consumed before, and no longer does — somebody
       was taken out of the payroll — goes back to being owed. */
    await tx.payrollAdjustment.updateMany({
      where: { orgId, consumedByRunId: runId, id: { notIn: consumedAdjustmentIds } },
      data: { status: 'APPROVED', consumedByRunId: null },
    });

    /*
     * A recalculation un-recovers what it no longer takes.
     *
     * The payslips are replaced wholesale, so an instalment whose payslip has
     * just been deleted must go back to PENDING — otherwise a run recalculated
     * after somebody was taken out of it leaves their loan looking repaid by a
     * payslip that no longer exists.
     */
    const unrecovered = await tx.payrollLoanInstallment.findMany({
      where: { orgId, slipId: { in: oldIds }, status: 'RECOVERED', id: { notIn: recoveredInstallments.map((r) => r.installmentId) } },
      select: { loanId: true },
    });
    await tx.payrollLoanInstallment.updateMany({
      where: { orgId, slipId: { in: oldIds }, status: 'RECOVERED', id: { notIn: recoveredInstallments.map((r) => r.installmentId) } },
      data: { status: 'PENDING', slipId: null, recoveredAt: null },
    });
    loanIdsTouched.push(...unrecovered.map((u) => u.loanId));

    /* Each loan's outstanding is the schedule's, re-derived rather than
       decremented: a counter that drifts from its instalments is a counter
       nobody can trust. */
    await rederiveLoans(tx, orgId, loanIdsTouched);

    await tx.payrollRunEmployee.updateMany({ where: { orgId, runId }, data: { state: 'CALCULATED' } });
    /* Stamped last, so everything this calculation wrote is older than calculatedAt: anything newer changed since (runStale). */
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        status: 'CALCULATED',
        calculatedAt: new Date(),
        engineVersion: ENGINE_VERSION,
        employeeCount: results.length,
        grossTotal: round2(totals.gross),
        deductionTotal: round2(totals.deductions),
        employerContributionTotal: round2(totals.employer),
        netTotal: round2(totals.net),
        employerCostTotal: round2(totals.cost),
        errorCount: 0,
        warningCount: issues.filter((i) => i.severity === 'WARNING').length,
        /* A recalculation starts the over-limit decision again: the figures it was about have been replaced. */
        deductionCap: capped.length || overLimit.length
          ? { percent: ctx.capRule.percent, people: capped.length, carried: cappedTotal, overLimit, overLimitReason: null }
          : Prisma.DbNull,
      },
    });

    /* A pool of one is shared with every other request: wait for it rather than fail, and give a large payroll time to write. */
  }, { maxWait: 30_000, timeout: 120_000 });

  // The earning is canonical; this marker is reconciled after each committed calculation.
  const encashments = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId, id: { startsWith: 'leave-encash:' } } });
  for (const earning of encashments) await peoplePrisma.leaveAdjustment.updateMany({
    where: { orgId, id: earning.id.slice('leave-encash:'.length) },
    data: { paidInRunId: earning.status === 'CONSUMED' ? earning.consumedByRunId : null },
  });

  return { slips: results, issues };
}

